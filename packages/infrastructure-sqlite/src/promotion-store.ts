import {postWalletEntry} from './promotion-completion.js';
import {DomainError} from '@cash-sloth/domain';
import {VoucherSchema,DiscountTemplateSchema} from '@cash-sloth/contracts';
import type {PromotionStore} from '@cash-sloth/application';
import type {DatabaseConnection} from './connection.js';import {createPosStore} from './pos-store.js';import {createFinanceStore} from './finance-store.js';
export function createPromotionStore(connection:DatabaseConnection):PromotionStore{
 const {sqlite}=connection;const write=()=>{if(!sqlite.isTransaction)throw new Error('Promotion write requires transaction.');};
 return {pos:createPosStore(connection),finance:createFinanceStore(connection),mode:connection.ticketMode??'normal',
 templates:()=>sqlite.prepare('SELECT data FROM discount_templates ORDER BY id').all().map(row=>DiscountTemplateSchema.parse(JSON.parse(String(row['data'])) as unknown)),
 putTemplate(value){write();const checked=DiscountTemplateSchema.parse(value);sqlite.prepare('INSERT INTO discount_templates VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(checked.id,JSON.stringify(checked));},
 removeTemplate(id){write();sqlite.prepare('DELETE FROM discount_templates WHERE id=?').run(id);},
 vouchers:()=>sqlite.prepare('SELECT data FROM vouchers ORDER BY rowid DESC').all().map(row=>VoucherSchema.parse(JSON.parse(String(row['data'])) as unknown)),
 getVoucher(code){const row=sqlite.prepare('SELECT data FROM vouchers WHERE code=?').get(code);return row?VoucherSchema.parse(JSON.parse(String(row['data'])) as unknown):null;},
 putVoucher(value){write();const v=VoucherSchema.parse(value);if((v.mode==='demo')!==v.code.startsWith('AD'))throw new Error('Voucher mode mismatch.');const old=sqlite.prepare('SELECT data FROM vouchers WHERE code=?').get(v.code);if(old){const before=VoucherSchema.parse(JSON.parse(String(old['data'])) as unknown);for(const key of ['id','code','name','kind','value','productId','issuedAt','mode'] as const)if(before[key]!==v[key])throw new DomainError('CONFLICT','Voucher identity and value are immutable.');}sqlite.prepare('INSERT INTO vouchers VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').run(v.code,JSON.stringify(v));},
 uses(code){return Number(sqlite.prepare("SELECT (SELECT count(*) FROM benefit_redemptions WHERE code=?) + (SELECT count(*) FROM wallet_ledger WHERE code=? AND kind='pay')-(SELECT count(*) FROM wallet_ledger WHERE code=? AND kind='cancel') n").get(code,code,code)?.['n']??0);},
 balance(code){const v=sqlite.prepare('SELECT data FROM vouchers WHERE code=?').get(code);const value=v?VoucherSchema.parse(JSON.parse(String(v['data'])) as unknown).value:0;return value+Number(sqlite.prepare('SELECT COALESCE(sum(amount_rappen),0) n FROM wallet_ledger WHERE code=?').get(code)?.['n']??0);},
 reserved(code){return !!sqlite.prepare("SELECT 1 FROM cart_vouchers v JOIN carts c ON c.id=v.cart_id WHERE v.code=? AND c.status='draft' UNION ALL SELECT 1 FROM wallet_ledger l JOIN payment_sessions s ON s.id=l.session_id WHERE l.code=? AND s.state='open' AND l.kind='pay'").get(code,code);},
 bind(cartId,code,at){write();sqlite.prepare('INSERT INTO cart_vouchers VALUES(?,?,?)').run(cartId,code,at);},unbind(cartId){write();sqlite.prepare('DELETE FROM cart_vouchers WHERE cart_id=?').run(cartId);},
 ledger(id){const row=sqlite.prepare('SELECT * FROM wallet_ledger WHERE id=?').get(id);return row?{code:String(row['code']),sessionId:String(row['session_id']),amountRappen:Number(row['amount_rappen']),kind:String(row['kind'])}:null;},
 post(entry){write();postWalletEntry(connection,entry);},
 getOperation(id){const row=sqlite.prepare('SELECT request,result FROM promotion_operations WHERE id=?').get(id);return row?{request:String(row['request']),result:String(row['result'])}:null;},
 putOperation(id,request,result){write();sqlite.prepare('INSERT INTO promotion_operations VALUES(?,?,?)').run(id,request,result);},
 walletForSession(id){const row=sqlite.prepare("SELECT l.code FROM wallet_ledger l JOIN payment_attempts a ON a.id=l.id WHERE l.session_id=? AND l.kind='pay' AND a.state='confirmed' ORDER BY l.rowid LIMIT 1").get(id);return row?String(row['code']):null;},
 };
}
