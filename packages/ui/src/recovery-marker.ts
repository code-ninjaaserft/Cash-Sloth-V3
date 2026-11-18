import { assertIdentifier, assertRappen } from '@cash-sloth/domain';

export const CASH_RECOVERY_KEY = 'cash-sloth.pending-cash-confirmation.v1';
export interface CashRecoveryMarker {
  readonly idempotencyKey: string;
  readonly cashReceivedRappen: number | null;
}

/** A recovery pointer only. The host database remains the financial authority. */
export function readCashRecovery(storage: Pick<Storage, 'getItem'>): CashRecoveryMarker | null {
  const serialized = storage.getItem(CASH_RECOVERY_KEY);
  if (serialized === null) return null;
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== 'object' || value === null) throw new Error('Invalid cash recovery reference.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.idempotencyKey !== 'string' ||
      !(record.cashReceivedRappen === null || typeof record.cashReceivedRappen === 'number')) {
    throw new Error('Invalid cash recovery reference.');
  }
  assertIdentifier(record.idempotencyKey);
  if (record.cashReceivedRappen !== null) assertRappen(record.cashReceivedRappen);
  return { idempotencyKey: record.idempotencyKey, cashReceivedRappen: record.cashReceivedRappen };
}

export function saveCashRecovery(storage: Pick<Storage, 'setItem'>, marker: CashRecoveryMarker): void {
  assertIdentifier(marker.idempotencyKey);
  if (marker.cashReceivedRappen !== null) assertRappen(marker.cashReceivedRappen);
  storage.setItem(CASH_RECOVERY_KEY, JSON.stringify(marker));
}

export function clearCashRecovery(storage: Pick<Storage, 'getItem' | 'removeItem'>, expectedKey: string): void {
  assertIdentifier(expectedKey);
  const marker = readCashRecovery(storage);
  if (marker === null) return;
  if (marker.idempotencyKey !== expectedKey) throw new Error('A different checkout still requires reconciliation.');
  storage.removeItem(CASH_RECOVERY_KEY);
}
