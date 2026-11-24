import { TICKETS_CONTRACTS, TicketInfoSchema, type TicketInfo } from '@cash-sloth/contracts';
import { DomainError, ticketStatus } from '@cash-sloth/domain';
import type { TicketStore } from './ticket-ports.js';
import { PersistenceError, type PosRuntime } from './ports.js';
function checked<T>(result: { success: true; data: T } | { success: false }): T {
 if (!result.success) throw new DomainError('INVALID_INPUT', 'Invalid ticket request.'); return result.data;
}
export function createTicketService(store: TicketStore, runtime: PosRuntime) {
 const assertMode = (code: string): void => {
  const mode = code.startsWith('DS') ? 'demo' : 'normal';
  if (mode !== store.mode) throw new DomainError('TICKET_MODE_MISMATCH', mode === 'demo' ? 'Demo tickets can only be redeemed in demo mode.' : 'Normal tickets can only be redeemed in normal mode.');
 };
 const info = (code: string): TicketInfo => {
  const ticket = store.get(code); if (!ticket) throw new DomainError('NOT_FOUND', 'Ticket not found on this device.');
  const entries = store.redemptions(code);
  const controls=store.controls?.(code);
  const status = controls?.revokedAt ? 'revoked' : controls?.expiresAt && Date.parse(controls.expiresAt)<=Date.parse(runtime.now()) ? 'expired' : ticketStatus(ticket.maxUses, entries.length, ticket.ordinal <= store.refundedQuantity(ticket.saleId, ticket.saleItemId));
  return TicketInfoSchema.parse({ ...ticket, expiresAt:controls?.expiresAt??null,revokedAt:controls?.revokedAt??null,status, remainingUses: status === 'valid' ? ticket.maxUses === 2147483647 ? 2147483647 : ticket.maxUses - entries.length : 0, redemptions: entries.map(({ operationId, redeemedAt }) => ({ operationId, redeemedAt })) });
 };
 const safe = <T>(operation: () => T): { ok: true; value: T } | { ok: false; error: { code: string; message: string } } => {
  try { return { ok: true, value: store.transaction(operation) }; }
  catch (failure) { return { ok: false, error: { code: failure instanceof DomainError ? failure.code : failure instanceof PersistenceError && failure.outcome === 'unknown' ? 'COMMIT_UNCERTAIN' : 'STORAGE_ERROR', message: failure instanceof DomainError ? failure.message : 'Ticket redemption could not be confirmed. Retry the same reference.' } }; }
 };
 return {
  invalidate(input:{code:string}) {return safe(()=>{const request=checked(TICKETS_CONTRACTS.invalidate.request.safeParse(input));assertMode(request.code);info(request.code);if(!store.invalidate)throw new DomainError('CONFLICT','Unavailable');store.invalidate(request.code,runtime.now());return info(request.code);});},
  setExpiry(input:{code:string;expiresAt:string|null}) {return safe(()=>{const request=checked(TICKETS_CONTRACTS.setExpiry.request.safeParse(input));assertMode(request.code);info(request.code);if(!store.setExpiry)throw new DomainError('CONFLICT','Unavailable');store.setExpiry(request.code,request.expiresAt);return info(request.code);});},
  listForSale(input: { saleId: string }) { return safe(() => { const request = checked(TICKETS_CONTRACTS.listForSale.request.safeParse(input)); return store.list(request.saleId).map((ticket) => info(ticket.code)); }); },
  lookup(input: { code: string }) { return safe(() => { const request = checked(TICKETS_CONTRACTS.lookup.request.safeParse(input)); assertMode(request.code); return info(request.code); }); },
  redeem(input: { code: string; operationId: string; expectedUses: number; operatorConfirmed: true }) { return safe(() => {
   const request = checked(TICKETS_CONTRACTS.redeem.request.safeParse(input));
   assertMode(request.code);
   const existing = store.getOperation(request.operationId);
   if (existing) { if (existing.code !== request.code || existing.expectedUses !== request.expectedUses) throw new DomainError('CONFLICT', 'This redemption reference belongs to another request.'); return info(request.code); }
   const ticket = info(request.code);
   if(ticket.status==='revoked'||ticket.status==='expired')throw new DomainError('CONFLICT',ticket.status==='revoked'?'Ticket has been invalidated.':'Ticket has expired.');
   if (ticket.status === 'refunded') throw new DomainError('CONFLICT', 'This ticket was refunded and is no longer valid.');
   if (ticket.status === 'used') throw new DomainError('CONFLICT', 'This ticket has no remaining uses.');
   if (ticket.redemptions.length !== request.expectedUses) throw new DomainError('CONFLICT', 'Ticket usage changed. Check the ticket again.');
   store.redeem({ ...request, redeemedAt: runtime.now() });
   return info(request.code);
  }); },
 };
}
