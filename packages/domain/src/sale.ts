import { validateCart } from './cart.js';
import { calculateCashPayment, calculateCashQuote } from './money.js';
import { assertIdentifier, DomainError, type CheckoutAttempt, type Sale } from './models.js';

function assertTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new DomainError('INVALID_INPUT', 'Invalid financial timestamp.');
}

export function validateCheckoutAttempt(attempt: CheckoutAttempt): void {
  assertIdentifier(attempt.idempotencyKey); assertIdentifier(attempt.cartId); assertTimestamp(attempt.createdAt);
  if (!['prepared', 'confirmed', 'completed'].includes(attempt.status)) throw new DomainError('INVALID_INPUT', 'Invalid checkout status.');
  if (!Number.isSafeInteger(attempt.cartRevision) || attempt.cartRevision < 0) throw new DomainError('INVALID_INPUT', 'Invalid checkout revision.');
  const quote = calculateCashQuote(attempt.subtotalRappen);
  if (quote.amountDueRappen !== attempt.amountDueRappen || quote.roundingAdjustmentRappen !== attempt.roundingAdjustmentRappen) throw new DomainError('INVALID_INPUT', 'Invalid checkout quote.');
  if (attempt.status === 'prepared') {
    if (attempt.cashReceivedRappen !== null || attempt.confirmedAt !== null || attempt.saleId !== null) throw new DomainError('INVALID_INPUT', 'Prepared checkout has inconsistent confirmation data.');
  } else {
    if (attempt.cashReceivedRappen === null || attempt.confirmedAt === null) throw new DomainError('INVALID_INPUT', 'Cash confirmation is missing.');
    assertTimestamp(attempt.confirmedAt);
    calculateCashPayment(attempt.amountDueRappen, attempt.cashReceivedRappen);
    if (attempt.status === 'completed') {
      if (attempt.saleId === null) throw new DomainError('INVALID_INPUT', 'Completed checkout has no sale.');
      assertIdentifier(attempt.saleId);
    } else if (attempt.saleId !== null) throw new DomainError('INVALID_INPUT', 'Uncompleted checkout has a sale identifier.');
  }
}

export function validateSale(sale: Sale): void {
  assertIdentifier(sale.id); assertIdentifier(sale.idempotencyKey);
  validateCart({ id: sale.cartId, revision: sale.cartRevision, items: sale.items, subtotalRappen: sale.subtotalRappen });
  if (sale.items.length === 0) throw new DomainError('EMPTY_CART', 'A sale must contain at least one item.');
  const quote = calculateCashQuote(sale.subtotalRappen);
  if (sale.amountDueRappen !== quote.amountDueRappen || sale.roundingAdjustmentRappen !== quote.roundingAdjustmentRappen) throw new DomainError('INVALID_INPUT', 'Invalid sale cash quote.');
  const payment = calculateCashPayment(sale.amountDueRappen, sale.payment.cashReceivedRappen);
  if (sale.payment.method !== 'cash' || sale.payment.operatorConfirmed !== true || sale.payment.cashAppliedRappen !== payment.cashAppliedRappen || sale.payment.changeRappen !== payment.changeRappen) throw new DomainError('INVALID_INPUT', 'Invalid confirmed cash payment.');
  assertTimestamp(sale.completedAt); assertTimestamp(sale.payment.confirmedAt);
}
