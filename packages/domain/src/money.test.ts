import { describe, expect, it } from 'vitest';
import { addMoney, assertQuantity, assertRappen, calculateCashPayment, calculateCashQuote, formatChf, multiplyMoney, parseChfInput, previewCash, roundCashRappen } from './money.js';

describe('integer CHF money', () => {
  it.each([-1, 0.01, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid Rappen %s', (value) => {
    expect(() => assertRappen(value)).toThrow();
  });
  it.each([0, -1, 1.5, 10000, NaN])('rejects invalid quantity %s', (value) => {
    expect(() => assertQuantity(value)).toThrow();
  });
  it('formats exact two-decimal CHF values, including safe-integer limits', () => {
    expect(formatChf(0)).toBe('CHF 0.00');
    expect(formatChf(5)).toBe('CHF 0.05');
    expect(formatChf(247)).toBe('CHF 2.47');
    expect(formatChf(Number.MAX_SAFE_INTEGER)).toBe('CHF 90071992547409.91');
  });
  it.each([['1', 100], ['1.2', 120], ['2,47', 247], [' 10.00 ', 1000], ['0.05', 5]])('parses %s without floating-point currency arithmetic', (input, expected) => {
    expect(parseChfInput(input)).toBe(expected);
  });
  it.each(['-1', 'NaN', '', '1.001', '1e3', '1 000', 'Infinity', '90071992547409.92'])('rejects invalid cash input %s', (input) => {
    expect(() => parseChfInput(input)).toThrow();
  });
  it('multiplies and sums safely and rejects overflows', () => {
    expect(multiplyMoney(247, 3)).toBe(741);
    expect(addMoney(741, 330)).toBe(1071);
    expect(() => multiplyMoney(Number.MAX_SAFE_INTEGER, 2)).toThrow();
    expect(() => addMoney(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });
});

describe('cash rounding and change', () => {
  it.each([[0, 0], [1, 0], [2, 0], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 10], [9, 10], [10, 10], [247, 245], [248, 250], [999, 1000]])('rounds %i Rappen to %i once', (input, expected) => {
    expect(roundCashRappen(input)).toBe(expected);
  });
  it('keeps subtotal and signed rounding adjustment distinct', () => {
    expect(calculateCashQuote(247)).toEqual({ subtotalRappen: 247, amountDueRappen: 245, roundingAdjustmentRappen: -2 });
    expect(calculateCashQuote(248)).toEqual({ subtotalRappen: 248, amountDueRappen: 250, roundingAdjustmentRappen: 2 });
  });
  it('can round a future remaining cash portion independently of digital amounts', () => {
    expect(roundCashRappen(247 - 100)).toBe(145);
  });
  it('previews insufficient cash but rejects it as a completed payment', () => {
    expect(previewCash(245, 200)).toMatchObject({ sufficient: false, remainingRappen: 45, changeRappen: 0 });
    expect(() => calculateCashPayment(245, 200)).toThrow('Cash received is below');
  });
  it('records cash received, applied and change independently', () => {
    expect(calculateCashPayment(245, 500)).toEqual({ cashReceivedRappen: 500, cashAppliedRappen: 245, changeRappen: 255, remainingRappen: 0, sufficient: true });
  });
});
