import { describe, expect, it, vi } from 'vitest';
import { CUSTOMER_DISPLAY_CONTRACTS } from '@cash-sloth/contracts';
import { handleValidatedIpc, type SenderIdentity } from './ipc-security.js';
const cashier: SenderIdentity = { webContentsId: 1, frameProcessId: 2, frameRoutingId: 3, url: 'file:///pos/index.html' };
const customer: SenderIdentity = { webContentsId: 4, frameProcessId: 5, frameRoutingId: 6, url: 'file:///pos/index.html?customer=1' };
describe('separate cashier and customer IPC authority', () => {
  it('rejects cashier operations from the customer window', () => {
    const run = vi.fn(() => ({ ok: true as const, value: { opened: true as const } }));
    expect(() => handleValidatedIpc(customer, cashier, [{}], CUSTOMER_DISPLAY_CONTRACTS.open, run)).toThrow('not authorized');
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects customer reads from a cashier, subframe or unexpected URL', () => {
    const run = vi.fn(() => ({ ok: false as const, error: { code: 'TEST', message: 'No read' } }));
    for (const sender of [cashier, { ...customer, frameRoutingId: 7 }, { ...customer, url: cashier.url }]) expect(() => handleValidatedIpc(sender, customer, [{}], CUSTOMER_DISPLAY_CONTRACTS.getState, run)).toThrow('not authorized');
    expect(run).not.toHaveBeenCalled();
  });
  it('validates customer requests and rejects private data in the response', () => {
    expect(CUSTOMER_DISPLAY_CONTRACTS.getState.request.safeParse({ saleId: 'private' }).success).toBe(false);
    const state = { eventTitle: null, items: [], subtotalRappen: 0, tipRappen: 0, roundingAdjustmentRappen: 0, totalRappen: 0, outstandingRappen: 0, cashReceivedRappen: null, changeRappen: null, checkoutActive: false };
    expect(CUSTOMER_DISPLAY_CONTRACTS.getState.response.safeParse({ ok: true, value: state }).success).toBe(true);
    expect(CUSTOMER_DISPLAY_CONTRACTS.getState.response.safeParse({ ok: true, value: { ...state, payments: [] } }).success).toBe(false);
  });
});
