import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogService, createHistoryService, createPaymentsService, createPosService, createPresetService, createTicketService } from '@cash-sloth/application';
import type { Result, FinancialSale } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { runMigrations } from './migrations.js';
import { seedDevelopmentCatalog } from './seed.js';
import { createCatalogStore } from './catalog-store.js';
import { createPosStore } from './pos-store.js';
import { createFinanceStore } from './finance-store.js';
import { createTicketStore } from './ticket-store.js';
import { createHistoryStore } from './history-store.js';
import { createPresetStore } from './preset-store.js';
const value = <T>(result: Result<T>): T => { if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message); return result.value; };
describe('local tickets', () => {
 let directory: string, db: DatabaseConnection, sequence: number;
 const runtime = { newId: () => 'ticket-test-' + ++sequence, now: () => '2026-11-23T19:00:00.000Z' };
 const pos = () => createPosService(createPosStore(db), runtime);
 const payments = () => createPaymentsService(createFinanceStore(db), runtime);
 const tickets = () => createTicketService(createTicketStore(db), runtime);
 const catalog = () => createCatalogService(createCatalogStore(db), runtime);
 beforeEach(() => { directory=mkdtempSync(join(tmpdir(),'sloth-tickets-')); db=openDatabase(join(directory,'test.sqlite')); runMigrations(db); seedDevelopmentCatalog(db,'development'); sequence=0; });
 afterEach(() => { db.close(); rmSync(directory,{recursive:true,force:true,maxRetries:5}); });
 const configure = (uses: number) => { const product=value(catalog().getProduct({productId:'product-chocolate'})); return value(catalog().updateProduct({ productId:product.id,expectedRevision:product.revision,name:product.name,description:product.description,active:product.active,imageReference:product.imageReference,ticketUses:uses })); };
 const cartWith = (quantity=2) => { let cart=value(pos().getCart({})).cart; cart=value(pos().addItem({cartId:cart.id,expectedRevision:cart.revision,variantId:'variant-chocolate-default'})); return value(pos().setQuantity({cartId:cart.id,expectedRevision:cart.revision,lineId:cart.items[0]!.id,quantity})); };
 const paid = (quantity=2) => { const cart=cartWith(quantity); const session=value(payments().startCheckout({cartId:cart.id,expectedRevision:cart.revision})); const attempt=value(payments().preparePayment({sessionId:session.session.id,idempotencyKey:runtime.newId(),method:'card',intendedRappen:cart.subtotalRappen})); value(payments().confirmPayment({attemptId:attempt.id,operatorConfirmed:true})); return session.session.id; };
 const sell = (quantity=2): FinancialSale => value(payments().completeCheckout({sessionId:paid(quantity)}));
 it('snapshots ticket rules in the cart, creates one unique ticket per unit and reopens the same tickets', () => {
  configure(2); const sessionId=paid(); configure(5);
  const sale=value(payments().completeCheckout({sessionId})); const issued=value(tickets().listForSale({saleId:sale.id}));
  expect(issued).toHaveLength(2); expect(new Set(issued.map(t=>t.code)).size).toBe(2);
  expect(issued.map(t=>t.maxUses)).toEqual([2,2]); expect(issued[0]).toMatchObject({issuedAt:runtime.now(),remainingUses:2,status:'valid'});
  expect(value(payments().completeCheckout({sessionId}))).toEqual(sale);
  expect(value(tickets().listForSale({saleId:sale.id}))).toEqual(issued);
  db.close(); db=openDatabase(join(directory,'test.sqlite')); runMigrations(db);
  expect(value(tickets().listForSale({saleId:sale.id}))).toEqual(issued);
 });
 it('does not issue on draft/cancel, separates changed rules and blocks excessive ticket quantities', () => {
  configure(1); let cart=cartWith(1); expect(db.sqlite.prepare('SELECT count(*) n FROM tickets').get()?.['n']).toBe(0);
  configure(3); cart=value(pos().addItem({cartId:cart.id,expectedRevision:cart.revision,variantId:'variant-chocolate-default'})); expect(cart.items.map(i=>i.ticketUses)).toEqual([1,3]);
  expect(pos().setQuantity({cartId:cart.id,expectedRevision:cart.revision,lineId:cart.items[0]!.id,quantity:1000}).ok).toBe(false);
  value(pos().clearCart({cartId:cart.id,expectedRevision:cart.revision})); configure(0); const sale=sell(1); expect(value(tickets().listForSale({saleId:sale.id}))).toEqual([]);
 });
 it('rolls back sale and tickets together on issuance failure, and retries without duplicate tickets', () => {
  configure(1); const sessionId=paid();
  db.sqlite.exec("CREATE TEMP TRIGGER fail_ticket BEFORE INSERT ON tickets BEGIN SELECT RAISE(ABORT,'test failure'); END");
  expect(payments().completeCheckout({sessionId})).toMatchObject({ok:false});
  expect(db.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(0); expect(db.sqlite.prepare('SELECT count(*) n FROM tickets').get()?.['n']).toBe(0);
  db.sqlite.exec('DROP TRIGGER fail_ticket');
  let fail=true; const uncertain=createPaymentsService(createFinanceStore(db,{afterCommit(){if(fail){fail=false;throw new Error('lost reply');}}}),runtime);
  expect(uncertain.completeCheckout({sessionId})).toMatchObject({ok:false,error:{code:'COMMIT_UNCERTAIN'}});
  const sale=value(payments().completeCheckout({sessionId})); expect(value(tickets().listForSale({saleId:sale.id}))).toHaveLength(2);
 });
 it('counts redemptions atomically, survives lost replies and prevents duplicate/stale or exhausted uses', () => {
  configure(2); const ticket=value(tickets().listForSale({saleId:sell(1).id}))[0]!;
  const request={code:ticket.code,operationId:runtime.newId(),expectedUses:0,operatorConfirmed:true as const};
  let fail=true; const store=createTicketStore(db); const uncertain=createTicketService({...store,transaction:createPosStore(db,{afterCommit(){if(fail){fail=false;throw new Error('lost reply');}}}).transaction},runtime);
  expect(uncertain.redeem(request)).toMatchObject({ok:false,error:{code:'COMMIT_UNCERTAIN'}});
  expect(value(tickets().redeem(request))).toMatchObject({remainingUses:1,redemptions:[{operationId:request.operationId,redeemedAt:runtime.now()}]});
  expect(value(tickets().redeem(request)).redemptions).toHaveLength(1);
  expect(tickets().redeem({...request,operationId:runtime.newId()})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
  value(tickets().redeem({...request,operationId:runtime.newId(),expectedUses:1}));
  expect(value(tickets().lookup({code:ticket.code}))).toMatchObject({status:'used',remainingUses:0});
  expect(tickets().redeem({...request,operationId:runtime.newId(),expectedUses:2}).ok).toBe(false);
 });
 it('invalidates refunded unit tickets and purges linked tickets and redemption evidence with the sale', () => {
  configure(2); const sale=sell(); const issued=value(tickets().listForSale({saleId:sale.id}));
  value(tickets().redeem({code:issued[0]!.code,operationId:runtime.newId(),expectedUses:0,operatorConfirmed:true}));
  const refund=value(payments().prepareRefund({saleId:sale.id,idempotencyKey:runtime.newId(),method:'card',items:[{saleItemId:sale.items[0]!.id,quantity:1}]})); value(payments().confirmRefund({attemptId:refund.id,operatorConfirmed:true}));
  expect(value(tickets().lookup({code:issued[0]!.code}))).toMatchObject({status:'refunded',remainingUses:0}); expect(value(tickets().lookup({code:issued[1]!.code})).status).toBe('valid');
  value(createHistoryService(createHistoryStore(db),runtime).removeSale({saleId:sale.id,reason:'Incorrect sale'}));
  expect(tickets().lookup({code:issued[0]!.code})).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
  expect(db.sqlite.prepare('SELECT count(*) n FROM ticket_redemptions').get()?.['n']).toBe(0);
 });
 it('rejects invalid product settings and malformed ticket requests', () => {
  const product=value(catalog().getProduct({productId:'product-chocolate'}));
  for (const ticketUses of [-1,1.5,1001]) expect(catalog().updateProduct({productId:product.id,expectedRevision:product.revision,name:product.name,description:product.description,active:product.active,imageReference:product.imageReference,ticketUses})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(tickets().lookup({code:'not-a-ticket'})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 });
 it('rejects normal tickets in demo even when copied and rejects demo tickets in normal mode', () => {
  configure(1); const original=value(tickets().listForSale({saleId:sell(1).id}))[0]!;
  expect(original).toMatchObject({mode:'normal'}); expect(original.code).toMatch(/^CS/u);
  // Pre-update ticket snapshots without a mode remain genuine normal tickets.
  db.sqlite.prepare("UPDATE tickets SET data=json_remove(data,'$.mode') WHERE code=?").run(original.code);
  const live=db; const normal=createTicketService(createTicketStore(live),runtime);
  expect(value(normal.lookup({code:original.code})).mode).toBe('normal');
  const demoFile=join(directory,'demo.sqlite'); live.sqlite.prepare('VACUUM INTO ?').run(demoFile);
  db=openDatabase(demoFile,{ticketMode:'demo'});
  try {
   const request={code:original.code,operationId:runtime.newId(),expectedUses:0,operatorConfirmed:true as const};
   expect(tickets().lookup({code:original.code})).toMatchObject({ok:false,error:{code:'TICKET_MODE_MISMATCH'}});
   expect(tickets().redeem(request)).toMatchObject({ok:false,error:{code:'TICKET_MODE_MISMATCH'}});
   expect(db.sqlite.prepare('SELECT count(*) n FROM ticket_redemptions').get()?.['n']).toBe(0);
   const demo=value(tickets().listForSale({saleId:sell(1).id}))[0]!; expect(demo).toMatchObject({mode:'demo'}); expect(demo.code).toMatch(/^DS/u);
   expect(normal.lookup({code:demo.code})).toMatchObject({ok:false,error:{code:'TICKET_MODE_MISMATCH'}});
   expect(normal.redeem({...request,code:demo.code})).toMatchObject({ok:false,error:{code:'TICKET_MODE_MISMATCH'}});
   expect(value(tickets().redeem({...request,code:demo.code,operationId:runtime.newId()}))).toMatchObject({status:'used',remainingUses:0});
   expect(value(normal.redeem(request))).toMatchObject({status:'used',remainingUses:0});
  } finally { db.close();db=live; }
 });
 it('records team consumption once without any payment or sales revenue',()=>{
  const cart=cartWith(2);const session=value(payments().startCheckout({cartId:cart.id,expectedRevision:cart.revision}));
  expect(value(payments().completeTeam({sessionId:session.session.id})).session.status).toBe('cancelled');
  value(payments().completeTeam({sessionId:session.session.id}));
  const rows=value(payments().listTeam({}));expect(rows).toHaveLength(1);expect(rows[0]!.cart.items[0]!.quantity).toBe(2);
  expect(value(payments().listRecentSales({}))).toEqual([]);expect(db.sqlite.prepare('SELECT count(*) n FROM payment_attempts').get()?.['n']).toBe(0);
  expect(value(pos().getCart({})).cart.items).toHaveLength(0);
 });
 it('refuses team consumption once any actual payment was prepared',()=>{
  const sessionId=paid(1);expect(payments().completeTeam({sessionId})).toMatchObject({ok:false,error:{code:'CONFLICT'}});
  expect(value(payments().listTeam({}))).toEqual([]);expect(value(payments().completeCheckout({sessionId})).actualPaidRappen).toBe(247);
 });
 it('keeps unlimited tickets valid across repeated uses and applies expiry and permanent invalidation',()=>{
  configure(2147483647);const ticket=value(tickets().listForSale({saleId:sell(1).id}))[0]!;
  for(let expectedUses=0;expectedUses<5;expectedUses++)expect(value(tickets().redeem({code:ticket.code,expectedUses,operationId:runtime.newId(),operatorConfirmed:true})).status).toBe('valid');
  expect(value(tickets().lookup({code:ticket.code})).redemptions).toHaveLength(5);
  value(tickets().setExpiry({code:ticket.code,expiresAt:'2026-11-22T00:00:00.000Z'}));expect(value(tickets().lookup({code:ticket.code})).status).toBe('expired');
  expect(tickets().redeem({code:ticket.code,expectedUses:5,operationId:runtime.newId(),operatorConfirmed:true}).ok).toBe(false);
  value(tickets().setExpiry({code:ticket.code,expiresAt:null}));expect(value(tickets().lookup({code:ticket.code})).status).toBe('valid');
  value(tickets().invalidate({code:ticket.code}));value(tickets().invalidate({code:ticket.code}));expect(value(tickets().lookup({code:ticket.code})).status).toBe('revoked');
  value(tickets().setExpiry({code:ticket.code,expiresAt:null}));expect(tickets().redeem({code:ticket.code,expectedUses:5,operationId:runtime.newId(),operatorConfirmed:true}).ok).toBe(false);
 });
 it('includes ticket settings in preset saves/copies/loads', () => {
  configure(3); const presets=createPresetService(createPresetStore(db),runtime); let state=value(presets.getState({}));
  state=value(presets.save({operationId:runtime.newId(),catalogVersion:state.catalogVersion,presetId:null,expectedRevision:null,name:'Fondue',empty:false})); const original=state.presets[0]!;
  configure(1); state=value(presets.getState({}));
  state=value(presets.load({operationId:runtime.newId(),catalogVersion:state.catalogVersion,presetId:original.id,expectedRevision:original.revision}));
  expect(value(catalog().getProduct({productId:'product-chocolate'})).ticketUses).toBe(3);
  state=value(presets.copy({operationId:runtime.newId(),catalogVersion:state.catalogVersion,presetId:original.id,expectedRevision:original.revision,name:'Fondue copy'})); expect(state.presets).toHaveLength(2);
 });
 it('also issues tickets atomically for legacy cash sales', () => {
  configure(1); const cart=cartWith(2); const key=value(pos().prepareCheckout({cartId:cart.id,expectedRevision:cart.revision})).idempotencyKey;
  const sale=value(pos().completeSale({idempotencyKey:key,cashReceivedRappen:1000,operatorConfirmed:true})); expect(value(tickets().listForSale({saleId:sale.id}))).toHaveLength(2); expect(value(pos().getSale({saleId:sale.id}))).toEqual(sale);
 });
});
