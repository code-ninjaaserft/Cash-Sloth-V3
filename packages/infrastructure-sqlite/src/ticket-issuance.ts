import { randomUUID } from 'node:crypto';
import { TicketSchema, PresetSchema } from '@cash-sloth/contracts';
import { validateCart, type CartItem } from '@cash-sloth/domain';
import type { DatabaseConnection } from './connection.js';
/** Called only inside the original sale transaction; a failed issuance rolls back the sale too. */
export function issueSaleTickets(connection: DatabaseConnection, sale: { id: string; completedAt: string; items: readonly CartItem[]; eventTitle?: string | null | undefined }): void {
 const { sqlite } = connection;
 if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='tickets' AND type='table'").get()) return;
 if (!sqlite.isTransaction) throw new Error('Ticket issuance requires the sale transaction.');
 validateCart({ id: sale.id, revision: 0, items: sale.items, subtotalRappen: sale.items.reduce((sum, item) => sum + item.lineTotalRappen, 0) });
 let eventTitle = sale.eventTitle ?? null;
 if (sale.eventTitle === undefined) { const row = sqlite.prepare('SELECT p.data FROM active_event_preset a JOIN event_presets p ON p.id=a.preset_id WHERE a.singleton=1').get(); if (typeof row?.['data'] === 'string') eventTitle = PresetSchema.parse(JSON.parse(row['data']) as unknown).name; }
 const mode = connection.ticketMode ?? 'normal';
 const insert = sqlite.prepare('INSERT INTO tickets(code,sale_id,sale_item_id,ordinal,data) VALUES(?,?,?,?,?)');
 for (const item of sale.items) if ((item.ticketUses ?? 0) > 0) for (let ordinal=1; ordinal<=item.quantity; ordinal++) {
  let code: string; do { code = (mode === 'demo' ? 'DS' : 'CS') + randomUUID().replaceAll('-', '').slice(0,14).toUpperCase(); } while (sqlite.prepare('SELECT 1 FROM tickets WHERE code=?').get(code));
  const ticket = TicketSchema.parse({ mode, code, saleId: sale.id, saleItemId: item.id, ordinal, productName: item.productName, variantName: item.variantName, eventTitle, issuedAt: sale.completedAt, maxUses: item.ticketUses });
  insert.run(code, sale.id, item.id, ordinal, JSON.stringify(ticket));
 }
}
