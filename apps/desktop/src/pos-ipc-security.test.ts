import { describe, expect, it, vi } from 'vitest';
import { POS_IPC_CONTRACTS, type PosMethod } from '@cash-sloth/contracts';
import { handleValidatedIpc, type RuntimeParser, type SenderIdentity } from './ipc-security.js';

const trusted: SenderIdentity = { webContentsId: 1, frameProcessId: 2, frameRoutingId: 3, url: 'file:///pos/index.html' };
const revision = { cartId: 'cart-security', expectedRevision: 0 };
const requests: Record<PosMethod, unknown> = {
  listCatalog: {}, getCart: {}, listRecentSales: {},
  addItem: { ...revision, variantId: 'variant-default' },
  setQuantity: { ...revision, lineId: 'line-security', quantity: 1 },
  removeItem: { ...revision, lineId: 'line-security' }, clearCart: revision, prepareCheckout: revision,
  completeSale: { idempotencyKey: 'checkout-security', cashReceivedRappen: 500, operatorConfirmed: true },
  reconcileCheckout: { idempotencyKey: 'checkout-security' }, getSale: { saleId: 'sale-security' },
};
const rejected = { ok: false, error: { code: 'TEST_FAILURE', message: 'No business operation executed.' } } as const;

describe.each(Object.entries(POS_IPC_CONTRACTS))('%s privileged IPC boundary', (name, definition) => {
  const contract: { request: RuntimeParser<unknown>; response: RuntimeParser<unknown> } = definition;
  const request = requests[name as PosMethod];

  it('rejects another window, subframe and URL before calling the operation', () => {
    for (const sender of [null, { ...trusted, webContentsId: 99 }, { ...trusted, frameRoutingId: 99 }, { ...trusted, url: 'https://untrusted.invalid/' }]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(sender, trusted, [request], contract, execute)).toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('rejects unexpected fields and argument envelopes before business execution', () => {
    for (const args of [[], [request, request], [null], [{ ...(request as object), unexpected: 'not allowed' }]]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(trusted, trusted, args, contract, execute)).toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('validates both the allowed request and the returned response', () => {
    expect(handleValidatedIpc(trusted, trusted, [request], contract, () => rejected)).toEqual(rejected);
    expect(() => handleValidatedIpc(trusted, trusted, [request], contract, () => ({ ok: true, value: 'invalid response' })))
      .toThrow('Invalid IPC response');
  });
});
