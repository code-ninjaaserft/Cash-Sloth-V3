import { describe, expect, it } from 'vitest';
import { addVariantToCart, createCart } from './cart.js';
import type { CheckoutAttempt, Sale } from './models.js';
import { validateCheckoutAttempt, validateSale } from './sale.js';

const timestamp = '2026-11-11T12:00:00.000Z';
const cart = addVariantToCart(createCart('cart'), { productId: 'product', variantId: 'variant', productName: 'Chocolate', variantName: 'Default', unitPriceRappen: 247, productActive: true, active: true }, 'line');
const sale: Sale = {
  id: 'sale', idempotencyKey: 'checkout', cartId: cart.id, cartRevision: cart.revision,
  completedAt: timestamp, items: cart.items, subtotalRappen: 247, amountDueRappen: 245, roundingAdjustmentRappen: -2,
  payment: { method: 'cash', cashReceivedRappen: 500, cashAppliedRappen: 245, changeRappen: 255, operatorConfirmed: true, confirmedAt: timestamp },
};
const prepared: CheckoutAttempt = { idempotencyKey: 'checkout', cartId: cart.id, cartRevision: cart.revision, subtotalRappen: 247, amountDueRappen: 245, roundingAdjustmentRappen: -2, status: 'prepared', createdAt: timestamp, cashReceivedRappen: null, confirmedAt: null, saleId: null };

describe('financial snapshot invariants', () => {
  it('accepts complete, consistent sale snapshots', () => {
    expect(() => validateSale(sale)).not.toThrow();
  });
  it('rejects forged totals, payment allocation, change and empty sales', () => {
    expect(() => validateSale({ ...sale, amountDueRappen: 250 })).toThrow();
    expect(() => validateSale({ ...sale, payment: { ...sale.payment, cashAppliedRappen: 247 } })).toThrow();
    expect(() => validateSale({ ...sale, payment: { ...sale.payment, changeRappen: 0 } })).toThrow();
    expect(() => validateSale({ ...sale, items: [], subtotalRappen: 0, amountDueRappen: 0, roundingAdjustmentRappen: 0 })).toThrow();
  });
  it('rejects invalid timestamps without assuming the host clock is monotonic', () => {
    expect(() => validateSale({ ...sale, completedAt: 'not-a-timestamp' })).toThrow();
    expect(() => validateSale({ ...sale, completedAt: '2026-11-11T11:59:59.000Z' })).not.toThrow();
  });
  it('requires explicit confirmation evidence for confirmed and completed attempts', () => {
    expect(() => validateCheckoutAttempt(prepared)).not.toThrow();
    expect(() => validateCheckoutAttempt({ ...prepared, status: 'confirmed' })).toThrow();
    expect(() => validateCheckoutAttempt({ ...prepared, cashReceivedRappen: 500 })).toThrow();
    const confirmed: CheckoutAttempt = { ...prepared, status: 'confirmed', cashReceivedRappen: 500, confirmedAt: timestamp };
    expect(() => validateCheckoutAttempt(confirmed)).not.toThrow();
    expect(() => validateCheckoutAttempt({ ...confirmed, status: 'completed' })).toThrow();
    expect(() => validateCheckoutAttempt({ ...confirmed, status: 'completed', saleId: sale.id })).not.toThrow();
  });
});
