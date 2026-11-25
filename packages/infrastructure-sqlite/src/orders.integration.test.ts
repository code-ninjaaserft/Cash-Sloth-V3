import {createCatalogService} from '@cash-sloth/application';
import {createCatalogStore} from './catalog-store.js';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {createOrderService,createPaymentsService,createPosService,createPresetService} from '@cash-sloth/application';import type {Result} from '@cash-sloth/contracts';
import {openDatabase,type DatabaseConnection} from './connection.js';import {runMigrations} from './migrations.js';import {seedDevelopmentCatalog} from './seed.js';import {createOrderStore} from './order-store.js';import {createPosStore} from './pos-store.js';import {createFinanceStore} from './finance-store.js';import {createPresetStore} from './preset-store.js';
function value<T>(r:Result<T>):T{if(!r.ok)throw new Error(r.error.code+': '+r.error.message);return r.value;}
describe('persistent self-service orders',()=>{
 let db:DatabaseConnection,directory:string,seq:number;const runtime={newId:()=> 'order-'+(++seq),now:()=> '2026-11-25T12:00:00.000Z'};
 const service=()=>createOrderService(createOrderStore(db),runtime),pos=()=>createPosService(createPosStore(db),runtime),pay=()=>createPaymentsService(createFinanceStore(db),runtime);
 const request=()=>{const catalog=value(service().catalog({}));return {operationId:runtime.newId(),eventId:catalog.eventId,version:catalog.version,items:[{variantId:'variant-chocolate-default',quantity:2}]};};
 beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),'sloth-orders-'));db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);seedDevelopmentCatalog(db,'development');seq=0;});afterEach(()=>{db.close();rmSync(directory,{recursive:true,force:true,maxRetries:5});});
 it('creates numbered unpaid snapshots, survives restart and retries the same order without duplicates',()=>{
  const input=request(),order=value(service().submit(input));expect(order).toMatchObject({number:1,status:'waiting',cart:{subtotalRappen:494}});expect(value(pos().getCart({})).cart.items).toHaveLength(0);expect(value(pay().listRecentSales({}))).toHaveLength(0);
  db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);expect(value(service().submit(input))).toEqual(order);expect(value(service().list({}))).toHaveLength(1);expect(service().submit({...input,items:[{variantId:'variant-coffee-default',quantity:1}]})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
 });
 it('requires an idle register, transfers once and marks paid only after sale commit',()=>{
  const o=value(service().submit(request())),input={orderId:o.id,operationId:runtime.newId()};let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}));expect(service().accept(input)).toMatchObject({ok:false,error:{code:'CONFLICT'}});value(pos().clearCart({cartId:c.id,expectedRevision:c.revision}));
  c=value(service().accept(input));expect(value(service().accept(input))).toEqual(c);expect(value(service().list({}))[0]!.status).toBe('register');expect(pos().clearCart({cartId:c.id,expectedRevision:c.revision})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
  expect(service().status({orderId:o.id,operationId:runtime.newId(),status:'ready'}).ok).toBe(false);
  const checkout=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const payment=value(pay().preparePayment({sessionId:checkout.session.id,idempotencyKey:runtime.newId(),method:'cash',intendedRappen:checkout.balance.cashDueRappen}));value(pay().confirmPayment({attemptId:payment.id,operatorConfirmed:true}));expect(value(service().list({}))[0]!.status).toBe('register');value(pay().completeCheckout({sessionId:checkout.session.id}));expect(value(service().list({}))[0]!.status).toBe('paid');
  {const current=value(service().list({}))[0]!;value(service().prepare({orderId:o.id,operationId:runtime.newId(),expectedRevision:current.revision,preparation:'preparing'}));}
  value(service().status({orderId:o.id,operationId:runtime.newId(),status:'ready'}));value(service().status({orderId:o.id,operationId:runtime.newId(),status:'collected'}));expect(value(service().list({}))[0]!.status).toBe('collected');
 });
 it('releases an unpaid order, blocks release after payment started, and supports cancellation',()=>{
  const o=value(service().submit(request()));let c=value(service().accept({orderId:o.id,operationId:runtime.newId()}));const checkout=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));expect(service().release({orderId:o.id,operationId:runtime.newId()}).ok).toBe(false);value(pay().cancelCheckout({sessionId:checkout.session.id}));
  value(service().release({orderId:o.id,operationId:runtime.newId()}));expect(value(pos().getCart({})).cart.items).toHaveLength(0);c=value(service().accept({orderId:o.id,operationId:runtime.newId()}));expect(c.subtotalRappen).toBe(494);value(service().release({orderId:o.id,operationId:runtime.newId()}));value(service().status({orderId:o.id,operationId:runtime.newId(),status:'cancelled'}));expect(service().accept({orderId:o.id,operationId:runtime.newId()}).ok).toBe(false);
 });
 it('rejects stale menus, duplicate lines and malformed quantities without recording an order',()=>{
  const input=request();expect(service().submit({...input,version:'stale'})).toMatchObject({ok:false,error:{code:'CONFLICT'}});expect(service().submit({...input,items:[...input.items,...input.items]})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(service().submit({...input,items:[{variantId:'variant-chocolate-default',quantity:0}]})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(value(service().list({}))).toHaveLength(0);
 });
 it('rolls back cart transfer if updating the order fails',()=>{
  const o=value(service().submit(request()));value(pos().getCart({}));db.sqlite.exec("CREATE TEMP TRIGGER reject_order BEFORE UPDATE ON kiosk_orders BEGIN SELECT RAISE(ABORT,'test failure'); END");const input={orderId:o.id,operationId:runtime.newId()};expect(service().accept(input).ok).toBe(false);expect(value(pos().getCart({})).cart.items).toHaveLength(0);expect(value(service().list({}))[0]!.status).toBe('waiting');db.sqlite.exec('DROP TRIGGER reject_order');expect(value(service().accept(input)).subtotalRappen).toBe(494);
 });
 it('scopes the order queue to the active event and keeps original event snapshots',()=>{
  const old=value(service().submit(request()));value(createPresetService(createPresetStore(db),runtime).save({operationId:runtime.newId(),presetId:null,expectedRevision:null,name:'New event',empty:true,catalogVersion:createPresetStore(db).catalogVersion()}));expect(value(service().list({}))).toHaveLength(0);expect(service().accept({orderId:old.id,operationId:runtime.newId()})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
 });
 it('keeps simulated orders out of the real database',()=>{
  const live=db;live.sqlite.prepare('VACUUM INTO ?').run(join(directory,'demo.sqlite'));db=openDatabase(join(directory,'demo.sqlite'),{ticketMode:'demo'});try{expect(value(service().catalog({})).demoMode).toBe(true);value(service().submit(request()));expect(value(service().list({}))).toHaveLength(1);}finally{db.close();db=live;}expect(value(service().list({}))).toHaveLength(0);
 });
 it('recovers a committed order after its acknowledgement is lost without another number',()=>{
  const store=createOrderStore(db),input=request();let fail=true;const uncertain=createOrderService({...store,pos:{...store.pos,transaction:createPosStore(db,{afterCommit(){if(fail){fail=false;throw new Error('lost reply');}}}).transaction}},runtime);
  expect(uncertain.submit(input)).toMatchObject({ok:false,error:{code:'COMMIT_UNCERTAIN'}});const recovered=value(service().submit(input));expect(recovered.number).toBe(1);expect(value(service().list({}))).toHaveLength(1);expect(value(service().submit({...input,operationId:runtime.newId()})).number).toBe(2);
 });

 it('wraps numbers through 1–99 without reusing an open number and refuses payment before reserving a number',()=>{
  const all=[];for(let i=1;i<=99;i++){const o=value(service().submit(request()));expect(o.number).toBe(i);all.push(o);}
  expect(service().submit(request())).toMatchObject({ok:false,error:{code:'ORDER_NUMBERS_FULL'}});
  let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}));expect(pay().startCheckout({cartId:c.id,expectedRevision:c.revision})).toMatchObject({ok:false,error:{code:'ORDER_NUMBERS_FULL'}});expect(value(pay().getActiveCheckout({}))).toBeNull();
  value(pos().clearCart({cartId:c.id,expectedRevision:c.revision}));value(service().status({orderId:all[0]!.id,operationId:runtime.newId(),status:'cancelled'}));expect(value(service().submit(request())).number).toBe(1);
  value(service().status({orderId:all[1]!.id,operationId:runtime.newId(),status:'cancelled'}));db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);expect(value(service().submit(request())).number).toBe(2);
 });
 it('books table batches without revenue, prepares before payment and combines only the same table on one receipt',()=>{
  const book=(label:string)=>{let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-default'}));return value(service().book({cartId:c.id,expectedRevision:c.revision,operationId:runtime.newId(),serviceLabel:label}));};
  const first=book('Tisch 7'),second=book('Tisch 7'),other=book('Anna');expect(first.number).toBeNull();expect(second.number).toBeNull();expect(value(service().board({})).orders).toHaveLength(0);expect(value(pay().listRecentSales({}))).toHaveLength(0);expect(value(service().kitchen({})).orders).toHaveLength(3);expect(value(pos().getCart({})).cart.items).toHaveLength(0);
  let current=first;for(const preparation of ['preparing','ready','collected'] as const)current=value(service().prepare({orderId:current.id,expectedRevision:current.revision,operationId:runtime.newId(),preparation}));expect(current.paid).toBe(false);expect(value(service().board({})).orders.some(o=>o.id===first.id)).toBe(false);
  const c=value(service().accept({orderId:second.id,operationId:runtime.newId()}));expect(c.subtotalRappen).toBe(494);expect(c.items.reduce((s,i)=>s+i.quantity,0)).toBe(2);expect(value(service().list({})).find(o=>o.id===other.id)!.status).toBe('waiting');
  expect(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}).ok).toBe(false);
  const session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const payment=value(pay().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'card',intendedRappen:494}));value(pay().confirmPayment({attemptId:payment.id,operatorConfirmed:true}));const sale=value(pay().completeCheckout({sessionId:session.session.id}));expect(sale.order).toMatchObject({source:'table',serviceLabel:'Tisch 7',numbers:[],number:null});
  expect(value(pay().getSaleDetails({saleId:sale.id})).sale.order).toEqual(sale.order);expect(value(service().list({})).filter(o=>o.paid)).toHaveLength(2);expect(value(service().list({})).find(o=>o.id===first.id)!.preparation).toBe('collected');
  db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);expect(value(pay().getSaleDetails({saleId:sale.id})).sale.order).toEqual(sale.order);
 });
 it('reserves a register order before money is received and keeps its reference on modern and legacy sales',()=>{
  let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}));const session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));expect(value(service().board({})).orders).toMatchObject([{number:1,preparation:'received'}]);
  const payment=value(pay().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'cash',intendedRappen:450}));value(pay().confirmPayment({attemptId:payment.id,operatorConfirmed:true}));const sale=value(pay().completeCheckout({sessionId:session.session.id}));expect(sale.order).toMatchObject({number:1,source:'register',serviceLabel:null});
  c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-default'}));const attempt=value(pos().prepareCheckout({cartId:c.id,expectedRevision:c.revision}));const legacy=value(pos().completeSale({idempotencyKey:attempt.idempotencyKey,cashReceivedRappen:250,operatorConfirmed:true}));expect(legacy.order).toMatchObject({number:2,source:'register'});expect(value(pay().getSaleDetails({saleId:legacy.id})).sale.order).toEqual(legacy.order);
 });
 it('guards competing kitchen transitions and replays a lost acknowledgement without advancing twice',()=>{
  const order=value(service().submit(request()));const input={orderId:order.id,operationId:runtime.newId(),expectedRevision:order.revision,preparation:'preparing' as const};const preparing=value(service().prepare(input));expect(value(service().prepare(input))).toEqual(preparing);expect(service().prepare({...input,operationId:runtime.newId(),preparation:'ready'})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
  expect(value(service().board({})).orders).toMatchObject([{number:order.number,preparation:'preparing'}]);
 });
 it('permits a fresh sale after a cancelled register checkout is emptied',()=>{
  let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-default'}));const session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));value(pay().cancelCheckout({sessionId:session.session.id}));c=value(pos().clearCart({cartId:c.id,expectedRevision:c.revision}));c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-coffee-default'}));expect(value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision})).session.status).toBe('open');expect(value(service().board({})).orders).toHaveLength(1);
 });

 it('uses the active event catalog after creating products in a new empty preset',()=>{
  const preset=createPresetService(createPresetStore(db),runtime);value(preset.save({operationId:runtime.newId(),catalogVersion:createPresetStore(db).catalogVersion(),presetId:null,expectedRevision:null,name:'Fondue Event',empty:true}));
  const c=createCatalogService(createCatalogStore(db),runtime);const cat=value(c.createCategory({name:'Dinner',parentId:null,active:true,position:0,color:'#ffff00'}));const p=value(c.createProduct({name:'Event Fondue',description:null,active:true,imageReference:null,categoryIds:[cat.id],primaryCategoryId:cat.id,firstVariant:{name:'Adult',unitPriceRappen:2000,sku:null,barcode:null,active:true,position:0}}));
  const catalog=createOrderStore(db).catalog();expect(catalog.eventTitle).toBe('Fondue Event');expect(catalog.products.map(product=>product.id)).toEqual([p.id]);expect(catalog.products[0]!.variants[0]!.unitPriceRappen).toBe(2000);
 });

 it('does not invalidate a kitchen preparation action when only payment changes',()=>{
  const o=value(service().submit(request()));let kitchen=o;for(const preparation of ['preparing','ready'] as const)kitchen=value(service().prepare({orderId:o.id,operationId:runtime.newId(),expectedRevision:kitchen.revision,preparation}));
  const c=value(service().accept({orderId:o.id,operationId:runtime.newId()})),session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const payment=value(pay().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'card',intendedRappen:c.subtotalRappen}));value(pay().confirmPayment({attemptId:payment.id,operatorConfirmed:true}));value(pay().completeCheckout({sessionId:session.session.id}));
  const collected=value(service().prepare({orderId:o.id,operationId:runtime.newId(),expectedRevision:kitchen.revision,preparation:'collected'}));expect(collected.paid).toBe(true);expect(collected.preparation).toBe('collected');expect(value(service().board({})).orders).toHaveLength(0);
 });

 it('disables new entry points durably while retaining payment for existing orders',()=>{
  const input=request(),pending=value(service().submit(input)),old=value(service().getSettings({}));const settings={kiosk:false,tableService:false,infoDisplay:false,kitchen:false,registerOrders:false};value(service().setSettings({operationId:runtime.newId(),expectedRevision:old.revision,settings}));
  expect(service().catalog({})).toMatchObject({ok:false,error:{code:'FEATURE_DISABLED'}});expect(service().submit({...input,operationId:runtime.newId()})).toMatchObject({ok:false,error:{code:'FEATURE_DISABLED'}});expect(service().board({})).toMatchObject({ok:false,error:{code:'FEATURE_DISABLED'}});expect(service().kitchen({})).toMatchObject({ok:false,error:{code:'FEATURE_DISABLED'}});
  expect(value(service().submit(input))).toEqual(pending);db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);expect(value(service().getSettings({}))).toMatchObject(settings);
  const c=value(service().accept({operationId:runtime.newId(),orderId:pending.id}));const session=value(pay().startCheckout({cartId:c.id,expectedRevision:c.revision}));const payment=value(pay().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'card',intendedRappen:c.subtotalRappen}));value(pay().confirmPayment({attemptId:payment.id,operatorConfirmed:true}));expect(value(pay().completeCheckout({sessionId:session.session.id})).order!.number).toBe(pending.number);
  let plain=value(pos().getCart({})).cart;plain=value(pos().addItem({cartId:plain.id,expectedRevision:plain.revision,variantId:'variant-coffee-default'}));expect(service().book({cartId:plain.id,expectedRevision:plain.revision,operationId:runtime.newId(),serviceLabel:'Tisch 8'})).toMatchObject({ok:false,error:{code:'FEATURE_DISABLED'}});const next=value(pay().startCheckout({cartId:plain.id,expectedRevision:plain.revision}));const a=value(pay().preparePayment({sessionId:next.session.id,idempotencyKey:runtime.newId(),method:'card',intendedRappen:450}));value(pay().confirmPayment({attemptId:a.id,operatorConfirmed:true}));expect(value(pay().completeCheckout({sessionId:next.session.id})).order).toBeUndefined();
 });
 it('resets only the numbering cursor, preserving occupied numbers and idempotent reset recovery',()=>{
  const one=value(service().submit(request()));value(service().submit(request()));value(service().status({orderId:one.id,operationId:runtime.newId(),status:'cancelled'}));expect(value(service().submit(request())).number).toBe(1);
  const input={operationId:runtime.newId()};value(service().resetCounter(input));expect(value(service().submit(request())).number).toBe(3);value(service().resetCounter(input));expect(value(service().submit(request())).number).toBe(4);
  const all=value(service().list({}));expect(all.filter(o=>o.status!=='cancelled').map(o=>o.number).sort()).toEqual([1,2,3,4]);
 });
 it('never allocates table-service numbers or publishes table-service preparation',()=>{
  for(let n=0;n<4;n++){let c=value(pos().getCart({})).cart;c=value(pos().addItem({cartId:c.id,expectedRevision:c.revision,variantId:'variant-chocolate-default'}));let o=value(service().book({cartId:c.id,expectedRevision:c.revision,operationId:runtime.newId(),serviceLabel:'Tisch '+n}));expect(o.number).toBeNull();o=value(service().prepare({orderId:o.id,expectedRevision:o.revision,operationId:runtime.newId(),preparation:'preparing'}));value(service().prepare({orderId:o.id,expectedRevision:o.revision,operationId:runtime.newId(),preparation:'ready'}));}
  expect(value(service().kitchen({})).orders).toHaveLength(4);expect(value(service().board({})).orders).toHaveLength(0);expect(value(service().submit(request())).number).toBe(1);
 });

 it('reissues a rejected number next, then resumes the original counter after restart and replay',()=>{
  const one=value(service().submit(request())),two=value(service().submit(request())),three=value(service().submit(request()));expect([one.number,two.number,three.number]).toEqual([1,2,3]);
  const rejection={orderId:two.id,operationId:runtime.newId(),status:'cancelled' as const};value(service().status(rejection));db.close();db=openDatabase(join(directory,'test.sqlite'));runMigrations(db);
  const replacement=request();const reused=value(service().submit(replacement));expect(reused.number).toBe(2);expect(value(service().submit(replacement))).toEqual(reused);value(service().status(rejection));expect(value(service().submit(request())).number).toBe(4);
  const numbers=value(service().list({})).filter(o=>o.status!=='cancelled').map(o=>o.number);expect(new Set(numbers).size).toBe(numbers.length);expect(value(service().board({})).orders.some(o=>o.id===two.id)).toBe(false);
 });
 it('reuses multiple rejections in cancellation order without moving the ordinary cursor',()=>{
  const all=[value(service().submit(request())),value(service().submit(request())),value(service().submit(request()))];for(const index of [2,0])value(service().status({orderId:all[index]!.id,operationId:runtime.newId(),status:'cancelled'}));
  expect(value(service().submit(request())).number).toBe(3);expect(value(service().submit(request())).number).toBe(1);expect(value(service().submit(request())).number).toBe(4);
 });
 it('rolls back number recycling together with a failed rejection and failed replacement',()=>{
  value(service().submit(request()));const rejected=value(service().submit(request()));value(service().submit(request()));
  db.sqlite.exec("CREATE TEMP TRIGGER fail_rejection BEFORE INSERT ON rejected_order_numbers BEGIN SELECT RAISE(ABORT,'test failure'); END");const cancellation={orderId:rejected.id,operationId:runtime.newId(),status:'cancelled' as const};expect(service().status(cancellation).ok).toBe(false);expect(value(service().list({})).find(o=>o.id===rejected.id)!.status).toBe('waiting');db.sqlite.exec('DROP TRIGGER fail_rejection');value(service().status(cancellation));
  db.sqlite.exec("CREATE TEMP TRIGGER fail_replacement BEFORE INSERT ON kiosk_orders BEGIN SELECT RAISE(ABORT,'test failure'); END");const input=request();expect(service().submit(input).ok).toBe(false);db.sqlite.exec('DROP TRIGGER fail_replacement');expect(value(service().submit(input)).number).toBe(2);expect(value(service().submit(request())).number).toBe(4);
 });
 it('honours an explicit counter reset ahead of queued rejected numbers',()=>{
  const all=[value(service().submit(request())),value(service().submit(request())),value(service().submit(request()))];for(const index of [2,0])value(service().status({orderId:all[index]!.id,operationId:runtime.newId(),status:'cancelled'}));value(service().resetCounter({operationId:runtime.newId()}));expect(value(service().submit(request())).number).toBe(1);expect(value(service().submit(request())).number).toBe(3);expect(value(service().submit(request())).number).toBe(4);
 });

});
