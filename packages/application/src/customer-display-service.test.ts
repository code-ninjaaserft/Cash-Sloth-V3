import { describe, expect, it } from 'vitest';
import { checkoutBalance, quotePayment, type Cart, type CheckoutView, type PaymentAttempt } from '@cash-sloth/domain';
import { createCustomerDisplayService } from './customer-display-service.js';
import type { Result } from '@cash-sloth/contracts';

function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }
const at = '2026-11-22T10:00:00.000Z';
function fixture(price = 247) {
  let cart: Cart | null = { id: 'private-cart', revision: 1, subtotalRappen: price, items: [{ id: 'private-line', productId: 'private-product', variantId: 'private-variant', productName: 'Chocolate', variantName: 'Default', unitPriceRappen: price, quantity: 1, lineTotalRappen: price }] };
  let checkout: CheckoutView | null = null;
  const display = createCustomerDisplayService({ transaction: (action) => action(), getCart: () => cart, getCheckout: () => checkout, getEventTitle: () => 'Fair' });
  return { display, open: () => { checkout = { session: { id: 'private-session', cart: cart!, status: 'open', saleId: null, createdAt: at }, attempts: [], balance: checkoutBalance(price, []), sale: null }; return checkout; }, setCheckout: (next: CheckoutView) => { checkout = next; }, clear: () => { checkout = null; cart = null; } };
}
describe('read-only customer display snapshots', () => {
  it('exposes cart labels and prices without internal IDs or financial history', () => {
    const { display } = fixture(); const state = value(display.getState());
    expect(state).toMatchObject({ eventTitle: 'Fair', subtotalRappen: 247, totalRappen: 247, outstandingRappen: 247, checkoutActive: false });
    expect(JSON.stringify(state)).not.toContain('private-');
    expect(state.items).toHaveLength(1);
  });
  it('previews cash and a tip without changing the recorded checkout', () => {
    const { display, open, clear } = fixture(); const checkout = open();
    value(display.preview({ sessionId: checkout.session.id, method: 'cash', tipRappen: 255, cashReceivedRappen: 1000 }));
    expect(value(display.getState())).toMatchObject({ subtotalRappen: 247, tipRappen: 255, totalRappen: 500, outstandingRappen: 500, cashReceivedRappen: 1000, changeRappen: 500 });
    expect(checkout.session.tipRappen).toBeUndefined(); expect(checkout.attempts).toEqual([]);
    clear(); expect(value(display.getState())).toMatchObject({ items: [], totalRappen: 0, tipRappen: 0, changeRappen: null });
  });
  it('rejects a stale checkout and invalid or overflowing previews', () => {
    const { display, open } = fixture(); const checkout = open();
    expect(display.preview({ sessionId: 'other-session', method: 'cash', tipRappen: 0, cashReceivedRappen: 0 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(display.preview({ sessionId: checkout.session.id, method: 'cash', tipRappen: -1, cashReceivedRappen: 0 }).ok).toBe(false);
    expect(display.preview({ sessionId: checkout.session.id, method: 'cash', tipRappen: Number.MAX_SAFE_INTEGER, cashReceivedRappen: 0 }).ok).toBe(false);
    expect(value(display.getState()).totalRappen).toBe(247);
  });
  it('shows rounded outstanding cash and change after partial digital payments', () => {
    const { display, open, setCheckout } = fixture(1684); const checkout = open();
    const digital: PaymentAttempt = { id: 'payment', sessionId: checkout.session.id, idempotencyKey: 'payment-key', method: 'card', intendedRappen: 500, ...quotePayment(1684, [], 'card', 500), status: 'confirmed', createdAt: at, reportedAt: at, confirmedAt: at, note: null };
    setCheckout({ ...checkout, attempts: [digital], balance: checkoutBalance(1684, [digital]) });
    value(display.preview({ sessionId: checkout.session.id, method: 'cash', tipRappen: 100, cashReceivedRappen: 1200 }));
    expect(value(display.getState())).toMatchObject({ tipRappen: 0, totalRappen: 1685, outstandingRappen: 1185, changeRappen: 15 });
    const cash: PaymentAttempt = { ...digital, id: 'cash', idempotencyKey: 'cash-key', method: 'cash', intendedRappen: 1200, ...quotePayment(1684, [digital], 'cash', 1200) };
    setCheckout({ ...checkout, attempts: [digital, cash], balance: checkoutBalance(1684, [digital, cash]) });
    expect(value(display.getState())).toMatchObject({ totalRappen: 1685, outstandingRappen: 0, cashReceivedRappen: 1200, changeRappen: 15 });
  });
});
