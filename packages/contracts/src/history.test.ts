import { describe, expect, it } from 'vitest';
import { HISTORY_IPC_CONTRACTS, HistoryExportRequestSchema, HistoryFiltersSchema, HistorySearchRequestSchema } from './history.js';

const filters = { dateFrom: null, dateTo: null, paymentMethod: 'all', minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all', saleId: '', productQuery: '' } as const;
const request = { filters, sort: { field: 'date', direction: 'desc' }, page: 1, pageSize: 25 } as const;
describe('bounded history and export contracts', () => {
  it('accepts explicit empty filters and bounded paging with a separate export envelope', () => {
    expect(HistorySearchRequestSchema.parse(request)).toEqual(request);
    expect(HistoryExportRequestSchema.parse({ filters, sort: request.sort })).toEqual({ filters, sort: request.sort });
    expect(HistoryExportRequestSchema.safeParse(request).success).toBe(false);
  });
  it('rejects additional authority and unknown filter/sort fields', () => {
    expect(HistorySearchRequestSchema.safeParse({ ...request, sql: 'DELETE FROM sales' }).success).toBe(false);
    expect(HistorySearchRequestSchema.safeParse({ ...request, sort: { field: 'data', direction: 'desc' } }).success).toBe(false);
    expect(HistoryFiltersSchema.safeParse({ ...filters, timezone: 'untrusted' }).success).toBe(false);
  });
  it.each([0, -1, 101, 1.5, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid page size %s', (pageSize) => {
    expect(HistorySearchRequestSchema.safeParse({ ...request, pageSize }).success).toBe(false);
  });
  it('rejects reversed dates and monetary ranges, invalid currency and control characters', () => {
    for (const candidate of [
      { ...filters, dateFrom: '2026-11-19', dateTo: '2026-11-18' },
      { ...filters, dateFrom: '2026-02-30' }, { ...filters, dateFrom: '1899-12-31' }, { ...filters, dateTo: '9999-12-31' },
      { ...filters, minTotalRappen: 100, maxTotalRappen: 99 }, { ...filters, minTotalRappen: -1 },
      { ...filters, maxTotalRappen: Number.MAX_SAFE_INTEGER + 1 }, { ...filters, minTotalRappen: 1.5 },
      { ...filters, productQuery: 'test\0danger' },
    ]) expect(HistoryFiltersSchema.safeParse(candidate).success).toBe(false);
  });
  it('uses narrow unique channel names and rejects malformed output models', () => {
    expect(Object.values(HISTORY_IPC_CONTRACTS).map((entry) => entry.channel)).toEqual(['history:previewRemoval', 'history:removeHistory', 'history:getEvents', 'history:removeSale', 'history:search', 'history:getSaleContext']);
    expect(HISTORY_IPC_CONTRACTS.search.response.safeParse({ ok: true, value: { items: [], total: 0, page: 1, pageSize: 25 } }).success).toBe(true);
    expect(HISTORY_IPC_CONTRACTS.search.response.safeParse({ ok: true, value: { items: [], total: -1, page: 1, pageSize: 25 } }).success).toBe(false);
  });
});
