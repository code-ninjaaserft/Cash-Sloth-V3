import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {_electron as electron,expect,test} from '@playwright/test';
import {navigateTo} from './navigation-helpers.js';

test('ending a demo discards its history and permanently invalidates its tickets and both voucher types',async()=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(join(tmpdir(),'sloth-demo-lifecycle-'));
 const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
 const launch=()=>electron.launch({args:[resolve('apps/desktop')],env:{...environment,CASH_SLOTH_CHANNEL:'development',CASH_SLOTH_DATA_ROOT:directory}});
 let app=await launch();
 try{
  let page=await app.firstWindow();
  await expect(page.getByRole('button',{name:'Add Chocolate',exact:true})).toBeVisible();
  await page.evaluate(async()=>{
   const api=window.cashSloth!;const result=await api.catalog.getProduct({productId:'product-chocolate'});if(!result.ok)throw new Error(result.error.message);
   const p=result.value;const updated=await api.catalog.updateProduct({productId:p.id,expectedRevision:p.revision,name:p.name,description:p.description,active:p.active,imageReference:p.imageReference,ticketUses:1});if(!updated.ok)throw new Error(updated.error.message);
  });
  const issueVouchers=()=>page.evaluate(async()=>{
   const api=window.cashSloth!.promotions!;
   const wallet=await api.issue({operationId:crypto.randomUUID(),name:'Credit',kind:'wallet',value:1000,productId:null,maxUses:null,expiresAt:null});if(!wallet.ok)throw new Error(wallet.error.message);
   const product=await api.issue({operationId:crypto.randomUUID(),name:'Chocolate',kind:'freeProduct',value:0,productId:'product-chocolate',variantId:'variant-chocolate-default',maxUses:null,expiresAt:null});if(!product.ok)throw new Error(product.error.message);
   return {wallet:wallet.value.code,product:product.value.code};
  });
  const sell=()=>page.evaluate(async()=>{
   const api=window.cashSloth!;const current=await api.pos.getCart({});if(!current.ok)throw new Error(current.error.message);
   const added=await api.pos.addItem({cartId:current.value.cart.id,expectedRevision:current.value.cart.revision,variantId:'variant-chocolate-default'});if(!added.ok)throw new Error(added.error.message);
   const session=await api.payments.startCheckout({cartId:added.value.id,expectedRevision:added.value.revision});if(!session.ok)throw new Error(session.error.message);
   const payment=await api.payments.preparePayment({sessionId:session.value.session.id,idempotencyKey:crypto.randomUUID(),method:'cash',intendedRappen:250});if(!payment.ok)throw new Error(payment.error.message);
   const confirmed=await api.payments.confirmPayment({attemptId:payment.value.id,operatorConfirmed:true});if(!confirmed.ok)throw new Error(confirmed.error.message);
   const sale=await api.payments.completeCheckout({sessionId:session.value.session.id});if(!sale.ok)throw new Error(sale.error.message);
   const tickets=await api.tickets!.listForSale({saleId:sale.value.id});if(!tickets.ok||!tickets.value[0])throw new Error('Missing ticket');
   return {id:sale.value.id,ticket:tickets.value[0].code};
  });
  const history=()=>page.evaluate(()=>window.cashSloth!.history.search({filters:{scope:'device',dateFrom:null,dateTo:null,paymentMethod:'all',minTotalRappen:null,maxTotalRappen:null,refundStatus:'all',saleId:'',productQuery:''},sort:{field:'date',direction:'desc'},page:1,pageSize:25}));
  const liveVouchers=await issueVouchers(),liveSale=await sell(),liveHistory=await history();
  expect(liveHistory.ok&&liveHistory.value.total).toBe(1);
  expect(await page.evaluate(()=>window.cashSloth!.demo!.setMode({enabled:true}))).toMatchObject({ok:true});
  expect(await history()).toMatchObject({ok:true,value:{total:0}});
  const firstState=await page.evaluate(()=>window.cashSloth!.demo!.getState({}));
  const vouchers=await issueVouchers(),sale=await sell();
  expect(await history()).toMatchObject({ok:true,value:{total:1,items:[{id:sale.id}]}});
  expect(await page.evaluate(code=>window.cashSloth!.tickets!.lookup({code}),sale.ticket)).toMatchObject({ok:true,value:{status:'valid'}});
  await page.reload();await navigateTo(page,'Sales history');
  await expect(page.getByRole('heading',{name:'Demo sales history',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open sale '+sale.id,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open sale '+liveSale.id,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open sale '+sale.id,exact:true}).click();
  await page.getByRole('button',{name:'View / print receipt',exact:true}).click();
  await expect(page.locator('.receipt-barcode code')).toHaveText(/^DC[0-9A-F]{14}$/u);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Start new sale',exact:true}).click();
  expect(await page.evaluate(()=>window.cashSloth!.demo!.setMode({enabled:false}))).toMatchObject({ok:true});
  expect(await history()).toEqual(liveHistory);
  expect(await page.evaluate(code=>window.cashSloth!.tickets!.lookup({code}),sale.ticket)).toMatchObject({ok:false});
  expect(await page.evaluate(code=>window.cashSloth!.tickets!.lookup({code}),liveSale.ticket)).toMatchObject({ok:true,value:{status:'valid'}});
  const normalState=await page.evaluate(()=>window.cashSloth!.promotions!.getState({}));
  expect(normalState.ok&&normalState.value.vouchers.map(v=>v.code).sort()).toEqual([liveVouchers.wallet,liveVouchers.product].sort());
  expect(await page.evaluate(()=>window.cashSloth!.demo!.setMode({enabled:true}))).toMatchObject({ok:true});
  const secondState=await page.evaluate(()=>window.cashSloth!.demo!.getState({}));expect(secondState.sessionId).not.toBe(firstState.sessionId);
  expect(await history()).toMatchObject({ok:true,value:{total:0}});
  expect(await page.evaluate(code=>window.cashSloth!.tickets!.lookup({code}),sale.ticket)).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
  const freshVouchers=await page.evaluate(()=>window.cashSloth!.promotions!.getState({}));expect(freshVouchers.ok&&freshVouchers.value.vouchers).toEqual([]);
  const failures=await page.evaluate(async codes=>{
   const api=window.cashSloth!,c=await api.pos.getCart({});if(!c.ok)throw new Error(c.error.message);
   const added=await api.pos.addItem({cartId:c.value.cart.id,expectedRevision:c.value.cart.revision,variantId:'variant-chocolate-default'});if(!added.ok)throw new Error(added.error.message);
   const benefit=await api.promotions!.apply({cartId:added.value.id,expectedRevision:added.value.revision,operationId:crypto.randomUUID(),rule:null,voucherCode:codes.product});
   const checkout=await api.payments.startCheckout({cartId:added.value.id,expectedRevision:added.value.revision});if(!checkout.ok)throw new Error(checkout.error.message);
   const credit=await api.promotions!.walletPay({sessionId:checkout.value.session.id,code:codes.wallet,amountRappen:100,operationId:crypto.randomUUID()});
   return {benefit,credit};
  },vouchers);
  expect(failures.benefit).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});expect(failures.credit).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
  await app.close();app=await launch();page=await app.firstWindow();await expect(page.locator('.pos-shell')).toBeVisible();
  expect(await history()).toEqual(liveHistory);
  expect(await page.evaluate(()=>window.cashSloth!.demo!.getState({}))).toEqual({enabled:false,sessionId:null});
 }finally{await app.close();await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
