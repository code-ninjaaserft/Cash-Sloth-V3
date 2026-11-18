import { assertIdentifier } from '@cash-sloth/domain';

export const MANAGEMENT_RECOVERY_KEY = 'cash-sloth.management-operation.v1';
export interface ManagementRecoveryReference {
  readonly operationId: string;
  readonly kind: 'csv' | 'demo';
}
type ReferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function validate(value: unknown): ManagementRecoveryReference {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid management recovery reference.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.operationId !== 'string' || !['csv', 'demo'].includes(String(record.kind))) throw new Error('Invalid management recovery reference.');
  assertIdentifier(record.operationId);
  return record as unknown as ManagementRecoveryReference;
}

/** Identifiers only: the committed operation ledger remains authoritative. */
export function readManagementRecovery(storage: Pick<ReferenceStorage, 'getItem'>): ManagementRecoveryReference | null {
  const serialized = storage.getItem(MANAGEMENT_RECOVERY_KEY);
  return serialized === null ? null : validate(JSON.parse(serialized) as unknown);
}

export function saveManagementRecovery(storage: Pick<ReferenceStorage, 'getItem' | 'setItem'>, reference: ManagementRecoveryReference): void {
  validate(reference);
  const existing = readManagementRecovery(storage);
  if (existing && (existing.operationId !== reference.operationId || existing.kind !== reference.kind)) throw new Error('Review the previous catalog operation before submitting another import.');
  storage.setItem(MANAGEMENT_RECOVERY_KEY, JSON.stringify(reference));
}

export function clearManagementRecovery(storage: Pick<ReferenceStorage, 'getItem' | 'removeItem'>, operationId: string): void {
  assertIdentifier(operationId);
  const reference = readManagementRecovery(storage);
  if (reference && reference.operationId !== operationId) throw new Error('A different catalog operation still needs review.');
  if (reference) storage.removeItem(MANAGEMENT_RECOVERY_KEY);
}

/** Persist before sending once; startup and navigation never invoke this helper. */
export function submitManagementOperation<T>(storage: Pick<ReferenceStorage, 'getItem' | 'setItem'>, reference: ManagementRecoveryReference, submit: () => Promise<T>): Promise<T> {
  saveManagementRecovery(storage, reference);
  return submit();
}

export class ManagementRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function unwrapManagement<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }): T {
  if (!result.ok) throw new ManagementRequestError(result.error.code, result.error.message);
  return result.value;
}
export function managementError(error: unknown): string {
  return error instanceof ManagementRequestError ? error.message : 'The operation could not be confirmed. Read its stored result before importing again.';
}
