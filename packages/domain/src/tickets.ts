import { DomainError } from './models.js';
export const MAX_TICKETS_PER_SALE = 1000;
export function assertTicketUses(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || (value > 1000 && value !== 2147483647))) throw new DomainError('INVALID_INPUT', 'Ticket uses must be an integer from 0 to 1000.');
}
export type TicketMode = 'normal' | 'demo';
export interface Ticket {
  readonly mode: TicketMode;
  readonly code: string; readonly saleId: string; readonly saleItemId: string; readonly ordinal: number;
  readonly productName: string; readonly variantName: string; readonly eventTitle: string | null;
  readonly issuedAt: string; readonly maxUses: number;
}
export function ticketStatus(maxUses: number, used: number, refunded: boolean): 'valid' | 'used' | 'refunded' {
  assertTicketUses(maxUses);
  if (maxUses < 1 || !Number.isSafeInteger(used) || used < 0 || (maxUses !== 2147483647 && used > maxUses)) throw new DomainError('INVALID_INPUT', 'Invalid ticket usage.');
  return refunded ? 'refunded' : maxUses !== 2147483647 && used >= maxUses ? 'used' : 'valid';
}
