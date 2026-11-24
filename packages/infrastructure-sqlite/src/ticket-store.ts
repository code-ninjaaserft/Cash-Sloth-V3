import { TicketControlsSchema, RefundSchema, TicketSchema } from '@cash-sloth/contracts';
import type { TicketStore, TicketRedemption } from '@cash-sloth/application';
import type { DatabaseConnection } from './connection.js';
import { createPosStore } from './pos-store.js';
export function createTicketStore(connection: DatabaseConnection): TicketStore {
 const { sqlite } = connection;
 const read = (row: Record<string, unknown>) => { if (typeof row['data'] !== 'string') throw new Error('Invalid ticket data.'); const ticket = TicketSchema.parse(JSON.parse(row['data']) as unknown); if ((ticket.mode === 'demo') !== ticket.code.startsWith('DS')) throw new Error('Ticket mode and barcode disagree.'); return ticket; };
 const redemption = (row: Record<string, unknown>): TicketRedemption => {
  if (typeof row['operation_id'] !== 'string' || typeof row['code'] !== 'string' || typeof row['expected_uses'] !== 'number' || typeof row['redeemed_at'] !== 'string') throw new Error('Invalid redemption record.');
  return { operationId: row['operation_id'], code: row['code'], expectedUses: row['expected_uses'], redeemedAt: row['redeemed_at'] };
 };
 return {
  controls(code) {const row=sqlite.prepare('SELECT expires_at,revoked_at FROM ticket_controls WHERE code=?').get(code);return TicketControlsSchema.parse({expiresAt:row?.['expires_at']??null,revokedAt:row?.['revoked_at']??null});},
  invalidate(code,at) {if(!sqlite.isTransaction)throw new Error('Transaction required');sqlite.prepare('INSERT INTO ticket_controls(code,revoked_at) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET revoked_at=COALESCE(ticket_controls.revoked_at,excluded.revoked_at)').run(code,at);},
  setExpiry(code,at) {if(!sqlite.isTransaction)throw new Error('Transaction required');sqlite.prepare('INSERT INTO ticket_controls(code,expires_at) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET expires_at=excluded.expires_at').run(code,at);},
  mode: connection.ticketMode ?? 'normal',
  transaction: createPosStore(connection).transaction,
  get(code) { const row = sqlite.prepare('SELECT data FROM tickets WHERE code=?').get(code); return row ? read(row) : null; },
  list(saleId) { return sqlite.prepare('SELECT data FROM tickets WHERE sale_id=? ORDER BY sale_item_id,ordinal').all(saleId).map(read); },
  redemptions(code) { return sqlite.prepare('SELECT * FROM ticket_redemptions WHERE code=? ORDER BY expected_uses').all(code).map(redemption); },
  getOperation(operationId) { const row = sqlite.prepare('SELECT * FROM ticket_redemptions WHERE operation_id=?').get(operationId); return row ? redemption(row) : null; },
  refundedQuantity(saleId, saleItemId) { return sqlite.prepare('SELECT data FROM refunds WHERE sale_id=?').all(saleId).reduce((sum, row) => { if (typeof row['data'] !== 'string') throw new Error('Invalid refund data.'); const refund = RefundSchema.parse(JSON.parse(row['data']) as unknown); return sum + refund.items.filter((item) => item.saleItemId === saleItemId).reduce((subtotal, item) => subtotal + item.quantity, 0); }, 0); },
  redeem(entry) { if (!sqlite.isTransaction) throw new Error('Redemption requires a transaction.'); sqlite.prepare('INSERT INTO ticket_redemptions(operation_id,code,expected_uses,redeemed_at) VALUES(?,?,?,?)').run(entry.operationId, entry.code, entry.expectedUses, entry.redeemedAt); },
 };
}
