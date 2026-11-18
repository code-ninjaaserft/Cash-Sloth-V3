import { describe, expect, it } from 'vitest';
import { addVariantToCart, createCart } from './cart.js';
import { checkoutBalance, financialSaleFromLegacy, paymentAllocation, quotePayment, quoteRefundItems, validateCheckoutSession, validateFinancialSale, validatePaymentAttempt, validateRefund, validateRefundAttempt, validateRefundHistory, type FinancialSale, type PaymentAttempt, type Refund } from './finance.js';
import { calculateCashQuote } from './money.js';
import type { Cart } from './models.js';

const at = '2026-11-16T10:00:00.000Z';
function cart(price = 842, quantity = 1): Cart {
  let value = createCart('cart');
  for (let index = 0; index < quantity; index++) value = addVariantToCart(value, { productId: 'product', variantId: 'variant', productName: 'Historical item', variantName: 'Default', unitPriceRappen: price, productActive: true, active: true }, 'item');
  return value;
}
function attempt(subtotal: number, previous: readonly PaymentAttempt[], method: 'cash' | 'card' | 'twint', intended: number, id = 'attempt'): PaymentAttempt {
  return { id, idempotencyKey: `${id}-key`, sessionId: 'session', method, intendedRappen: intended, ...quotePayment(subtotal, previous, method, intended), status: 'confirmed', createdAt: at, reportedAt: at, confirmedAt: at, note: null };
}
function sale(value: Cart, attempts: readonly PaymentAttempt[]): FinancialSale {
  const balance = checkoutBalance(value.subtotalRappen, attempts);
  return { id: 'sale', checkoutSessionId: 'session', cartId: value.id, cartRevision: value.revision, completedAt: at, items: value.items, subtotalRappen: value.subtotalRappen,
    roundingAdjustmentRappen: balance.roundingAdjustmentRappen, amountDueRappen: balance.finalPayableRappen, actualPaidRappen: balance.confirmedAppliedRappen, payments: attempts.map(paymentAllocation), source: 'payments' };
}
function refund(original: FinancialSale, previous: readonly Refund[], quantity: number, id = `refund-${previous.length}`, method: 'card' | 'cash' | 'twint' = 'card'): Refund {
  const items = quoteRefundItems(original, previous, [{ saleItemId: original.items[0]!.id, quantity }]);
  return { id, idempotencyKey: `${id}-key`, attemptId: `${id}-attempt`, saleId: original.id, items, amountRappen: items.reduce((sum, item) => sum + item.amountRappen, 0), method, operatorConfirmed: true, confirmedAt: at, completedAt: at };
}
describe('shared payment allocation rules', () => {
  it.each([[840, 840, 0], [841, 840, -1], [842, 840, -2], [843, 845, 2], [844, 845, 1], [845, 845, 0], [1, 0, -1], [2, 0, -2], [3, 5, 2]])('rounds a final cash remainder %i once to %i', (subtotal, due, adjustment) => {
    const cash = attempt(subtotal, [], 'cash', 1000);
    expect(checkoutBalance(subtotal, [cash])).toMatchObject({ finalPayableRappen: due, roundingAdjustmentRappen: adjustment, confirmedAppliedRappen: due, outstandingRappen: 0, settled: true });
    expect(cash.changeRappen).toBe(1000 - due);
  });
  it('retains exact card-only and TWINT-only amounts', () => {
    for (const method of ['card', 'twint'] as const) {
      const payment = attempt(842, [], method, 842);
      expect(checkoutBalance(842, [payment])).toMatchObject({ finalPayableRappen: 842, roundingAdjustmentRappen: 0, confirmedAppliedRappen: 842, settled: true });
      expect(() => validateFinancialSale(sale(cart(), [payment]))).not.toThrow();
    }
  });
  it('rounds only the final residual after several exact allocations', () => {
    const twint = attempt(1684, [], 'twint', 500, 'twint');
    const card = attempt(1684, [twint], 'card', 500, 'card');
    expect(checkoutBalance(1684, [twint, card])).toMatchObject({ outstandingRappen: 684, cashDueRappen: 685, finalPayableRappen: 1684, roundingAdjustmentRappen: 0, settled: false });
    const cash = attempt(1684, [twint, card], 'cash', 1000, 'cash');
    const complete = sale(cart(842, 2), [twint, card, cash]);
    expect(complete).toMatchObject({ amountDueRappen: 1685, actualPaidRappen: 1685, roundingAdjustmentRappen: 1 });
    expect(cash).toMatchObject({ appliedRappen: 685, cashTenderedRappen: 1000, changeRappen: 315 });
    expect(() => validateFinancialSale(complete)).not.toThrow();
  });
  it('does not change exact digital allocations when the final remainder rounds down', () => {
    const card = attempt(842, [], 'card', 500, 'card'); const cash = attempt(842, [card], 'cash', 500, 'cash');
    expect(checkoutBalance(842, [card, cash])).toMatchObject({ confirmedDigitalRappen: 500, confirmedAppliedRappen: 840, roundingAdjustmentRappen: -2, finalPayableRappen: 840 });
    expect(card.appliedRappen).toBe(500); expect(cash.appliedRappen).toBe(340);
  });
  it('leaves unconfirmed, failed and uncertain attempts out of paid totals', () => {
    const confirmed = attempt(842, [], 'card', 500);
    for (const status of ['prepared', 'reported', 'failed', 'uncertain', 'excluded'] as const) {
      const pending: PaymentAttempt = { ...confirmed, status, confirmedAt: null, reportedAt: status === 'prepared' ? null : at };
      expect(checkoutBalance(842, [pending])).toMatchObject({ confirmedAppliedRappen: 0, outstandingRappen: 842, settled: false });
    }
  });
  it('retains original digital confirmation evidence after an investigated compensation without counting it as payment', () => {
    const confirmed = attempt(842, [], 'card', 500);
    const compensated: PaymentAttempt = { ...confirmed, status: 'excluded', note: 'Operator returned the original digital amount independently.' };
    expect(() => validatePaymentAttempt(compensated)).not.toThrow();
    expect(compensated.reportedAt).toBe(confirmed.reportedAt); expect(compensated.confirmedAt).toBe(confirmed.confirmedAt);
    expect(checkoutBalance(842, [compensated])).toMatchObject({ confirmedAppliedRappen: 0, outstandingRappen: 842, settled: false });
    expect(() => validatePaymentAttempt({ ...compensated, note: null })).toThrow();
    expect(() => validatePaymentAttempt({ ...attempt(842, [], 'cash', 1000), status: 'excluded', note: compensated.note })).toThrow();
  });
  it('requires explicit zero-value cash confirmation for a free checkout', () => {
    expect(checkoutBalance(0, []).settled).toBe(false);
    const zero = attempt(0, [], 'cash', 0);
    expect(() => validateFinancialSale(sale(cart(0), [zero]))).not.toThrow();
    expect(() => validateFinancialSale({ ...sale(cart(0), [zero]), payments: [] })).toThrow();
    expect(() => quotePayment(0, [], 'card', 0)).toThrow();
  });
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid allocation amounts %s', (invalid) => {
    expect(() => quotePayment(842, [], 'card', invalid)).toThrow();
    expect(() => quotePayment(842, [], 'cash', invalid)).toThrow();
  });
  it('prevents digital overpayment, zero digital payment and insufficient cash', () => {
    expect(() => quotePayment(842, [], 'card', 843)).toThrow();
    expect(() => quotePayment(842, [], 'twint', 0)).toThrow();
    expect(() => quotePayment(842, [], 'cash', 835)).toThrow();
    expect(() => quotePayment(842, [], 'cash', 841)).toThrow('multiple of CHF 0.05');
  });
  it('prevents new allocations after final cash or exact digital settlement', () => {
    const cash = attempt(842, [], 'cash', 1000); const card = attempt(842, [], 'card', 842);
    expect(() => quotePayment(842, [cash], 'card', 1)).toThrow();
    expect(() => quotePayment(842, [card], 'cash', 0)).toThrow();
    expect(() => checkoutBalance(842, [cash, { ...card, id: 'another', appliedRappen: 1, intendedRappen: 1 }])).toThrow('Cash must be the final');
  });
  it('uses checked integer arithmetic at maximum bounds', () => {
    expect(() => quotePayment(Number.MAX_SAFE_INTEGER, [], 'cash', Number.MAX_SAFE_INTEGER)).toThrow();
    const exact = attempt(Number.MAX_SAFE_INTEGER, [], 'card', Number.MAX_SAFE_INTEGER);
    expect(checkoutBalance(Number.MAX_SAFE_INTEGER, [exact]).settled).toBe(true);
    expect(() => checkoutBalance(Number.MAX_SAFE_INTEGER, [exact, { ...exact, id: 'another', appliedRappen: 1, intendedRappen: 1 }])).toThrow();
  });
  it('rejects inconsistent snapshots, duplicated allocations, forged cash and missing confirmation', () => {
    const cash = attempt(842, [], 'cash', 1000); const complete = sale(cart(), [cash]);
    expect(() => validateFinancialSale({ ...complete, actualPaidRappen: 841 })).toThrow();
    expect(() => validateFinancialSale({ ...complete, payments: [complete.payments[0]!, complete.payments[0]!] })).toThrow();
    expect(() => validatePaymentAttempt({ ...cash, changeRappen: 1 })).toThrow();
    expect(() => validatePaymentAttempt({ ...cash, confirmedAt: null })).toThrow();
    expect(() => paymentAllocation({ ...cash, status: 'uncertain' })).toThrow();
    expect(() => validateCheckoutSession({ id: 'session', cart: cart(), status: 'completed', createdAt: at, saleId: null })).toThrow();
  });
  it('projects legacy cash snapshots without inventing a different paid amount', () => {
    const original = cart();
    const converted = financialSaleFromLegacy({ id: 'old-sale', idempotencyKey: 'old-key', cartId: original.id, cartRevision: original.revision, completedAt: at, items: original.items, ...calculateCashQuote(842),
      payment: { method: 'cash', cashReceivedRappen: 1000, cashAppliedRappen: 840, changeRappen: 160, operatorConfirmed: true, confirmedAt: at } });
    expect(converted).toMatchObject({ source: 'legacy', actualPaidRappen: 840, checkoutSessionId: 'old-key' });
  });
});

