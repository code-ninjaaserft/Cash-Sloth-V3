import { describe, expect, it, vi } from 'vitest';
import { PAYMENTS_IPC_CONTRACTS, type PaymentsMethod } from '@cash-sloth/contracts';
import { handleValidatedIpc, type RuntimeParser, type SenderIdentity } from './ipc-security.js';

const trusted: SenderIdentity = { webContentsId: 1, frameProcessId: 2, frameRoutingId: 3, url: 'file:///pos/index.html' };
const requests: Record<PaymentsMethod, unknown> = {
  completeTeam: {sessionId:'session'}, listTeam: {},
  setTip: { sessionId: 'session', expectedTipRappen: 0, tipRappen: 100 },
  startCheckout: { cartId: 'cart-security', expectedRevision: 0 },
  getCheckout: { sessionId: 'checkout-security' }, getActiveCheckout: {},
  cancelCheckout: { sessionId: 'checkout-security' },
  preparePayment: { sessionId: 'checkout-security', idempotencyKey: 'payment-key', method: 'card', intendedRappen: 842 },
  confirmPayment: { attemptId: 'payment-attempt', operatorConfirmed: true },
  reportPaymentOutcome: { attemptId: 'payment-attempt', outcome: 'uncertain', reason: 'Terminal result needs investigation.', operatorConfirmed: true },
  completeCheckout: { sessionId: 'checkout-security' },
  getSaleDetails: { saleId: 'sale-security' }, listRecentSales: {},
  prepareRefund: { saleId: 'sale-security', idempotencyKey: 'refund-key', method: 'twint', items: [{ saleItemId: 'item-security', quantity: 1 }] },
  getRefundAttempt: { attemptId: 'refund-attempt' },
  confirmRefund: { attemptId: 'refund-attempt', operatorConfirmed: true },
  reportRefundOutcome: { attemptId: 'refund-attempt', outcome: 'uncertain', reason: 'Payout outcome needs investigation.', operatorConfirmed: true },
  listReconciliationCases: {},
  listReconciliationHistory: {},
  reconcile: { kind: 'payment', referenceId: 'payment-attempt', idempotencyKey: 'resolution-key', resolution: 'confirm-recorded', reason: 'Operator investigated and confirms receipt.', deliberateConfirmation: true },
};
const rejected = { ok: false, error: { code: 'TEST_FAILURE', message: 'No financial mutation executed.' } } as const;

describe.each(Object.entries(PAYMENTS_IPC_CONTRACTS))('%s financial IPC boundary', (name, definition) => {
  const contract: { request: RuntimeParser<unknown>; response: RuntimeParser<unknown> } = definition;
  const request = requests[name as PaymentsMethod];
  it('rejects other windows, subframes, processes and URLs before executing', () => {
    for (const sender of [null, { ...trusted, webContentsId: 99 }, { ...trusted, frameProcessId: 99 }, { ...trusted, frameRoutingId: 99 }, { ...trusted, url: 'https://untrusted.invalid/' }, { ...trusted, url: `${trusted.url}?untrusted` }]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(sender, trusted, [request], contract, execute)).toThrow('not authorized');
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects extra fields, malformed envelopes and wrong argument counts without executing', () => {
    for (const args of [[], [request, request], [null], [{ ...(request as object), sql: 'DELETE FROM sales' }]]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(trusted, trusted, args, contract, execute)).toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('runtime-validates accepted requests and rejects invalid success responses', () => {
    expect(handleValidatedIpc(trusted, trusted, [request], contract, () => rejected)).toEqual(rejected);
    expect(() => handleValidatedIpc(trusted, trusted, [request], contract, () => ({ ok: true, value: 'invalid' }))).toThrow('Invalid IPC response');
  });
});

describe('consequential financial request validation', () => {
  it('requires literal confirmation and a meaningful reason for local reconciliation', () => {
    const contract = PAYMENTS_IPC_CONTRACTS.reconcile;
    for (const payload of [
      { ...(requests.reconcile as object), deliberateConfirmation: false },
      { ...(requests.reconcile as object), reason: '   ' },
      { ...(requests.reconcile as object), resolution: 'delete-evidence' },
      { ...(requests.reconcile as object), administrator: true },
    ]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(trusted, trusted, [payload], contract, execute)).toThrow('Invalid IPC request');
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects noninteger, negative, unsafe and nonfinite payment amounts', () => {
    for (const intendedRappen of [-1, 0.01, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '842']) {
      const execute = vi.fn(() => rejected);
      const payload = { ...(requests.preparePayment as object), intendedRappen };
      expect(() => handleValidatedIpc(trusted, trusted, [payload], PAYMENTS_IPC_CONTRACTS.preparePayment, execute)).toThrow('Invalid IPC request');
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects unconfirmed payment and refund assertions', () => {
    for (const method of ['confirmPayment', 'confirmRefund'] as const) {
      const execute = vi.fn(() => rejected);
      const contract: { request: RuntimeParser<unknown>; response: RuntimeParser<unknown> } = PAYMENTS_IPC_CONTRACTS[method];
      expect(() => handleValidatedIpc(trusted, trusted, [{ attemptId: 'attempt', operatorConfirmed: false }], contract, execute)).toThrow('Invalid IPC request');
      expect(execute).not.toHaveBeenCalled();
    }
  });
});
