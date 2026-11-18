import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPaymentsService, createPosService, type FinanceStore, type PaymentsService, type PosService } from '@cash-sloth/application';
import type { CheckoutView, FinancialSale, PaymentMethod, Result } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { firstSaleMigration } from './migrations/0001-first-sale.js';
import { catalogManagementMigration } from './migrations/0002-catalog-management.js';
import { migrations, runMigrations } from './migrations.js';
import { createPosStore, type PosStoreTestHooks } from './pos-store.js';
import { createFinanceStore } from './finance-store.js';
import { seedDevelopmentCatalog } from './seed.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('payment and refund persistence', () => {
  let directory: string;
  let databaseFile: string;
  let connection: DatabaseConnection;
  let sequence: number;
  let finance: FinanceStore;
  let payments: PaymentsService;
  let pos: PosService;
  let currentTime: string;
  const runtime = { newId: () => `payments-test-${++sequence}`, now: () => currentTime };
  const extraConnections: DatabaseConnection[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cash-sloth-payments-'));
    databaseFile = join(directory, 'payments.sqlite');
    connection = openDatabase(databaseFile);
    sequence = 0;
    currentTime = '2026-11-16T12:00:00.000Z';
  });
  afterEach(() => {
    for (const extra of extraConnections.splice(0)) extra.close();
    connection.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  function bind(hooks: PosStoreTestHooks = {}): void {
    finance = createFinanceStore(connection, hooks);
    payments = createPaymentsService(finance, runtime);
    pos = createPosService(createPosStore(connection), runtime);
  }
  function initialize(): void { runMigrations(connection); seedDevelopmentCatalog(connection, 'development'); bind(); }
  function reopen(): void { connection.close(); connection = openDatabase(databaseFile); runMigrations(connection); bind(); }
  function checkout(price = 247, quantity = 1): CheckoutView {
    initialize();
    connection.sqlite.prepare("UPDATE product_variants SET unit_price_rappen = ? WHERE id = 'variant-chocolate-default'").run(price);
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    if (quantity !== 1) cart = value(pos.setQuantity({ cartId: cart.id, expectedRevision: cart.revision, lineId: cart.items[0]?.id ?? '', quantity }));
    return value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
  }
  function prepare(view: CheckoutView, method: PaymentMethod, amount: number, key = runtime.newId()) {
    return value(payments.preparePayment({ sessionId: view.session.id, idempotencyKey: key, method, intendedRappen: amount }));
  }
  function confirm(view: CheckoutView, method: PaymentMethod, amount: number): CheckoutView {
    const attempt = prepare(view, method, amount);
    return value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
  }
  function cashSale(price = 247, quantity = 1): FinancialSale {
    const view = checkout(price, quantity);
    const paid = confirm(view, 'cash', view.balance.cashDueRappen);
    return value(payments.completeCheckout({ sessionId: paid.session.id }));
  }
  function refund(sale: FinancialSale, quantity: number, method: PaymentMethod = 'card', key = runtime.newId()) {
    return value(payments.prepareRefund({ saleId: sale.id, idempotencyKey: key, method, items: [{ saleItemId: sale.items[0]?.id ?? '', quantity }] }));
  }

  function versionTwoDatabase(): void {
    const { sqlite } = connection;
    sqlite.exec(`BEGIN IMMEDIATE;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
      ${firstSaleMigration.sql}`);
    const record = sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)');
    record.run(1, firstSaleMigration.name, createHash('sha256').update(firstSaleMigration.sql).digest('hex'), runtime.now());
    sqlite.exec(catalogManagementMigration.sql);
    record.run(2, catalogManagementMigration.name, createHash('sha256').update(catalogManagementMigration.sql).digest('hex'), runtime.now());
    sqlite.exec('COMMIT');
    seedDevelopmentCatalog(connection, 'development');
  }

  it('upgrades populated version-two sales, payments and historical cart snapshots without rewriting them', () => {
    versionTwoDatabase();
    const pos = createPosService(createPosStore(connection), runtime);
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    const checkout = value(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    const sale = value(pos.completeSale({ idempotencyKey: checkout.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
    let draft = value(pos.getCart({})).cart;
    draft = value(pos.addItem({ cartId: draft.id, expectedRevision: draft.revision, variantId: 'variant-chocolate-default' }));
    connection.sqlite.prepare("UPDATE product_variants SET unit_price_rappen = 999 WHERE id = 'variant-chocolate-default'").run();
    const snapshot = (table: string) => JSON.stringify(connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const tables = ['sales', 'sale_items', 'sale_payments', 'checkout_attempts', 'cart_items'];
    const before = tables.map(snapshot);
    const oldLedger = connection.sqlite.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    runMigrations(connection);
    expect(tables.map(snapshot)).toEqual(before);
    expect(connection.sqlite.prepare('SELECT * FROM schema_migrations WHERE version <= 2 ORDER BY version').all()).toEqual(oldLedger);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM schema_migrations').get()?.['n']).toBe(migrations.length);
    expect(migrations.length).toBeGreaterThan(2);
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(value(pos.getCart({})).cart).toEqual(draft);
    connection.close();
    connection = openDatabase(databaseFile);
    runMigrations(connection);
    const reopened = createPosService(createPosStore(connection), runtime);
    expect(value(reopened.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(value(reopened.getCart({})).cart).toEqual(draft);
    const modern = createPaymentsService(createFinanceStore(connection), runtime);
    expect(value(modern.getSaleDetails({ saleId: sale.id })).sale).toMatchObject({ id: sale.id, source: 'legacy', actualPaidRappen: 245 });
  });

  it('rolls back migration three entirely when an unrelated conflicting table exists', () => {
    versionTwoDatabase();
    connection.sqlite.exec("CREATE TABLE payment_attempts (note TEXT); INSERT INTO payment_attempts VALUES ('retain existing data')");
    expect(() => runMigrations(connection)).toThrow();
    expect(connection.sqlite.prepare('SELECT count(*) n FROM schema_migrations').get()?.['n']).toBe(2);
    expect(connection.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'payment_sessions'").get()).toBeUndefined();
    expect(connection.sqlite.prepare('SELECT note FROM payment_attempts').get()?.['note']).toBe('retain existing data');
  });

  it.each(['card', 'twint'] as const)('records exact %s allocations, commits once and reopens the same immutable sale', (method) => {
    const view = checkout(842);
    const request = { sessionId: view.session.id, idempotencyKey: 'exact-payment', method, intendedRappen: 842 };
    const attempt = value(payments.preparePayment(request));
    expect(value(payments.preparePayment(request))).toEqual(attempt);
    expect(payments.preparePayment({ ...request, intendedRappen: 841 }).ok).toBe(false);
    expect(value(payments.getCheckout({ sessionId: view.session.id })).balance.confirmedAppliedRappen).toBe(0);
    expect(payments.completeCheckout({ sessionId: view.session.id }).ok).toBe(false);
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(sale).toMatchObject({ amountDueRappen: 842, actualPaidRappen: 842, roundingAdjustmentRappen: 0 });
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0]).toMatchObject({ method, amountRappen: 842, cashTenderedRappen: null, changeRappen: 0 });
    expect(value(payments.completeCheckout({ sessionId: view.session.id }))).toEqual(sale);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared', 'reported', 'confirmed']);
    reopen();
    expect(value(payments.completeCheckout({ sessionId: view.session.id }))).toEqual(sale);
    expect(value(payments.listRecentSales({}))).toEqual([sale]);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(1);
  });

  it('preserves multiple exact digital payments and rounds only the final cash balance with separate tender/change', () => {
    let view = checkout(1842);
    view = confirm(view, 'twint', 1000);
    expect(view.balance).toMatchObject({ confirmedDigitalRappen: 1000, outstandingRappen: 842, cashDueRappen: 840 });
    view = confirm(view, 'card', 500);
    expect(view.balance).toMatchObject({ confirmedDigitalRappen: 1500, outstandingRappen: 342, cashDueRappen: 340 });
    expect(payments.preparePayment({ sessionId: view.session.id, idempotencyKey: 'overpay', method: 'twint', intendedRappen: 343 }).ok).toBe(false);
    view = confirm(view, 'cash', 500);
    expect(view.balance).toMatchObject({ settled: true, outstandingRappen: 0, finalPayableRappen: 1840, roundingAdjustmentRappen: -2 });
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(sale.payments.map((p) => p.amountRappen)).toEqual([1000, 500, 340]);
    expect(sale.payments[2]).toMatchObject({ cashTenderedRappen: 500, amountRappen: 340, changeRappen: 160 });
    expect(sale.actualPaidRappen).toBe(1840);
    expect(payments.preparePayment({ sessionId: view.session.id, idempotencyKey: 'too-late', method: 'card', intendedRappen: 1 }).ok).toBe(false);
  });

  it('reserves the cart from every legacy mutation and cash preparation while a payment checkout is open', () => {
    const view = checkout(); const cart = view.session.cart;
    expect(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-water-default' }).ok).toBe(false);
    expect(pos.setQuantity({ cartId: cart.id, expectedRevision: cart.revision, lineId: cart.items[0]?.id ?? '', quantity: 2 }).ok).toBe(false);
    expect(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(false);
    expect(pos.removeItem({ cartId: cart.id, expectedRevision: cart.revision, lineId: cart.items[0]?.id ?? '' }).ok).toBe(false);
    expect(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(false);
    expect(value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }))).toEqual(view);
    value(payments.cancelCheckout({ sessionId: view.session.id }));
    expect(value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-water-default' })).items).toHaveLength(2);
    const changed = value(pos.getCart({})).cart;
    const next = value(payments.startCheckout({ cartId: changed.id, expectedRevision: changed.revision }));
    expect(next.session.id).not.toBe(view.session.id);
  });

  it('makes prepared external attempts durable across restart without counting or automatically confirming them', () => {
    const view = checkout(842); const attempt = prepare(view, 'card', 500);
    reopen();
    const active = value(payments.getActiveCheckout({}));
    expect(active?.attempts).toEqual([attempt]);
    expect(active?.balance).toMatchObject({ confirmedAppliedRappen: 0, outstandingRappen: 842 });
    expect(payments.cancelCheckout({ sessionId: view.session.id }).ok).toBe(false);
    value(payments.reportPaymentOutcome({ attemptId: attempt.id, outcome: 'failed', reason: 'No payment was attempted', operatorConfirmed: true }));
    value(payments.cancelCheckout({ sessionId: view.session.id }));
    expect(value(payments.getActiveCheckout({}))).toBeNull();
  });

  it('retains reported payment evidence when the allocation transaction rolls back and safely retries the same attempt', () => {
    const view = checkout(842); const attempt = prepare(view, 'twint', 842);
    let commits = 0;
    bind({ beforeCommit: () => { if (++commits === 2) throw new Error('Allocation commit fault'); } });
    expect(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    bind();
    expect(finance.getPaymentAttempt(attempt.id)?.status).toBe('reported');
    expect(value(payments.getCheckout({ sessionId: view.session.id })).balance.confirmedAppliedRappen).toBe(0);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared', 'reported']);
    reopen();
    expect(value(payments.listReconciliationCases({}))).toHaveLength(1);
    expect(value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })).balance.settled).toBe(true);
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(sale.payments).toHaveLength(1);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared', 'reported', 'confirmed']);
  });

  it('retains the prepared payment reference when its first confirmation transaction rolls back and retries only after explicit action', () => {
    const view = checkout(842); const attempt = prepare(view, 'card', 842);
    bind({ beforeCommit: () => { throw new Error('First confirmation write failed'); } });
    expect(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    reopen();
    expect(finance.getPaymentAttempt(attempt.id)).toEqual(attempt);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared']);
    const active = value(payments.getActiveCheckout({}));
    expect(active?.attempts).toEqual([attempt]);
    expect(active?.balance.confirmedAppliedRappen).toBe(0);
    expect(active?.sale).toBeNull();
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(0);
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0]?.attemptId).toBe(attempt.id);
    expect(value(payments.completeCheckout({ sessionId: view.session.id }))).toEqual(sale);
  });

  it.each([1, 2])('recovers a lost acknowledgement after confirmation transaction %i without duplicating allocations', (lostCommit) => {
    const view = checkout(842); const attempt = prepare(view, 'card', 842);
    let commits = 0;
    bind({ afterCommit: () => { if (++commits === lostCommit) throw new Error('Lost commit reply'); } });
    expect(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    reopen();
    expect(finance.getPaymentAttempt(attempt.id)?.status).toBe(lostCommit === 1 ? 'reported' : 'confirmed');
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(sale.payments).toHaveLength(1);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared', 'reported', 'confirmed']);
  });

  it('atomically rolls back final sale, consumed cart, completion marker and event while preserving confirmed allocations', () => {
    let view = checkout(); view = confirm(view, 'cash', 500);
    bind({ beforeCommit: () => { throw new Error('Final sale fault'); } });
    expect(payments.completeCheckout({ sessionId: view.session.id }).ok).toBe(false);
    bind();
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(0);
    expect(finance.pos.getCart(view.session.cart.id)).toEqual(view.session.cart);
    expect(finance.getSession(view.session.id)?.status).toBe('open');
    expect(finance.listEvents(view.session.id).map((event) => event.status)).toEqual(['open']);
    expect(finance.listPaymentAttempts(view.session.id)[0]?.status).toBe('confirmed');
    expect(value(payments.completeCheckout({ sessionId: view.session.id })).actualPaidRappen).toBe(245);
  });

  it('reconciles an unknown final commit after restart to one sale without taking another payment', () => {
    let view = checkout(); view = confirm(view, 'cash', 500);
    bind({ afterCommit: () => { throw new Error('Receipt reply lost'); } });
    expect(payments.completeCheckout({ sessionId: view.session.id })).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    reopen();
    const saved = value(payments.getCheckout({ sessionId: view.session.id }));
    expect(saved.session.status).toBe('completed');
    expect(saved.sale?.actualPaidRappen).toBe(245);
    expect(value(payments.completeCheckout({ sessionId: view.session.id }))).toEqual(saved.sale);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(1);
    expect(value(pos.getCart({})).cart.items).toHaveLength(0);
  });

  it('never automatically retries an uncertain transfer and requires reasoned, idempotent reconciliation', () => {
    const view = checkout(842); const attempt = prepare(view, 'twint', 842);
    value(payments.reportPaymentOutcome({ attemptId: attempt.id, outcome: 'uncertain', reason: 'Operator cannot determine external result', operatorConfirmed: true }));
    reopen();
    expect(value(payments.getActiveCheckout({}))?.balance.confirmedAppliedRappen).toBe(0);
    expect(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }).ok).toBe(false);
    expect(payments.completeCheckout({ sessionId: view.session.id }).ok).toBe(false);
    const cases = value(payments.listReconciliationCases({}));
    expect(cases[0]?.paymentAttempt?.status).toBe('uncertain');
    const request = { kind: 'payment', referenceId: attempt.id, idempotencyKey: 'investigation-1', resolution: 'confirm-recorded', reason: 'Operator inspected the external receipt and accepted the evidence', deliberateConfirmation: true } as const;
    const action = value(payments.reconcile(request));
    expect(value(payments.reconcile(request))).toEqual(action);
    expect(payments.reconcile({ ...request, reason: 'A changed investigation reason is a different request' }).ok).toBe(false);
    expect(value(payments.listReconciliationCases({}))).toHaveLength(1); // Confirmed digital funds still belong to an open checkout.
    expect(value(payments.completeCheckout({ sessionId: view.session.id })).actualPaidRappen).toBe(842);
    reopen();
    expect(value(payments.listReconciliationHistory({}))).toEqual([action]);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared', 'uncertain', 'confirmed']);
  });

  it('keeps excluded external evidence and the reason while releasing an explicitly compensated checkout', () => {
    const view = checkout(); const attempt = prepare(view, 'cash', 500);
    value(payments.reportPaymentOutcome({ attemptId: attempt.id, outcome: 'uncertain', reason: 'Cash disposition was unclear', operatorConfirmed: true }));
    value(payments.reconcile({ kind: 'payment', referenceId: attempt.id, idempotencyKey: 'compensation', resolution: 'exclude-compensated', reason: 'Operator recorded that all cash was manually returned', deliberateConfirmation: true }));
    expect(finance.getPaymentAttempt(attempt.id)).toMatchObject({ status: 'excluded', intendedRappen: 500, appliedRappen: 245 });
    expect(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }).ok).toBe(false);
    value(payments.cancelCheckout({ sessionId: view.session.id }));
    const cart = view.session.cart;
    expect(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(true);
    expect(value(payments.listReconciliationHistory({}))[0]?.resolution).toBe('exclude-compensated');
  });

  it('prevents concurrent payment preparation and settlement through two independent SQLite connections', () => {
    const view = checkout(842);
    const other = openDatabase(databaseFile); extraConnections.push(other);
    const second = createPaymentsService(createFinanceStore(other), runtime);
    const attempt = prepare(view, 'card', 842, 'concurrent-key');
    expect(value(second.preparePayment({ sessionId: view.session.id, idempotencyKey: 'concurrent-key', method: 'card', intendedRappen: 842 }))).toEqual(attempt);
    expect(second.preparePayment({ sessionId: view.session.id, idempotencyKey: 'other-key', method: 'twint', intendedRappen: 100 }).ok).toBe(false);
    value(second.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(value(second.completeCheckout({ sessionId: view.session.id }))).toEqual(sale);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(1);
  });

  it('refunds successive historical units using persisted rounding shares and exactly equals the original actual payment', () => {
    const sale = cashSale(247, 3);
    expect(sale.subtotalRappen).toBe(741); expect(sale.actualPaidRappen).toBe(740);
    connection.sqlite.prepare("UPDATE product_variants SET unit_price_rappen = 999 WHERE id = 'variant-chocolate-default'").run();
    const amounts: number[] = [];
    for (const method of ['card', 'twint', 'card'] as const) {
      const attempt = refund(sale, 1, method);
      const completed = value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
      amounts.push(completed.amountRappen);
      expect(completed.items[0]?.unitPriceRappen).toBe(247);
      reopen();
    }
    expect(amounts).toEqual([246, 247, 247]);
    const details = value(payments.getSaleDetails({ saleId: sale.id }));
    expect(details).toMatchObject({ refundedRappen: 740, refundableRappen: 0, items: [{ quantitySold: 3, quantityRefunded: 3, quantityRemaining: 0 }] });
    expect(details.refunds.map((r) => r.items[0]?.unitOffset)).toEqual([0, 1, 2]);
    expect(details.refunds.map((r) => r.items[0]?.roundingAllocationRappen)).toEqual([-1, 0, 0]);
    expect(payments.prepareRefund({ saleId: sale.id, idempotencyKey: 'exceeds-units', method: 'card', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] }).ok).toBe(false);
    expect(details.sale).toEqual(sale);
  });

  it('supports a full cash refund of a digitally paid sale and blocks a second refund or changed idempotency payload', () => {
    let view = checkout(845); view = confirm(view, 'card', 845);
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    const request = { saleId: sale.id, idempotencyKey: 'full-refund', method: 'cash' as const, items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] };
    const attempt = value(payments.prepareRefund(request));
    expect(value(payments.prepareRefund(request))).toEqual(attempt);
    expect(payments.prepareRefund({ ...request, method: 'twint' }).ok).toBe(false);
    const completed = value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    expect(completed).toMatchObject({ amountRappen: 845, method: 'cash' });
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }))).toEqual(completed);
    reopen();
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }))).toEqual(completed);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM refunds').get()?.['n']).toBe(1);
    expect(value(payments.getSaleDetails({ saleId: sale.id })).refundableRappen).toBe(0);
  });

  it('rejects non-nickel cash refunds without changing the historical allocation and permits exact digital refunds', () => {
    let view = checkout(842); view = confirm(view, 'twint', 842);
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(payments.prepareRefund({ saleId: sale.id, idempotencyKey: 'bad-cash', method: 'cash', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] })).toMatchObject({ ok: false, error: { code: 'CASH_DENOMINATION' } });
    const attempt = refund(sale, 1, 'card');
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true })).amountRappen).toBe(842);
  });

  it('reserves refund quantities across restart and competing connections until explicit cancellation or completion', () => {
    const sale = cashSale(247, 3); const first = refund(sale, 2);
    const other = openDatabase(databaseFile); extraConnections.push(other);
    const second = createPaymentsService(createFinanceStore(other), runtime);
    expect(second.prepareRefund({ saleId: sale.id, idempotencyKey: 'competing-refund', method: 'twint', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 2 }] })).toMatchObject({ ok: false, error: { code: 'REFUND_PENDING' } });
    reopen();
    expect(value(payments.getSaleDetails({ saleId: sale.id })).refundAttempts).toEqual([first]);
    value(payments.reportRefundOutcome({ attemptId: first.id, outcome: 'failed', reason: 'Operator confirms no disbursement occurred', operatorConfirmed: true }));
    const replacement = refund(sale, 3, 'twint');
    expect(replacement.items[0]?.unitOffset).toBe(0);
    expect(value(second.confirmRefund({ attemptId: replacement.id, operatorConfirmed: true })).amountRappen).toBe(740);
    expect(payments.prepareRefund({ saleId: sale.id, idempotencyKey: 'late-refund', method: 'card', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] }).ok).toBe(false);
  });

  it('retains reported refund evidence across a failed final transaction and completes one refund after restart', () => {
    const sale = cashSale(); const attempt = refund(sale, 1, 'twint');
    let commits = 0;
    bind({ beforeCommit: () => { if (++commits === 2) throw new Error('Refund completion fault'); } });
    expect(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    bind();
    expect(finance.getRefundAttempt(attempt.id)?.status).toBe('reported');
    expect(finance.getRefundByAttempt(attempt.id)).toBeNull();
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared', 'reported']);
    reopen();
    expect(value(payments.listReconciliationCases({}))[0]?.kind).toBe('refund');
    const completed = value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    expect(completed.amountRappen).toBe(245);
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }))).toEqual(completed);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM refunds').get()?.['n']).toBe(1);
  });

  it('retains the prepared refund reference when its first confirmation transaction rolls back and never disburses on read', () => {
    const sale = cashSale(); const attempt = refund(sale, 1, 'twint');
    bind({ beforeCommit: () => { throw new Error('First refund confirmation write failed'); } });
    expect(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    reopen();
    expect(value(payments.getRefundAttempt({ attemptId: attempt.id }))).toEqual(attempt);
    expect(finance.listEvents(attempt.id).map((event) => event.status)).toEqual(['prepared']);
    expect(value(payments.getSaleDetails({ saleId: sale.id })).refundedRappen).toBe(0);
    expect(finance.getRefundByAttempt(attempt.id)).toBeNull();
    expect(connection.sqlite.prepare('SELECT count(*) n FROM refunds').get()?.['n']).toBe(0);
    const completed = value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    expect(completed.attemptId).toBe(attempt.id);
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }))).toEqual(completed);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM refunds').get()?.['n']).toBe(1);
  });

  it.each([1, 2])('recovers a lost acknowledgement after refund commit %i with the original refund identity', (lostCommit) => {
    const sale = cashSale(); const attempt = refund(sale, 1);
    let commits = 0;
    bind({ afterCommit: () => { if (++commits === lostCommit) throw new Error('Refund reply lost'); } });
    expect(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    reopen();
    expect(finance.getRefundAttempt(attempt.id)?.status).toBe(lostCommit === 1 ? 'reported' : 'completed');
    const completed = value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }))).toEqual(completed);
    expect(finance.listRefunds(sale.id)).toEqual([completed]);
  });

  it('investigates an uncertain refund without automatic disbursement and preserves the accepted audit action', () => {
    const sale = cashSale(); const attempt = refund(sale, 1);
    value(payments.reportRefundOutcome({ attemptId: attempt.id, outcome: 'uncertain', reason: 'External refund outcome cannot be verified', operatorConfirmed: true }));
    reopen();
    expect(value(payments.getSaleDetails({ saleId: sale.id })).refundedRappen).toBe(0);
    expect(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }).ok).toBe(false);
    expect(value(payments.listReconciliationCases({}))[0]?.refundAttempt?.id).toBe(attempt.id);
    currentTime = '2026-11-16T14:00:00.000Z';
    const action = value(payments.reconcile({ kind: 'refund', referenceId: attempt.id, idempotencyKey: 'refund-review', resolution: 'confirm-recorded', reason: 'Operator reviewed the external refund evidence and accepted it', deliberateConfirmation: true }));
    const completed = finance.getRefundByAttempt(attempt.id);
    expect(completed?.amountRappen).toBe(245);
    expect(completed?.confirmedAt).toBe('2026-11-16T14:00:00.000Z');
    expect(finance.getRefundAttempt(attempt.id)?.reportedAt).toBe('2026-11-16T12:00:00.000Z');
    expect(value(payments.listReconciliationCases({}))).toHaveLength(0);
    reopen();
    expect(value(payments.listReconciliationHistory({}))).toEqual([action]);
    expect(finance.listRefunds(sale.id)).toEqual([completed]);
  });

  it('preserves legacy conflicting cash evidence until every explicit compensation is audited and then unlocks operation', () => {
    initialize();
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    const first = value(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-water-default' }));
    const second = value(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    expect(pos.completeSale({ idempotencyKey: first.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true }).ok).toBe(false);
    expect(pos.completeSale({ idempotencyKey: second.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true }).ok).toBe(false);
    const originalRows = connection.sqlite.prepare("SELECT * FROM checkout_attempts WHERE state = 'confirmed' ORDER BY rowid").all();
    expect(originalRows).toHaveLength(2);
    expect(value(payments.listReconciliationCases({}))).toHaveLength(2);
    expect(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(false);
    const resolve = (key: string, auditKey: string) => value(payments.reconcile({ kind: 'legacy', referenceId: key, idempotencyKey: auditKey, resolution: 'exclude-compensated', reason: 'Operator documented that the cash for this conflicting attempt was returned', deliberateConfirmation: true }));
    resolve(first.idempotencyKey, 'legacy-resolve-1');
    expect(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(false);
    resolve(second.idempotencyKey, 'legacy-resolve-2');
    expect(value(payments.listReconciliationCases({}))).toHaveLength(0);
    expect(connection.sqlite.prepare("SELECT * FROM checkout_attempts WHERE state = 'confirmed' ORDER BY rowid").all()).toEqual(originalRows);
    expect(finance.pos.getPendingCheckout(cart.id)).toBeNull();
    expect(pos.completeSale({ idempotencyKey: second.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true }).ok).toBe(false);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(0);
    reopen();
    expect(value(payments.listReconciliationHistory({}))).toHaveLength(2);
    expect(value(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision })).items).toHaveLength(0);
  });

  it('records a late legacy cash confirmation during modern checkout, blocks both paths and resumes only after explicit disposition', () => {
    initialize();
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    const legacy = value(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    const modern = value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    expect(pos.completeSale({ idempotencyKey: legacy.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    expect(finance.pos.getCheckout(legacy.idempotencyKey)?.status).toBe('confirmed');
    expect(payments.preparePayment({ sessionId: modern.session.id, idempotencyKey: 'blocked-modern', method: 'card', intendedRappen: 247 }).ok).toBe(false);
    value(payments.reconcile({ kind: 'legacy', referenceId: legacy.idempotencyKey, idempotencyKey: 'legacy-compensated', resolution: 'exclude-compensated', reason: 'Operator confirmed that the stale legacy cash was manually returned', deliberateConfirmation: true }));
    const paid = confirm(modern, 'card', 247);
    const sale = value(payments.completeCheckout({ sessionId: paid.session.id }));
    expect(sale.actualPaidRappen).toBe(247);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(0);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(1);
    expect(pos.completeSale({ idempotencyKey: legacy.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }).ok).toBe(false);
  });

  it('returns an old completed legacy receipt idempotently while a new checkout is open and supports legacy-sale refunds', () => {
    initialize();
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    const legacy = value(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    const sale = value(pos.completeSale({ idempotencyKey: legacy.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
    const modern = checkout();
    expect(value(pos.completeSale({ idempotencyKey: legacy.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }))).toEqual(sale);
    const attempt = value(payments.prepareRefund({ saleId: sale.id, idempotencyKey: 'legacy-refund', method: 'twint', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] }));
    expect(value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true })).amountRappen).toBe(245);
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale.source).toBe('legacy');
    expect(value(payments.getActiveCheckout({}))?.session.id).toBe(modern.session.id);
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
  });

  it('blocks legacy cart changes and cash preparation during an unresolved refund while retaining old receipt replay', () => {
    initialize();
    let originalCart = value(pos.getCart({})).cart;
    originalCart = value(pos.addItem({ cartId: originalCart.id, expectedRevision: originalCart.revision, variantId: 'variant-chocolate-default' }));
    const legacy = value(pos.prepareCheckout({ cartId: originalCart.id, expectedRevision: originalCart.revision }));
    const sale = value(pos.completeSale({ idempotencyKey: legacy.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-water-default' }));
    const attempt = value(payments.prepareRefund({ saleId: sale.id, idempotencyKey: 'uncertain-global-refund', method: 'card', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] }));
    value(payments.reportRefundOutcome({ attemptId: attempt.id, outcome: 'uncertain', reason: 'External refund outcome is unknown', operatorConfirmed: true }));
    expect(finance.getOpenSession()).toBeNull();
    expect(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }).ok).toBe(false);
    expect(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(false);
    expect(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }).ok).toBe(false);
    expect(value(pos.completeSale({ idempotencyKey: legacy.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }))).toEqual(sale);
    value(payments.reconcile({ kind: 'refund', referenceId: attempt.id, idempotencyKey: 'resolve-global-refund', resolution: 'exclude-no-transfer', reason: 'Operator established that no external refund transfer occurred', deliberateConfirmation: true }));
    expect(value(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision })).items).toHaveLength(0);
  });

  it('rejects forged financial inserts, missing JSON identities and direct invalid status jumps', () => {
    const view = checkout(842); const attempt = prepare(view, 'card', 842);
    const fakeSale = { id: 'forged-sale', checkoutSessionId: view.session.id, cartId: view.session.cart.id, cartRevision: view.session.cart.revision,
      completedAt: runtime.now(), items: view.session.cart.items, subtotalRappen: 842, roundingAdjustmentRappen: 0, amountDueRappen: 842, actualPaidRappen: 842,
      payments: [{ attemptId: attempt.id, method: 'card', amountRappen: 842, cashTenderedRappen: null, changeRappen: 0, operatorConfirmed: true, confirmedAt: runtime.now() }], source: 'payments' };
    const insert = (data: unknown) => connection.sqlite.prepare('INSERT INTO financial_sales (id, session_id, cart_id, completed_at, actual_paid_rappen, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fakeSale.id, view.session.id, view.session.cart.id, runtime.now(), 842, JSON.stringify(data));
    expect(() => insert(fakeSale)).toThrow();
    expect(() => insert({})).toThrow();
    expect(() => connection.sqlite.prepare('INSERT INTO financial_events (id, reference_id, data) VALUES (?, ?, ?)').run('missing-event', attempt.id, '{}')).toThrow();
    const jumped = { ...attempt, status: 'confirmed', reportedAt: runtime.now(), confirmedAt: runtime.now() };
    expect(() => connection.sqlite.prepare('UPDATE payment_attempts SET state = ?, data = ? WHERE id = ?').run('confirmed', JSON.stringify(jumped), attempt.id)).toThrow();
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    expect(() => insert({ ...fakeSale, payments: [{ ...fakeSale.payments[0], amountRappen: 841 }] })).toThrow();
    expect(() => insert({ ...fakeSale, payments: [fakeSale.payments[0], fakeSale.payments[0]] })).toThrow();
    expect(connection.sqlite.prepare('SELECT count(*) n FROM financial_sales').get()?.['n']).toBe(0);
    expect(value(payments.completeCheckout({ sessionId: view.session.id })).actualPaidRappen).toBe(842);
  });

  it('enforces append-only sales, refunds, financial events and reconciliation audit rows in SQLite', () => {
    const sale = cashSale(); const attempt = refund(sale, 1); value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    const next = checkout(); const pending = prepare(next, 'card', 247);
    value(payments.reportPaymentOutcome({ attemptId: pending.id, outcome: 'uncertain', reason: 'Outcome requires investigation', operatorConfirmed: true }));
    value(payments.reconcile({ kind: 'payment', referenceId: pending.id, idempotencyKey: 'audit-immutable', resolution: 'exclude-no-transfer', reason: 'Operator established that no external transfer occurred', deliberateConfirmation: true }));
    for (const table of ['financial_sales', 'refunds', 'financial_events', 'reconciliation_actions']) {
      expect(() => connection.sqlite.prepare(`UPDATE ${table} SET data = data`).run()).toThrow();
      expect(() => connection.sqlite.prepare(`DELETE FROM ${table}`).run()).toThrow();
    }
    for (const table of ['payment_sessions', 'payment_attempts', 'refund_attempts']) expect(() => connection.sqlite.prepare(`DELETE FROM ${table}`).run()).toThrow();
    const original = finance.getPaymentAttempt(pending.id);
    expect(original).not.toBeNull();
    expect(() => connection.sqlite.prepare('UPDATE payment_attempts SET data = ? WHERE id = ?').run(JSON.stringify({ ...original, intendedRappen: 1 }), pending.id)).toThrow();
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale).toEqual(sale);
  });

  it('retains committed refund sequence order even when the system clock moves backwards', () => {
    const sale = cashSale(247, 3);
    const times = ['2026-11-16T12:00:00.000Z', '2026-11-16T11:00:00.000Z', '2026-11-16T13:00:00.000Z'];
    for (const at of times) {
      currentTime = at; const attempt = refund(sale, 1);
      value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    }
    reopen();
    const details = value(payments.getSaleDetails({ saleId: sale.id }));
    expect(details.refunds.map((record) => record.completedAt)).toEqual(times);
    expect(details.refunds.map((record) => record.items[0]?.unitOffset)).toEqual([0, 1, 2]);
    expect(details.refundedRappen).toBe(sale.actualPaidRappen);
  });

  it('rolls back an investigated refund together with its audit action if their shared commit fails', () => {
    const sale = cashSale(); const attempt = refund(sale, 1);
    value(payments.reportRefundOutcome({ attemptId: attempt.id, outcome: 'uncertain', reason: 'Refund outcome remains unknown', operatorConfirmed: true }));
    const request = { kind: 'refund', referenceId: attempt.id, idempotencyKey: 'atomic-audit-refund', resolution: 'confirm-recorded', reason: 'Operator accepted the investigated external refund evidence', deliberateConfirmation: true } as const;
    bind({ beforeCommit: () => { throw new Error('Investigation commit failed'); } });
    expect(payments.reconcile(request).ok).toBe(false);
    bind();
    expect(finance.getRefundAttempt(attempt.id)?.status).toBe('uncertain');
    expect(finance.getRefundByAttempt(attempt.id)).toBeNull();
    expect(value(payments.listReconciliationHistory({}))).toHaveLength(0);
    const action = value(payments.reconcile(request));
    expect(finance.getRefundByAttempt(attempt.id)?.amountRappen).toBe(245);
    expect(value(payments.listReconciliationHistory({}))).toEqual([action]);
  });

  it('rejects raw SQL refund quantities beyond the original units even for zero-value lines', () => {
    const sale = cashSale(0);
    const items = [{ saleItemId: sale.items[0]?.id ?? '', quantity: 2, unitOffset: 0, unitPriceRappen: 0, baseRappen: 0, roundingAllocationRappen: 0, amountRappen: 0 }];
    const attempt = { id: 'forged-refund-attempt', idempotencyKey: 'forged-refund-key', saleId: sale.id, method: 'card', items, amountRappen: 0,
      status: 'prepared', createdAt: runtime.now(), reportedAt: null, refundId: null, note: null };
    connection.sqlite.prepare('INSERT INTO refund_attempts (id, idempotency_key, sale_id, state, data) VALUES (?, ?, ?, ?, ?)')
      .run(attempt.id, attempt.idempotencyKey, sale.id, 'prepared', JSON.stringify(attempt));
    const reported = { ...attempt, status: 'reported', reportedAt: runtime.now() };
    connection.sqlite.prepare('UPDATE refund_attempts SET state = ?, data = ? WHERE id = ?').run('reported', JSON.stringify(reported), attempt.id);
    const record = { id: 'forged-refund', idempotencyKey: attempt.idempotencyKey, attemptId: attempt.id, saleId: sale.id, items, amountRappen: 0, method: 'card', operatorConfirmed: true, confirmedAt: runtime.now(), completedAt: runtime.now() };
    expect(() => connection.sqlite.prepare('INSERT INTO refunds (id, idempotency_key, attempt_id, sale_id, amount_rappen, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(record.id, record.idempotencyKey, record.attemptId, record.saleId, record.amountRappen, JSON.stringify(record))).toThrow('Refund units');
    expect(connection.sqlite.prepare('SELECT count(*) n FROM refunds').get()?.['n']).toBe(0);
  });

  it('fails closed on ambiguous duplicate-key financial snapshots before using them as business data', () => {
    const view = checkout(); const attempt = prepare(view, 'card', 100);
    value(payments.reportPaymentOutcome({ attemptId: attempt.id, outcome: 'failed', reason: 'No transfer was attempted', operatorConfirmed: true }));
    const template = { ...attempt, id: 'ambiguous-db-id', idempotencyKey: 'ambiguous-key' };
    const ambiguous = JSON.stringify(template).replace('"id":"ambiguous-db-id"', '"id":"ambiguous-db-id","id":"ambiguous-decoded-id"');
    connection.sqlite.prepare('INSERT INTO payment_attempts (id, idempotency_key, session_id, state, data) VALUES (?, ?, ?, ?, ?)')
      .run(template.id, template.idempotencyKey, template.sessionId, 'prepared', ambiguous);
    expect(() => finance.getPaymentAttempt(template.id)).toThrow('ambiguous');
    expect(payments.getCheckout({ sessionId: view.session.id })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
  });

  it('allows an open confirmed digital allocation to be excluded only after audited manual compensation, retaining all original evidence', () => {
    const view = checkout(842); const attempt = prepare(view, 'twint', 500);
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const confirmed = finance.getPaymentAttempt(attempt.id);
    expect(value(payments.listReconciliationCases({}))[0]?.paymentAttempt?.status).toBe('confirmed');
    const request = { kind: 'payment', referenceId: attempt.id, idempotencyKey: 'compensate-open-digital', resolution: 'exclude-compensated', reason: 'Operator documented that the full confirmed TWINT amount was manually returned', deliberateConfirmation: true } as const;
    expect(payments.reconcile({ ...request, resolution: 'exclude-no-transfer' }).ok).toBe(false);
    expect(payments.reconcile({ ...request, resolution: 'confirm-recorded' }).ok).toBe(false);
    const action = value(payments.reconcile(request));
    expect(value(payments.reconcile(request))).toEqual(action);
    expect(finance.getPaymentAttempt(attempt.id)).toEqual({ ...confirmed, status: 'excluded', note: request.reason });
    expect(finance.listEvents(attempt.id).map((record) => record.status)).toEqual(['prepared', 'reported', 'confirmed', 'excluded']);
    expect(value(payments.getCheckout({ sessionId: view.session.id })).balance).toMatchObject({ confirmedAppliedRappen: 0, outstandingRappen: 842 });
    expect(payments.completeCheckout({ sessionId: view.session.id }).ok).toBe(false);
    value(payments.cancelCheckout({ sessionId: view.session.id }));
    reopen();
    expect(finance.getPaymentAttempt(attempt.id)?.confirmedAt).toBe(confirmed?.confirmedAt);
    expect(value(payments.listReconciliationHistory({}))).toEqual([action]);
    expect(value(pos.clearCart({ cartId: view.session.cart.id, expectedRevision: view.session.cart.revision })).items).toHaveLength(0);
  });

  it('rejects direct confirmed-allocation exclusion without its atomic compensation audit', () => {
    const view = checkout(842); const attempt = prepare(view, 'card', 500);
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const confirmed = finance.getPaymentAttempt(attempt.id);
    if (confirmed === null) throw new Error('Missing confirmed fixture payment');
    const excluded = { ...confirmed, status: 'excluded', note: 'Unaudited compensation assertion' } as const;
    expect(() => finance.transaction(() => finance.putPaymentAttempt(excluded))).toThrow();
    expect(() => connection.sqlite.prepare('UPDATE payment_attempts SET state = ?, data = ? WHERE id = ?').run('excluded', JSON.stringify(excluded), attempt.id)).toThrow();
    expect(finance.getPaymentAttempt(attempt.id)).toEqual(confirmed);
    expect(value(payments.listReconciliationHistory({}))).toHaveLength(0);
  });

  it('retains confirmed allocations and no compensation action when their shared compensation commit rolls back', () => {
    const view = checkout(842); const attempt = prepare(view, 'card', 842);
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const request = { kind: 'payment', referenceId: attempt.id, idempotencyKey: 'compensate-rollback', resolution: 'exclude-compensated', reason: 'Operator documented a completed manual return of these card funds', deliberateConfirmation: true } as const;
    bind({ beforeCommit: () => { throw new Error('Compensation audit commit failed'); } });
    expect(payments.reconcile(request).ok).toBe(false);
    reopen();
    expect(finance.getPaymentAttempt(attempt.id)?.status).toBe('confirmed');
    expect(finance.listEvents(attempt.id).map((record) => record.status)).toEqual(['prepared', 'reported', 'confirmed']);
    expect(value(payments.listReconciliationHistory({}))).toHaveLength(0);
    const action = value(payments.reconcile(request));
    expect(finance.getPaymentAttempt(attempt.id)?.status).toBe('excluded');
    expect(value(payments.listReconciliationHistory({}))).toEqual([action]);
  });

  it('never excludes confirmed cash, earlier digital funds after cash settlement, or payments on a completed sale', () => {
    const view = checkout(842); const digital = prepare(view, 'card', 500);
    value(payments.confirmPayment({ attemptId: digital.id, operatorConfirmed: true }));
    const cash = prepare(view, 'cash', 500);
    value(payments.confirmPayment({ attemptId: cash.id, operatorConfirmed: true }));
    expect(value(payments.listReconciliationCases({}))).toHaveLength(0);
    const request = { kind: 'payment', referenceId: digital.id, idempotencyKey: 'blocked-post-cash', resolution: 'exclude-compensated', reason: 'Operator proposes removing an allocation after cash settlement', deliberateConfirmation: true } as const;
    expect(payments.reconcile(request).ok).toBe(false);
    expect(payments.reconcile({ ...request, referenceId: cash.id, idempotencyKey: 'blocked-cash' }).ok).toBe(false);
    const sale = value(payments.completeCheckout({ sessionId: view.session.id }));
    expect(sale.payments.map((payment) => payment.amountRappen)).toEqual([500, 340]);
    expect(payments.reconcile({ ...request, idempotencyKey: 'blocked-completed' }).ok).toBe(false);
    const attempt = finance.getPaymentAttempt(digital.id);
    if (attempt === null) throw new Error('Missing completed fixture payment');
    expect(() => finance.transaction(() => {
      finance.insertReconciliationAction({ id: 'forged-completed-action', idempotencyKey: request.idempotencyKey, kind: request.kind,
        referenceId: request.referenceId, resolution: request.resolution, reason: request.reason, at: runtime.now() });
      finance.putPaymentAttempt({ ...attempt, status: 'excluded', note: request.reason });
    })).toThrow();
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale).toEqual(sale);
    expect(value(payments.listReconciliationHistory({}))).toHaveLength(0);
  });

  it('requires a pending cash quote to be resolved before compensating an earlier confirmed digital allocation', () => {
    const view = checkout(842); const digital = prepare(view, 'card', 500);
    value(payments.confirmPayment({ attemptId: digital.id, operatorConfirmed: true }));
    const cash = prepare(view, 'cash', 500);
    const request = { kind: 'payment', referenceId: digital.id, idempotencyKey: 'pending-cash-compensation', resolution: 'exclude-compensated', reason: 'Operator documented a manual return of the original card payment', deliberateConfirmation: true } as const;
    expect(value(payments.listReconciliationCases({}))).toHaveLength(0);
    expect(payments.reconcile(request).ok).toBe(false);
    value(payments.reportPaymentOutcome({ attemptId: cash.id, outcome: 'failed', reason: 'No physical cash transfer occurred', operatorConfirmed: true }));
    expect(value(payments.listReconciliationCases({}))[0]?.referenceId).toBe(digital.id);
    const action = value(payments.reconcile(request));
    expect(finance.getPaymentAttempt(digital.id)?.status).toBe('excluded');
    expect(value(payments.listReconciliationHistory({}))).toEqual([action]);
  });
});
