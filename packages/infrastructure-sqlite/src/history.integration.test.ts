import {createOrderService} from '@cash-sloth/application';
import {createOrderStore} from './order-store.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHistoryService, createPaymentsService, createPosService, createPresetService, type HistoryService, type PaymentsService, type PosService } from '@cash-sloth/application';
import { createPresetStore } from './preset-store.js';
import { parseCatalogCsv, swissHistoryRange } from '@cash-sloth/domain';
import type { FinancialSale, HistoryFilters, HistorySort, PaymentMethod, Result } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { createPosStore } from './pos-store.js';
import { createFinanceStore } from './finance-store.js';
import { createHistoryStore } from './history-store.js';
import { seedDevelopmentCatalog } from './seed.js';
import { runMigrations } from './migrations.js';
import { firstSaleMigration } from './migrations/0001-first-sale.js';
import { catalogManagementMigration } from './migrations/0002-catalog-management.js';
import { paymentsRefundsMigration } from './migrations/0003-payments-refunds.js';

function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`); return result.value; }
const filters: HistoryFilters = { dateFrom: null, dateTo: null, paymentMethod: 'all', minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all', saleId: '', productQuery: '' };
const sort: HistorySort = { field: 'date', direction: 'desc' };
describe('SQL history and financial CSV export', () => {
  let directory: string; let databaseFile: string; let connection: DatabaseConnection;
  let sequence: number; let now: string; let pos: PosService; let payments: PaymentsService; let history: HistoryService;
  const runtime = { newId: () => `history-${++sequence}`, now: () => now };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cash-sloth-history-')); databaseFile = join(directory, 'history.sqlite');
    connection = openDatabase(databaseFile); sequence = 0; now = '2026-11-18T10:00:00.000Z';
    runMigrations(connection); seedDevelopmentCatalog(connection, 'development'); bind();
  });
  afterEach(() => { connection.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  function bind() { pos = createPosService(createPosStore(connection), runtime); payments = createPaymentsService(createFinanceStore(connection), runtime); history = createHistoryService(createHistoryStore(connection), runtime); }
  function cart(price: number, quantity = 1) {
    connection.sqlite.prepare("UPDATE product_variants SET unit_price_rappen = ? WHERE id = 'variant-chocolate-default'").run(price);
    let saved = value(pos.getCart({})).cart;
    saved = value(pos.addItem({ cartId: saved.id, expectedRevision: saved.revision, variantId: 'variant-chocolate-default' }));
    if (quantity !== 1) saved = value(pos.setQuantity({ cartId: saved.id, expectedRevision: saved.revision, lineId: saved.items[0]?.id ?? '', quantity }));
    return saved;
  }
  function sale(method: PaymentMethod | 'mixed' = 'cash', price = 247, quantity = 1, timestamp = now): FinancialSale {
    now = timestamp; const saved = cart(price, quantity); let checkout = value(payments.startCheckout({ cartId: saved.id, expectedRevision: saved.revision }));
    const allocations: readonly [PaymentMethod, number][] = method === 'mixed' ? [['twint', 500], ['card', 500], ['cash', 685]] : [[method, method === 'cash' ? checkout.balance.cashDueRappen : saved.subtotalRappen]];
    for (const [allocationMethod, intendedRappen] of allocations) {
      const prepared = value(payments.preparePayment({ sessionId: checkout.session.id, idempotencyKey: runtime.newId(), method: allocationMethod, intendedRappen }));
      checkout = value(payments.confirmPayment({ attemptId: prepared.id, operatorConfirmed: true }));
    }
    return value(payments.completeCheckout({ sessionId: checkout.session.id }));
  }
  function legacy(price = 247, quantity = 1, timestamp = now): FinancialSale {
    now = timestamp; const saved = cart(price, quantity);
    const prepared = value(pos.prepareCheckout({ cartId: saved.id, expectedRevision: saved.revision }));
    const completed = value(pos.completeSale({ idempotencyKey: prepared.idempotencyKey, cashReceivedRappen: prepared.amountDueRappen, operatorConfirmed: true }));
    return value(payments.getSaleDetails({ saleId: completed.id })).sale;
  }
  function buildSalesFixture(count:number):void {
    // Batch fixture construction only. Other integration cases exercise real
    // per-stage durable commits; this case tests read/query behavior at volume.
    // Domain/use cases and SQL constraints still construct every stored record.
    const fixtureTransaction = <T>(operation: () => T): T => operation();
    pos = createPosService({ ...createPosStore(connection), transaction: fixtureTransaction }, runtime);
    payments = createPaymentsService({ ...createFinanceStore(connection), transaction: fixtureTransaction }, runtime);
    connection.sqlite.exec('BEGIN IMMEDIATE');
    try { for (let index = 0; index < count; index++) serveFixture(sale('card', 100 + index)); connection.sqlite.exec('COMMIT'); }
    catch (error) { if (connection.sqlite.isTransaction) connection.sqlite.exec('ROLLBACK'); throw error; }
    bind();
  }
  function serveFixture(sale:FinancialSale):void {
    if(!sale.order)return;const store=createOrderStore(connection);const service=createOrderService({...store,pos:{...store.pos,transaction:operation=>connection.sqlite.isTransaction?operation():store.pos.transaction(operation)}},runtime);let current=store.get(sale.order.id)!;
    for(const preparation of ['preparing','ready','collected'] as const)current=value(service.prepare({orderId:current.id,expectedRevision:current.revision,operationId:runtime.newId(),preparation}));
  }
  function refund(original: FinancialSale, quantity: number, method: PaymentMethod = 'card') {
    const attempt = value(payments.prepareRefund({ saleId: original.id, idempotencyKey: runtime.newId(), method, items: [{ saleItemId: original.items[0]?.id ?? '', quantity }] }));
    return value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
  }
  const search = (changes: Partial<HistoryFilters> = {}, sorting = sort, page = 1, pageSize = 25) => value(history.search({ filters: { ...filters, ...changes }, sort: sorting, page, pageSize }));
  function csvRows(content: string): Record<string, string>[] {
    const parsed = parseCatalogCsv(content, ',');
    return parsed.rows.map((row) => Object.fromEntries(parsed.headers.map((name, index) => [name, row.values[index] ?? ''])));
  }

  it('separates event identities across renames, copies and deleted presets', () => {
    const unassigned = sale();
    const presets = createPresetService(createPresetStore(connection), runtime);
    const state = () => value(presets.getState({}));
    const a = value(presets.save({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, name: 'Festival', presetId: null, expectedRevision: null, empty: false })).active!.id;
    const first = sale('card');
    const current = state().presets.find((p) => p.id === a)!;
    value(presets.save({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, name: 'Renamed festival', presetId: a, expectedRevision: current.revision, empty: false }));
    const second = sale('twint');
    const source = state().presets.find((p) => p.id === a)!;
    const b = value(presets.copy({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: a, expectedRevision: source.revision, name: 'Festival' })).active!.id;
    const third = sale('card');
    expect(first.eventId).toBe(a); expect(second.eventId).toBe(a); expect(third.eventId).toBe(b);
    expect(first.eventTitle).toBe('Festival'); expect(second.eventTitle).toBe('Renamed festival');
    expect(search({ scope: 'event', eventId: a }).items.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    expect(search({ scope: 'event', eventId: b }).items.map((p) => p.id)).toEqual([third.id]);
    expect(search({ scope: 'event', eventId: null }).items.map((p) => p.id)).toEqual([unassigned.id]);
    expect(search({ scope: 'device' }).total).toBe(4);
    const savedB = state().presets.find((p) => p.id === b)!;
    value(presets.remove({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: b, expectedRevision: savedB.revision }));
    expect(value(history.getEvents({})).events).toEqual(expect.arrayContaining([{ id: a, title: 'Renamed festival' }, { id: b, title: 'Festival' }]));
    expect(search({ scope: 'event', eventId: b }).total).toBe(1);
    const exported = value(history.prepareExport({ filters: { ...filters, scope: 'event', eventId: a }, sort }));
    expect(exported.saleCount).toBe(2);
    expect(csvRows(exported.files[0]!.content).map((row) => row['event_id'])).toEqual([a, a]);
    connection.close(); connection = openDatabase(join(directory, 'history.sqlite')); runMigrations(connection); bind();
    expect(search({ scope: 'event', eventId: b }).total).toBe(1);
  });

  it.each(['payments', 'legacy'] as const)('permanently removes %s receipts and financial totals while retaining other sales', (source) => {
    const original = source === 'legacy' ? legacy() : sale('card');
    refund(original, 1);
    const other = sale('twint', 1000);
    const request = { saleId: original.id, reason: 'Wrong product selected' };
    expect(history.removeSale({ ...request, reason: '  ' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(history.removeSale({ ...request, saleId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    value(history.removeSale(request)); value(history.removeSale(request));
    expect(search({ includeRemoved: true }).items.map((s) => s.id)).toEqual([other.id]);
    expect(payments.getSaleDetails({ saleId: original.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(value(payments.getSaleDetails({ saleId: other.id })).sale).toEqual(other);
    const exported = value(history.prepareExport({ filters: { ...filters, includeRemoved: true }, sort }));
    expect(exported.saleCount).toBe(1); expect(exported.totals).toEqual({ paidRappen: '1000', refundedRappen: '0', netRappen: '1000' });
    expect(connection.sqlite.prepare('SELECT 1 FROM carts WHERE id=?').get(original.cartId)).toBeUndefined();
    expect(connection.sqlite.prepare('SELECT 1 FROM refunds WHERE sale_id=?').get(original.id)).toBeUndefined();
    expect(connection.sqlite.prepare('SELECT 1 FROM sale_purge_records').get()).toBeUndefined();
    expect(connection.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    connection.close(); connection = openDatabase(databaseFile); runMigrations(connection); bind();
    expect(search({ includeRemoved: true }).total).toBe(1);
    expect(payments.getSaleDetails({ saleId: original.id }).ok).toBe(false);
  });

  it('removes tip income and all payment evidence when an incorrect sale is deleted', () => {
    const saved = cart(247);
    const checkout = value(payments.startCheckout({ cartId: saved.id, expectedRevision: saved.revision }));
    value(payments.setTip({ sessionId: checkout.session.id, expectedTipRappen: 0, tipRappen: 253 }));
    const attempt = value(payments.preparePayment({ sessionId: checkout.session.id, idempotencyKey: runtime.newId(), method: 'card', intendedRappen: 500 }));
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const original = value(payments.completeCheckout({ sessionId: checkout.session.id }));
    expect(value(history.prepareExport({ filters, sort })).totals.paidRappen).toBe('500');
    value(history.removeSale({ saleId: original.id, reason: 'Incorrect entry' }));
    expect(value(history.prepareExport({ filters: { ...filters, includeRemoved: true }, sort })).totals).toEqual({ paidRappen: '0', refundedRappen: '0', netRappen: '0' });
    expect(value(payments.listRecentSales({}))).toEqual([]);
    expect(payments.getCheckout({ sessionId: checkout.session.id }).ok).toBe(false);
    expect(connection.sqlite.prepare('SELECT 1 FROM payment_attempts WHERE id=?').get(attempt.id)).toBeUndefined();
    expect(connection.sqlite.prepare('SELECT 1 FROM financial_events WHERE reference_id=?').get(attempt.id)).toBeUndefined();
  });

  it('purges previously hidden sales and rolls back all changes when a deletion fails', () => {
    const original = sale('card');
    connection.sqlite.prepare('INSERT INTO removed_history_sales VALUES(?,?,?)').run(original.id, now, 'Old hidden sale');
    connection.sqlite.exec("CREATE TEMP TRIGGER fail_sale_purge BEFORE DELETE ON financial_sales BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
    expect(history.removeSale({ saleId: original.id, reason: 'Incorrect' }).ok).toBe(false);
    expect(value(payments.getSaleDetails({ saleId: original.id })).sale).toEqual(original);
    expect(connection.sqlite.prepare('SELECT 1 FROM sale_purge_records').get()).toBeUndefined();
    connection.sqlite.exec('DROP TRIGGER fail_sale_purge');
    value(history.removeSale({ saleId: original.id, reason: 'Incorrect' }));
    expect(search({ includeRemoved: true }).total).toBe(0);
    expect(payments.getSaleDetails({ saleId: original.id }).ok).toBe(false);
  });

  it('blocks deletion during a pending refund and rolls back failed visibility writes', () => {
    const original = sale('card');
    const attempt = value(payments.prepareRefund({ saleId: original.id, idempotencyKey: runtime.newId(), method: 'card', items: [{ saleItemId: original.items[0]!.id, quantity: 1 }] }));
    expect(history.removeSale({ saleId: original.id, reason: 'Incorrect' })).toMatchObject({ ok: false, error: { code: 'REFUND_PENDING' } });
    value(payments.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true }));
    connection.sqlite.exec("CREATE TEMP TRIGGER fail_history_hide BEFORE INSERT ON removed_history_sales BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
    expect(history.removeSale({ saleId: original.id, reason: 'Incorrect' }).ok).toBe(false);
    expect(search().total).toBe(1);
    expect(value(payments.getSaleDetails({ saleId: original.id })).sale).toEqual(original);
  });

  it('clears one whole event independently and replays without deleting later sales', () => {
    const unassigned = legacy();
    const presets = createPresetService(createPresetStore(connection), runtime);
    const state = () => value(presets.getState({}));
    const a = value(presets.save({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, name: 'Summer', presetId: null, expectedRevision: null, empty: false })).active!.id;
    sale('card'); sale('twint');
    const source = state().presets.find((p) => p.id === a)!;
    const b = value(presets.copy({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: a, expectedRevision: source.revision, name: 'Winter' })).active!.id;
    const winter = sale('card');
    const preview = value(history.previewRemoval({ scope: 'event', eventId: a })); expect(preview.count).toBe(2);
    const request = { scope: 'event' as const, eventId: a, operationId: runtime.newId(), expectedVersion: preview.version, reason: 'Clear event' };
    expect(value(history.removeHistory(request))).toEqual({ removedCount: 2 });
    expect(search({ scope: 'event', eventId: a }).total).toBe(0);
    expect(search({ scope: 'event', eventId: b }).items.map((s) => s.id)).toEqual([winter.id]);
    expect(search({ scope: 'event', eventId: null }).items.map((s) => s.id)).toEqual([unassigned.id]);
    const savedA = state().presets.find((p) => p.id === a)!;
    value(presets.load({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: a, expectedRevision: savedA.revision }));
    const later = sale('card');
    expect(value(history.removeHistory(request))).toEqual({ removedCount: 2 });
    expect(search({ scope: 'event', eventId: a }).items.map((s) => s.id)).toEqual([later.id]);
    expect(history.removeHistory({ ...request, operationId: runtime.newId() })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const device = value(history.previewRemoval({ scope: 'device', eventId: null })); expect(device.count).toBe(3);
    expect(value(history.removeHistory({ scope: 'device', eventId: null, operationId: runtime.newId(), expectedVersion: device.version, reason: 'Reset device' })).removedCount).toBe(3);
    expect(search({ includeRemoved: true }).total).toBe(0);
    expect(state().presets).toHaveLength(2);
    expect(value(history.prepareExport({ filters, sort })).totals.netRappen).toBe('0');
  });

  it('rolls back an entire bulk deletion if a later sale fails and rejects reused operation keys', () => {
    const first = sale('card'), second = sale('twint');
    const preview = value(history.previewRemoval({ scope: 'device', eventId: null }));
    const request = { scope: 'device' as const, eventId: null, operationId: runtime.newId(), expectedVersion: preview.version, reason: 'Reset' };
    connection.sqlite.exec("CREATE TEMP TRIGGER fail_bulk BEFORE DELETE ON financial_sales WHEN OLD.id='" + second.id + "' BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
    expect(history.removeHistory(request).ok).toBe(false);
    expect(value(payments.getSaleDetails({ saleId: first.id })).sale).toEqual(first);
    expect(value(payments.getSaleDetails({ saleId: second.id })).sale).toEqual(second);
    expect(connection.sqlite.prepare('SELECT * FROM history_purge_operations').all()).toEqual([]);
    expect(connection.sqlite.prepare('SELECT * FROM sale_purge_records').all()).toEqual([]);
    connection.sqlite.exec('DROP TRIGGER fail_bulk');
    const pending = value(payments.prepareRefund({ saleId: second.id, idempotencyKey: runtime.newId(), method: 'card', items: [{ saleItemId: second.items[0]!.id, quantity: 1 }] }));
    expect(history.removeHistory(request)).toMatchObject({ ok: false, error: { code: 'REFUND_PENDING' } });
    expect(search().total).toBe(2);
    value(payments.confirmRefund({ attemptId: pending.id, operatorConfirmed: true }));
    value(history.removeHistory(request));
    expect(history.removeHistory({ ...request, reason: 'Different request' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(search().total).toBe(0);
  });

  it('returns bounded empty results and five predictable header-only exports', () => {
    expect(search()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 });
    const exported = value(history.prepareExport({ filters, sort }));
    expect(exported.saleCount).toBe(0); expect(exported.files).toHaveLength(5);
    expect(exported.files.every((file) => csvRows(file.content).length === 0)).toBe(true);
    expect(exported.totals).toEqual({ paidRappen: '0', refundedRappen: '0', netRappen: '0' });
  });
  it('merges historical cash and expanded payment sales without duplication', () => {
    const old = legacy(); const modern = sale();
    const found = search(); expect(found.total).toBe(2);
    expect(new Set(found.items.map((entry) => entry.id))).toEqual(new Set([old.id, modern.id]));
    expect(found.items.find((entry) => entry.id === old.id)?.source).toBe('legacy');
    expect(found.items.every((entry) => entry.actualPaidRappen === 245 && entry.subtotalRappen === 247 && entry.roundingAdjustmentRappen === -2)).toBe(true);
  });
  it('uses Swiss inclusive days with exact exclusive UTC boundaries on the spring DST change', () => {
    sale('cash', 100, 1, '2026-03-28T22:59:59.999Z');
    const first = sale('card', 101, 1, '2026-03-28T23:00:00.000Z');
    const last = sale('twint', 102, 1, '2026-03-29T21:59:59.999Z');
    sale('cash', 103, 1, '2026-03-29T22:00:00.000Z');
    expect(search({ dateFrom: '2026-03-29', dateTo: '2026-03-29' }).items.map((entry) => entry.id)).toEqual([last.id, first.id]);
    expect(search({ dateTo: '2026-03-28' }).total).toBe(1);
    expect(search({ dateFrom: '2026-03-30' }).total).toBe(1);
  });
  it('covers the repeated hour on the autumn DST day', () => {
    const one = sale('card', 100, 1, '2026-10-25T00:30:00.000Z');
    const two = sale('twint', 100, 1, '2026-10-25T01:30:00.000Z');
    sale('cash', 100, 1, '2026-10-25T23:00:00.000Z');
    expect(search({ dateFrom: '2026-10-25', dateTo: '2026-10-25' }).items.map((entry) => entry.id)).toEqual([two.id, one.id]);
  });
  it('distinguishes cash, Card, TWINT and Mixed while same-method multiple allocations stay Card', () => {
    const cash = sale(); const card = sale('card'); const twint = sale('twint'); const mixed = sale('mixed', 842, 2);
    const saved = cart(842); let checkout = value(payments.startCheckout({ cartId: saved.id, expectedRevision: saved.revision }));
    for (const amount of [400, 442]) { const attempt = value(payments.preparePayment({ sessionId: checkout.session.id, idempotencyKey: runtime.newId(), method: 'card', intendedRappen: amount })); checkout = value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })); }
    const twiceCard = value(payments.completeCheckout({ sessionId: checkout.session.id }));
    expect(search({ paymentMethod: 'cash' }).items.map((entry) => entry.id)).toEqual([cash.id]);
    expect(new Set(search({ paymentMethod: 'card' }).items.map((entry) => entry.id))).toEqual(new Set([card.id, twiceCard.id]));
    expect(search({ paymentMethod: 'twint' }).items.map((entry) => entry.id)).toEqual([twint.id]);
    expect(search({ paymentMethod: 'mixed' }).items.map((entry) => entry.id)).toEqual([mixed.id]);
  });
  it('filters inclusive actual-paid ranges rather than cash tender or original subtotal', () => {
    const rounded = sale('cash', 247); const exact = sale('card', 247); sale('card', 899);
    expect(search({ minTotalRappen: 245, maxTotalRappen: 245 }).items.map((entry) => entry.id)).toEqual([rounded.id]);
    expect(search({ minTotalRappen: 247, maxTotalRappen: 247 }).items.map((entry) => entry.id)).toEqual([exact.id]);
  });
  it('filters none, partial and full refunds by original units without multiplying sales', () => {
    const none = sale(); const partial = sale('card', 347, 2); const full = sale('mixed', 842, 2);
    refund(partial, 1); refund(full, 1); refund(full, 1, 'twint');
    expect(search({ refundStatus: 'none' }).items.map((entry) => entry.id)).toEqual([none.id]);
    expect(search({ refundStatus: 'partial' }).items.map((entry) => entry.id)).toEqual([partial.id]);
    const complete = search({ refundStatus: 'full' });
    expect(complete.total).toBe(1); expect(complete.items[0]).toMatchObject({ id: full.id, refundedRappen: 1685, refundableRappen: 0 });
    expect(search().total).toBe(3);
  });
  it('distinguishes partial and full refunds for zero-priced original units', () => {
    const free = sale('cash', 0, 2); refund(free, 1);
    expect(search({ refundStatus: 'partial' }).items[0]).toMatchObject({ id: free.id, actualPaidRappen: 0, refundedRappen: 0, refundableRappen: 0 });
    refund(free, 1);
    expect(search({ refundStatus: 'full' }).items.map((entry) => entry.id)).toEqual([free.id]);
  });
  it('searches original names, variants and identifiers with accent folding after catalog edits', () => {
    connection.sqlite.prepare("UPDATE products SET name = 'Chöcolâte Alpine' WHERE id = 'product-chocolate'").run();
    const original = sale();
    connection.sqlite.prepare("UPDATE products SET name = 'Renamed live product' WHERE id = 'product-chocolate'").run();
    expect(search({ productQuery: 'CHOCOLATE' }).items[0]?.id).toBe(original.id);
    expect(search({ productQuery: 'variant-chocolate-default' }).total).toBe(1);
    expect(search({ productQuery: 'Default' }).total).toBe(1);
    expect(search({ productQuery: 'Renamed live product' }).total).toBe(0);
    expect(search({ saleId: original.id.slice(-5) }).total).toBe(1);
    expect(search({ productQuery: "' OR 1=1 --" }).total).toBe(0);
    expect(search({ productQuery: '%' }).total).toBe(0);
  });
  it('sorts dates/totals in both directions with deterministic identity ties', () => {
    const low = sale('card', 100, 1, '2026-11-17T10:00:00.000Z');
    const high = sale('card', 900, 1, '2026-11-18T10:00:00.000Z');
    const middle = sale('card', 500, 1, '2026-11-18T10:00:00.000Z');
    expect(search({}, { field: 'total', direction: 'asc' }).items.map((entry) => entry.id)).toEqual([low.id, middle.id, high.id]);
    expect(search({}, { field: 'total', direction: 'desc' }).items.map((entry) => entry.id)).toEqual([high.id, middle.id, low.id]);
    const ascending = [high.id, middle.id].sort();
    expect(search({}, { field: 'date', direction: 'asc' }).items.map((entry) => entry.id)).toEqual([low.id, ...ascending]);
    expect(search({}, { field: 'date', direction: 'desc' }).items.map((entry) => entry.id)).toEqual([...ascending].reverse().concat(low.id));
  });
  it('loads bounded pages beyond the original last-20 limitation', () => {
    buildSalesFixture(128);
    const allIds = new Set<string>();
    for (let page = 1; page <= 6; page++) {
      const result = search({}, sort, page, 25); expect(result.total).toBe(128); expect(result.items.length).toBe(page === 6 ? 3 : 25);
      for (const item of result.items) { expect(allIds.has(item.id)).toBe(false); allIds.add(item.id); }
    }
    expect(allIds.size).toBe(128); expect(search({}, sort, 7, 25).items).toEqual([]);
  });
  it('filters and exports a 1000-sale fixture without transferring unbounded history to the caller', () => {
    buildSalesFixture(1000);
    const page = search({ minTotalRappen: 900, maxTotalRappen: 999 }, { field: 'total', direction: 'asc' }, 3, 25);
    expect(page.total).toBe(100); expect(page.items).toHaveLength(25);
    expect(page.items.map((item) => item.actualPaidRappen)).toEqual(Array.from({ length: 25 }, (_, index) => 950 + index));
    expect(search({}, sort, 1, 100)).toMatchObject({ total: 1000 });
    const exported = value(history.prepareExport({ filters: { ...filters, minTotalRappen: 900, maxTotalRappen: 999 }, sort }));
    expect(exported.saleCount).toBe(100);
    expect(csvRows(exported.files[0]?.content ?? '')).toHaveLength(100);
    expect(exported.totals).toEqual({ paidRappen: '94950', refundedRappen: '0', netRappen: '94950' });
  }, 60_000);
  it('returns field-specific context counts without audit reasons or unrelated records', () => {
    const original = sale('card', 500);
    const attempt = value(payments.prepareRefund({ saleId: original.id, idempotencyKey: runtime.newId(), method: 'twint', items: [{ saleItemId: original.items[0]?.id ?? '', quantity: 1 }] }));
    value(payments.reportRefundOutcome({ attemptId: attempt.id, outcome: 'uncertain', reason: 'Provider payout outcome unknown', operatorConfirmed: true }));
    expect(value(history.getSaleContext({ saleId: original.id }))).toMatchObject({ unresolvedRefundCount: 1, reconciliationCount: 0 });
    value(payments.reconcile({ kind: 'refund', referenceId: attempt.id, idempotencyKey: runtime.newId(), resolution: 'confirm-recorded', reason: 'Original payout receipt was checked locally.', deliberateConfirmation: true }));
    expect(value(history.getSaleContext({ saleId: original.id }))).toEqual({ unresolvedRefundCount: 0, reconciliationCount: 1, lastReconciliationAt: now });
    expect(search().items[0]).toMatchObject({ reconciliationCount: 1, refundStatus: 'full' });
    expect(JSON.stringify(search())).not.toContain('Original payout receipt');
    expect(history.getSaleContext({ saleId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('exports the current filters across every matching page with exact persisted financial linkage', () => {
    const original = sale('mixed', 842, 2); const first = refund(original, 1); const second = refund(original, 1, 'twint'); sale('cash', 247);
    const result = value(history.prepareExport({ filters: { ...filters, paymentMethod: 'mixed', refundStatus: 'full' }, sort }));
    const tables = Object.fromEntries(result.files.map((file) => [file.name, csvRows(file.content)]));
    expect(result.saleCount).toBe(1); expect(tables['sales.csv']).toHaveLength(1); expect(tables['payments.csv']).toHaveLength(3); expect(tables['refunds.csv']).toHaveLength(2);
    expect(tables['sales.csv']?.[0]).toMatchObject({ sale_id: original.id, paid_rappen: '1685', refunded_rappen: '1685', remaining_refundable_rappen: '0' });
    expect(tables['payments.csv']?.reduce((sum, row) => sum + BigInt(row.applied_rappen ?? ''), 0n)).toBe(1685n);
    expect(tables['refunds.csv']?.reduce((sum, row) => sum + BigInt(row.amount_rappen ?? ''), 0n)).toBe(1685n);
    expect(new Set(tables['refund_items.csv']?.map((row) => row.refund_id))).toEqual(new Set([first.id, second.id]));
    for (const rows of Object.values(tables)) expect(rows.every((row) => row.sale_id === original.id)).toBe(true);
    expect(result.totals).toEqual({ paidRappen: '1685', refundedRappen: '1685', netRappen: '0' });
  });
  it('exports untrusted text safely and round-trips quoted delimiters and newlines', () => {
    connection.sqlite.prepare("UPDATE products SET name = ? WHERE id = 'product-chocolate'").run('  =HYPERLINK("bad"), Swiss\r\nTea');
    const original = sale(); const result = value(history.prepareExport({ filters, sort }));
    const rows = csvRows(result.files.find((file) => file.name === 'sale_items.csv')?.content ?? '');
    expect(rows[0]?.sale_id).toBe(original.id);
    // The shared importer normalizes embedded CRLF to LF; the export itself
    // preserves the original quoted historical field exactly.
    expect(rows[0]?.product_name).toBe('\'  =HYPERLINK("bad"), Swiss\nTea');
    expect(result.files.find((file) => file.name === 'sale_items.csv')?.content).toContain('Swiss\r\nTea');
    expect(result.files.every((file) => file.content.endsWith('\r\n'))).toBe(true);
  });
  it('rejects export limits before loading oversized aggregates and never truncates results', () => {
    sale('mixed', 842, 2); sale();
    const store = createHistoryStore(connection); const normalized = { ...filters, ...swissHistoryRange(null, null) };
    expect(() => store.exportRecords(normalized, sort, 1, 100)).toThrow('1 sales');
    expect(() => store.exportRecords(normalized, sort, 5000, 1)).toThrow('1 records');
  });
  it('keeps a repeat export byte-identical and history accurate after restart', () => {
    const original = sale('mixed', 842, 2); refund(original, 1);
    const before = value(history.prepareExport({ filters, sort }));
    connection.close(); connection = openDatabase(databaseFile); runMigrations(connection); bind();
    const after = value(history.prepareExport({ filters, sort }));
    expect(after).toEqual(before); expect(search().items[0]).toMatchObject({ id: original.id, refundedRappen: 842, refundableRappen: 843 });
    expect(value(payments.getSaleDetails({ saleId: original.id })).sale).toEqual(original);
  });
  it('fails closed on invalid request values instead of sending SQL or unsafe ranges to the adapter', () => {
    expect(history.search({ filters: { ...filters, minTotalRappen: -1 }, sort, page: 1, pageSize: 25 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(history.search({ filters, sort, page: 0, pageSize: 25 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(history.prepareExport({ filters: { ...filters, dateFrom: '2026-11-19', dateTo: '2026-11-18' }, sort })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(search().total).toBe(0);
  });
  it('adds query indexes to a populated version-three database without rewriting financial records', () => {
    connection.close(); rmSync(databaseFile, { force: true }); connection = openDatabase(databaseFile);
    connection.sqlite.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
    for (const migration of [firstSaleMigration, catalogManagementMigration, paymentsRefundsMigration]) {
      connection.sqlite.exec(migration.sql);
      connection.sqlite.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'), now);
    }
    seedDevelopmentCatalog(connection, 'development'); bind(); const original = sale('mixed', 842, 2); refund(original, 1);
    const before = connection.sqlite.prepare('SELECT * FROM financial_sales').all(); const oldLedger = connection.sqlite.prepare('SELECT * FROM schema_migrations').all();
    runMigrations(connection);
    expect(connection.sqlite.prepare('SELECT * FROM financial_sales').all()).toEqual(before);
    expect(connection.sqlite.prepare('SELECT * FROM schema_migrations WHERE version <= 3').all()).toEqual(oldLedger);
    expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('sales_history_total','financial_sales_history_total')").all()).toHaveLength(2);
    expect(search().items[0]).toMatchObject({ id: original.id, refundedRappen: 842 });
  });
  it('uses covering history indexes for amount constraints in the two source tables', () => {
    const oldPlan = connection.sqlite.prepare('EXPLAIN QUERY PLAN SELECT id FROM sales WHERE sealed=1 AND amount_due_rappen >= ? ORDER BY amount_due_rappen,completed_at,id').all(100);
    const modernPlan = connection.sqlite.prepare('EXPLAIN QUERY PLAN SELECT id FROM financial_sales WHERE actual_paid_rappen >= ? ORDER BY actual_paid_rappen,completed_at,id').all(100);
    expect(JSON.stringify(oldPlan)).toContain('sales_history_total');
    expect(JSON.stringify(modernPlan)).toContain('financial_sales_history_total');
  });
  it('finds immutable receipts by their stable barcode after restart and removes codes with a purged sale',()=>{
    const original=sale('card',500),other=legacy(400);const code=value(history.getReceiptCode({saleId:original.id})),legacyCode=value(history.getReceiptCode({saleId:other.id}));expect(code).toMatch(/^CC[0-9A-F]{14}$/u);expect(legacyCode).not.toBe(code);
    expect(search({receiptCode:code}).items.map(s=>s.id)).toEqual([original.id]);expect(search({receiptCode:legacyCode}).items.map(s=>s.id)).toEqual([other.id]);
    connection.close();connection=openDatabase(databaseFile);runMigrations(connection);bind();expect(value(history.getReceiptCode({saleId:original.id}))).toBe(code);value(history.removeSale({saleId:original.id,reason:'Incorrect sale'}));expect(search({receiptCode:code}).items).toHaveLength(0);expect(connection.sqlite.prepare('SELECT code FROM receipt_codes WHERE sale_id=?').get(original.id)).toBeUndefined();
  });
  it('filters by exact order number and folded table/name with matching count and export selection',()=>{
    const register=sale('card',500);const c=cart(900);const orders=createOrderService(createOrderStore(connection),runtime);const booking=value(orders.book({cartId:c.id,expectedRevision:c.revision,operationId:runtime.newId(),serviceLabel:'Tisch Müller 12'}));expect(booking.number).toBeNull();const chosen=value(orders.accept({orderId:booking.id,operationId:runtime.newId()}));const checkout=value(payments.startCheckout({cartId:chosen.id,expectedRevision:chosen.revision}));const a=value(payments.preparePayment({sessionId:checkout.session.id,idempotencyKey:runtime.newId(),method:'card',intendedRappen:900}));value(payments.confirmPayment({attemptId:a.id,operatorConfirmed:true}));const table=value(payments.completeCheckout({sessionId:checkout.session.id}));
    expect(search({orderNumber:register.order!.number}).items.map(s=>s.id)).toEqual([register.id]);expect(search({serviceLabel:'muller'}).items.map(s=>s.id)).toEqual([table.id]);expect(search({serviceLabel:"' OR 1=1--"}).items).toHaveLength(0);expect(search({orderNumber:99}).total).toBe(0);
    const exported=value(history.prepareExport({filters:{...filters,serviceLabel:'MÜLLER'},sort}));expect(exported.saleCount).toBe(1);expect(exported.files[0]!.content).toContain(table.id);expect(exported.files[0]!.content).not.toContain(register.id);
  });

});
