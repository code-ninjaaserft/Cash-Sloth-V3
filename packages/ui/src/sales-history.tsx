import {OrderReference} from './order-reference.js';
import { t, localeTag } from './preferences.js';
import React, { useEffect, useRef, useState } from 'react';
import type { CashSlothApi, HistoryFilters, HistoryPage, HistorySort } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';
import { DEFAULT_HISTORY_SORT, EMPTY_HISTORY_DRAFT, historyFiltersFromDraft, historySortFromValue, type HistoryFilterDraft } from './history-ui.js';
import { Modal } from './modal.js';
import { managementError, unwrapManagement } from './management-recovery.js';

const methodLabels = { cash: 'Cash', card: 'Card', twint: 'TWINT', voucher:'Voucher', mixed: 'Mixed' } as const;
const refundLabels = { none: 'No refund', partial: 'Partial refund', full: 'Fully refunded' } as const;

export interface SalesHistoryState {
  readonly activeEventId?: string | null;
  readonly draft: HistoryFilterDraft; readonly appliedDraft: HistoryFilterDraft; readonly filters: HistoryFilters;
  readonly sort: HistorySort; readonly page: number; readonly pageSize: number;
}
export function initialSalesHistoryState(): SalesHistoryState {
  return { draft: EMPTY_HISTORY_DRAFT, appliedDraft: EMPTY_HISTORY_DRAFT, filters: historyFiltersFromDraft(EMPTY_HISTORY_DRAFT), sort: DEFAULT_HISTORY_SORT, page: 1, pageSize: 25 };
}
export function SalesHistory({ api, savedState, onStateChange, onOpen, onRemoved, onCleared }: { api: CashSlothApi; savedState: SalesHistoryState; onStateChange: (state: SalesHistoryState) => void; onOpen: (saleId: string) => Promise<void>; onRemoved?: (saleId: string) => void; onCleared?: (scope: 'event' | 'device', eventId: string | null) => void }): React.JSX.Element {
  const [scope, setScope] = useState<'event' | 'device'>(savedState.filters.scope ?? 'event');
  const [eventId, setEventId] = useState<string | null>(savedState.filters.eventId ?? null);
  const [activeEventId, setActiveEventId] = useState<string | null>(savedState.activeEventId ?? null);
  const [events, setEvents] = useState<readonly { id: string; title: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [includeRemoved, setIncludeRemoved] = useState(savedState.filters.includeRemoved ?? false);
  const [bulk, setBulk] = useState<{ scope: 'event' | 'device'; eventId: string | null; title: string; count: number; version: string; operationId: string } | null>(null);
  const [previewingRemoval, setPreviewingRemoval] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkConfirmed, setBulkConfirmed] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const removalInFlight = useRef(false);
  const [removalTarget, setRemovalTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [draft, setDraft] = useState<HistoryFilterDraft>(savedState.draft);
  const [appliedDraft, setAppliedDraft] = useState<HistoryFilterDraft>(savedState.appliedDraft);
  const [filters, setFilters] = useState<HistoryFilters>(savedState.filters);
  const [sort, setSort] = useState<HistorySort>(savedState.sort);
  const [page, setPage] = useState(savedState.page);
  const [pageSize, setPageSize] = useState(savedState.pageSize);
  const [result, setResult] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const exportInFlight = useRef(false);
  const scopedFilters = React.useMemo(() => ({ ...filters, scope, eventId, includeRemoved: scope === 'device' && includeRemoved }), [filters, scope, eventId, includeRemoved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(appliedDraft);
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const change = <K extends keyof HistoryFilterDraft>(key: K, value: HistoryFilterDraft[K]): void => { setDraft((current) => ({ ...current, [key]: value })); };
  useEffect(() => { if (ready) onStateChange({ draft, appliedDraft, filters: scopedFilters, sort, page, pageSize, activeEventId }); }, [draft, appliedDraft, scopedFilters, sort, page, pageSize, activeEventId, ready, onStateChange]);
  useEffect(() => {
    let cancelled = false;
    void api.history.getEvents({}).then((response) => {
      if (cancelled) return;
      const context = unwrapManagement(response); setEvents(context.events); setActiveEventId(context.activeEventId);
      if (savedState.activeEventId !== context.activeEventId) setEventId(context.activeEventId);
      setReady(true);
    }).catch((failure: unknown) => { if (!cancelled) { setError(managementError(failure)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, refresh]);

  useEffect(() => {
    if (!ready) return;
    const request = ++sequence.current;
    setLoading(true); setError(null);
    void api.history.search({ filters: scopedFilters, sort, page, pageSize }).then((response) => {
      if (request !== sequence.current) return;
      const found = unwrapManagement(response); setResult(found);
      if (found.total > 0 && found.items.length === 0 && page > 1) setPage(Math.max(1, Math.ceil(found.total / pageSize)));
    }).catch((failure: unknown) => { if (request === sequence.current) { setError(managementError(failure)); setResult(null); } })
      .finally(() => { if (request === sequence.current) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [api, scopedFilters, sort, page, pageSize, refresh, ready]);

  const apply = (event: React.FormEvent): void => {
    event.preventDefault();
    try { const checked = historyFiltersFromDraft(draft); setLoading(true); setFilters(checked); setAppliedDraft(draft); setPage(1); setNotice(''); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("Check the history filters.")); }
  };
  const exportHistory = (): void => {
    if (exportInFlight.current || dirty || loading || error) return;
    exportInFlight.current = true; setExporting(true); setNotice(''); setError(null);
    void api.files.exportSalesHistory({ filters: scopedFilters, sort }).then((response) => {
      const exported = unwrapManagement(response);
      setNotice(exported.cancelled ? t("Export cancelled. No files were written.") : `Exported ${exported.saleCount} sales to ${exported.directory}. ${exported.files.length} files preserve the linked sale, item, payment and refund records.`);
    }).catch((failure: unknown) => setError(managementError(failure)))
      .finally(() => { exportInFlight.current = false; setExporting(false); });
  };

  const previewRemoval = async (): Promise<void> => {
    if (previewingRemoval || removing) return;
    setPreviewingRemoval(true); setError(null);
    const targetId = scope === 'device' ? null : eventId;
    try {
      const preview = unwrapManagement(await api.history.previewRemoval({ scope, eventId: targetId }));
      setBulk({ scope, eventId: targetId, title: scope === 'device' ? t('Device history') : events.find((item) => item.id === targetId)?.title ?? t('Without event / older sales'), count: preview.count, version: preview.version, operationId: window.crypto.randomUUID() });
      setBulkReason(''); setBulkConfirmed(false); setBulkError(null);
    } catch (failure) { setError(managementError(failure)); }
    finally { setPreviewingRemoval(false); }
  };
  return <main className="management-workspace sales-history-workspace">
    <header className="pos-heading"><div><span className="pos-label">{t("Management & operations")}</span><h1>{t("Sales history")}</h1><p>{t("Find original sales and inspect their separate payment and refund records.")}</p></div><button type="button" className="subtle-button" disabled={exporting || loading || dirty || !!error} onClick={exportHistory}>{exporting ? t("Preparing export…") : t("Export filtered history")}</button></header>
    <section className="management-panel history-scope" aria-label={t('History view')}>
      <div className="form-actions"><button type="button" className="subtle-button" aria-pressed={scope === 'event'} onClick={() => { setScope('event'); setPage(1); }}>{t('Event history')}</button><button type="button" className="subtle-button" aria-pressed={scope === 'device'} onClick={() => { setScope('device'); setPage(1); }}>{t('Device history')}</button></div>
      {scope === 'event' ? <label>{t('Event')}<select aria-label={t('History event')} value={eventId ?? ''} disabled={!ready} onChange={(event) => { setEventId(event.target.value || null); setPage(1); }}><option value="">{t('Without event / older sales')}</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title}{events.filter((other) => other.title === item.title).length > 1 ? ' · ' + item.id : ''}</option>)}</select></label> : <><p>{t('All events recorded on this device.')}</p><label className="inline-check"><input type="checkbox" checked={includeRemoved} onChange={(event) => { setIncludeRemoved(event.target.checked); setPage(1); }} />{t('Show deleted sales')}</label></>}
      <button type="button" className="subtle-button history-clear" disabled={!ready || loading || exporting || removing || previewingRemoval} onClick={() => { void previewRemoval(); }}>{t(scope === 'event' ? 'Clear event history' : 'Clear entire device history')}</button>
      <p className="form-hint">{t('Older sales without a definite event assignment remain available under Without event / older sales and Device history.')}</p>
    </section>
    <form className="management-panel history-filters" onSubmit={apply} aria-label={t("Sales history filters")}>
      <div className="management-form-grid">
        <label>{t("From date (Switzerland)")}<input type="date" value={draft.dateFrom} onChange={(event) => change('dateFrom', event.target.value)} /></label>
        <label>{t("Through date (Switzerland)")}<input type="date" value={draft.dateTo} onChange={(event) => change('dateTo', event.target.value)} /></label>
        <label>{t("Payment method")}<select aria-label={t("Payment method filter")} value={draft.paymentMethod} onChange={(event) => change('paymentMethod', event.target.value as HistoryFilterDraft['paymentMethod'])}><option value="all">{t("All methods")}</option><option value="cash">{t("Cash")}</option><option value="card">{t("Card")}</option><option value="twint">TWINT</option><option value="mixed">{t("Mixed")}</option></select></label>
        <label>{t("Refund status")}<select aria-label={t("Refund status filter")} value={draft.refundStatus} onChange={(event) => change('refundStatus', event.target.value as HistoryFilterDraft['refundStatus'])}><option value="all">{t("All refund states")}</option><option value="none">{t("No refund")}</option><option value="partial">{t("Partial refund")}</option><option value="full">{t("Fully refunded")}</option></select></label>
        <label>{t("Minimum total (CHF)")}<input type="text" inputMode="decimal" value={draft.minimum} placeholder={t("No minimum")} onChange={(event) => change('minimum', event.target.value)} /></label>
        <label>{t("Maximum total (CHF)")}<input type="text" inputMode="decimal" value={draft.maximum} placeholder={t("No maximum")} onChange={(event) => change('maximum', event.target.value)} /></label>
        <label>{t("Sale identifier")}<input type="search" maxLength={128} value={draft.saleId} placeholder={t("Full or partial sale ID")} onChange={(event) => change('saleId', event.target.value)} /></label>
        <label>{t('Order number')}<input type="search" inputMode="numeric" maxLength={3} value={draft.orderNumber??''} onChange={e=>change('orderNumber',e.target.value)}/></label>
        <label>{t('Table / name')}<input type="search" maxLength={80} value={draft.serviceLabel??''} onChange={e=>change('serviceLabel',e.target.value)}/></label>
        <label>{t('Receipt barcode')}<input type="search" maxLength={16} autoComplete="off" spellCheck={false} value={draft.receiptCode??''} placeholder={t('Scan or enter receipt code')} onChange={e=>change('receiptCode',e.target.value)}/></label>
        <label>{t("Product or variant")}<input type="search" maxLength={200} value={draft.productQuery} placeholder={t("Historical name or identifier")} onChange={(event) => change('productQuery', event.target.value)} /></label>
      </div>
      <div className="form-actions"><button type="submit" className="primary-button">{t("Apply history filters")}</button><button type="button" className="subtle-button" onClick={() => { setDraft(EMPTY_HISTORY_DRAFT); setAppliedDraft(EMPTY_HISTORY_DRAFT); setFilters(historyFiltersFromDraft(EMPTY_HISTORY_DRAFT)); setPage(1); setNotice(''); }}>{t("Clear history filters")}</button><button type="button" className="subtle-button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{t("Refresh history")}</button></div>
      <p className="form-hint">{t("Dates include the full selected days in Europe/Zurich, including daylight-saving changes. Totals filter the original amount actually paid. Export uses the displayed filters.")}{dirty && ' Apply your edited filters before exporting.'}</p>
    </form>
    {error && <div role="alert" className="pos-error">{error}</div>}
    <p role="status" className="catalog-save-status">{notice}</p>
    <div className="history-toolbar"><p role="status" aria-live="polite" data-testid="history-result-count">{loading ? t("Reading sales history…") : `${result?.total ?? 0} ${t(result?.total === 1 ? 'matching sale' : 'matching sales')}`}</p><label>{t("Sort")}<select aria-label={t("Sort sales")} value={`${sort.field}-${sort.direction}`} onChange={(event) => { setSort(historySortFromValue(event.target.value)); setPage(1); }}><option value="date-desc">{t("Newest first")}</option><option value="date-asc">{t("Oldest first")}</option><option value="total-desc">{t("Highest total first")}</option><option value="total-asc">{t("Lowest total first")}</option></select></label><label>{t("Per page")}<select aria-label={t("Sales per page")} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
    <section className="history-results" aria-label={t("Recent completed sales")} aria-busy={loading}>
      {!loading && result?.items.length === 0 && <div className="pos-empty">{t("No completed sales match these filters.")}</div>}
      {result?.items.map((sale) => <article className="history-sale-entry" key={sale.id}><button type="button" className="history-sale-row" key={sale.id} aria-label={`Open sale ${sale.id}`} disabled={loading || opening !== null} onClick={() => { setOpening(sale.id); void onOpen(sale.id).catch((failure: unknown) => setError(managementError(failure))).finally(() => setOpening(null)); }}>
        <span className="history-sale-main"><strong>{new Date(sale.completedAt).toLocaleString(localeTag(), { timeZone: 'Europe/Zurich' })}</strong><small className="history-sale-id">{sale.id}</small><span>{sale.itemSummary}</span><OrderReference order={sale.order}/><small className="history-event-title">{t('Event')}: {sale.eventTitle ?? t('Without event / older sales')}</small>{sale.removedAt && <small className="history-warning">{t('Deleted from history')} · {new Date(sale.removedAt).toLocaleString(localeTag())} · {sale.removalReason}</small>}</span>
        <span><strong>{formatChf(sale.actualPaidRappen)}</strong><small>{t(methodLabels[sale.paymentMethod])}</small>{(sale.tipRappen ?? 0) > 0 && <small>{t("Tip")}: {formatChf(sale.tipRappen ?? 0)}</small>}</span>
        <span><span className={`management-badge ${sale.refundStatus === 'none' ? '' : 'muted'}`}>{t(refundLabels[sale.refundStatus])}</span><small>{t("Refunded")}{' '}{formatChf(sale.refundedRappen)}{' '}{t("· Remaining")}{' '}{formatChf(sale.refundableRappen)}</small>{sale.unresolvedRefundCount > 0 && <small className="history-warning">{sale.unresolvedRefundCount}{' '}{t("refund outcome(s) need review")}</small>}{sale.reconciliationCount > 0 && <small>{sale.reconciliationCount}{' '}{t("reconciliation action(s)")}</small>}</span>
      </button>{<button type="button" className="subtle-button history-delete-sale" aria-label={'Delete sale ' + sale.id} disabled={loading || removing || sale.unresolvedRefundCount > 0} onClick={() => { setRemovalTarget(sale.id); setReason(''); setRemovalError(null); }}>{t('Delete sale')}</button>}</article>)}
    </section>
    {bulk && <Modal title={t(bulk.scope === 'event' ? 'Clear event history?' : 'Clear entire device history?')} closeDisabled={removing} onClose={() => { if (!removing) setBulk(null); }}>
      <p><strong>{bulk.title}</strong> · {bulk.count} {t(bulk.count === 1 ? 'sale' : 'sales')}</p>
      <p>{t(bulk.scope === 'event' ? 'All sales and receipts for this event will be permanently deleted. Other events and the preset remain unchanged.' : 'All sales and receipts from every event on this device will be permanently deleted. Products, categories and presets remain unchanged.')}</p>
      <p>{t('This includes every page and ignores search filters. Deleted amounts no longer count in income or exports.')}</p>
      <form className="editor-form" onSubmit={(event) => {
        event.preventDefault(); if (removalInFlight.current || !bulkConfirmed || !bulkReason.trim() || bulk.count === 0) return;
        removalInFlight.current = true; setRemoving(true); setBulkError(null);
        void api.history.removeHistory({ scope: bulk.scope, eventId: bulk.eventId, operationId: bulk.operationId, expectedVersion: bulk.version, reason: bulkReason.trim() }).then((response) => {
          unwrapManagement(response); onCleared?.(bulk.scope, bulk.eventId); setBulk(null); setPage(1); setNotice(t('History permanently cleared.')); setRefresh((value) => value + 1);
        }).catch((failure: unknown) => setBulkError(managementError(failure))).finally(() => { removalInFlight.current = false; setRemoving(false); });
      }}>
        {bulkError && <p className="pos-error" role="alert">{bulkError}</p>}
        <label>{t('Reason for deletion')}<textarea required maxLength={1000} disabled={removing} value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} /></label>
        <label className="inline-check"><input type="checkbox" disabled={removing} checked={bulkConfirmed} onChange={(event) => setBulkConfirmed(event.target.checked)} />{t('I confirm permanent deletion of this entire history.')}</label>
        <div className="form-actions"><button type="submit" className="primary-button" disabled={removing || !bulkConfirmed || !bulkReason.trim() || bulk.count === 0}>{t('Permanently clear history')}</button><button type="button" className="subtle-button" disabled={removing} onClick={() => setBulk(null)}>{t('Cancel')}</button></div>
      </form>
    </Modal>}
    {removalTarget && <Modal title={t('Delete sale?')} closeDisabled={removing} onClose={() => { if (!removing) setRemovalTarget(null); }}>
      <p>{t('Permanently delete this incorrect sale and its receipt? Its payments, tips and refunds will no longer count in totals or exports. Use this only for an incorrect record; it does not transfer money.')}</p>
      <form className="editor-form" onSubmit={(event) => {
        event.preventDefault(); if (removalInFlight.current) return; removalInFlight.current = true; setRemoving(true); setRemovalError(null);
        void api.history.removeSale({ saleId: removalTarget, reason: reason.trim() }).then((response) => { unwrapManagement(response); onRemoved?.(removalTarget); setRemovalTarget(null); setNotice(t('Sale removed from history.')); setRefresh((value) => value + 1); }).catch((failure: unknown) => setRemovalError(managementError(failure))).finally(() => { removalInFlight.current = false; setRemoving(false); });
      }}>
        {removalError && <p className="pos-error" role="alert">{removalError}</p>}
        <label>{t('Reason for deletion')}<textarea required maxLength={1000} value={reason} disabled={removing} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="form-actions"><button className="primary-button" type="submit" disabled={removing || !reason.trim()}>{t('Confirm delete sale')}</button><button type="button" className="subtle-button" disabled={removing} onClick={() => setRemovalTarget(null)}>{t('Cancel')}</button></div>
      </form>
    </Modal>}
    <nav className="history-pagination" aria-label={t("Sales history pages")}><button type="button" className="subtle-button" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>{t("Previous sales page")}</button><span>{t("Page")}{' '}{page}{' '}{t("of")}{' '}{pages}</span><button type="button" className="subtle-button" disabled={loading || !result || page >= pages} onClick={() => setPage((value) => value + 1)}>{t("Next sales page")}</button></nav>
  </main>;
}
