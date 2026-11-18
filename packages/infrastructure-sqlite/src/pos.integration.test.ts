import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPosService, type PosService } from '@cash-sloth/application';
import type { Cart, CheckoutAttempt, Sale, Result } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { migrations, runMigrations } from './migrations.js';
import { createPosStore } from './pos-store.js';
import { seedDevelopmentCatalog } from './seed.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('persistent First Sale workflow', () => {
  let directory: string;
  let databaseFile: string;
  let connection: DatabaseConnection;
  let service: PosService;
  let sequence: number;
  const runtime = { newId: () => `test-id-${++sequence}`, now: () => '2026-11-11T12:00:00.000Z' };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cash-sloth-pos-'));
    databaseFile = join(directory, 'pos.sqlite');
    sequence = 0;
    connection = openDatabase(databaseFile);
    runMigrations(connection);
    seedDevelopmentCatalog(connection, 'development');
    service = createPosService(createPosStore(connection), runtime);
  });
  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  function reopen(): void {
    connection.close();
    connection = openDatabase(databaseFile);
    runMigrations(connection);
    service = createPosService(createPosStore(connection), runtime);
  }
  function chocolateCart(): Cart {
    const cart = value(service.getCart({})).cart;
    return value(service.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
  }
  function prepare(): CheckoutAttempt {
    const cart = chocolateCart();
    return value(service.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
  }
  function finish(attempt: CheckoutAttempt): Sale {
    return value(service.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
  }

  it('replays versioned migrations without dropping unrelated data and rejects altered or newer history', () => {
    connection.sqlite.exec("CREATE TABLE unrelated_notes (note TEXT); INSERT INTO unrelated_notes VALUES ('keep me')");
    runMigrations(connection);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM schema_migrations').get()?.['n']).toBe(migrations.length);
    expect(connection.sqlite.prepare('SELECT note FROM unrelated_notes').get()?.['note']).toBe('keep me');
    connection.sqlite.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run();
    expect(() => runMigrations(connection)).toThrow('migration history');
    expect(connection.sqlite.prepare('SELECT note FROM unrelated_notes').get()?.['note']).toBe('keep me');
  });

  it('fails closed on unknown future migrations without recreating the database', () => {
    connection.sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(99, 'future', 'unrecognized', runtime.now());
    expect(() => runMigrations(connection)).toThrow('migration history');
    expect(connection.sqlite.prepare('SELECT count(*) n FROM products').get()?.['n']).toBe(3);
  });

  it('seeds idempotently without overwriting catalog edits and never seeds Beta or Stable', () => {
    connection.sqlite.prepare("UPDATE product_variants SET unit_price_rappen = 299 WHERE id = 'variant-chocolate-default'").run();
    seedDevelopmentCatalog(connection, 'development');
    expect(value(service.listCatalog({}))).toHaveLength(3);
    expect(connection.sqlite.prepare("SELECT unit_price_rappen p FROM product_variants WHERE id = 'variant-chocolate-default'").get()?.['p']).toBe(299);
    for (const channel of ['beta', 'stable']) {
      const isolated = openDatabase(join(directory, `${channel}.sqlite`));
      try {
        runMigrations(isolated);
        seedDevelopmentCatalog(isolated, channel);
        expect(isolated.sqlite.prepare('SELECT count(*) n FROM products').get()?.['n']).toBe(0);
      } finally { isolated.close(); }
    }
  });

  it('restores a draft and its revision after reopening and refuses stale or invalid quantity edits', () => {
    const added = chocolateCart();
    const line = added.items[0];
    if (!line) throw new Error('Missing fixture line');
    const edited = value(service.setQuantity({ cartId: added.id, expectedRevision: added.revision, lineId: line.id, quantity: 3 }));
    reopen();
    expect(value(service.getCart({})).cart).toEqual(edited);
    expect(service.setQuantity({ cartId: added.id, expectedRevision: added.revision, lineId: line.id, quantity: 2 }).ok).toBe(false);
    expect(service.setQuantity({ cartId: edited.id, expectedRevision: edited.revision, lineId: line.id, quantity: 0 }).ok).toBe(false);
    expect(() => connection.sqlite.prepare('UPDATE cart_items SET quantity = 0 WHERE id = ?').run(line.id)).toThrow();
    expect(value(service.getCart({})).cart).toEqual(edited);
    const removed = value(service.removeItem({ cartId: edited.id, expectedRevision: edited.revision, lineId: line.id }));
    expect(removed.items).toHaveLength(0);
    const readded = value(service.addItem({ cartId: removed.id, expectedRevision: removed.revision, variantId: 'variant-water-default' }));
    expect(value(service.clearCart({ cartId: readded.id, expectedRevision: readded.revision })).items).toHaveLength(0);
  });

  it('preserves names and unit-price snapshots, keeps changed-price additions separate and snapshots both in a sale', () => {
    const added = chocolateCart();
    const original = added.items[0];
    if (!original) throw new Error('Missing fixture line');
    connection.sqlite.prepare("UPDATE product_variants SET unit_price_rappen = 299, name = 'Large' WHERE id = 'variant-chocolate-default'").run();
    connection.sqlite.prepare("UPDATE products SET name = 'New chocolate' WHERE id = 'product-chocolate'").run();
    const increased = value(service.setQuantity({ cartId: added.id, expectedRevision: added.revision, lineId: original.id, quantity: 2 }));
    expect(increased.items[0]).toMatchObject({ unitPriceRappen: 247, productName: 'Chocolate', variantName: 'Default', lineTotalRappen: 494 });
    const separate = value(service.addItem({ cartId: increased.id, expectedRevision: increased.revision, variantId: 'variant-chocolate-default' }));
    expect(separate.items).toHaveLength(2);
    expect(separate.items[1]).toMatchObject({ unitPriceRappen: 299, productName: 'New chocolate', variantName: 'Large' });
    const attempt = value(service.prepareCheckout({ cartId: separate.id, expectedRevision: separate.revision }));
    const sale = value(service.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true }));
    expect(sale.subtotalRappen).toBe(793);
    expect(sale.items).toEqual(separate.items);
    connection.sqlite.prepare("UPDATE products SET name = 'Later name', active = 0 WHERE id = 'product-chocolate'").run();
    expect(value(service.getSale({ saleId: sale.id })).items).toEqual(separate.items);
    expect(value(service.listCatalog({})).some((item) => item.productId === 'product-chocolate')).toBe(false);
  });

  it('does not allow an inactive product or variant to be added', () => {
    const cart = value(service.getCart({})).cart;
    connection.sqlite.prepare("UPDATE products SET active = 0 WHERE id = 'product-chocolate'").run();
    connection.sqlite.prepare("UPDATE product_variants SET active = 0 WHERE id = 'variant-water-default'").run();
    for (const variantId of ['variant-chocolate-default', 'variant-water-default']) {
      const response = service.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId });
      expect(response.ok).toBe(false);
    }
    expect(value(service.getCart({})).cart.items).toHaveLength(0);
  });

  it('commits the rounded sale, item snapshots, explicit cash confirmation and consumed cart durably', () => {
    const attempt = prepare();
    expect(attempt).toMatchObject({ subtotalRappen: 247, amountDueRappen: 245, roundingAdjustmentRappen: -2 });
    const insufficient = service.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 244, operatorConfirmed: true });
    expect(insufficient.ok).toBe(false);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(0);
    const sale = finish(attempt);
    expect(sale.payment).toEqual({ method: 'cash', cashReceivedRappen: 500, cashAppliedRappen: 245, changeRappen: 255, operatorConfirmed: true, confirmedAt: runtime.now() });
    expect(connection.sqlite.prepare('SELECT status FROM carts WHERE id = ?').get(attempt.cartId)?.['status']).toBe('consumed');
    reopen();
    expect(value(service.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(value(service.listRecentSales({}))).toEqual([sale]);
    expect(value(service.getCart({})).cart.items).toHaveLength(0);
  });

  it('never duplicates a checkout before or after reopen and rejects a changed cash payload', () => {
    const attempt = prepare();
    const sale = finish(attempt);
    expect(finish(attempt)).toEqual(sale);
    reopen();
    expect(finish(attempt)).toEqual(sale);
    expect(service.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true }).ok).toBe(false);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(1);
  });

  it('rolls back every sale write while retaining durable cash confirmation and supports an explicit same-key retry', () => {
    const attempt = prepare();
    let commits = 0;
    const failing = createPosService(createPosStore(connection, { beforeCommit: () => { if (++commits === 2) throw new Error('injected pre-commit fault'); } }), runtime);
    const response = failing.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true });
    expect(response.ok).toBe(false);
    for (const table of ['sales', 'sale_items', 'sale_payments']) {
      expect(connection.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()?.['n']).toBe(0);
    }
    expect(connection.sqlite.prepare('SELECT state FROM checkout_attempts WHERE idempotency_key = ?').get(attempt.idempotencyKey)?.['state']).toBe('confirmed');
    expect(service.clearCart({ cartId: attempt.cartId, expectedRevision: attempt.cartRevision }).ok).toBe(false);
    reopen();
    expect(value(service.getCart({})).pendingCheckout?.status).toBe('confirmed');
    expect(value(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey })).sale).toBeNull();
    expect(finish(attempt).payment.cashReceivedRappen).toBe(500);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(1);
  });

  it('reconciles a lost commit acknowledgement after reopening without reporting premature success or duplicating cash', () => {
    const attempt = prepare();
    let commits = 0;
    const failing = createPosService(createPosStore(connection, { afterCommit: () => { if (++commits === 2) throw new Error('injected lost acknowledgement'); } }), runtime);
    const response = failing.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true });
    expect(response).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(1);
    reopen();
    const reconciliation = value(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }));
    expect(reconciliation.attempt.status).toBe('completed');
    expect(reconciliation.sale).not.toBeNull();
    expect(finish(attempt)).toEqual(reconciliation.sale);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(1);
  });

  it('recovers a lost cash-confirmation acknowledgement with no sale yet', () => {
    const attempt = prepare();
    let commits = 0;
    const failing = createPosService(createPosStore(connection, { afterCommit: () => { if (++commits === 1) throw new Error('injected confirmation acknowledgement loss'); } }), runtime);
    const response = failing.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true });
    expect(response).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    reopen();
    expect(value(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }))).toMatchObject({ attempt: { status: 'confirmed', cashReceivedRappen: 500 }, sale: null });
    expect(finish(attempt).amountDueRappen).toBe(245);
  });

  it('preserves evidence and locks edits if another connection changed an already prepared checkout cart', () => {
    const attempt = prepare();
    const secondConnection = openDatabase(databaseFile);
    try {
      const second = createPosService(createPosStore(secondConnection), runtime);
      const changed = value(second.addItem({ cartId: attempt.cartId, expectedRevision: attempt.cartRevision, variantId: 'variant-water-default' }));
      const result = service.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true });
      expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(value(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }))).toMatchObject({ attempt: { status: 'confirmed', cashReceivedRappen: 500 }, sale: null });
      expect(value(second.getCart({})).pendingCheckout?.idempotencyKey).toBe(attempt.idempotencyKey);
      expect(second.clearCart({ cartId: changed.id, expectedRevision: changed.revision })).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
      expect(second.prepareCheckout({ cartId: changed.id, expectedRevision: changed.revision })).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    } finally { secondConnection.close(); }
  });

  it('retains both explicit cash confirmations from stale quotes while preventing duplicate financial sales', () => {
    const firstAttempt = prepare();
    const updatedCart = value(service.addItem({
      cartId: firstAttempt.cartId, expectedRevision: firstAttempt.cartRevision, variantId: 'variant-water-default',
    }));
    const secondAttempt = value(service.prepareCheckout({ cartId: updatedCart.id, expectedRevision: updatedCart.revision }));
    expect(secondAttempt.idempotencyKey).not.toBe(firstAttempt.idempotencyKey);

    const firstResult = service.completeSale({ idempotencyKey: firstAttempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true });
    expect(firstResult).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const secondResult = service.completeSale({ idempotencyKey: secondAttempt.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true });
    expect(secondResult).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });

    expect(connection.sqlite.prepare("SELECT count(*) n FROM checkout_attempts WHERE state = 'confirmed'").get()?.['n']).toBe(2);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM sales').get()?.['n']).toBe(0);
    expect(value(service.reconcileCheckout({ idempotencyKey: firstAttempt.idempotencyKey })))
      .toMatchObject({ attempt: { status: 'confirmed', cashReceivedRappen: 500 }, sale: null });
    expect(value(service.reconcileCheckout({ idempotencyKey: secondAttempt.idempotencyKey })))
      .toMatchObject({ attempt: { status: 'confirmed', cashReceivedRappen: 1000 }, sale: null });
    reopen();
    expect(value(service.getCart({})).pendingCheckout?.idempotencyKey).toBe(firstAttempt.idempotencyKey);
    expect(service.clearCart({ cartId: updatedCart.id, expectedRevision: updatedCart.revision }))
      .toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
  });

  it('rejects inserts, updates and deletes against sealed financial records and confirmed cash evidence', () => {
    const sale = finish(prepare());
    const queries = [
      ['UPDATE sales SET amount_due_rappen = 0 WHERE id = ?', sale.id],
      ['DELETE FROM sales WHERE id = ?', sale.id],
      ['UPDATE sale_items SET quantity = 2 WHERE sale_id = ?', sale.id],
      ['DELETE FROM sale_items WHERE sale_id = ?', sale.id],
      ["INSERT INTO sale_items SELECT 'extra-id', sale_id, 100, product_id, variant_id, product_name, variant_name, unit_price_rappen, quantity, line_total_rappen FROM sale_items WHERE sale_id = ?", sale.id],
      ['UPDATE sale_payments SET cash_received_rappen = 1000 WHERE sale_id = ?', sale.id],
      ['DELETE FROM sale_payments WHERE sale_id = ?', sale.id],
      ['INSERT INTO sale_payments SELECT * FROM sale_payments WHERE sale_id = ?', sale.id],
      ['UPDATE checkout_attempts SET cash_received_rappen = 1000 WHERE idempotency_key = ?', sale.idempotencyKey],
      ['DELETE FROM checkout_attempts WHERE idempotency_key = ?', sale.idempotencyKey],
    ] as const;
    for (const [sql, identifier] of queries) expect(() => connection.sqlite.prepare(sql).run(identifier)).toThrow(/immutable/u);
    expect(value(service.getSale({ saleId: sale.id }))).toEqual(sale);
  });
});
