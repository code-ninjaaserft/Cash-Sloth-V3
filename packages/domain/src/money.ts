import { DomainError } from './models.js';

export const MAX_QUANTITY = 9999;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function assertRappen(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('INVALID_INPUT', 'Money must be non-negative safe integer Rappen.');
}
export function assertQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_QUANTITY) throw new DomainError('INVALID_INPUT', `Quantity must be an integer from 1 to ${MAX_QUANTITY}.`);
}
function fromInteger(value: bigint): number {
  if (value < 0n || value > MAX_SAFE) throw new DomainError('OVERFLOW', 'The monetary result exceeds supported integer bounds.');
  return Number(value);
}
export function addMoney(left: number, right: number): number {
  assertRappen(left); assertRappen(right);
  return fromInteger(BigInt(left) + BigInt(right));
}
export function multiplyMoney(unitPriceRappen: number, quantity: number): number {
  assertRappen(unitPriceRappen); assertQuantity(quantity);
  return fromInteger(BigInt(unitPriceRappen) * BigInt(quantity));
}
/** Round only the cash portion. Digital amounts must be subtracted beforehand. */
export function roundCashRappen(cashPortionRappen: number): number {
  assertRappen(cashPortionRappen);
  return fromInteger(((BigInt(cashPortionRappen) + 2n) / 5n) * 5n);
}
export function calculateCashQuote(subtotalRappen: number) {
  const amountDueRappen = roundCashRappen(subtotalRappen);
  return { subtotalRappen, amountDueRappen, roundingAdjustmentRappen: amountDueRappen - subtotalRappen };
}
export function previewCash(amountDueRappen: number, cashReceivedRappen: number) {
  assertRappen(amountDueRappen); assertRappen(cashReceivedRappen);
  const sufficient = cashReceivedRappen >= amountDueRappen;
  return {
    cashReceivedRappen,
    cashAppliedRappen: sufficient ? amountDueRappen : cashReceivedRappen,
    changeRappen: sufficient ? cashReceivedRappen - amountDueRappen : 0,
    remainingRappen: sufficient ? 0 : amountDueRappen - cashReceivedRappen,
    sufficient,
  };
}
export function calculateCashPayment(amountDueRappen: number, cashReceivedRappen: number) {
  const payment = previewCash(amountDueRappen, cashReceivedRappen);
  if (!payment.sufficient) throw new DomainError('INSUFFICIENT_CASH', 'Cash received is below the rounded amount due.');
  return payment;
}
/** Formatting never divides a currency value into floating-point francs. */
export function formatChf(rappen: number): string {
  assertRappen(rappen);
  const amount = BigInt(rappen);
  return `CHF ${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
export function parseChfInput(input: string): number {
  const value = input.trim();
  if (value.length > 32 || !/^\d+(?:[.,]\d{1,2})?$/u.test(value)) throw new DomainError('INVALID_INPUT', 'Enter a CHF amount with at most two decimal places.');
  const [whole = '0', fraction = ''] = value.split(/[.,]/u);
  return fromInteger(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0'));
}
