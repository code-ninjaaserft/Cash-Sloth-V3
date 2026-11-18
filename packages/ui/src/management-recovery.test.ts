import { describe, expect, it, vi } from 'vitest';
import { clearManagementRecovery, MANAGEMENT_RECOVERY_KEY, readManagementRecovery, saveManagementRecovery, submitManagementOperation } from './management-recovery.js';

function memory(initial: string | null = null) {
  let stored = initial;
  return { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; }, removeItem: () => { stored = null; } };
}
const reference = { operationId: 'catalog-operation-1', kind: 'csv' as const };

describe('catalog operation recovery reference', () => {
  it('stores only a validated operation identity and kind', () => {
    const storage = memory();
    expect(readManagementRecovery(storage)).toBeNull();
    saveManagementRecovery(storage, reference);
    expect(readManagementRecovery(storage)).toEqual(reference);
    expect(JSON.parse(storage.getItem() ?? 'null')).toEqual(reference);
    expect(MANAGEMENT_RECOVERY_KEY).toContain('.v1');
  });
  it.each(['{', '{}', 'null', '[]', '{"operationId":"../bad","kind":"csv"}', '{"operationId":"ok","kind":"unknown"}', '{"operationId":"ok","kind":"demo","sql":"DELETE"}'])('blocks malformed recovery data %s', (serialized) => {
    const storage = memory(serialized);
    expect(() => readManagementRecovery(storage)).toThrow();
    expect(() => saveManagementRecovery(storage, reference)).toThrow();
    expect(() => clearManagementRecovery(storage, reference.operationId)).toThrow();
    expect(storage.getItem()).toBe(serialized);
  });
  it('does not overwrite or acknowledge an unrelated operation', () => {
    const storage = memory(); saveManagementRecovery(storage, reference);
    expect(() => saveManagementRecovery(storage, { operationId: 'other', kind: 'demo' })).toThrow();
    expect(() => saveManagementRecovery(storage, { ...reference, kind: 'demo' })).toThrow();
    expect(() => clearManagementRecovery(storage, 'other')).toThrow();
    expect(readManagementRecovery(storage)).toEqual(reference);
    clearManagementRecovery(storage, reference.operationId);
    expect(readManagementRecovery(storage)).toBeNull();
  });
  it('saves before a write and retains the reference after a lost reply', async () => {
    const storage = memory();
    const send = vi.fn(async () => { expect(readManagementRecovery(storage)).toEqual(reference); throw new Error('Lost reply'); });
    await expect(submitManagementOperation(storage, reference, send)).rejects.toThrow('Lost reply');
    expect(send).toHaveBeenCalledOnce();
    expect(readManagementRecovery(storage)).toEqual(reference);
  });
  it('retains a successful operation reference until the matching result is acknowledged', async () => {
    const storage = memory();
    await expect(submitManagementOperation(storage, reference, async () => 'committed')).resolves.toBe('committed');
    expect(readManagementRecovery(storage)).toEqual(reference);
    clearManagementRecovery(storage, reference.operationId);
    expect(readManagementRecovery(storage)).toBeNull();
  });
  it('never submits if browser storage cannot preserve the reference', () => {
    const send = vi.fn(async () => 'written');
    const storage = { getItem: () => null, setItem: () => { throw new Error('Unavailable storage'); } };
    expect(() => submitManagementOperation(storage, reference, send)).toThrow('Unavailable storage');
    expect(send).not.toHaveBeenCalled();
  });
  it('allows startup to read a pending key without executing or clearing it', () => {
    const storage = memory(JSON.stringify(reference));
    expect(readManagementRecovery(storage)).toEqual(reference);
    expect(readManagementRecovery(storage)).toEqual(reference);
    expect(storage.getItem()).toBe(JSON.stringify(reference));
  });
});
