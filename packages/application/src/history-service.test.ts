import { describe, expect, it, vi } from 'vitest';
import type { HistoryFilters } from '@cash-sloth/contracts';
import type { HistoryStore } from './history-ports.js';
import { createHistoryService } from './history-service.js';
import { PersistenceError } from './ports.js';

const filters: HistoryFilters = { dateFrom: null, dateTo: null, paymentMethod: 'all', minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all', saleId: '', productQuery: '' };
const sort = { field: 'date', direction: 'desc' } as const;
function fixture(overrides: Partial<HistoryStore> = {}) {
  const store: HistoryStore = {
    transaction<T>(operation: () => T): T { return operation(); },
    search: vi.fn((_filters, _sort, page, pageSize) => ({ items: [], total: 0, page, pageSize })),
    getSaleContext: vi.fn(() => null), exportRecords: vi.fn(() => []), ...overrides,
  };
  return { store, service: createHistoryService(store, { now: () => '2026-11-18T12:00:00.000Z' }) };
}
describe('history application boundary', () => {
  it('normalizes trimmed searches and converts Swiss calendar filters before querying', () => {
    const { store, service } = fixture();
    expect(service.search({ filters: { ...filters, dateFrom: '2026-03-29', dateTo: '2026-03-29', productQuery: '  Alpine  ', saleId: '  history  ' }, sort, page: 2, pageSize: 10 }).ok).toBe(true);
    expect(store.search).toHaveBeenCalledWith({ paymentMethod: 'all', minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all', productQuery: 'Alpine', saleId: 'history', fromInclusive: '2026-03-28T23:00:00.000Z', toExclusive: '2026-03-29T22:00:00.000Z' }, sort, 2, 10);
  });
  it('rejects malformed pagination, filters and extra authority without calling storage', () => {
    const { store, service } = fixture();
    for (const request of [
      { filters, sort, page: 0, pageSize: 25 }, { filters, sort, page: 1, pageSize: 101 },
      { filters: { ...filters, maxTotalRappen: -1 }, sort, page: 1, pageSize: 25 },
      { filters, sort, page: 1, pageSize: 25, sql: 'DELETE FROM sales' },
    ]) expect(service.search(request)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.search).not.toHaveBeenCalled();
  });
  it('rejects invalid adapter responses instead of exposing a malformed success', () => {
    const { service } = fixture({ search: () => ({ items: [], total: -1, page: 1, pageSize: 25 }) });
    expect(service.search({ filters, sort, page: 1, pageSize: 25 })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
  });
  it('returns not found for absent details and validates IDs before privileged reads', () => {
    const { store, service } = fixture();
    expect(service.getSaleContext({ saleId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(service.getSaleContext({ saleId: '../private' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.getSaleContext).toHaveBeenCalledTimes(1);
  });
  it('does not reveal storage messages or treat an uncertain snapshot as successful', () => {
    const { service } = fixture({ transaction: () => { throw new PersistenceError('unknown', 'secret database path'); } });
    const result = service.search({ filters, sort, page: 1, pageSize: 25 });
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(service.prepareExport({ filters, sort })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
  });
  it('prepares only bounded exports and never returns invalid-filter partial files', () => {
    const { store, service } = fixture();
    expect(service.prepareExport({ filters: { ...filters, minTotalRappen: 2, maxTotalRappen: 1 }, sort })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.exportRecords).not.toHaveBeenCalled();
    const result = service.prepareExport({ filters, sort });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.files).toHaveLength(5);
    expect(store.exportRecords).toHaveBeenCalledWith(expect.objectContaining({ fromInclusive: null, toExclusive: null }), sort, 5000, 100_000);
  });
  it('validates the host export timestamp', () => {
    const { store } = fixture();
    expect(createHistoryService(store, { now: () => 'not a timestamp' }).prepareExport({ filters, sort })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
