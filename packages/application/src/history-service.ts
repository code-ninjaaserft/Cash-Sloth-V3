import { HISTORY_IPC_CONTRACTS, HistoryExportRequestSchema, type HistoryExportRequest, type HistoryMethod, type HistoryRequest, type HistoryResponse, type Result } from '@cash-sloth/contracts';
import { assertFinancialTimestamp, DomainError, swissHistoryRange } from '@cash-sloth/domain';
import type { PosRuntime } from './ports.js';
import type { HistoryStore, NormalizedHistoryFilters, PreparedHistoryExport } from './history-ports.js';
import { buildHistoryExport, HISTORY_EXPORT_LIMITS } from './history-export.js';

export type HistoryService = { [K in HistoryMethod]: (request: HistoryRequest<K>) => HistoryResponse<K> } & { prepareExport(request: HistoryExportRequest): Result<PreparedHistoryExport> };
function failure(error: unknown): { ok: false; error: { code: string; message: string } } {
  return error instanceof DomainError ? { ok: false, error: { code: error.code, message: error.message } } : { ok: false, error: { code: 'STORAGE_ERROR', message: 'History data could not be read consistently. Refresh before continuing.' } };
}
function normalized(request: HistoryExportRequest): NormalizedHistoryFilters {
  const { dateFrom, dateTo, ...filters } = HistoryExportRequestSchema.parse({ filters: request.filters, sort: request.sort }).filters;
  return { ...filters, ...swissHistoryRange(dateFrom, dateTo) };
}
/** History visibility and export orchestration; the host alone owns export dialogs and files. */
export function createHistoryService(store: HistoryStore, runtime: Pick<PosRuntime, 'now'>): HistoryService {
  function safe<K extends HistoryMethod>(method: K, request: HistoryRequest<K>, operation: () => unknown): HistoryResponse<K> {
    try {
      if (!HISTORY_IPC_CONTRACTS[method].request.safeParse(request).success) throw new DomainError('INVALID_INPUT', 'Invalid history filter or pagination request.');
      return HISTORY_IPC_CONTRACTS[method].response.parse({ ok: true, value: store.transaction(operation) }) as HistoryResponse<K>;
    } catch (error) { return HISTORY_IPC_CONTRACTS[method].response.parse(failure(error)) as HistoryResponse<K>; }
  }
  return {
    previewRemoval: (request) => safe('previewRemoval', request, () => { if (!store.previewRemoval) throw new DomainError('NOT_SUPPORTED', 'History deletion is unavailable.'); return store.previewRemoval(request.scope, request.eventId); }),
    removeHistory: (request) => safe('removeHistory', request, () => { if (!store.removeHistory) throw new DomainError('NOT_SUPPORTED', 'History deletion is unavailable.'); const at = runtime.now(); assertFinancialTimestamp(at); return store.removeHistory(request, at); }),
    getEvents: (request) => safe('getEvents', request, () => {
      if (!store.getEvents) throw new DomainError('NOT_SUPPORTED', 'Event history is unavailable.');
      return store.getEvents();
    }),
    removeSale: (request) => safe('removeSale', request, () => {
      if (!store.removeSale) throw new DomainError('NOT_SUPPORTED', 'History removal is unavailable.');
      const at = runtime.now(); assertFinancialTimestamp(at);
      store.removeSale(request.saleId, request.reason.trim(), at);
      return { removed: true };
    }),
    search: (request) => safe('search', request, () => store.search(normalized(request), request.sort, request.page, request.pageSize)),
    getSaleContext: (request) => safe('getSaleContext', request, () => { const context = store.getSaleContext(request.saleId); if (context === null) throw new DomainError('NOT_FOUND', 'Sale not found.'); return context; }),
    prepareExport: (request) => {
      try {
        if (!HistoryExportRequestSchema.safeParse(request).success) throw new DomainError('INVALID_INPUT', 'Invalid history export filters.');
        return { ok: true, value: store.transaction(() => {
          const records = store.exportRecords(normalized(request), request.sort, HISTORY_EXPORT_LIMITS.maxSales, HISTORY_EXPORT_LIMITS.maxRows);
          const at = runtime.now(); assertFinancialTimestamp(at); return buildHistoryExport(records, at);
        }) };
      } catch (error) { return failure(error); }
    },
  };
}
