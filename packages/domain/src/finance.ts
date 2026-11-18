import { validateCart } from './cart.js';
import { addMoney, assertQuantity, assertRappen, calculateCashPayment, roundCashRappen } from './money.js';
import { assertIdentifier, DomainError, type Cart, type CheckoutAttempt, type Sale, type SaleItem } from './models.js';

export type PaymentMethod = 'cash' | 'card' | 'twint';
export type PaymentStatus = 'prepared' | 'reported' | 'confirmed' | 'uncertain' | 'failed' | 'excluded';
export interface CheckoutSession {
  readonly id: string; readonly cart: Cart; readonly status: 'open' | 'completed' | 'cancelled';
  readonly createdAt: string; readonly saleId: string | null;
}
export interface PaymentAttempt {
  readonly id: string; readonly idempotencyKey: string; readonly sessionId: string;
  readonly method: PaymentMethod; readonly intendedRappen: number; readonly appliedRappen: number;
  readonly cashTenderedRappen: number | null; readonly changeRappen: number; readonly roundingAdjustmentRappen: number;
  readonly status: PaymentStatus; readonly createdAt: string; readonly reportedAt: string | null;
  readonly confirmedAt: string | null; readonly note: string | null;
}
export interface PaymentAllocation {
  readonly attemptId: string; readonly method: PaymentMethod; readonly amountRappen: number;
  readonly cashTenderedRappen: number | null; readonly changeRappen: number;
  readonly operatorConfirmed: true; readonly confirmedAt: string;
}
export interface FinancialSale {
  readonly id: string; readonly checkoutSessionId: string; readonly cartId: string; readonly cartRevision: number;
  readonly completedAt: string; readonly items: readonly SaleItem[]; readonly subtotalRappen: number;
  readonly roundingAdjustmentRappen: number; readonly amountDueRappen: number; readonly actualPaidRappen: number;
  readonly payments: readonly PaymentAllocation[]; readonly source: 'legacy' | 'payments';
}
export interface CheckoutBalance {
  readonly subtotalRappen: number; readonly confirmedDigitalRappen: number; readonly confirmedAppliedRappen: number;
  readonly outstandingRappen: number; readonly cashDueRappen: number; readonly roundingAdjustmentRappen: number;
  readonly finalPayableRappen: number; readonly settled: boolean;
}
export interface CheckoutView { readonly session: CheckoutSession; readonly attempts: readonly PaymentAttempt[]; readonly balance: CheckoutBalance; readonly sale: FinancialSale | null }
export interface RefundSelection { readonly saleItemId: string; readonly quantity: number }
export interface RefundItem extends RefundSelection { readonly unitOffset: number; readonly unitPriceRappen: number; readonly baseRappen: number; readonly roundingAllocationRappen: number; readonly amountRappen: number }
export interface RefundAttempt {
  readonly id: string; readonly idempotencyKey: string; readonly saleId: string; readonly method: PaymentMethod;
  readonly items: readonly RefundItem[]; readonly amountRappen: number; readonly status: 'prepared' | 'reported' | 'completed' | 'uncertain' | 'failed' | 'excluded';
  readonly createdAt: string; readonly reportedAt: string | null; readonly refundId: string | null; readonly note: string | null;
}
export interface Refund {
  readonly id: string; readonly idempotencyKey: string; readonly attemptId: string; readonly saleId: string;
  readonly items: readonly RefundItem[]; readonly amountRappen: number; readonly method: PaymentMethod;
  readonly operatorConfirmed: true; readonly confirmedAt: string; readonly completedAt: string;
}
export interface RefundableItem { readonly saleItemId: string; readonly quantitySold: number; readonly quantityRefunded: number; readonly quantityRemaining: number }
export interface SaleDetails { readonly sale: FinancialSale; readonly refunds: readonly Refund[]; readonly refundAttempts: readonly RefundAttempt[]; readonly refundedRappen: number; readonly refundableRappen: number; readonly items: readonly RefundableItem[] }
export interface FinancialEvent { readonly id: string; readonly kind: 'payment' | 'refund' | 'session'; readonly referenceId: string; readonly status: string; readonly at: string; readonly note: string | null }
export type ReconciliationResolution = 'confirm-recorded' | 'exclude-no-transfer' | 'exclude-compensated';
export interface ReconciliationAction {
  readonly id: string; readonly idempotencyKey: string; readonly kind: 'payment' | 'refund' | 'legacy';
  readonly referenceId: string; readonly resolution: ReconciliationResolution; readonly reason: string; readonly at: string;
}
export interface ReconciliationCase {
  readonly id: string; readonly kind: 'payment' | 'refund' | 'legacy'; readonly referenceId: string;
  readonly reason: string; readonly paymentAttempt: PaymentAttempt | null; readonly refundAttempt: RefundAttempt | null;
  readonly legacyCheckout: CheckoutAttempt | null; readonly sale: FinancialSale | null;
  readonly events: readonly FinancialEvent[]; readonly actions: readonly ReconciliationAction[];
}

