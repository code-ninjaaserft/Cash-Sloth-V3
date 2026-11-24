import {VoucherSchema} from '@cash-sloth/contracts';import {DomainError} from '@cash-sloth/domain';import type {DatabaseConnection} from './connection.js';
export function completeBenefit(connection:DatabaseConnection,cartId:string,saleId:string,at:string):void{
 const {sqlite}=connection;if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='vouchers'").get())return;if(!sqlite.isTransaction)throw new Error('Transaction required.');
 const row=sqlite.prepare('SELECT v.data FROM cart_vouchers c JOIN vouchers v ON v.code=c.code WHERE c.cart_id=?').get(cartId);if(!row)return;const voucher=VoucherSchema.parse(JSON.parse(String(row['data'])) as unknown);
 if(voucher.mode!==(connection.ticketMode??'normal')||voucher.kind==='wallet'||voucher.revokedAt)throw new DomainError('CONFLICT','Reserved voucher is no longer valid.');
 const count=Number(sqlite.prepare('SELECT count(*) n FROM benefit_redemptions WHERE code=?').get(voucher.code)?.['n']??0);if(voucher.maxUses!==null&&count>=voucher.maxUses)throw new DomainError('CONFLICT','Voucher exhausted.');
 sqlite.prepare('INSERT INTO benefit_redemptions VALUES(?,?,?)').run(saleId,voucher.code,at);
 sqlite.prepare('DELETE FROM cart_vouchers WHERE cart_id=?').run(cartId);
}

export function postWalletEntry(connection:DatabaseConnection,entry:{id:string;code:string;sessionId:string;amountRappen:number;kind:'pay'|'cancel'|'refund';at:string}):void{
 const {sqlite}=connection;if(!sqlite.isTransaction||!Number.isSafeInteger(entry.amountRappen))throw new Error('Invalid wallet transaction.');
 const row=sqlite.prepare('SELECT data FROM vouchers WHERE code=?').get(entry.code);if(!row)throw new DomainError('NOT_FOUND','Voucher not found.');const voucher=VoucherSchema.parse(JSON.parse(String(row['data'])) as unknown);if(voucher.kind!=='wallet')throw new DomainError('INVALID_INPUT','Not a value voucher.');
 const previous=BigInt(voucher.value)+BigInt(Number(sqlite.prepare('SELECT COALESCE(sum(amount_rappen),0) n FROM wallet_ledger WHERE code=?').get(entry.code)?.['n']??0));const next=previous+BigInt(entry.amountRappen);if(next<0n||next>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError('OVERFLOW','Voucher balance is outside the supported range.');
 sqlite.prepare('INSERT INTO wallet_ledger VALUES(?,?,?,?,?,?)').run(entry.id,entry.code,entry.sessionId,entry.amountRappen,entry.kind,entry.at);
}
