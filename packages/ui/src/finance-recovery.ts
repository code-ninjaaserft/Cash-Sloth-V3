import { assertIdentifier } from '@cash-sloth/domain';

export const FINANCE_RECOVERY_KEY = 'cash-sloth.financial-recovery.v1';
export interface FinanceRecoveryMarker {
  readonly kind: 'checkout' | 'refund';
  readonly reference: string;
  readonly attemptId: string | null;
  readonly confirmationSubmitted: boolean;
}
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function validateMarker(value: unknown): FinanceRecoveryMarker {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid financial recovery reference.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || !['checkout', 'refund'].includes(String(record.kind)) ||
    typeof record.reference !== 'string' || !(record.attemptId === null || typeof record.attemptId === 'string') ||
    typeof record.confirmationSubmitted !== 'boolean') throw new Error('Invalid financial recovery reference.');
  assertIdentifier(record.reference);
  if (record.attemptId !== null) assertIdentifier(record.attemptId);
  if (record.confirmationSubmitted && record.attemptId === null) throw new Error('A submitted confirmation needs its durable attempt identifier.');
  return record as unknown as FinanceRecoveryMarker;
}

/** Store identifiers and UI intent only; financial amounts remain database authority. */
export function readFinanceRecovery(storage: Pick<RecoveryStorage, 'getItem'>): FinanceRecoveryMarker | null {
  const serialized = storage.getItem(FINANCE_RECOVERY_KEY);
  return serialized === null ? null : validateMarker(JSON.parse(serialized) as unknown);
}

export function saveFinanceRecovery(storage: Pick<RecoveryStorage, 'getItem' | 'setItem'>, marker: FinanceRecoveryMarker): void {
  validateMarker(marker);
  const previous = readFinanceRecovery(storage);
  if (previous && (previous.kind !== marker.kind || previous.reference !== marker.reference)) {
    throw new Error('Another financial operation still requires review.');
  }
  if (previous?.confirmationSubmitted && previous.attemptId !== marker.attemptId) {
    throw new Error('Review the submitted attempt before preparing another payment.');
  }
  storage.setItem(FINANCE_RECOVERY_KEY, JSON.stringify(marker));
}

/** Acknowledgement can never erase an unrelated or unreadable recovery pointer. */
export function clearFinanceRecovery(storage: Pick<RecoveryStorage, 'getItem' | 'removeItem'>, kind: FinanceRecoveryMarker['kind'], reference: string): void {
  assertIdentifier(reference);
  const marker = readFinanceRecovery(storage);
  if (!marker) return;
  if (marker.kind !== kind || marker.reference !== reference) throw new Error('Another financial operation still requires review.');
  storage.removeItem(FINANCE_RECOVERY_KEY);
}

/** Persist the reference before sending once. No automatic retries belong here. */
export function submitFinancialConfirmation<T>(storage: Pick<RecoveryStorage, 'getItem' | 'setItem'>, marker: FinanceRecoveryMarker, submit: () => Promise<T>): Promise<T> {
  saveFinanceRecovery(storage, { ...marker, confirmationSubmitted: true });
  return submit();
}

/** Reads authoritative state only. In particular, restart never confirms a payment. */
export async function restoreFinancialReference<T>(storage: Pick<RecoveryStorage, 'getItem'>, inspect: (marker: FinanceRecoveryMarker) => Promise<T>): Promise<{ marker: FinanceRecoveryMarker; state: T } | null> {
  const marker = readFinanceRecovery(storage);
  return marker === null ? null : { marker, state: await inspect(marker) };
}