export function assertFinancialTimestamp(value: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new DomainError('INVALID_INPUT', 'Invalid financial timestamp.');
}
export function assertPaymentMethod(method: PaymentMethod): void {
  if (!['cash', 'card', 'twint'].includes(method)) throw new DomainError('INVALID_INPUT', 'Invalid payment method.');
}
export function validateCheckoutSession(session: CheckoutSession): void {
  assertIdentifier(session.id); validateCart(session.cart); assertFinancialTimestamp(session.createdAt);
  if (session.cart.items.length === 0 || !['open', 'completed', 'cancelled'].includes(session.status)) throw new DomainError('INVALID_INPUT', 'Invalid checkout session.');
  if ((session.status === 'completed') !== (session.saleId !== null)) throw new DomainError('INVALID_INPUT', 'Inconsistent checkout sale reference.');
  if (session.saleId !== null) assertIdentifier(session.saleId);
}
export function validatePaymentAttempt(attempt: PaymentAttempt): void {
  assertIdentifier(attempt.id); assertIdentifier(attempt.idempotencyKey); assertIdentifier(attempt.sessionId); assertPaymentMethod(attempt.method);
  assertRappen(attempt.intendedRappen); assertRappen(attempt.appliedRappen); assertRappen(attempt.changeRappen);
  assertFinancialTimestamp(attempt.createdAt);
  if (!['prepared', 'reported', 'confirmed', 'uncertain', 'failed', 'excluded'].includes(attempt.status) || !Number.isSafeInteger(attempt.roundingAdjustmentRappen) || Math.abs(attempt.roundingAdjustmentRappen) > 2) throw new DomainError('INVALID_INPUT', 'Invalid payment attempt state.');
  if (attempt.method === 'cash') {
    if (attempt.cashTenderedRappen === null || attempt.cashTenderedRappen !== attempt.intendedRappen || attempt.intendedRappen % 5 !== 0 || attempt.appliedRappen % 5 !== 0 || addMoney(attempt.appliedRappen, attempt.changeRappen) !== attempt.cashTenderedRappen) throw new DomainError('INVALID_INPUT', 'Invalid cash payment amounts.');
  } else if (attempt.cashTenderedRappen !== null || attempt.changeRappen !== 0 || attempt.appliedRappen !== attempt.intendedRappen || attempt.intendedRappen === 0 || attempt.roundingAdjustmentRappen !== 0) throw new DomainError('INVALID_INPUT', 'Invalid exact digital payment.');
  if (attempt.reportedAt !== null) assertFinancialTimestamp(attempt.reportedAt);
  if (attempt.confirmedAt !== null) assertFinancialTimestamp(attempt.confirmedAt);
  if (attempt.status === 'confirmed' && (attempt.confirmedAt === null || attempt.reportedAt === null)) throw new DomainError('INVALID_INPUT', 'Payment confirmation evidence is missing.');
  if (['reported', 'uncertain'].includes(attempt.status) && attempt.reportedAt === null || !['confirmed', 'excluded'].includes(attempt.status) && attempt.confirmedAt !== null) throw new DomainError('INVALID_INPUT', 'Inconsistent payment assertion timestamps.');
  if (attempt.status === 'excluded' && attempt.confirmedAt !== null && (attempt.method === 'cash' || attempt.reportedAt === null || attempt.note === null || attempt.note.trim().length < 10)) throw new DomainError('INVALID_INPUT', 'A compensated digital allocation must retain its original confirmation and investigation reason.');
  if (attempt.status === 'prepared' && (attempt.reportedAt !== null || attempt.confirmedAt !== null)) throw new DomainError('INVALID_INPUT', 'Prepared payment has confirmation data.');
}
export function checkoutBalance(subtotalRappen: number, attempts: readonly PaymentAttempt[]): CheckoutBalance {
  assertRappen(subtotalRappen);
  let digital = 0; let applied = 0; let cash: PaymentAttempt | undefined; const ids = new Set<string>();
  for (const attempt of attempts) {
    validatePaymentAttempt(attempt);
    if (ids.has(attempt.id)) throw new DomainError('CONFLICT', 'A payment attempt cannot be allocated twice.');
    ids.add(attempt.id); if (attempt.status !== 'confirmed') continue;
    if (cash !== undefined) throw new DomainError('CONFLICT', 'Cash must be the final allocation.');
    if (attempt.method === 'cash') cash = attempt; else digital = addMoney(digital, attempt.appliedRappen);
    applied = addMoney(applied, attempt.appliedRappen);
  }
  if (digital > subtotalRappen) throw new DomainError('OVERPAYMENT', 'Digital payments exceed the original subtotal.');
  const remaining = subtotalRappen - digital;
  const cashDue = roundCashRappen(remaining);
  const adjustment = cash === undefined ? 0 : cashDue - remaining;
  if (cash !== undefined && (cash.appliedRappen !== cashDue || cash.roundingAdjustmentRappen !== adjustment)) throw new DomainError('CONFLICT', 'Cash does not settle the remaining balance.');
  const payable = cash === undefined ? subtotalRappen : addMoney(digital, cashDue);
  if (applied > payable) throw new DomainError('OVERPAYMENT', 'Applied payments exceed the final payable amount.');
  return { subtotalRappen, confirmedDigitalRappen: digital, confirmedAppliedRappen: applied, outstandingRappen: payable - applied,
    cashDueRappen: cash === undefined ? cashDue : 0, roundingAdjustmentRappen: adjustment, finalPayableRappen: payable,
    settled: cash !== undefined || digital === subtotalRappen && attempts.some((attempt) => attempt.status === 'confirmed') };
}
export function quotePayment(subtotalRappen: number, attempts: readonly PaymentAttempt[], method: PaymentMethod, intendedRappen: number) {
  assertPaymentMethod(method); assertRappen(intendedRappen);
  const balance = checkoutBalance(subtotalRappen, attempts);
  if (attempts.some((attempt) => attempt.status === 'confirmed' && attempt.method === 'cash') || balance.settled && subtotalRappen > 0) throw new DomainError('ALREADY_SETTLED', 'This checkout is already fully settled.');
  if (method !== 'cash') {
    if (intendedRappen === 0 || intendedRappen > balance.outstandingRappen) throw new DomainError('OVERPAYMENT', 'Digital payment must be positive and no greater than the outstanding balance.');
    return { appliedRappen: intendedRappen, cashTenderedRappen: null, changeRappen: 0, roundingAdjustmentRappen: 0 };
  }
  const payment = calculateCashPayment(balance.cashDueRappen, intendedRappen);
  if (intendedRappen % 5 !== 0) throw new DomainError('CASH_DENOMINATION', 'Cash tendered must be a multiple of CHF 0.05.');
  return { appliedRappen: payment.cashAppliedRappen, cashTenderedRappen: intendedRappen, changeRappen: payment.changeRappen,
    roundingAdjustmentRappen: balance.cashDueRappen - balance.outstandingRappen };
}
export function paymentAllocation(attempt: PaymentAttempt): PaymentAllocation {
  validatePaymentAttempt(attempt);
  if (attempt.status !== 'confirmed' || attempt.confirmedAt === null) throw new DomainError('CONFIRMATION_REQUIRED', 'Only confirmed payments can be allocated.');
  return { attemptId: attempt.id, method: attempt.method, amountRappen: attempt.appliedRappen, cashTenderedRappen: attempt.cashTenderedRappen, changeRappen: attempt.changeRappen, operatorConfirmed: true, confirmedAt: attempt.confirmedAt };
}
export function validateFinancialSale(sale: FinancialSale): void {
  assertIdentifier(sale.id); assertIdentifier(sale.checkoutSessionId); assertFinancialTimestamp(sale.completedAt);
  validateCart({ id: sale.cartId, revision: sale.cartRevision, items: sale.items, subtotalRappen: sale.subtotalRappen });
  if (sale.items.length === 0 || sale.payments.length === 0 || sale.payments.length > 1000 || !['legacy', 'payments'].includes(sale.source)) throw new DomainError('INVALID_INPUT', 'Invalid sale snapshot.');
  assertRappen(sale.amountDueRappen); assertRappen(sale.actualPaidRappen);
  if (!Number.isSafeInteger(sale.roundingAdjustmentRappen) || Math.abs(sale.roundingAdjustmentRappen) > 2 || BigInt(sale.subtotalRappen) + BigInt(sale.roundingAdjustmentRappen) !== BigInt(sale.amountDueRappen)) throw new DomainError('INVALID_INPUT', 'Sale payable amount is inconsistent.');
  let total = 0; let digital = 0; let seenCash = false; const ids = new Set<string>();
  for (const payment of sale.payments) {
    assertIdentifier(payment.attemptId); assertPaymentMethod(payment.method); assertRappen(payment.amountRappen); assertRappen(payment.changeRappen); assertFinancialTimestamp(payment.confirmedAt);
    if (ids.has(payment.attemptId) || payment.operatorConfirmed !== true || seenCash) throw new DomainError('INVALID_INPUT', 'Invalid sale payment allocation.');
    ids.add(payment.attemptId);
    if (payment.method === 'cash') {
      seenCash = true;
      if (payment.cashTenderedRappen === null || payment.amountRappen % 5 !== 0 || sale.source === 'payments' && payment.cashTenderedRappen % 5 !== 0 || addMoney(payment.amountRappen, payment.changeRappen) !== payment.cashTenderedRappen) throw new DomainError('INVALID_INPUT', 'Invalid sale cash payment.');
    } else {
      if (payment.cashTenderedRappen !== null || payment.changeRappen !== 0 || payment.amountRappen === 0) throw new DomainError('INVALID_INPUT', 'Invalid sale digital payment.');
      digital = addMoney(digital, payment.amountRappen);
    }
    total = addMoney(total, payment.amountRappen);
  }
  if (digital > sale.subtotalRappen || total !== sale.amountDueRappen || total !== sale.actualPaidRappen || (seenCash ? addMoney(digital, roundCashRappen(sale.subtotalRappen - digital)) !== total : sale.roundingAdjustmentRappen !== 0)) throw new DomainError('INVALID_INPUT', 'Applied payments must equal the final payable amount.');
}
export function financialSaleFromLegacy(sale: Sale): FinancialSale {
  const converted: FinancialSale = { id: sale.id, checkoutSessionId: sale.idempotencyKey, cartId: sale.cartId, cartRevision: sale.cartRevision, completedAt: sale.completedAt,
    items: sale.items, subtotalRappen: sale.subtotalRappen, roundingAdjustmentRappen: sale.roundingAdjustmentRappen, amountDueRappen: sale.amountDueRappen, actualPaidRappen: sale.payment.cashAppliedRappen,
    source: 'legacy', payments: [{ attemptId: sale.idempotencyKey, method: 'cash', amountRappen: sale.payment.cashAppliedRappen, cashTenderedRappen: sale.payment.cashReceivedRappen, changeRappen: sale.payment.changeRappen, operatorConfirmed: true, confirmedAt: sale.payment.confirmedAt }] };
  validateFinancialSale(converted); return converted;
}

