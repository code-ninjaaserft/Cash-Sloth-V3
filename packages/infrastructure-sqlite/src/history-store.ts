import { DomainError, addMoney, assertFinancialTimestamp, validateFinancialSale, validateRefundHistory } from '@cash-sloth/domain';
import type { HistoryExportRecord, HistoryStore, NormalizedHistoryFilters } from '@cash-sloth/application';
import { HistoryFiltersSchema, HistorySortSchema, SaleHistoryEntrySchema, SaleHistoryContextSchema, type HistorySort, type SaleHistoryContext, type SaleHistoryEntry } from '@cash-sloth/contracts';
import type { DatabaseConnection } from './connection.js';
import { createFinanceStore } from './finance-store.js';

type Parameters = (string | number | null)[];
type Row = Record<string, unknown>;
const baseQuery = `WITH refund_totals AS (
  SELECT sale_id, sum(amount_rappen) refunded_rappen, count(*) refund_count FROM refunds GROUP BY sale_id
), refund_units AS (
  SELECT r.sale_id, sum(json_extract(i.value, '$.quantity')) refunded_units, count(*) refund_item_count
  FROM refunds r, json_each(r.data, '$.items') i GROUP BY r.sale_id
), history_sales AS (
  SELECT s.id, s.idempotency_key session_id, s.completed_at, s.amount_due_rappen actual_paid_rappen,
    s.subtotal_rappen, s.rounding_adjustment_rappen, 'legacy' source, 'cash' payment_method, NULL data,
    (SELECT sum(quantity) FROM sale_items WHERE sale_id = s.id) sold_units,
    (SELECT count(*) FROM sale_items WHERE sale_id = s.id) item_count, 1 payment_count
  FROM sales s WHERE s.sealed = 1
  UNION ALL
  SELECT f.id, f.session_id, f.completed_at, f.actual_paid_rappen,
    json_extract(f.data, '$.subtotalRappen'), json_extract(f.data, '$.roundingAdjustmentRappen'), 'payments',
    CASE WHEN (SELECT count(DISTINCT json_extract(p.value, '$.method')) FROM json_each(f.data, '$.payments') p) > 1 THEN 'mixed'
      ELSE (SELECT json_extract(p.value, '$.method') FROM json_each(f.data, '$.payments') p LIMIT 1) END,
    f.data, (SELECT sum(json_extract(i.value, '$.quantity')) FROM json_each(f.data, '$.items') i),
    json_array_length(f.data, '$.items'), json_array_length(f.data, '$.payments')
  FROM financial_sales f
), history AS (
  SELECT s.*, coalesce(rt.refunded_rappen, 0) refunded_rappen, coalesce(rt.refund_count, 0) refund_count,
    coalesce(ru.refunded_units, 0) refunded_units, coalesce(ru.refund_item_count, 0) refund_item_count,
    CASE WHEN coalesce(rt.refund_count, 0) = 0 THEN 'none'
      WHEN ru.refunded_units = s.sold_units THEN 'full' ELSE 'partial' END refund_status
  FROM history_sales s LEFT JOIN refund_totals rt ON rt.sale_id = s.id LEFT JOIN refund_units ru ON ru.sale_id = s.id
)`;

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid persisted history count or total.');
  return value;
}
function text(row: Row, key: string): string {
  const value = row[key]; if (typeof value !== 'string') throw new Error('Invalid persisted history identity.'); return value;
}
function folded(text: string): string { return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en'); }
function where(filters: NormalizedHistoryFilters): { sql: string; parameters: Parameters } {
  const { fromInclusive, toExclusive, ...remaining } = filters;
  HistoryFiltersSchema.parse({ ...remaining, dateFrom: null, dateTo: null });
  if (fromInclusive !== null) assertFinancialTimestamp(fromInclusive);
  if (toExclusive !== null) assertFinancialTimestamp(toExclusive);
  const conditions: string[] = []; const parameters: Parameters = [];
  const add = (sql: string, value: string | number) => { conditions.push(sql); parameters.push(value); };
  if (fromInclusive !== null) add('h.completed_at >= ?', fromInclusive);
  if (toExclusive !== null) add('h.completed_at < ?', toExclusive);
  if (filters.paymentMethod !== 'all') add('h.payment_method = ?', filters.paymentMethod);
  if (filters.minTotalRappen !== null) add('h.actual_paid_rappen >= ?', filters.minTotalRappen);
  if (filters.maxTotalRappen !== null) add('h.actual_paid_rappen <= ?', filters.maxTotalRappen);
  if (filters.refundStatus !== 'all') add('h.refund_status = ?', filters.refundStatus);
  if (filters.saleId !== '') add('instr(lower(h.id), lower(?)) > 0', filters.saleId);
  if (filters.productQuery !== '') {
    const query = folded(filters.productQuery);
    conditions.push(`((h.source = 'legacy' AND EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id = h.id AND instr(cash_sloth_history_fold(i.product_name || ' ' || i.variant_name || ' ' || i.product_id || ' ' || i.variant_id), ?) > 0))
      OR (h.source = 'payments' AND EXISTS(SELECT 1 FROM json_each(h.data, '$.items') i WHERE instr(cash_sloth_history_fold(json_extract(i.value, '$.productName') || ' ' || json_extract(i.value, '$.variantName') || ' ' || json_extract(i.value, '$.productId') || ' ' || json_extract(i.value, '$.variantId')), ?) > 0)))`);
    parameters.push(query, query);
  }
  return { sql: conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`, parameters };
}
function order(sort: HistorySort): string {
  HistorySortSchema.parse(sort);
  const column = sort.field === 'date' ? 'h.completed_at' : 'h.actual_paid_rappen';
  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';
  return ` ORDER BY ${column} ${direction}, h.id ${direction}`;
}

/** Filters/counts run in SQLite; only a bounded page is materialized into financial models. */
export function createHistoryStore(connection: DatabaseConnection): HistoryStore {
  const { sqlite } = connection;
  const finance = createFinanceStore(connection);
  sqlite.function('cash_sloth_history_fold', { deterministic: true }, (value) => typeof value === 'string' ? folded(value) : '');
  const transaction = finance.transaction;
  const snapshot = <T>(operation: () => T): T => sqlite.isTransaction ? operation() : transaction(operation);
  const contexts = (saleId: string, sessionId: string, source: string): SaleHistoryContext => {
    const unresolved = sqlite.prepare("SELECT count(*) n FROM refund_attempts WHERE sale_id = ? AND state IN ('prepared', 'reported', 'uncertain')").get(saleId);
    const related = `FROM reconciliation_actions a WHERE
      ${source === 'legacy' ? "(a.kind = 'legacy' AND a.reference_id = ?) OR" : ''}
      (a.kind = 'payment' AND a.reference_id IN (SELECT id FROM payment_attempts WHERE session_id = ?))
      OR (a.kind = 'refund' AND a.reference_id IN (SELECT id FROM refund_attempts WHERE sale_id = ?))`;
    const parameters = source === 'legacy' ? [sessionId, sessionId, saleId] : [sessionId, saleId];
    const count = sqlite.prepare(`SELECT count(*) n ${related}`).get(...parameters);
    const last = sqlite.prepare(`SELECT json_extract(a.data, '$.at') at ${related} ORDER BY a.rowid DESC LIMIT 1`).get(...parameters);
    return SaleHistoryContextSchema.parse({ unresolvedRefundCount: integer(unresolved ?? {}, 'n'), reconciliationCount: integer(count ?? {}, 'n'), lastReconciliationAt: last?.['at'] ?? null });
  };
  const entry = (row: Row): SaleHistoryEntry => {
    const sale = finance.getFinancialSale(text(row, 'id')); if (sale === null) throw new Error('Missing historical sale.');
    validateFinancialSale(sale);
    const context = contexts(sale.id, sale.checkoutSessionId, sale.source);
    const summary = sale.items.map((item) => `${item.quantity} × ${item.productName} — ${item.variantName}`).join('; ');
    const refundedRappen = integer(row, 'refunded_rappen');
    if (refundedRappen > sale.actualPaidRappen) throw new Error('Persisted refund total exceeds actual payment.');
    return SaleHistoryEntrySchema.parse({ id: sale.id, completedAt: sale.completedAt, subtotalRappen: sale.subtotalRappen,
      roundingAdjustmentRappen: sale.roundingAdjustmentRappen, actualPaidRappen: sale.actualPaidRappen,
      refundedRappen, refundableRappen: sale.actualPaidRappen - refundedRappen,
      paymentMethod: row['payment_method'], refundStatus: row['refund_status'], itemSummary: summary.slice(0, 1000), source: sale.source, ...contextWithoutDate(context) });
  };
  function contextWithoutDate(context: SaleHistoryContext) { return { unresolvedRefundCount: context.unresolvedRefundCount, reconciliationCount: context.reconciliationCount }; }
  return {
    transaction,
    search(filters, sort, page, pageSize) {
      return snapshot(() => {
        if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new DomainError('INVALID_INPUT', 'Invalid history pagination.');
        const query = where(filters);
        const count = sqlite.prepare(`${baseQuery} SELECT count(*) n FROM history h${query.sql}`).get(...query.parameters);
        const rows = sqlite.prepare(`${baseQuery} SELECT h.id, h.refunded_rappen, h.payment_method, h.refund_status FROM history h${query.sql}${order(sort)} LIMIT ? OFFSET ?`).all(...query.parameters, pageSize, (page - 1) * pageSize);
        return { items: rows.map(entry), total: integer(count ?? {}, 'n'), page, pageSize };
      });
    },
    getSaleContext(saleId) {
      return snapshot(() => { const sale = finance.getFinancialSale(saleId); return sale === null ? null : contexts(sale.id, sale.checkoutSessionId, sale.source); });
    },
    exportRecords(filters, sort, maxSales, maxRows) {
      return snapshot(() => {
        if (!Number.isSafeInteger(maxSales) || maxSales < 1 || maxSales > 5000 || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100_000) throw new DomainError('INVALID_INPUT', 'Invalid export limits.');
        const query = where(filters);
        const rows = sqlite.prepare(`${baseQuery} SELECT h.id, h.item_count, h.payment_count, h.refund_count, h.refund_item_count, h.refunded_rappen FROM history h${query.sql}${order(sort)} LIMIT ?`).all(...query.parameters, maxSales + 1);
        if (rows.length > maxSales) throw new DomainError('EXPORT_TOO_LARGE', `Export exceeds ${maxSales} sales. Narrow the history filters.`);
        let recordRows = 0;
        for (const row of rows) {
          recordRows += 1 + integer(row, 'item_count') + integer(row, 'payment_count') + integer(row, 'refund_count') + integer(row, 'refund_item_count');
          if (recordRows > maxRows) throw new DomainError('EXPORT_TOO_LARGE', `Export exceeds ${maxRows} records. Narrow the history filters.`);
        }
        return rows.map((row): HistoryExportRecord => {
          const sale = finance.getFinancialSale(text(row, 'id')); if (sale === null) throw new Error('Missing export sale.');
          const refunds = finance.listRefunds(sale.id); validateRefundHistory(sale, refunds);
          if (refunds.reduce((sum, refund) => addMoney(sum, refund.amountRappen), 0) !== integer(row, 'refunded_rappen')) throw new Error('Refund snapshot changed inside export transaction.');
          return { sale, refunds, context: contexts(sale.id, sale.checkoutSessionId, sale.source) };
        });
      });
    },
  };
}
