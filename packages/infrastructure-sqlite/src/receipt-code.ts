import {randomUUID} from 'node:crypto';import {ReceiptCodeSchema} from '@cash-sloth/contracts';import type {DatabaseConnection} from './connection.js';
export function ensureReceiptCode(c:DatabaseConnection,saleId:string):string|null{
 if(!c.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='receipt_codes'").get())return null;
 if(!c.sqlite.isTransaction)throw new Error('Receipt code requires a transaction.');
 const current=c.sqlite.prepare('SELECT code FROM receipt_codes WHERE sale_id=?').get(saleId);if(current)return ReceiptCodeSchema.parse(current['code']);
 for(let tries=0;tries<10;tries++){const code=(c.ticketMode==='demo'?'DC':'CC')+randomUUID().replaceAll('-','').slice(0,14).toUpperCase();if(c.sqlite.prepare('SELECT 1 FROM receipt_codes WHERE code=?').get(code))continue;c.sqlite.prepare('INSERT INTO receipt_codes VALUES(?,?)').run(saleId,code);return code;}
 throw new Error('Could not allocate a unique receipt code.');
}
