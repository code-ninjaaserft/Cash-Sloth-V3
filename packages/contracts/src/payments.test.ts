import { describe, expect, it } from 'vitest';
import { PAYMENTS_IPC_CONTRACTS, FinancialSaleSchema, PaymentAttemptSchema, RefundAttemptSchema } from './payments.js';

const validRequests = {
  startCheckout: { cartId: 'cart', expectedRevision: 1 }, getCheckout: { sessionId: 'session' }, getActiveCheckout: {}, cancelCheckout: { sessionId: 'session' },
  preparePayment: { sessionId: 'session', idempotencyKey: 'stable-key', method: 'card', intendedRappen: 842 }, confirmPayment: { attemptId: 'attempt', operatorConfirmed: true },
  reportPaymentOutcome: { attemptId: 'attempt', outcome: 'uncertain', reason: 'Provider outcome unknown', operatorConfirmed: true }, completeCheckout: { sessionId: 'session' },
  getSaleDetails: { saleId: 'sale' }, listRecentSales: {}, prepareRefund: { saleId: 'sale', idempotencyKey: 'refund-key', method: 'twint', items: [{ saleItemId: 'item', quantity: 1 }] },
  getRefundAttempt: { attemptId: 'refund-attempt' }, confirmRefund: { attemptId: 'refund-attempt', operatorConfirmed: true }, reportRefundOutcome: { attemptId: 'refund-attempt', outcome: 'failed', reason: 'No refund was paid', operatorConfirmed: true },
  listReconciliationCases: {}, listReconciliationHistory: {}, reconcile: { kind: 'payment', referenceId: 'attempt', idempotencyKey: 'decision-key', resolution: 'confirm-recorded', reason: 'Operator checked the original receipt', deliberateConfirmation: true },
} as const;

describe('narrow payment and refund contracts', () => {
  it.each(Object.keys(PAYMENTS_IPC_CONTRACTS) as (keyof typeof PAYMENTS_IPC_CONTRACTS)[])('%s accepts its intended request and rejects extra authority', (method) => {
    const contract = PAYMENTS_IPC_CONTRACTS[method];
    expect(contract.request.safeParse(validRequests[method]).success).toBe(true);
    expect(contract.request.safeParse({ ...validRequests[method], sql: 'DELETE FROM sales' }).success).toBe(false);
    expect(contract.request.safeParse(null).success).toBe(false);
    expect(contract.response.safeParse({ ok: false, error: { code: 'STORAGE_ERROR', message: 'Read the same recovery reference.' } }).success).toBe(true);
    expect(contract.response.safeParse({ ok: true, value: null }).success).toBe(method === 'getActiveCheckout');
  });
  it('uses unique explicit IPC channels with no generic execution operation', () => {
    const channels = Object.values(PAYMENTS_IPC_CONTRACTS).map((contract) => contract.channel);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels.every((channel) => channel.startsWith('payments:'))).toBe(true);
  });
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe monetary input %s', (intendedRappen) => {
    expect(PAYMENTS_IPC_CONTRACTS.preparePayment.request.safeParse({ ...validRequests.preparePayment, intendedRappen }).success).toBe(false);
  });
  it('requires deliberate assertions and stable identities at consequential boundaries', () => {
    expect(PAYMENTS_IPC_CONTRACTS.confirmPayment.request.safeParse({ attemptId: 'attempt', operatorConfirmed: false }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.confirmRefund.request.safeParse({ attemptId: 'attempt' }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.reconcile.request.safeParse({ ...validRequests.reconcile, deliberateConfirmation: false }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.reconcile.request.safeParse({ ...validRequests.reconcile, reason: 'ok' }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.preparePayment.request.safeParse({ ...validRequests.preparePayment, idempotencyKey: '' }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.prepareRefund.request.safeParse({ ...validRequests.prepareRefund, items: [{ saleItemId: 'item', quantity: 0 }] }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.reportPaymentOutcome.request.safeParse({ ...validRequests.reportPaymentOutcome, outcome: 'confirmed' }).success).toBe(false);
  });
  it('rejects future provider integrations and arbitrary payment methods', () => {
    expect(PAYMENTS_IPC_CONTRACTS.preparePayment.request.safeParse({ ...validRequests.preparePayment, method: 'bitcoin' }).success).toBe(false);
    expect(PAYMENTS_IPC_CONTRACTS.confirmPayment.request.safeParse({ ...validRequests.confirmPayment, providerAuthorized: true }).success).toBe(false);
  });
  it('rejects malformed persistent financial envelopes', () => {
    expect(PaymentAttemptSchema.safeParse({ id: 'attempt', status: 'confirmed', amount: 8.42 }).success).toBe(false);
    expect(FinancialSaleSchema.safeParse({ id: 'sale', payments: [], amountDueRappen: -1 }).success).toBe(false);
    expect(RefundAttemptSchema.safeParse({ id: 'refund', items: [], status: 'completed' }).success).toBe(false);
  });
});
