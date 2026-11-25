import {randomUUID} from 'node:crypto';
import {OrderSettingsSchema,OrderSchema,OrderContextSchema,type OrderContext} from '@cash-sloth/contracts';
import {DomainError,type Cart} from '@cash-sloth/domain';
import type {DatabaseConnection} from './connection.js';
export function hasOrderService(c:DatabaseConnection):boolean{return !!c.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='order_counters'").get();}
export function allocateOrderNumber(c:DatabaseConnection,eventId:string|null):number{
 if(!c.sqlite.isTransaction)throw new Error('Order numbering requires transaction.');const key=eventId??'',last=Number(c.sqlite.prepare('SELECT last_number FROM order_counters WHERE event_key=?').get(key)?.['last_number']??0);
 const used=new Set(c.sqlite.prepare("SELECT number FROM kiosk_orders WHERE source!='table' AND number IS NOT NULL AND coalesce(json_extract(data,'$.eventId'),'')=? AND status!='cancelled' AND (status IN ('waiting','register') OR prep_status NOT IN ('collected','cancelled'))").all(key).map(r=>Number(r['number'])));
 // Reissued rejections do not advance the ordinary event counter.
 if(c.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='rejected_order_numbers'").get()){
  const released=c.sqlite.prepare('SELECT number FROM rejected_order_numbers WHERE event_key=? ORDER BY rowid').all(key);
  for(const row of released){const number=Number(row['number']);c.sqlite.prepare('DELETE FROM rejected_order_numbers WHERE event_key=? AND number=?').run(key,number);if(!used.has(number))return number;}
 }
 for(let offset=1;offset<=99;offset++){const number=(last+offset-1)%99+1;if(!used.has(number)){c.sqlite.prepare('INSERT INTO order_counters VALUES(?,?) ON CONFLICT(event_key) DO UPDATE SET last_number=excluded.last_number').run(key,number);return number;}}
 throw new DomainError('ORDER_NUMBERS_FULL','All 99 order numbers are in use. Finish an open order first.');
}
export function prepareCartOrder(c:DatabaseConnection,cart:Cart,at:string):OrderContext|undefined{
 if(!hasOrderService(c))return undefined;if(!c.sqlite.isTransaction)throw new Error('Order snapshot requires transaction.');
 let rows=c.sqlite.prepare("SELECT * FROM kiosk_orders WHERE cart_id=? AND status!='cancelled' ORDER BY rowid").all(cart.id);
 if(!rows.length){
  if(c.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='order_settings'").get()){const settings=OrderSettingsSchema.parse(JSON.parse(String(c.sqlite.prepare('SELECT data FROM order_settings WHERE singleton=1').get()?.['data'])) as unknown);if(!settings.registerOrders)return undefined;}
  const active=c.sqlite.prepare("SELECT p.id,json_extract(p.data,'$.name') name FROM active_event_preset a JOIN event_presets p ON p.id=a.preset_id WHERE a.singleton=1").get();const eventId=active?String(active['id']):null,number=allocateOrderNumber(c,eventId);
  const saved=OrderSchema.parse({id:'register-'+randomUUID(),number,eventId,eventTitle:active?String(active['name']):'Cash Sloth V3',createdAt:at,cart,status:'register',cartId:cart.id,source:'register',serviceLabel:null,preparation:'received',revision:0,paid:false});
  c.sqlite.prepare('INSERT INTO kiosk_orders VALUES(?,?,?,?,?,?,?,?,?)').run(saved.id,number,cart.id,'register',JSON.stringify(saved),'register',null,'received',0);rows=c.sqlite.prepare('SELECT * FROM kiosk_orders WHERE id=?').all(saved.id);
 }
 const first=rows[0]!;return OrderContextSchema.parse({id:first['id'],number:first['source']==='table'?null:first['number'],numbers:first['source']==='table'?[]:rows.map(r=>Number(r['number'])),source:first['source'],serviceLabel:first['service_label']});
}
