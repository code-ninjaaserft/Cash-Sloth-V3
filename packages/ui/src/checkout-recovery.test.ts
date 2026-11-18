import { describe, expect, it, vi } from 'vitest';
import type { CheckoutAttempt, PosApi, Sale } from '@cash-sloth/contracts';
import { restoreCashConfirmation, submitCashConfirmation } from './checkout-recovery.js';
import { CASH_RECOVERY_KEY, clearCashRecovery, readCashRecovery, saveCashRecovery } from './recovery-marker.js';

function memoryStorage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string): string | null => records.get(key) ?? null,
    setItem: (key: string, value: string): void => { records.set(key, value); },
    removeItem: (key: string): void => { records.delete(key); },
  };
}

const attempt: CheckoutAttempt = {
  idempotencyKey: 'attempt-1', cartId: 'cart-1', cartRevision: 1,
  subtotalRappen: 247, roundingAdjustmentRappen: -2, amountDueRappen: 245,
  status: 'completed', cashReceivedRappen: 500, confirmedAt: '2026-11-11T12:00:00.000Z',
  saleId: 'sale-1', createdAt: '2026-11-11T11:59:00.000Z',
};
const sale: Sale = {
  id: 'sale-1', idempotencyKey: 'attempt-1', cartId: 'cart-1', cartRevision: 1,
  completedAt: '2026-11-11T12:00:00.000Z',
  items: [{ id: 'line-1', productId: 'product-1', variantId: 'variant-1', productName: 'Chocolate', variantName: 'Default', unitPriceRappen: 247, quantity: 1, lineTotalRappen: 247 }],
  subtotalRappen: 247, roundingAdjustmentRappen: -2, amountDueRappen: 245,
  payment: { method: 'cash', cashReceivedRappen: 500, cashAppliedRappen: 245, changeRappen: 255, operatorConfirmed: true, confirmedAt: '2026-11-11T12:00:00.000Z' },
};
const request = { idempotencyKey: 'attempt-1', cashReceivedRappen: 500, operatorConfirmed: true } as const;

describe('renderer cash confirmation recovery', () => {
  it('refuses to submit payment when the recovery pointer cannot be persisted', () => {
    const completeSale = vi.fn<PosApi['completeSale']>();
    const storage = { setItem: (): never => { throw new Error('storage full'); } };
    expect(() => submitCashConfirmation({ completeSale }, storage, request)).toThrow('storage full');
    expect(completeSale).not.toHaveBeenCalled();
  });

  it('reconciles a committed sale after a lost reply without submitting another confirmation', async () => {
    const storage = memoryStorage();
    const completeSale = vi.fn<PosApi['completeSale']>().mockImplementation(async () => {
      expect(readCashRecovery(storage)).toEqual({ idempotencyKey: 'attempt-1', cashReceivedRappen: 500 });
      throw new Error('reply lost after database commit');
    });
    await expect(submitCashConfirmation({ completeSale }, storage, request)).rejects.toThrow('reply lost');
    const reconcileCheckout = vi.fn<PosApi['reconcileCheckout']>().mockResolvedValue({ ok: true, value: { attempt, sale } });
    const restored = await restoreCashConfirmation({ reconcileCheckout }, storage);
    expect(restored?.result).toEqual({ ok: true, value: { attempt, sale } });
    expect(reconcileCheckout).toHaveBeenCalledWith({ idempotencyKey: 'attempt-1' });
    expect(completeSale).toHaveBeenCalledTimes(1);
    expect(readCashRecovery(storage)?.idempotencyKey).toBe('attempt-1');
  });

  it('retains the reference after a host-reported failure or confirmed response until receipt acknowledgement', async () => {
    const storage = memoryStorage();
    const completeSale = vi.fn<PosApi['completeSale']>().mockResolvedValueOnce({ ok: false, error: { code: 'COMPLETION_UNCERTAIN', message: 'Check the result.' } }).mockResolvedValueOnce({ ok: true, value: sale });
    const first = await submitCashConfirmation({ completeSale }, storage, request);
    expect(first.ok).toBe(false);
    expect(readCashRecovery(storage)).toEqual({ idempotencyKey: 'attempt-1', cashReceivedRappen: 500 });
    const second = await submitCashConfirmation({ completeSale }, storage, request);
    expect(second.ok).toBe(true);
    expect(readCashRecovery(storage)?.idempotencyKey).toBe('attempt-1');
    expect(completeSale.mock.calls.map(([argument]) => argument)).toEqual([request, request]);
  });

  it.each([
    'invalid JSON', 'null', '{}', '{"idempotencyKey":"../bad","cashReceivedRappen":500}',
    '{"idempotencyKey":"attempt-1","cashReceivedRappen":-1}',
    '{"idempotencyKey":"attempt-1","cashReceivedRappen":5.5}',
    '{"idempotencyKey":"attempt-1","cashReceivedRappen":9007199254740992}',
    '{"idempotencyKey":"attempt-1","cashReceivedRappen":500,"unexpected":true}',
  ])('does not call the host for a malformed persisted reference: %s', async (raw) => {
    const storage = memoryStorage();
    storage.setItem(CASH_RECOVERY_KEY, raw);
    const reconcileCheckout = vi.fn<PosApi['reconcileCheckout']>();
    await expect(restoreCashConfirmation({ reconcileCheckout }, storage)).rejects.toThrow();
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });

  it('restores a prepared reference read-only without inferring cash receipt', async () => {
    const storage = memoryStorage();
    saveCashRecovery(storage, { idempotencyKey: 'attempt-1', cashReceivedRappen: null });
    const prepared = { ...attempt, status: 'prepared' as const, cashReceivedRappen: null, confirmedAt: null, saleId: null };
    const reconcileCheckout = vi.fn<PosApi['reconcileCheckout']>().mockResolvedValue({ ok: true, value: { attempt: prepared, sale: null } });
    const restored = await restoreCashConfirmation({ reconcileCheckout }, storage);
    expect(restored?.marker.cashReceivedRappen).toBeNull();
    expect(restored?.result).toEqual({ ok: true, value: { attempt: prepared, sale: null } });
  });

  it('does not erase an unreadable recovery reference when acknowledging an older receipt', () => {
    const storage = memoryStorage();
    storage.setItem(CASH_RECOVERY_KEY, 'unreadable checkout reference');
    expect(() => clearCashRecovery(storage, 'older-receipt-key')).toThrow();
    expect(storage.getItem(CASH_RECOVERY_KEY)).toBe('unreadable checkout reference');
  });

  it('clears only the reference matching the acknowledged receipt or cancelled prepared checkout', () => {
    const storage = memoryStorage();
    saveCashRecovery(storage, { idempotencyKey: 'attempt-1', cashReceivedRappen: 500 });
    expect(() => clearCashRecovery(storage, 'older-receipt-key')).toThrow('different checkout');
    expect(readCashRecovery(storage)?.idempotencyKey).toBe('attempt-1');
    clearCashRecovery(storage, 'attempt-1');
    expect(readCashRecovery(storage)).toBeNull();
  });
});
