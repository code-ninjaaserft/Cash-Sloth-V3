import { describe, expect, it } from 'vitest';
import type { CheckoutView } from '@cash-sloth/contracts';
import type { Cart, CheckoutAttempt } from '@cash-sloth/domain';
import { cartPayableRappen } from './cart-payable.js';

const cart: Cart = {
  id: 'register', revision: 1, subtotalRappen: 247,
  items: [{ id: 'line', productId: 'tea', variantId: 'cup', productName: 'Tea', variantName: 'Cup', unitPriceRappen: 247, quantity: 1, lineTotalRappen: 247 }],
};
const time = '2026-01-01T12:00:00.000Z';

describe('cart footer payable total', () => {
  it('uses a confirmed legacy quote only for its original cart and revision', () => {
    const legacy: CheckoutAttempt = {
      idempotencyKey: 'cash', cartId: cart.id, cartRevision: cart.revision, status: 'confirmed',
      subtotalRappen: 247, roundingAdjustmentRappen: -2, amountDueRappen: 245,
      cashReceivedRappen: 500, saleId: null, createdAt: time, confirmedAt: time,
    };
    expect(cartPayableRappen(cart, null, legacy)).toBe(245);
    expect(cartPayableRappen({ ...cart, revision: 2 }, null, legacy)).toBe(247);
    expect(cartPayableRappen({ ...cart, id: 'new-cart' }, null, legacy)).toBe(247);
    expect(cartPayableRappen(null, null, legacy)).toBeNull();
  });

  it('shows the stored payable after rounding and withholds a total during investigation', () => {
    const cash: CheckoutView['attempts'][number] = {
      id: 'payment', idempotencyKey: 'cash', sessionId: 'checkout', method: 'cash', status: 'confirmed',
      intendedRappen: 245, appliedRappen: 245, cashTenderedRappen: 500, changeRappen: 255, roundingAdjustmentRappen: -2,
      createdAt: time, reportedAt: time, confirmedAt: time, note: null,
    };
    const checkout: CheckoutView = {
      session: { id: 'checkout', cart, createdAt: time, status: 'open', saleId: null }, sale: null, attempts: [cash],
      balance: { subtotalRappen: 247, confirmedDigitalRappen: 0, confirmedAppliedRappen: 245, cashDueRappen: 0,
        outstandingRappen: 0, roundingAdjustmentRappen: -2, finalPayableRappen: 245, settled: true },
    };
    expect(cartPayableRappen(cart, checkout, null)).toBe(245);
    const uncertain = { ...cash, status: 'uncertain' as const, confirmedAt: null };
    expect(cartPayableRappen(cart, { ...checkout, attempts: [uncertain] }, null)).toBeNull();
    expect(cartPayableRappen({ ...cart, revision: 2 }, checkout, null)).toBe(247);
  });
});
