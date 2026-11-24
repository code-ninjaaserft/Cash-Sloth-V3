import { TicketdeskButton } from './ticketdesk-button.js';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { TICKETS_CONTRACTS, TicketCodeSchema, type TicketdeskControlApi, type TicketInfo, type TicketsApi } from '@cash-sloth/contracts';
import { operationStorage } from './operation-storage.js';
import { TicketPaper } from './ticket-preview.js';
import { t, localeTag } from './preferences.js';
const defaultRecoveryKey = 'cash-sloth.ticket-redemption.v1';
type Request = Parameters<TicketsApi['redeem']>[0];
function readPending(recoveryKey: string): { request: Request | null; invalid: boolean } {
 try { const raw = operationStorage.getItem(recoveryKey); if (!raw) return { request: null, invalid: false }; const parsed = TICKETS_CONTRACTS.redeem.request.safeParse(JSON.parse(raw) as unknown); return parsed.success ? { request: parsed.data, invalid: false } : { request: null, invalid: true }; }
 catch { return { request: null, invalid: true }; }
}
export function TicketsView({ api, title = 'Redeem tickets', recoveryKey = defaultRecoveryKey, ticketdesk, admin }: { admin?: TicketsApi | undefined; api: Pick<TicketsApi, 'lookup' | 'redeem'>; title?: string; recoveryKey?: string; ticketdesk?: TicketdeskControlApi | undefined }): React.JSX.Element {
 const [initial] = useState(() => readPending(recoveryKey)), [pending, setPending] = useState<Request | null>(initial.request), [invalid, setInvalid] = useState(initial.invalid);
 const [code, setCode] = useState(initial.request?.code ?? ''), [ticket, setTicket] = useState<TicketInfo | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
 const running = useRef(false);
 const codeInput = useRef<HTMLInputElement>(null);
 useLayoutEffect(() => { if (notice && !busy && !pending) { codeInput.current?.focus(); codeInput.current?.select(); } }, [notice, busy, pending]);
 const updateTicket=async(action:()=>ReturnType<TicketsApi['invalidate']>):Promise<void>=>{
  if(running.current)return;running.current=true;setBusy(true);setNotice(null);setError(null);
  try{const result=await action();if(result.ok)setTicket(result.value);else setError(t(result.error.message));}catch{setError(t('Ticket could not be checked. Try again.'));}finally{running.current=false;setBusy(false);}
 };
 const lookup = async (): Promise<void> => {
  if (running.current) return; setNotice(null); setError(null); setTicket(null);
  const normalized = code.trim().toUpperCase(); if (!TicketCodeSchema.safeParse(normalized).success) { setError(t('Enter a valid ticket code.')); return; }
  running.current=true; setBusy(true);
  try { const result = await api.lookup({ code: normalized }); if (result.ok) { setTicket(result.value); setCode(normalized); } else setError(t(result.error.message)); }
  catch { setError(t('Ticket could not be checked. Try again.')); }
  finally { running.current=false; setBusy(false); }
 };
 const redeem = async (): Promise<void> => {
  if (running.current || invalid || (!pending && (!ticket || ticket.status !== 'valid'))) return;
  running.current=true; setBusy(true); setError(null); setNotice(null);
  const request: Request = pending ?? { code: ticket!.code, expectedUses: ticket!.redemptions.length, operationId: window.crypto.randomUUID(), operatorConfirmed: true };
  try {
   operationStorage.setItem(recoveryKey, JSON.stringify(request)); setPending(request);
   const result = await api.redeem(request);
   if (result.ok) { setTicket(result.value); operationStorage.removeItem(recoveryKey); setPending(null); setNotice(t('Ticket successfully redeemed.')); }
   else { setError(t(result.error.message)); if (!['COMMIT_UNCERTAIN','STORAGE_ERROR'].includes(result.error.code)) { operationStorage.removeItem(recoveryKey); setPending(null); setTicket(null); } }
  } catch { setError(t('Ticket redemption could not be confirmed. Retry the same reference.')); }
  finally { running.current=false; setBusy(false); }
 };
 return <main className="pos-content tickets-view"><header><h1>{t(title)}</h1><p>{t('Scan a ticket or enter its code, then confirm one redemption. Tickets are valid only on this device.')}</p>{ticketdesk && <TicketdeskButton api={ticketdesk} translate={t} />}</header><form className="ticket-lookup" onSubmit={(event) => { event.preventDefault(); void lookup(); }}><label>{t('Ticket code')}<input ref={codeInput} autoFocus autoComplete="off" spellCheck={false} value={code} disabled={busy || pending !== null} onChange={(event) => { setCode(event.target.value); setTicket(null); setNotice(null); }} /></label><button type="submit" disabled={busy}>{t('Check ticket')}</button></form>
 {error && <p role="alert" className="pos-error">{error}</p>}{notice && <p role="status">{notice}</p>}
 {invalid && <section><p role="alert">{t('An invalid ticket reference was found. Check the ticket usage before redeeming again.')}</p><button type="button" onClick={() => { operationStorage.removeItem(recoveryKey); setInvalid(false); }}>{t('Clear invalid ticket reference')}</button></section>}
 {pending && <p>{t('A redemption needs confirmation. Retry the same reference; it cannot consume another use twice.')}</p>}
 {ticket && <div className={'ticket-status ticket-status-' + ticket.status}><strong>{t(ticket.status === 'valid' ? 'Valid ticket' : ticket.status === 'used' ? 'Fully redeemed' : ticket.status==='revoked'?'Ticket invalidated':ticket.status==='expired'?'Ticket expired':'Refunded ticket')}</strong><span>{t('Remaining uses')}: <b>{ticket.maxUses===2147483647?(ticket.status==='valid'?'∞':'0'):ticket.remainingUses+' / '+ticket.maxUses} · {t('Redemptions')}: {ticket.redemptions.length}</b></span></div>}
 {(ticket || pending) && <button type="button" className="primary-button" disabled={busy || invalid || (!pending && ticket?.status !== 'valid')} onClick={() => { void redeem(); }}>{t(pending ? 'Check / retry same redemption' : 'Redeem once')}</button>}
 {ticket && admin && <section className="ticket-admin-controls"><button type="button" disabled={busy||ticket.status==='revoked'} onClick={()=>{if(window.confirm(t('Permanently invalidate this ticket?')))void updateTicket(()=>admin.invalidate({code:ticket.code}));}}>{t('Invalidate ticket')}</button><label>{t('Valid until (optional)')}<input disabled={busy} key={ticket.expiresAt??'none'} defaultValue={ticket.expiresAt?new Date(Date.parse(ticket.expiresAt)-new Date(ticket.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0,16):''} type="datetime-local" onChange={event=>{if(event.target.value){const expiresAt=new Date(event.target.value).toISOString();void updateTicket(()=>admin.setExpiry({code:ticket.code,expiresAt}));}}} /></label>{ticket.expiresAt&&<p>{t('Valid until')}: {new Date(ticket.expiresAt).toLocaleString(localeTag())}</p>}<button type="button" disabled={busy} onClick={()=>{void updateTicket(()=>admin.setExpiry({code:ticket.code,expiresAt:null}));}}>{t('No expiry date')}</button></section>}
 {ticket && <div className="ticket-inspection"><TicketPaper ticket={ticket} /><section><h2>{t('Redemption history')}</h2>{ticket.redemptions.length ? <ol>{ticket.redemptions.map((entry) => <li key={entry.operationId}>{new Date(entry.redeemedAt).toLocaleString(localeTag(), { timeZone: 'Europe/Zurich' })}</li>)}</ol> : <p>{t('Not redeemed yet.')}</p>}</section></div>}
 </main>;
}