/** Prefix-floor apportionment assigns every historical unit a fixed share of the actual payment. */
export function quoteRefundItems(sale: FinancialSale, refunds: readonly Refund[], selections: readonly RefundSelection[]): readonly RefundItem[] {
  validateFinancialSale(sale);
  if (selections.length === 0 || selections.length > sale.items.length) throw new DomainError('INVALID_INPUT', 'Select at least one original sale item.');
  const refunded = new Map<string, number>();
  let refundedAmount = 0;
  for (const refund of refunds) {
    validateRefund(refund);
    if (refund.saleId !== sale.id) throw new DomainError('INVALID_INPUT', 'Refund belongs to another original sale.');
    refundedAmount = addMoney(refundedAmount, refund.amountRappen);
    for (const item of refund.items) refunded.set(item.saleItemId, (refunded.get(item.saleItemId) ?? 0) + item.quantity);
  }
  if (refundedAmount > sale.actualPaidRappen) throw new DomainError('REFUND_LIMIT', 'Previous refunds exceed the actual original payment.');
  const prefixes = new Map<string, bigint>(); let prefix = 0n;
  for (const item of sale.items) { prefixes.set(item.id, prefix); prefix += BigInt(item.lineTotalRappen); }
  const selected = new Set<string>();
  return selections.map((selection) => {
    assertIdentifier(selection.saleItemId); assertQuantity(selection.quantity);
    const item = sale.items.find((candidate) => candidate.id === selection.saleItemId);
    if (item === undefined || selected.has(item.id)) throw new DomainError('INVALID_INPUT', 'Refund selections must name distinct original sale lines.');
    selected.add(item.id); const offset = refunded.get(item.id) ?? 0;
    if (!Number.isSafeInteger(offset) || offset + selection.quantity > item.quantity) throw new DomainError('REFUND_LIMIT', 'Refund quantity exceeds the remaining original quantity.');
    const base = BigInt(item.unitPriceRappen) * BigInt(selection.quantity);
    const start = (prefixes.get(item.id) ?? 0n) + BigInt(item.unitPriceRappen) * BigInt(offset);
    const end = start + base;
    const amount = sale.subtotalRappen === 0 ? 0n : end * BigInt(sale.actualPaidRappen) / BigInt(sale.subtotalRappen) - start * BigInt(sale.actualPaidRappen) / BigInt(sale.subtotalRappen);
    return { saleItemId: item.id, quantity: selection.quantity, unitOffset: offset, unitPriceRappen: item.unitPriceRappen, baseRappen: Number(base), roundingAllocationRappen: Number(amount - base), amountRappen: Number(amount) };
  });
}
export function validateRefund(refund: Refund): void {
  assertIdentifier(refund.id); assertIdentifier(refund.idempotencyKey); assertIdentifier(refund.attemptId); assertIdentifier(refund.saleId); assertPaymentMethod(refund.method);
  assertFinancialTimestamp(refund.confirmedAt); assertFinancialTimestamp(refund.completedAt); assertRappen(refund.amountRappen);
  if (refund.operatorConfirmed !== true || refund.items.length === 0) throw new DomainError('INVALID_INPUT', 'Refund requires confirmation and original items.');
  let total = 0; const ids = new Set<string>();
  for (const item of refund.items) {
    assertIdentifier(item.saleItemId); assertQuantity(item.quantity); assertRappen(item.unitOffset); assertRappen(item.unitPriceRappen); assertRappen(item.baseRappen); assertRappen(item.amountRappen);
    if (ids.has(item.saleItemId) || BigInt(item.unitPriceRappen) * BigInt(item.quantity) !== BigInt(item.baseRappen) || !Number.isSafeInteger(item.roundingAllocationRappen) || BigInt(item.baseRappen) + BigInt(item.roundingAllocationRappen) !== BigInt(item.amountRappen)) throw new DomainError('INVALID_INPUT', 'Invalid refund item allocation.');
    ids.add(item.saleItemId); total = addMoney(total, item.amountRappen);
  }
  if (total !== refund.amountRappen || refund.method === 'cash' && total % 5 !== 0) throw new DomainError('INVALID_INPUT', 'Refund total or cash denomination is invalid.');
}
export function validateRefundAttempt(attempt: RefundAttempt): void {
  assertIdentifier(attempt.id); assertIdentifier(attempt.idempotencyKey); assertIdentifier(attempt.saleId); assertPaymentMethod(attempt.method); assertFinancialTimestamp(attempt.createdAt);
  if (!['prepared', 'reported', 'completed', 'uncertain', 'failed', 'excluded'].includes(attempt.status)) throw new DomainError('INVALID_INPUT', 'Invalid refund attempt state.');
  validateRefund({ id: attempt.id, idempotencyKey: attempt.idempotencyKey, attemptId: attempt.id, saleId: attempt.saleId, items: attempt.items, amountRappen: attempt.amountRappen, method: attempt.method, operatorConfirmed: true, confirmedAt: attempt.reportedAt ?? attempt.createdAt, completedAt: attempt.createdAt });
  if (attempt.reportedAt !== null) assertFinancialTimestamp(attempt.reportedAt);
  if (['reported', 'uncertain'].includes(attempt.status) && attempt.reportedAt === null) throw new DomainError('INVALID_INPUT', 'Refund assertion timestamp is missing.');
  if ((attempt.status === 'completed') !== (attempt.refundId !== null) || attempt.status === 'completed' && attempt.reportedAt === null || attempt.status === 'prepared' && attempt.reportedAt !== null) throw new DomainError('INVALID_INPUT', 'Inconsistent refund confirmation state.');
  if (attempt.refundId !== null) assertIdentifier(attempt.refundId);
}
export function validateRefundHistory(sale: FinancialSale, refunds: readonly Refund[]): void {
  const prior: Refund[] = []; let total = 0; const ids = new Set<string>(); const keys = new Set<string>();
  for (const refund of refunds) {
    validateRefund(refund);
    if (refund.saleId !== sale.id || ids.has(refund.id) || keys.has(refund.idempotencyKey)) throw new DomainError('INVALID_INPUT', 'Invalid refund history identity.');
    ids.add(refund.id); keys.add(refund.idempotencyKey);
    const expected = quoteRefundItems(sale, prior, refund.items);
    if (expected.length !== refund.items.length || expected.some((item, index) => {
      const actual = refund.items[index];
      return actual === undefined || item.saleItemId !== actual.saleItemId || item.quantity !== actual.quantity || item.unitOffset !== actual.unitOffset || item.unitPriceRappen !== actual.unitPriceRappen || item.baseRappen !== actual.baseRappen || item.roundingAllocationRappen !== actual.roundingAllocationRappen || item.amountRappen !== actual.amountRappen;
    })) throw new DomainError('INVALID_INPUT', 'Persisted refund does not match historical unit allocations.');
    total = addMoney(total, refund.amountRappen); prior.push(refund);
  }
  if (total > sale.actualPaidRappen) throw new DomainError('REFUND_LIMIT', 'Cumulative refunds exceed the actual payment.');
}