describe('historical refund allocation and limits', () => {
  it('allocates an upward rounded sale to historical units as 842 then 843', () => {
    const original = sale(cart(842, 2), [attempt(1684, [], 'cash', 2000)]);
    const first = refund(original, [], 1); const second = refund(original, [first], 1);
    expect(first.items[0]).toMatchObject({ unitOffset: 0, baseRappen: 842, roundingAllocationRappen: 0, amountRappen: 842 });
    expect(second.items[0]).toMatchObject({ unitOffset: 1, baseRappen: 842, roundingAllocationRappen: 1, amountRappen: 843 });
    expect(first.amountRappen + second.amountRappen).toBe(original.actualPaidRappen);
    expect(() => validateRefundHistory(original, [first, second])).not.toThrow();
  });
  it('never rounds a partial refund independently and restricts impossible cash coin payouts', () => {
    const original = sale(cart(842, 2), [attempt(1684, [], 'cash', 2000)]);
    expect(() => validateRefund(refund(original, [], 1, 'partial', 'cash'))).toThrow();
    expect(() => validateRefund(refund(original, [], 2, 'full', 'cash'))).not.toThrow();
  });
  it.each([1, 2, 3, 7, 99, 842])('returns exactly the original paid total after arbitrary valid partial sequences at price %i', (price) => {
    const value = cart(price, 7); const original = sale(value, [attempt(value.subtotalRappen, [], 'cash', 10000)]);
    for (const quantities of [[1, 1, 1, 1, 1, 1, 1], [3, 1, 3], [2, 5], [7]]) {
      const history: Refund[] = [];
      for (const quantity of quantities) history.push(refund(original, history, quantity));
      expect(history.reduce((sum, entry) => sum + entry.amountRappen, 0)).toBe(original.actualPaidRappen);
      expect(() => validateRefundHistory(original, history)).not.toThrow();
    }
  });
  it('assigns fixed entitlement across several lines, independent of line-refund order', () => {
    const initial = cart(1, 2);
    const value = addVariantToCart(initial, { productId: 'other', variantId: 'other-variant', productName: 'Other', variantName: 'Default', unitPriceRappen: 1, productActive: true, active: true }, 'other-item');
    const original = sale(value, [attempt(3, [], 'cash', 5)]);
    const lineB = quoteRefundItems(original, [], [{ saleItemId: 'other-item', quantity: 1 }]);
    const entryB: Refund = { ...refund(original, [], 1), items: lineB, amountRappen: lineB[0]!.amountRappen };
    const lineA = quoteRefundItems(original, [entryB], [{ saleItemId: 'item', quantity: 2 }]);
    expect(lineA[0]!.amountRappen + lineB[0]!.amountRappen).toBe(5);
  });
  it('supports zero-priced lines and zero-paid rounded sales without negative entitlements', () => {
    const original = sale(cart(0, 2), [attempt(0, [], 'cash', 0)]);
    const first = refund(original, [], 1); const second = refund(original, [first], 1);
    expect(first.amountRappen).toBe(0); expect(second.amountRappen).toBe(0);
    expect(() => validateRefundHistory(original, [first, second])).not.toThrow();
    const roundedZero = sale(cart(1), [attempt(1, [], 'cash', 0)]);
    expect(refund(roundedZero, [], 1).items[0]).toMatchObject({ amountRappen: 0, roundingAllocationRappen: -1 });
  });
  it('prevents quantity reuse, unknown lines, duplicate selections and invalid quantities', () => {
    const original = sale(cart(842, 2), [attempt(1684, [], 'card', 1684)]);
    const first = refund(original, [], 1);
    expect(() => refund(original, [first], 2)).toThrow();
    expect(() => quoteRefundItems(original, [], [])).toThrow();
    expect(() => quoteRefundItems(original, [], [{ saleItemId: 'missing', quantity: 1 }])).toThrow();
    expect(() => quoteRefundItems(original, [], [{ saleItemId: 'item', quantity: 1 }, { saleItemId: 'item', quantity: 1 }])).toThrow();
    for (const quantity of [-1, 0, 1.5, NaN, 10000]) expect(() => quoteRefundItems(original, [], [{ saleItemId: 'item', quantity }])).toThrow();
  });
  it('rejects forged historical amounts, repeated refund identities and skipped units', () => {
    const original = sale(cart(842, 2), [attempt(1684, [], 'card', 1684)]);
    const first = refund(original, [], 1); const second = refund(original, [first], 1);
    expect(() => validateRefundHistory(original, [first, { ...second, id: first.id }])).toThrow();
    expect(() => validateRefundHistory(original, [{ ...first, items: [{ ...first.items[0]!, unitOffset: 1 }] }])).toThrow();
    expect(() => validateRefundHistory(original, [{ ...first, amountRappen: 843, items: [{ ...first.items[0]!, amountRappen: 843, roundingAllocationRappen: 1 }] }])).toThrow();
    expect(() => validateRefundAttempt({ id: 'refund-attempt', idempotencyKey: 'refund-key', saleId: original.id, method: 'card', items: first.items, amountRappen: first.amountRappen, status: 'completed', createdAt: at, reportedAt: null, refundId: null, note: null })).toThrow();
    expect(() => validateRefundAttempt({ id: 'refund-attempt', idempotencyKey: 'refund-key', saleId: original.id, method: 'card', items: first.items, amountRappen: first.amountRappen, status: 'reported', createdAt: at, reportedAt: null, refundId: null, note: null })).toThrow();
  });
  it('apportions maximum-safe historical amounts with BigInt products', () => {
    const value = cart(Number.MAX_SAFE_INTEGER); const original = sale(value, [attempt(value.subtotalRappen, [], 'card', value.subtotalRappen)]);
    const full = refund(original, [], 1);
    expect(full.amountRappen).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => validateRefundHistory(original, [full])).not.toThrow();
  });
});
