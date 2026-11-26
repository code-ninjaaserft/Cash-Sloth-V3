import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {createPromotionService,createPosService,createPaymentsService,createHistoryService} from '@cash-sloth/application';import type {Result} from '@cash-sloth/contracts';import {openDatabase,type DatabaseConnection} from './connection.js';import {migrations,runMigrations} from './migrations.js';import {seedDevelopmentCatalog} from './seed.js';import {createPromotionStore} from './promotion-store.js';import {createPosStore} from './pos-store.js';import {createFinanceStore} from './finance-store.js';import {createHistoryStore} from './history-store.js';
function value<T>(result:Result<T>):T{if(!result.ok)throw new Error(result.error.code+': '+result.error.message);return result.value;}
describe('discounts and local vouchers',()=>{
 let db:DatabaseConnection,directory:string,seq:number;const runtime={newId:()=>`promotion-${++seq}`,now:()=> '2026-11-24T12:00:00.000Z',newVoucherCode:(mode:'normal'|'demo')=>(mode==='demo'?'AD':'AC')+(++seq).toString(16).padStart(14,'0').toUpperCase()};
 const promo=()=>createPromotionService(createPromotionStore(db),runtime),pos=()=>createPosService(createPosStore(db),runtime),pay=()=>createPaymentsService(createFinanceStore(db),runtime);
 beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),'sloth-promotions-'));db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);seedDevelopmentCatalog(db,'development');seq=0;});afterEach(()=>{db.close();rmSync(directory,{recursive:true,force:true,maxRetries:5});});
 const cart=(quantity=1)=>{let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-default'}));return quantity===1?c:value(pos().setQuantity({cartId:c.id,expectedRevision:c.revision,lineId:c.items[0]!.id,quantity}));};
 const issue=(kind:'wallet'|'percent'|'amount'|'freeProduct',amount:number,maxUses:number|null=1)=>value(promo().issue({operationId:runtime.newId(),name:'Test voucher',kind,value:amount,productId:kind==='freeProduct'?'product-chocolate':null,maxUses,expiresAt:null}));
 const settle=(c:ReturnType<typeof cart>)=>{const view=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const a=value(pay().preparePayment({sessionId:view.session.id,idempotencyKey:runtime.newId(),method:'cash',intendedRappen:view.balance.cashDueRappen}));value(pay().confirmPayment({attemptId:a.id,operatorConfirmed:true}));return value(pay().completeCheckout({sessionId:view.session.id}));};
 it('allocates an exact fixed discount, persists original prices and restores the cart',()=>{
  let c=cart(3);const request={operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,voucherCode:null,rule:{name:'Employee',kind:'amount' as const,value:100,productId:null}};c=value(promo().apply(request));expect(c.subtotalRappen).toBe(641);expect(c.items.reduce((s,i)=>s+i.quantity,0)).toBe(3);expect(c.items.every(i=>i.originalUnitPriceRappen===247)).toBe(true);expect(value(pos().getCart({})).cart).toEqual(c);
  expect(value(promo().apply(request))).toEqual(c);expect(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'})).toMatchObject({ok:false,error:{code:'DISCOUNT_LOCKED'}});
  c=value(promo().clear({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision}));expect(c.subtotalRappen).toBe(741);expect(c.items.every(i=>i.originalUnitPriceRappen===undefined)).toBe(true);
 });
 it('discounts only a chosen product and retains discounted prices on sales and refunds',()=>{
  let c=cart(2);c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}));c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,voucherCode:null,rule:{name:'Employee 10%',kind:'percent',value:1000,productId:'product-chocolate'}}));expect(c.items.find(i=>i.productId==='product-coffee')!.unitPriceRappen).toBe(450);expect(c.items.find(i=>i.productId==='product-chocolate')!.unitPriceRappen).toBe(222);
  const sale=settle(c);expect(value(pay().getSaleDetails({saleId:sale.id})).sale.items).toEqual(c.items);const attempt=value(pay().prepareRefund({saleId:sale.id,idempotencyKey:runtime.newId(),method:'card',items:[{saleItemId:sale.items.find(i=>i.productId==='product-chocolate')!.id,quantity:1}]}));expect(attempt.amountRappen).toBeLessThanOrEqual(222);
 });
 it('uses one free product per voucher redemption and restores use when a sale is removed',()=>{
  const voucher=issue('freeProduct',0,2);let c=cart(2);c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code}));expect(c.subtotalRappen).toBe(247);expect(c.items.filter(i=>i.unitPriceRappen===0).reduce((s,i)=>s+i.quantity,0)).toBe(1);
  expect(value(promo().getState({})).vouchers[0]!.uses).toBe(0);const sale=settle(c);expect(value(promo().getState({})).vouchers[0]!.uses).toBe(1);
  value(createHistoryService(createHistoryStore(db),runtime).removeSale({saleId:sale.id,reason:'Incorrect sale'}));expect(value(promo().getState({})).vouchers[0]!.uses).toBe(0);
 });
 it('does not consume a benefit when a draft is cleared and rejects expired/revoked vouchers',()=>{
  const voucher=issue('amount',50);let c=cart();c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code}));value(pos().clearCart({cartId:c.id,expectedRevision:c.revision}));expect(value(promo().getState({})).vouchers[0]!.uses).toBe(0);
  value(promo().control({code:voucher.code,maxUses:1,expiresAt:'2020-01-01T00:00:00Z',revoke:false}));c=cart();expect(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code}).ok).toBe(false);
  value(promo().control({code:voucher.code,maxUses:null,expiresAt:null,revoke:true}));expect(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code}).ok).toBe(false);
 });
 it('pays with credit and cash, preserves balance and idempotence and refunds credit without cashing it out',()=>{
  const voucher=issue('wallet',2000,null),c=cart(10),session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const request={code:voucher.code,sessionId:session.session.id,amountRappen:2000,operationId:runtime.newId()};const funded=value(promo().walletPay(request));expect(funded.balance.outstandingRappen).toBe(470);expect(value(promo().walletPay(request))).toEqual(funded);expect(value(promo().getState({})).vouchers[0]!.balanceRappen).toBe(0);
  const cash=value(pay().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'cash',intendedRappen:470}));value(pay().confirmPayment({attemptId:cash.id,operatorConfirmed:true}));const sale=value(pay().completeCheckout({sessionId:session.session.id}));expect(sale.payments.map(p=>[p.method,p.amountRappen])).toEqual([['voucher',2000],['cash',470]]);expect(sale.subtotalRappen).toBe(2470);
  expect(pay().prepareRefund({saleId:sale.id,idempotencyKey:runtime.newId(),method:'cash',items:[{saleItemId:sale.items[0]!.id,quantity:1}]}).ok).toBe(false);
  const refund=value(pay().prepareRefund({saleId:sale.id,idempotencyKey:runtime.newId(),method:'voucher',items:[{saleItemId:sale.items[0]!.id,quantity:1}]}));value(pay().confirmRefund({attemptId:refund.id,operatorConfirmed:true}));expect(value(promo().getState({})).vouchers[0]!.balanceRappen).toBe(247);
  db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);expect(value(promo().getState({})).vouchers[0]!.balanceRappen).toBe(247);
 });
 it('reverses voucher credit before finalisation and blocks public fabricated voucher payments',()=>{
  const voucher=issue('wallet',1000,null),c=cart(),session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));expect(pay().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'voucher',intendedRappen:200}).ok).toBe(false);
  const funded=value(promo().walletPay({sessionId:session.session.id,code:voucher.code,amountRappen:200,operationId:runtime.newId()}));const request={sessionId:session.session.id,attemptId:funded.attempts[0]!.id,operationId:runtime.newId()};expect(pay().reconcile({kind:'payment',referenceId:request.attemptId,idempotencyKey:runtime.newId(),resolution:'exclude-compensated',reason:'External manual compensation',deliberateConfirmation:true})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});value(promo().walletCancel(request));value(promo().walletCancel(request));expect(value(promo().getState({})).vouchers[0]!.balanceRappen).toBe(1000);value(pay().cancelCheckout({sessionId:session.session.id}));
 });
 it('saves templates and keeps normal vouchers unavailable in a demo snapshot',()=>{
  value(promo().saveTemplate({id:null,operationId:runtime.newId(),rule:{name:'Employee',kind:'percent',value:1000,productId:null}}));const voucher=issue('wallet',1000);const live=db;const file=join(directory,'demo.sqlite');live.sqlite.prepare('VACUUM INTO ?').run(file);db=openDatabase(file,{ticketMode:'demo'});try{expect(value(promo().getState({})).templates).toHaveLength(1);const c=cart(),session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));expect(promo().walletPay({sessionId:session.session.id,code:voucher.code,amountRappen:100,operationId:runtime.newId()})).toMatchObject({ok:false,error:{code:'VOUCHER_MODE_MISMATCH'}});}finally{db.close();db=live;}
 });
 it('recovers a lost wallet acknowledgement without a second debit',()=>{
  const voucher=issue('wallet',1000,null),c=cart(),session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const request={sessionId:session.session.id,code:voucher.code,amountRappen:200,operationId:runtime.newId()};
  const store=createPromotionStore(db);let fail=true;const uncertain=createPromotionService({...store,pos:{...store.pos,transaction:createPosStore(db,{afterCommit(){if(fail){fail=false;throw new Error('lost reply');}}}).transaction}},runtime);
  expect(uncertain.walletPay(request)).toMatchObject({ok:false,error:{code:'COMMIT_UNCERTAIN'}});const recovered=value(promo().walletPay(request));expect(recovered.attempts).toHaveLength(1);expect(value(promo().getState({})).vouchers[0]!.balanceRappen).toBe(800);
  expect(promo().walletPay({...request,amountRappen:100})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
 });
 it('rolls back discount changes when metadata persistence fails',()=>{
  const c=cart(2),request={cartId:c.id,expectedRevision:c.revision,operationId:runtime.newId(),voucherCode:null,rule:{name:'Employee',kind:'percent' as const,value:1000,productId:null}};
  db.sqlite.exec("CREATE TEMP TRIGGER fail_discount BEFORE INSERT ON cart_discounts BEGIN SELECT RAISE(ABORT,'test failure'); END");expect(promo().apply(request).ok).toBe(false);expect(value(pos().getCart({})).cart).toEqual(c);db.sqlite.exec('DROP TRIGGER fail_discount');expect(value(promo().apply(request)).subtotalRappen).toBe(444);
 });
 it('completes a 100 percent discounted cart without collecting money',()=>{
  let c=cart();c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,voucherCode:null,rule:{name:'Free',kind:'percent',value:10000,productId:null}}));expect(c.subtotalRappen).toBe(0);const sale=settle(c);expect(sale.actualPaidRappen).toBe(0);
 });
 it('combines free goods, product discounts and basket discounts without restoring earlier prices',()=>{
  const free=issue('freeProduct',0),other=issue('percent',1000),third=issue('amount',50);let c=cart(2);c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}));
  const apply=(code:string)=>{c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:code}));};
  apply(free.code);expect(c.subtotalRappen).toBe(697);apply(other.code);expect(c.subtotalRappen).toBe(627);apply(third.code);expect(c.subtotalRappen).toBe(577);
  expect(c.items.filter(i=>i.unitPriceRappen===0).reduce((s,i)=>s+i.quantity,0)).toBe(1);
  expect(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:free.code})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
  const sale=settle(c);expect(value(promo().getState({})).vouchers.every(v=>v.uses===1)).toBe(true);
  value(createHistoryService(createHistoryStore(db),runtime).removeSale({saleId:sale.id,reason:'Incorrect sale'}));expect(value(promo().getState({})).vouchers.every(v=>v.uses===0)).toBe(true);
 });
 it('combines two free-product vouchers, persists reservations and clears all benefits without consuming them',()=>{
  const first=issue('freeProduct',0),second=issue('freeProduct',0);let c=cart(3);
  for(const voucher of [first,second])c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code}));expect(c.subtotalRappen).toBe(247);
  db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);expect(value(pos().getCart({})).cart).toEqual(c);
  c=value(promo().clear({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision}));expect(c.subtotalRappen).toBe(741);expect(db.sqlite.prepare('SELECT count(*) n FROM cart_vouchers').get()?.['n']).toBe(0);expect(value(promo().getState({})).vouchers.every(v=>v.uses===0)).toBe(true);
 });
 it('combines value vouchers and returns partial refunds across original credits idempotently',()=>{
  const first=issue('wallet',200),second=issue('wallet',294);const c=cart(2),checkout=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));
  for(const voucher of [first,second])value(promo().walletPay({operationId:runtime.newId(),sessionId:checkout.session.id,code:voucher.code,amountRappen:voucher.value}));
  const sale=value(pay().completeCheckout({sessionId:checkout.session.id}));expect(sale.payments.filter(p=>p.method==='voucher')).toHaveLength(2);
  const refund=value(pay().prepareRefund({saleId:sale.id,idempotencyKey:runtime.newId(),method:'voucher',items:[{saleItemId:sale.items[0]!.id,quantity:1}]}));value(pay().confirmRefund({attemptId:refund.id,operatorConfirmed:true}));value(pay().confirmRefund({attemptId:refund.id,operatorConfirmed:true}));
  let state=value(promo().getState({}));expect(state.vouchers.find(v=>v.code===first.code)!.balanceRappen).toBe(200);expect(state.vouchers.find(v=>v.code===second.code)!.balanceRappen).toBe(47);
  const rest=value(pay().prepareRefund({saleId:sale.id,idempotencyKey:runtime.newId(),method:'voucher',items:[{saleItemId:sale.items[0]!.id,quantity:1}]}));value(pay().confirmRefund({attemptId:rest.id,operatorConfirmed:true}));state=value(promo().getState({}));expect(state.vouchers.find(v=>v.code===second.code)!.balanceRappen).toBe(294);
 });

 it('upgrades a populated version-16 database without losing reservations or redemptions',()=>{
  db.close();db=openDatabase(join(directory,'version16.sqlite'));
  db.sqlite.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
  db.sqlite.exec('BEGIN IMMEDIATE');for(const m of migrations.filter(m=>m.version<=16)){db.sqlite.exec(m.sql);db.sqlite.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version,m.name,createHash('sha256').update(m.sql).digest('hex'),runtime.now());}db.sqlite.exec('COMMIT');seedDevelopmentCatalog(db,'development');
  const used=issue('freeProduct',0,2);let c=cart(2);c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:used.code}));const sale=settle(c);
  const reserved=issue('amount',25);c=cart(2);c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:reserved.code}));runMigrations(db);
  expect(value(promo().getState({})).vouchers.find(v=>v.code===used.code)!.uses).toBe(1);expect(value(pos().getCart({})).cart).toEqual(c);
  const extra=issue('percent',1000);c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:extra.code}));settle(c);expect(value(promo().getState({})).vouchers.find(v=>v.code===reserved.code)!.uses).toBe(1);
  expect(()=>db.sqlite.prepare('UPDATE financial_sales SET subtotal_rappen=0 WHERE id=?').run(sale.id)).toThrow();
 });

 it('persists a product-voucher variant and frees one matching unit without discounting sibling variants',()=>{
  db.sqlite.prepare('INSERT INTO product_variants (id,product_id,name,unit_price_rappen,active) VALUES (?,?,?,?,1)').run('variant-chocolate-large','product-chocolate','Large',500);
  const request={operationId:runtime.newId(),name:'One large chocolate',kind:'freeProduct' as const,value:0,productId:'product-chocolate',variantId:'variant-chocolate-large',maxUses:2,expiresAt:null};
  const voucher=value(promo().issue(request));expect(value(promo().issue(request))).toEqual(voucher);expect(voucher.benefitLabel).toBe('Chocolate — Large');
  db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);
  expect(value(promo().getState({})).vouchers[0]).toMatchObject({variantId:'variant-chocolate-large',benefitLabel:'Chocolate — Large'});
  let c=cart(2);const before=c;expect(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(value(pos().getCart({})).cart).toEqual(before);
  c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-large'}));c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-large'}));
  c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule:null,voucherCode:voucher.code}));expect(c.subtotalRappen).toBe(994);
  expect(c.items.filter(i=>i.unitPriceRappen===0)).toMatchObject([{variantId:'variant-chocolate-large',quantity:1}]);expect(c.items.find(i=>i.variantId==='variant-chocolate-default')?.lineTotalRappen).toBe(494);
  const sale=settle(c);expect(sale.items).toEqual(c.items);expect(value(promo().getState({})).vouchers[0]?.uses).toBe(1);
 });
 it('retains variant scope on saved templates and applies free, percentage and fixed discounts only to that variant',()=>{
  db.sqlite.prepare('INSERT INTO product_variants (id,product_id,name,unit_price_rappen,active) VALUES (?,?,?,?,1)').run('variant-chocolate-large','product-chocolate','Large',500);
  let c=cart(2);c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-large'}));
  for(const [kind,amount,expected] of [['percent',5000,744],['amount',100,894],['freeProduct',0,494]] as const){
   const rule={name:'Scoped discount',kind,value:amount,productId:'product-chocolate',variantId:'variant-chocolate-large'};
   const template=value(promo().saveTemplate({operationId:runtime.newId(),id:null,rule})).templates.at(-1)!;expect(template.variantId).toBe(rule.variantId);
   c=value(promo().apply({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision,rule, voucherCode:null}));expect(c.subtotalRappen).toBe(expected);expect(c.items.find(i=>i.variantId==='variant-chocolate-default')?.lineTotalRappen).toBe(494);
   c=value(promo().clear({operationId:runtime.newId(),cartId:c.id,expectedRevision:c.revision}));expect(c.subtotalRappen).toBe(994);
  }
 });
 it('rejects mismatched, missing and inactive variant targets without issuing vouchers or saving templates',()=>{
  const rule={name:'Invalid scope',kind:'freeProduct' as const,value:0,productId:'product-chocolate',variantId:'variant-coffee-default'};
  for(const target of [rule,{...rule,productId:null},{...rule,variantId:'missing-variant'}]){
   expect(promo().saveTemplate({operationId:runtime.newId(),id:null,rule:target})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
   expect(promo().issue({...target,operationId:runtime.newId(),maxUses:1,expiresAt:null})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  }
  db.sqlite.prepare('UPDATE product_variants SET active=0 WHERE id=?').run('variant-chocolate-default');
  expect(promo().issue({...rule,variantId:'variant-chocolate-default',operationId:runtime.newId(),maxUses:1,expiresAt:null})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(value(promo().getState({}))).toEqual({templates:[],vouchers:[]});
 });
});
