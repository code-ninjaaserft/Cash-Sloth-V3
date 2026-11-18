import React, { useEffect, useRef, useState } from 'react';
import type { CashSlothApi, HistoryFilters, HistoryPage, HistorySort } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';
import { DEFAULT_HISTORY_SORT, EMPTY_HISTORY_DRAFT, historyFiltersFromDraft, historySortFromValue, type HistoryFilterDraft } from './history-ui.js';
import { managementError, unwrapManagement } from './management-recovery.js';

const methodLabels = { cash: 'Cash', card: 'Card', twint: 'TWINT', mixed: 'Mixed' } as const;
const refundLabels = { none: 'No refund', partial: 'Partial refund', full: 'Fully refunded' } as const;

export interface SalesHistoryState {
  readonly draft: HistoryFilterDraft; readonly appliedDraft: HistoryFilterDraft; readonly filters: HistoryFilters;
  readonly sort: HistorySort; readonly page: number; readonly pageSize: number;
}
export function initialSalesHistoryState(): SalesHistoryState {
  return { draft: EMPTY_HISTORY_DRAFT, appliedDraft: EMPTY_HISTORY_DRAFT, filters: historyFiltersFromDraft(EMPTY_HISTORY_DRAFT), sort: DEFAULT_HISTORY_SORT, page: 1, pageSize: 25 };
}
export function SalesHistory({ api, savedState, onStateChange, onOpen }: { api: CashSlothApi; savedState: SalesHistoryState; onStateChange: (state: SalesHistoryState) => void; onOpen: (saleId: string) => Promise<void> }): React.JSX.Element {
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(appliedDraft);
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const change = <K extends keyof HistoryFilterDraft>(key: K, value: HistoryFilterDraft[K]): void => { setDraft((current) => ({ ...current, [key]: value })); };
  useEffect(() => { onStateChange({ draft, appliedDraft, filters, sort, page, pageSize }); }, [draft, appliedDraft, filters, sort, page, pageSize, onStateChange]);

  useEffect(() => {
    const request = ++sequence.current;
    setLoading(true); setError(null);
    void api.history.search({ filters, sort, page, pageSize }).then((response) => {
      if (request !== sequence.current) return;
      const found = unwrapManagement(response); setResult(found);
      if (found.total > 0 && found.items.length === 0 && page > 1) setPage(Math.max(1, Math.ceil(found.total / pageSize)));
    }).catch((failure: unknown) => { if (request === sequence.current) { setError(managementError(failure)); setResult(null); } })
      .finally(() => { if (request === sequence.current) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [api, filters, sort, page, pageSize, refresh]);

  const apply = (event: React.FormEvent): void => {
    event.preventDefault();
    try { const checked = historyFiltersFromDraft(draft); setLoading(true); setFilters(checked); setAppliedDraft(draft); setPage(1); setNotice(''); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the history filters.'); }
  };
  const exportHistory = (): void => {
    if (exportInFlight.current || dirty || loading || error) return;
    exportInFlight.current = true; setExporting(true); setNotice(''); setError(null);
    void api.files.exportSalesHistory({ filters, sort }).then((response) => {
      const exported = unwrapManagement(response);
      setNotice(exported.cancelled ? 'Export cancelled. No files were written.' : `Exported ${exported.saleCount} sales to ${exported.directory}. ${exported.files.length} files preserve the linked sale, item, payment and refund records.`);
    }).catch((failure: unknown) => setError(managementError(failure)))
      .finally(() => { exportInFlight.current = false; setExporting(false); });
  };

  return <main className="management-workspace sales-history-workspace">
    <header className="pos-heading"><div><span className="pos-label">Management & operations</span><h1>Sales history</h1><p>Find original sales and inspect their separate payment and refund records.</p></div><button type="button" className="subtle-button" disabled={exporting || loading || dirty || !!error} onClick={exportHistory}>{exporting ? 'Preparing export…' : 'Export filtered history'}</button></header>
    <form className="management-panel history-filters" onSubmit={apply} aria-label="Sales history filters">
      <div className="management-form-grid">
        <label>From date (Switzerland)<input type="date" value={draft.dateFrom} onChange={(event) => change('dateFrom', event.target.value)} /></label>
        <label>Through date (Switzerland)<input type="date" value={draft.dateTo} onChange={(event) => change('dateTo', event.target.value)} /></label>
        <label>Payment method<select aria-label="Payment method filter" value={draft.paymentMethod} onChange={(event) => change('paymentMethod', event.target.value as HistoryFilterDraft['paymentMethod'])}><option value="all">All methods</option><option value="cash">Cash</option><option value="card">Card</option><option value="twint">TWINT</option><option value="mixed">Mixed</option></select></label>
        <label>Refund status<select aria-label="Refund status filter" value={draft.refundStatus} onChange={(event) => change('refundStatus', event.target.value as HistoryFilterDraft['refundStatus'])}><option value="all">All refund states</option><option value="none">No refund</option><option value="partial">Partial refund</option><option value="full">Fully refunded</option></select></label>
        <label>Minimum total (CHF)<input type="text" inputMode="decimal" value={draft.minimum} placeholder="No minimum" onChange={(event) => change('minimum', event.target.value)} /></label>
        <label>Maximum total (CHF)<input type="text" inputMode="decimal" value={draft.maximum} placeholder="No maximum" onChange={(event) => change('maximum', event.target.value)} /></label>
        <label>Sale identifier<input type="search" maxLength={128} value={draft.saleId} placeholder="Full or partial sale ID" onChange={(event) => change('saleId', event.target.value)} /></label>
        <label>Product or variant<input type="search" maxLength={200} value={draft.productQuery} placeholder="Historical name or identifier" onChange={(event) => change('productQuery', event.target.value)} /></label>
      </div>
      <div className="form-actions"><button type="submit" className="primary-button">Apply history filters</button><button type="button" className="subtle-button" onClick={() => { setDraft(EMPTY_HISTORY_DRAFT); setAppliedDraft(EMPTY_HISTORY_DRAFT); setFilters(historyFiltersFromDraft(EMPTY_HISTORY_DRAFT)); setPage(1); setNotice(''); }}>Clear history filters</button><button type="button" className="subtle-button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh history</button></div>
      <p className="form-hint">Dates include the full selected days in Europe/Zurich, including daylight-saving changes. Totals filter the original amount actually paid. Export uses the displayed filters.{dirty && ' Apply your edited filters before exporting.'}</p>
    </form>
    {error && <div role="alert" className="pos-error">{error}</div>}
    <p role="status" className="catalog-save-status">{notice}</p>
    <div className="history-toolbar"><p role="status" aria-live="polite" data-testid="history-result-count">{loading ? 'Reading sales history…' : `${result?.total ?? 0} matching sales`}</p><label>Sort<select aria-label="Sort sales" value={`${sort.field}-${sort.direction}`} onChange={(event) => { setSort(historySortFromValue(event.target.value)); setPage(1); }}><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="total-desc">Highest total first</option><option value="total-asc">Lowest total first</option></select></label><label>Per page<select aria-label="Sales per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
    <section className="history-results" aria-label="Recent completed sales" aria-busy={loading}>
      {!loading && result?.items.length === 0 && <div className="pos-empty">No completed sales match these filters.</div>}
      {result?.items.map((sale) => <button type="button" className="history-sale-row" key={sale.id} aria-label={`Open sale ${sale.id}`} disabled={loading || opening !== null} onClick={() => { setOpening(sale.id); void onOpen(sale.id).catch((failure: unknown) => setError(managementError(failure))).finally(() => setOpening(null)); }}>
        <span className="history-sale-main"><strong>{new Date(sale.completedAt).toLocaleString('en-CH', { timeZone: 'Europe/Zurich' })}</strong><small className="history-sale-id">{sale.id}</small><span>{sale.itemSummary}</span></span>
        <span><strong>{formatChf(sale.actualPaidRappen)}</strong><small>{methodLabels[sale.paymentMethod]}</small></span>
        <span><span className={`management-badge ${sale.refundStatus === 'none' ? '' : 'muted'}`}>{refundLabels[sale.refundStatus]}</span><small>Refunded {formatChf(sale.refundedRappen)} · Remaining {formatChf(sale.refundableRappen)}</small>{sale.unresolvedRefundCount > 0 && <small className="history-warning">{sale.unresolvedRefundCount} refund outcome(s) need review</small>}{sale.reconciliationCount > 0 && <small>{sale.reconciliationCount} reconciliation action(s)</small>}</span>
      </button>)}
    </section>
    <nav className="history-pagination" aria-label="Sales history pages"><button type="button" className="subtle-button" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous sales page</button><span>Page {page} of {pages}</span><button type="button" className="subtle-button" disabled={loading || !result || page >= pages} onClick={() => setPage((value) => value + 1)}>Next sales page</button></nav>
  </main>;
}
