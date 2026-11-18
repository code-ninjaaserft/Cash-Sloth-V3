import { describe, expect, it } from 'vitest';
import { quoteRefundItems, type FinancialSale, type Refund } from '@cash-sloth/domain';
import { buildHistoryExport, quoteHistoryCsvCell } from './history-export.js';
import type { HistoryExportRecord } from './history-ports.js';

const at = '2026-11-18T10:00:00.000Z';
function sale(): FinancialSale {
  return { id: 'sale', checkoutSessionId: 'session', cartId: 'cart', cartRevision: 1, completedAt: at,
    items: [{ id: 'line', productId: 'product', variantId: 'variant', productName: '=SUM(1,2)', variantName: 'Swiss "large", size', unitPriceRappen: 842, quantity: 2, lineTotalRappen: 1684 }],
    subtotalRappen: 1684, roundingAdjustmentRappen: 1, amountDueRappen: 1685, actualPaidRappen: 1685, source: 'payments',
    payments: [{ attemptId: 'card', method: 'card', amountRappen: 500, cashTenderedRappen: null, changeRappen: 0, operatorConfirmed: true, confirmedAt: at },
      { attemptId: 'twint', method: 'twint', amountRappen: 500, cashTenderedRappen: null, changeRappen: 0, operatorConfirmed: true, confirmedAt: at },
      { attemptId: 'cash', method: 'cash', amountRappen: 685, cashTenderedRappen: 1000, changeRappen: 315, operatorConfirmed: true, confirmedAt: at }] };
}
function record(withRefunds = true): HistoryExportRecord {
  const original = sale(); const refunds: Refund[] = [];
  if (withRefunds) for (const [index, method] of ['card', 'twint'].entries()) {
    const items = quoteRefundItems(original, refunds, [{ saleItemId: 'line', quantity: 1 }]);
    refunds.push({ id: `refund-${index}`, idempotencyKey: `refund-key-${index}`, attemptId: `refund-attempt-${index}`, saleId: original.id, items,
      amountRappen: items[0]?.amountRappen ?? 0, method: method as 'card' | 'twint', operatorConfirmed: true, confirmedAt: at, completedAt: at });
  }
  return { sale: original, refunds, context: { unresolvedRefundCount: 0, reconciliationCount: 1, lastReconciliationAt: at } };
}
describe('financial CSV export structure and cell safety', () => {
  it.each(['=1+1', '+SUM(1,2)', '-1+1', '@SUM(A1)', '   =HYPERLINK("url")', '\tformula', '\rhidden', '\nnew row', '\u200b=1', '\u202e@SUM(A1)', '\u2060\u0001+CMD', '  \tvalue', '＝1+1'])('neutralizes user-controlled spreadsheet expression %j', (value) => {
    expect(quoteHistoryCsvCell(value).startsWith('"\'')).toBe(true);
  });
  it('quotes delimiters, escaped quotes and newlines while preserving numeric adjustments', () => {
    expect(quoteHistoryCsvCell('Tea, "large"\r\nSwiss')).toBe('"Tea, ""large""\r\nSwiss"');
    expect(quoteHistoryCsvCell(-2)).toBe('"-2"');
    expect(quoteHistoryCsvCell(null)).toBe('""');
    expect(quoteHistoryCsvCell('Sören')).toBe('"Sören"');
  });
  it('separates one sale, three allocations and two refunds without repeating financial totals', () => {
    const result = buildHistoryExport([record()], at);
    expect(result.files.map(({ name, rows }) => [name, rows])).toEqual([['sales.csv', 1], ['sale_items.csv', 1], ['payments.csv', 3], ['refunds.csv', 2], ['refund_items.csv', 2]]);
    expect(result.totals).toEqual({ paidRappen: '1685', refundedRappen: '1685', netRappen: '0' });
    expect(result.files[0]?.content).toContain('"1684","1","1685","1685","0","mixed","full"');
    expect(result.files[1]?.content).toContain('"\'=SUM(1,2)"');
    expect(result.files[2]?.content).toContain('"cash","685","1000","315"');
    expect(result.files[3]?.content).toContain('"card","842"');
    expect(result.files[3]?.content).toContain('"twint","843"');
    expect(result.files[2]?.content).toContain('manual_operator_assertion');
  });
  it('writes five deterministic header-only files for an empty result set', () => {
    const result = buildHistoryExport([], at);
    expect(result.saleCount).toBe(0); expect(result.files).toHaveLength(5);
    expect(result.files.every((file) => file.rows === 0 && file.content.endsWith('\r\n') && file.content.split('\r\n').length === 2)).toBe(true);
    expect(result.totals).toEqual({ paidRappen: '0', refundedRappen: '0', netRappen: '0' });
  });
  it('is deterministic and retains original sale totals after refunds', () => {
    expect(buildHistoryExport([record()], at)).toEqual(buildHistoryExport([record()], at));
    expect(buildHistoryExport([record(false)], at).totals).toEqual({ paidRappen: '1685', refundedRappen: '0', netRappen: '1685' });
    expect(buildHistoryExport([record()], at).files[0]?.content).toContain('"1684","1","1685"');
  });
  it('keeps aggregate totals exact beyond the per-record safe integer bound', () => {
    const item = record(false); const price = Number.MAX_SAFE_INTEGER;
    const large: FinancialSale = { ...item.sale, items: [{ ...item.sale.items[0]!, quantity: 1, unitPriceRappen: price, lineTotalRappen: price }], subtotalRappen: price, roundingAdjustmentRappen: 0, amountDueRappen: price, actualPaidRappen: price,
      payments: [{ attemptId: 'large-card', method: 'card', amountRappen: price, cashTenderedRappen: null, changeRappen: 0, operatorConfirmed: true, confirmedAt: at }] };
    expect(buildHistoryExport([{ ...item, sale: large }, { ...item, sale: { ...large, id: 'large-second' } }], at).totals.paidRappen).toBe((BigInt(price) * 2n).toString());
  });
  it('rejects excessive sale counts instead of returning a truncated export', () => {
    expect(() => buildHistoryExport(Array.from({ length: 5001 }, () => record(false)), at)).toThrow('5000 sales');
  });
  function manyItems(productName: string, variantName: string): HistoryExportRecord {
    const original = record(false);
    const items = Array.from({ length: 1000 }, (_, index) => ({ id: `line-${index}`, productId: 'p', variantId: 'v', productName, variantName, unitPriceRappen: 10, quantity: 1, lineTotalRappen: 10 }));
    return { ...original, sale: { ...original.sale, items, subtotalRappen: 10000, roundingAdjustmentRappen: 0, amountDueRappen: 10000, actualPaidRappen: 10000,
      payments: [{ attemptId: 'cash-large', method: 'cash', amountRappen: 10000, cashTenderedRappen: 10000, changeRappen: 0, operatorConfirmed: true, confirmedAt: at }] } };
  }
  it('rejects a record-heavy export before exceeding its 100000 data-row bound', () => {
    const original = manyItems('Product', 'V');
    const records = Array.from({ length: 101 }, (_, index) => ({ ...original, sale: { ...original.sale, id: `s${index}`, cartId: `c${index}`, checkoutSessionId: `session${index}` } }));
    expect(() => buildHistoryExport(records, at)).toThrow('100000 records');
  });
  it('counts UTF-8 bytes rather than JavaScript character length for the 25 MiB export bound', () => {
    const original = manyItems('漢'.repeat(200), '語'.repeat(200));
    const records = Array.from({ length: 25 }, (_, index) => ({ ...original, sale: { ...original.sale, id: `unicode${index}`, cartId: `c${index}`, checkoutSessionId: `session${index}` } }));
    expect(() => buildHistoryExport(records, at)).toThrow('25 MiB');
  });
  it('rejects financially invalid adapter output before producing export files', () => {
    const original = record();
    expect(() => buildHistoryExport([{ ...original, sale: { ...original.sale, actualPaidRappen: 1686 } }], at)).toThrow();
    expect(() => buildHistoryExport([{ ...original, refunds: [...original.refunds, ...original.refunds] }], at)).toThrow();
  });
});
