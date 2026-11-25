import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY_DRAFT, historyFiltersFromDraft, historySortFromValue } from './history-ui.js';

describe('sales history filter input', () => {
  it('keeps inclusive Swiss calendar dates unchanged for server DST conversion', () => {
    expect(historyFiltersFromDraft({ ...EMPTY_HISTORY_DRAFT, dateFrom: '2026-03-29', dateTo: '2026-10-25' })).toMatchObject({ dateFrom: '2026-03-29', dateTo: '2026-10-25' });
  });
  it('converts explicit decimal currency to exact integer Rappen', () => {
    expect(historyFiltersFromDraft({ ...EMPTY_HISTORY_DRAFT, minimum: '2.42', maximum: '8,99', saleId: ' sale-1 ', productQuery: ' Tea ' })).toMatchObject({ minTotalRappen: 242, maxTotalRappen: 899, saleId: 'sale-1', productQuery: 'Tea' });
  });
  it('leaves omitted bounds and dates unbounded', () => {
    expect(historyFiltersFromDraft(EMPTY_HISTORY_DRAFT)).toEqual({ dateFrom: null, dateTo: null, paymentMethod: 'all', minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all', saleId: '', productQuery: '' });
  });
  it.each(['-1', 'NaN', '1.234', '9e3', '90071992547409.92'])('rejects malformed or unsafe amount %s before querying', (minimum) => {
    expect(() => historyFiltersFromDraft({ ...EMPTY_HISTORY_DRAFT, minimum })).toThrow();
  });
  it('rejects inverted dates and amount bounds', () => {
    expect(() => historyFiltersFromDraft({ ...EMPTY_HISTORY_DRAFT, dateFrom: '2026-11-19', dateTo: '2026-11-18' })).toThrow();
    expect(() => historyFiltersFromDraft({ ...EMPTY_HISTORY_DRAFT, minimum: '10.00', maximum: '2.00' })).toThrow();
  });
  it('accepts only explicit supported sorts', () => {
    expect(historySortFromValue('total-asc')).toEqual({ field: 'total', direction: 'asc' });
    expect(historySortFromValue('date-desc')).toEqual({ field: 'date', direction: 'desc' });
    expect(() => historySortFromValue('date-DESC;DELETE')).toThrow();
  });
  it('normalizes receipt scans, order numbers and named table searches',()=>{
    expect(historyFiltersFromDraft({...EMPTY_HISTORY_DRAFT,orderNumber:'#12',serviceLabel:' Tisch Müller ',receiptCode:' cc123456789abcde '})).toMatchObject({orderNumber:12,serviceLabel:'Tisch Müller',receiptCode:'CC123456789ABCDE'});
    for(const orderNumber of ['0','100','1.2','abc'])expect(()=>historyFiltersFromDraft({...EMPTY_HISTORY_DRAFT,orderNumber})).toThrow();
  });

});
