import { describe, expect, it, vi } from 'vitest';
import { FINANCE_RECOVERY_KEY, clearFinanceRecovery, readFinanceRecovery, restoreFinancialReference, saveFinanceRecovery, submitFinancialConfirmation, type FinanceRecoveryMarker } from './finance-recovery.js';

function memoryStorage() {
  const records = new Map<string, string>();
  return { getItem: (key: string): string | null => records.get(key) ?? null, setItem: (key: string, value: string): void => { records.set(key, value); }, removeItem: (key: string): void => { records.delete(key); } };
}
const marker: FinanceRecoveryMarker = { kind: 'checkout', reference: 'session-1', attemptId: 'attempt-1', confirmationSubmitted: false };

describe('financial UI recovery pointers', () => {
  it('stores intent before the host receives the confirmation and retains it after a lost reply', async () => {
    const storage = memoryStorage();
    const submit = vi.fn(async () => { expect(readFinanceRecovery(storage)).toEqual({ ...marker, confirmationSubmitted: true }); throw new Error('reply lost'); });
    await expect(submitFinancialConfirmation(storage, marker, submit)).rejects.toThrow('reply lost');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(readFinanceRecovery(storage)?.confirmationSubmitted).toBe(true);
  });
  it('does not submit when recovery storage is unavailable', () => {
    const submit = vi.fn(async () => undefined);
    const storage = { getItem: (): null => null, setItem: (): never => { throw new Error('storage unavailable'); } };
    expect(() => submitFinancialConfirmation(storage, marker, submit)).toThrow('storage unavailable');
    expect(submit).not.toHaveBeenCalled();
  });
  it('requires explicit acknowledgement even after a successful reply', async () => {
    const storage = memoryStorage();
    await submitFinancialConfirmation(storage, marker, async () => ({ recorded: true }));
    expect(readFinanceRecovery(storage)?.attemptId).toBe('attempt-1');
    clearFinanceRecovery(storage, 'checkout', 'session-1');
    expect(readFinanceRecovery(storage)).toBeNull();
  });
  it('never replaces an unrelated checkout or refund pointer', () => {
    const storage = memoryStorage();
    saveFinanceRecovery(storage, marker);
    expect(() => saveFinanceRecovery(storage, { ...marker, kind: 'refund' })).toThrow('Another financial');
    expect(() => saveFinanceRecovery(storage, { ...marker, reference: 'session-2' })).toThrow('Another financial');
    expect(() => clearFinanceRecovery(storage, 'refund', 'session-1')).toThrow('Another financial');
    expect(readFinanceRecovery(storage)).toEqual(marker);
  });
  it('does not replace a submitted attempt with another preparation in the same session', () => {
    const storage = memoryStorage();
    saveFinanceRecovery(storage, { ...marker, confirmationSubmitted: true });
    expect(() => saveFinanceRecovery(storage, { ...marker, attemptId: 'attempt-2' })).toThrow('Review the submitted attempt');
    expect(readFinanceRecovery(storage)?.attemptId).toBe('attempt-1');
  });
  it('restores read-only and retains the same pointer even when inspection fails', async () => {
    const storage = memoryStorage();
    saveFinanceRecovery(storage, { ...marker, confirmationSubmitted: true });
    const inspect = vi.fn(async (reference: FinanceRecoveryMarker) => ({ id: reference.reference, status: 'prepared' }));
    expect((await restoreFinancialReference(storage, inspect))?.state.status).toBe('prepared');
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ ...marker, confirmationSubmitted: true });
    await expect(restoreFinancialReference(storage, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(readFinanceRecovery(storage)?.confirmationSubmitted).toBe(true);
  });
  it.each(['null', '{}', 'invalid JSON', '{"kind":"checkout","reference":"../bad","attemptId":null,"confirmationSubmitted":false}', '{"kind":"refund","reference":"refund-1","attemptId":null,"confirmationSubmitted":true}', '{"kind":"checkout","reference":"session-1","attemptId":"attempt-1","confirmationSubmitted":false,"amount":200}'])('preserves corrupt pointers without submitting or clearing: %s', (raw) => {
    const storage = memoryStorage();
    storage.setItem(FINANCE_RECOVERY_KEY, raw);
    expect(() => readFinanceRecovery(storage)).toThrow();
    expect(() => clearFinanceRecovery(storage, 'checkout', 'session-1')).toThrow();
    expect(storage.getItem(FINANCE_RECOVERY_KEY)).toBe(raw);
  });
});
