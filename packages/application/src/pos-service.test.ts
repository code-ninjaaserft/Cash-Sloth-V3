import { describe, expect, it } from 'vitest';
import type { Result } from '@cash-sloth/contracts';
import type { Cart, CatalogItem, CheckoutAttempt, Sale } from '@cash-sloth/domain';
import { PersistenceError, type PosStore } from './ports.js';
import { createPosService, type PosService } from './pos-service.js';

const variant: CatalogItem = { productId: 'product', variantId: 'variant', productName: 'Test product', variantName: 'Default', unitPriceRappen: 247, productActive: true, active: true };
class MemoryStore implements PosStore {
  state: { carts: Cart[]; attempts: CheckoutAttempt[]; sales: Sale[] } = { carts: [], attempts: [], sales: [] };
  transactions = 0;
  failAt = -1;
  failOutcome: 'rolled-back' | 'unknown' = 'rolled-back';
  transaction<T>(operation: () => T): T {
    const before = structuredClone(this.state);
    const number = ++this.transactions;
    try {
      const value = operation();
      if (number === this.failAt) throw new PersistenceError(this.failOutcome);
      return value;
    } catch (error) {
      if (!(error instanceof PersistenceError && error.outcome === 'unknown')) this.state = before;
      throw error;
    }
  }
  listCatalog() { return [variant]; }
  getVariant(id: string) { return id === variant.variantId ? variant : null; }
  getDraftCart() { return this.state.carts[0] ?? null; }
  getCart(id: string) { return this.state.carts.find((cart) => cart.id === id) ?? null; }
  createCart(cart: Cart) { this.state.carts.push(cart); }
  updateCart(cart: Cart, _expectedRevision: number) { this.state.carts = this.state.carts.map((old) => old.id === cart.id ? cart : old); }
  getPendingCheckout(id: string) { return this.state.attempts.findLast((attempt) => attempt.cartId === id && attempt.status !== 'completed') ?? null; }
  getUnresolvedCheckout() { return this.state.attempts.find((attempt) => attempt.status === 'confirmed') ?? null; }
  getCheckout(key: string) { return this.state.attempts.find((attempt) => attempt.idempotencyKey === key) ?? null; }
  putCheckout(attempt: CheckoutAttempt) {
    this.state.attempts = [...this.state.attempts.filter((old) => old.idempotencyKey !== attempt.idempotencyKey), attempt];
  }
  getSale(id: string) { return this.state.sales.find((sale) => sale.id === id) ?? null; }
  getSaleByCheckoutKey(key: string) { return this.state.sales.find((sale) => sale.idempotencyKey === key) ?? null; }
  listRecentSales(limit: number) { return this.state.sales.slice(-limit).reverse(); }
  insertSale(sale: Sale) { this.state.sales.push(sale); }
  consumeCart(id: string, _expectedRevision: number) { this.state.carts = this.state.carts.filter((cart) => cart.id !== id); }
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
function fixture(): { store: MemoryStore; service: PosService; cart: Cart; attempt: CheckoutAttempt } {
  const store = new MemoryStore();
  let sequence = 0;
  const service = createPosService(store, { newId: () => `id-${++sequence}`, now: () => '2026-11-11T12:00:00.000Z' });
  const original = unwrap(service.getCart({})).cart;
  const cart = unwrap(service.addItem({ cartId: original.id, expectedRevision: original.revision, variantId: variant.variantId }));
  const attempt = unwrap(service.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
  return { store, service, cart, attempt };
}
const completeRequest = (attempt: CheckoutAttempt) => ({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true as const });

describe('sale completion application boundary', () => {
  it('returns a sale only after both commits and consumes its cart once', () => {
    const { store, service, attempt } = fixture();
    const sale = unwrap(service.completeSale(completeRequest(attempt)));
    expect(sale).toMatchObject({ subtotalRappen: 247, amountDueRappen: 245, roundingAdjustmentRappen: -2, payment: { cashReceivedRappen: 500, cashAppliedRappen: 245, changeRappen: 255, operatorConfirmed: true } });
    expect(store.state.carts).toHaveLength(0);
    expect(store.state.sales).toHaveLength(1);
    expect(store.getCheckout(attempt.idempotencyKey)?.status).toBe('completed');
  });
  it('reuses the prepared key for the same revision and returns the same sale on retry', () => {
    const { store, service, cart, attempt } = fixture();
    expect(unwrap(service.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }))).toEqual(attempt);
    const first = unwrap(service.completeSale(completeRequest(attempt)));
    expect(unwrap(service.completeSale(completeRequest(attempt)))).toEqual(first);
    expect(store.state.sales).toHaveLength(1);
    expect(service.completeSale({ ...completeRequest(attempt), cashReceivedRappen: 1000 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('keeps durable cash confirmation but no sale after a known final-transaction rollback', () => {
    const { store, service, cart, attempt } = fixture();
    store.failAt = store.transactions + 2;
    expect(service.completeSale(completeRequest(attempt))).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    expect(store.state.sales).toHaveLength(0);
    expect(unwrap(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }))).toMatchObject({ attempt: { status: 'confirmed', cashReceivedRappen: 500 }, sale: null });
    expect(service.clearCart({ cartId: cart.id, expectedRevision: cart.revision })).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    expect(unwrap(service.getCart({})).pendingCheckout?.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(unwrap(service.completeSale(completeRequest(attempt))).idempotencyKey).toBe(attempt.idempotencyKey);
  });
  it('never reports an uncertain COMMIT as successful and reconciles the committed sale', () => {
    const { store, service, attempt } = fixture();
    store.failAt = store.transactions + 2;
    store.failOutcome = 'unknown';
    expect(service.completeSale(completeRequest(attempt))).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    expect(store.state.sales).toHaveLength(1);
    const reconciliation = unwrap(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }));
    expect(reconciliation.attempt.status).toBe('completed');
    expect(reconciliation.sale?.id).toBe(store.state.sales[0]?.id);
    expect(unwrap(service.completeSale(completeRequest(attempt))).id).toBe(reconciliation.sale?.id);
    expect(store.state.sales).toHaveLength(1);
  });
  it('preserves an uncertain confirmation commit without falsely completing the sale', () => {
    const { store, service, attempt } = fixture();
    store.failAt = store.transactions + 1;
    store.failOutcome = 'unknown';
    expect(service.completeSale(completeRequest(attempt))).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    expect(store.state.sales).toHaveLength(0);
    expect(unwrap(service.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }))).toMatchObject({ attempt: { status: 'confirmed' }, sale: null });
  });
  it('keeps explicit cash evidence when another instance made the original quote stale', () => {
    const { store, service, cart, attempt } = fixture();
    unwrap(service.setQuantity({ cartId: cart.id, expectedRevision: cart.revision, lineId: cart.items[0]!.id, quantity: 2 }));
    const newer = unwrap(service.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision + 1 }));
    expect(service.completeSale(completeRequest(attempt))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(service.completeSale(completeRequest(newer))).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    expect(store.state.sales).toHaveLength(0);
    expect(store.getCheckout(attempt.idempotencyKey)).toMatchObject({ status: 'confirmed', cashReceivedRappen: 500, confirmedAt: '2026-11-11T12:00:00.000Z' });
    expect(store.getCheckout(newer.idempotencyKey)).toMatchObject({ status: 'confirmed', cashReceivedRappen: 500 });
    expect(service.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision + 1 })).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
  });
  it('rejects insufficient cash without recording a confirmation', () => {
    const { store, service, attempt } = fixture();
    expect(service.completeSale({ ...completeRequest(attempt), cashReceivedRappen: 200 })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CASH' } });
    expect(store.getCheckout(attempt.idempotencyKey)?.status).toBe('prepared');
    expect(store.state.sales).toHaveLength(0);
  });
  it('records a stale second confirmation but blocks completion behind an unresolved checkout', () => {
    const { store, service, attempt } = fixture();
    store.state.attempts.push({ ...attempt, idempotencyKey: 'older-checkout', cartId: 'old-cart', createdAt: '2026-11-11T11:00:00.000Z', status: 'confirmed', cashReceivedRappen: 500, confirmedAt: '2026-11-11T11:01:00.000Z' });
    expect(service.completeSale(completeRequest(attempt))).toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    expect(store.getCheckout(attempt.idempotencyKey)).toMatchObject({ status: 'confirmed', cashReceivedRappen: 500 });
    expect(store.state.sales).toHaveLength(0);
  });
});
