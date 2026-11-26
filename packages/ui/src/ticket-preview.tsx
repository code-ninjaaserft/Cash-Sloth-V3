import React, { useCallback, useEffect, useState } from 'react';
import type { TicketInfo, TicketsApi } from '@cash-sloth/contracts';
import type { Ticket } from '@cash-sloth/domain';
import { t, localeTag } from './preferences.js';
import { variantLabel } from './catalog-ui.js';
import { TicketBarcode } from './ticket-barcode.js';
export function TicketPaper({ ticket }: { ticket: Ticket }): React.JSX.Element {
 return <article className="ticket-paper" aria-label={t('Ticket')}><header><strong>{ticket.eventTitle ?? 'Cash Sloth V3'}</strong><span className="document-kind">{t('Ticket')}</span>{ticket.mode === 'demo' && <strong>{t('Demo ticket')}</strong>}</header><h3>{ticket.productName}{ticket.variantName === 'Default' ? '' : ' — ' + variantLabel(ticket.variantName)}</h3><p>{t('Issued at')}: {new Date(ticket.issuedAt).toLocaleString(localeTag(), { timeZone: 'Europe/Zurich' })}</p><p>{t('Allowed redemptions')}: <strong>{ticket.maxUses===2147483647?t('Unlimited'):ticket.maxUses}</strong></p><TicketBarcode code={ticket.code} /><code>{ticket.code}</code></article>;
}
export function TicketBatch({ api, saleId }: { api: TicketsApi; saleId: string }): React.JSX.Element | null {
 const [tickets, setTickets] = useState<readonly TicketInfo[]>([]), [selected, setSelected] = useState(0), [error, setError] = useState(false);
 const load = useCallback(async () => { try { const result = await api.listForSale({ saleId }); if (!result.ok) { setError(true); return; } setTickets(result.value); setError(false); } catch { setError(true); } }, [api, saleId]);
 useEffect(() => { void load(); }, [load]);
 if (error) return <section><p role="alert">{t('Tickets could not be loaded. The sale remains saved.')}</p><button type="button" onClick={() => { void load(); }}>{t('Load tickets again')}</button></section>;
 if (!tickets.length) return null;
 const ticket = tickets[selected] ?? tickets[0]!;
 return <section className="ticket-batch"><h2>{t('Tickets')} ({tickets.length})</h2><p>{t('One individual ticket was saved for each unit. Reopening shows the same barcodes.')}</p><label>{t('Ticket preview')}<select aria-label={t('Ticket preview')} value={Math.min(selected, tickets.length-1)} onChange={(event) => setSelected(Number(event.target.value))}>{tickets.map((entry,index) => <option key={entry.code} value={index}>{index+1}. {entry.productName} — {entry.code}</option>)}</select></label><TicketPaper ticket={ticket} /><button type="button" className="primary-button" disabled>{t('Print tickets')}</button><p>{t('80 mm ticket preview. Printer connection will be added later.')}</p></section>;
}
