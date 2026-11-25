import {DomainError,categorySummaries} from '@cash-sloth/domain';
import {allocateOrderNumber} from './order-persistence.js';
import {OrderSettingsSchema,OrderSchema,KioskCatalogSchema} from '@cash-sloth/contracts';
import type {OrderStore} from '@cash-sloth/application';
import type {DatabaseConnection} from './connection.js';
import {createPosStore} from './pos-store.js';
import {createPresetStore} from './preset-store.js';
import {createCatalogStore} from './catalog-store.js';
export function createOrderStore(connection:DatabaseConnection):OrderStore{
 const {sqlite}=connection,pos=createPosStore(connection),presets=createPresetStore(connection),catalog=createCatalogStore(connection);
 const check=()=>{if(!sqlite.isTransaction)throw new Error('Order write requires transaction.');};
 const read=(row:Record<string,unknown>)=>OrderSchema.parse({...JSON.parse(String(row['data'])) as object,status:row['status'],cartId:row['cart_id'],source:row['source'],serviceLabel:row['service_label'],preparation:row['prep_status'],revision:row['revision'],paid:['paid','ready','collected'].includes(String(row['status']))});
 return {pos,
 settings:()=>OrderSettingsSchema.parse(JSON.parse(String(sqlite.prepare('SELECT data FROM order_settings WHERE singleton=1').get()?.['data'])) as unknown),
 saveSettings(value){check();sqlite.prepare('UPDATE order_settings SET data=? WHERE singleton=1').run(JSON.stringify(OrderSettingsSchema.parse(value)));},
 resetCounter(){check();const key=presets.active()?.id??'';sqlite.prepare('DELETE FROM order_counters WHERE event_key=?').run(key);if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='rejected_order_numbers'").get())sqlite.prepare('DELETE FROM rejected_order_numbers WHERE event_key=?').run(key);},
 catalog(){const active=presets.active();return KioskCatalogSchema.parse({eventId:active?.id??null,eventTitle:active?.name??'Cash Sloth V3',logo:active?.logo??null,version:presets.catalogVersion(),products:catalog.listProducts().filter(p=>p.active).map(p=>({...p,variants:p.variants.filter(v=>v.active)})).filter(p=>p.variants.length),categories:categorySummaries(catalog.listProducts(),catalog.listCategories(),false),demoMode:connection.ticketMode==='demo'});},
 nextNumber:()=>allocateOrderNumber(connection,presets.active()?.id??null),
 list:()=>sqlite.prepare('SELECT * FROM kiosk_orders ORDER BY rowid DESC').all().map(read),
 get(id){const row=sqlite.prepare('SELECT * FROM kiosk_orders WHERE id=?').get(id);return row?read(row):null;},
 put(order){check();const checked=OrderSchema.parse(order);sqlite.prepare('INSERT INTO kiosk_orders VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cart_id=excluded.cart_id,status=excluded.status,data=excluded.data,source=excluded.source,service_label=excluded.service_label,prep_status=excluded.prep_status,revision=excluded.revision').run(checked.id,checked.number,checked.cartId,checked.status,JSON.stringify(checked),checked.source,checked.serviceLabel,checked.preparation,checked.revision);},
 operation(id){const row=sqlite.prepare('SELECT request,result FROM order_operations WHERE id=?').get(id);const deletedAck=row&&JSON.parse(String(row['result'])) as {deleted?:unknown}|undefined;if(deletedAck?.deleted!==true&&sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='purged_order_operations'").get()&&sqlite.prepare('SELECT 1 FROM purged_order_operations WHERE id=?').get(id))throw new DomainError('NOT_FOUND','This order has been deleted.');return row?{request:String(row['request']),result:String(row['result'])}:null;},
 saveOperation(id,request,result){check();sqlite.prepare('INSERT INTO order_operations VALUES(?,?,?)').run(id,request,result);},
 };
}
