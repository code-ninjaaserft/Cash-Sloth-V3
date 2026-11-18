import type { PosApi, PosRequest, PosResponse } from '@cash-sloth/contracts';
import { readCashRecovery, saveCashRecovery, type CashRecoveryMarker } from './recovery-marker.js';

/** Persist first, then submit once. A lost reply retains the same recovery key. */
export function submitCashConfirmation(
  api: Pick<PosApi, 'completeSale'>,
  storage: Pick<Storage, 'setItem'>,
  request: PosRequest<'completeSale'>,
): Promise<PosResponse<'completeSale'>> {
  saveCashRecovery(storage, { idempotencyKey: request.idempotencyKey, cashReceivedRappen: request.cashReceivedRappen });
  return api.completeSale(request);
}

/** Reconciliation is read-only; restoration never resubmits a cash confirmation. */
export async function restoreCashConfirmation(
  api: Pick<PosApi, 'reconcileCheckout'>,
  storage: Pick<Storage, 'getItem'>,
): Promise<{ marker: CashRecoveryMarker; result: PosResponse<'reconcileCheckout'> } | null> {
  const marker = readCashRecovery(storage);
  if (marker === null) return null;
  return { marker, result: await api.reconcileCheckout({ idempotencyKey: marker.idempotencyKey }) };
}
