import { DomainError, validateFinancialSale, validateRefundHistory } from '@cash-sloth/domain';
import type { HistoryExportFile, HistoryExportRecord, PreparedHistoryExport } from './history-ports.js';

export const HISTORY_EXPORT_LIMITS = Object.freeze({ maxSales: 5000, maxRows: 100_000, maxBytes: 25 * 1024 * 1024 });
type Cell = string | number | boolean | null;

/** Quote CSV syntax and neutralize spreadsheet formulas in untrusted text.
 * Numeric values stay numeric, including signed rounding adjustments. */
export function quoteHistoryCsvCell(value: Cell): string {
  let text = value === null ? '' : String(value);
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC');
    if (/^[\s\p{Cf}]*[\t\r\n]/u.test(value) || /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(normalized)) text = `'${value}`;
  }
  return `"${text.replace(/"/gu, '""')}"`;
}

export function buildHistoryExport(records: readonly HistoryExportRecord[], generatedAt: string): PreparedHistoryExport {
  if (records.length > HISTORY_EXPORT_LIMITS.maxSales) throw new DomainError('EXPORT_TOO_LARGE', 'Export exceeds 5000 sales. Narrow the history filters.');
  let bytes = 0; let rows = 0; let paid = 0n; let refunded = 0n;
  const encoder = new TextEncoder();
  function file(name: HistoryExportFile['name'], header: readonly Cell[]) {
    const lines: string[] = [];
    let count = 0;
    const append = (cells: readonly Cell[], isHeader = false): void => {
      const line = `${cells.map(quoteHistoryCsvCell).join(',')}\r\n`;
      bytes += encoder.encode(line).byteLength;
      if (!isHeader) { rows++; count++; }
      if (rows > HISTORY_EXPORT_LIMITS.maxRows || bytes > HISTORY_EXPORT_LIMITS.maxBytes) throw new DomainError('EXPORT_TOO_LARGE', 'Export exceeds 100000 records or 25 MiB. Narrow the history filters.');
      lines.push(line);
    };
    append(header, true);
    return { append, result: (): HistoryExportFile => ({ name, content: lines.join(''), rows: count }) };
  }
  const sales = file('sales.csv', ['sale_id', 'checkout_session_id', 'completed_at_utc', 'source', 'subtotal_rappen', 'rounding_adjustment_rappen', 'paid_rappen', 'refunded_rappen', 'remaining_refundable_rappen', 'payment_method', 'refund_status', 'unresolved_refund_attempts', 'reconciliation_actions']);
  const items = file('sale_items.csv', ['sale_id', 'sale_item_id', 'product_id', 'variant_id', 'product_name', 'variant_name', 'quantity', 'unit_price_rappen', 'line_total_rappen', 'quantity_refunded', 'quantity_refundable']);
  const payments = file('payments.csv', ['sale_id', 'payment_attempt_id', 'method', 'applied_rappen', 'cash_tendered_rappen', 'change_rappen', 'operator_confirmed', 'confirmed_at_utc', 'confirmation_kind']);
  const refunds = file('refunds.csv', ['sale_id', 'refund_id', 'refund_attempt_id', 'refund_request_key', 'method', 'amount_rappen', 'operator_confirmed', 'confirmed_at_utc', 'completed_at_utc', 'confirmation_kind']);
  const refundItems = file('refund_items.csv', ['sale_id', 'refund_id', 'sale_item_id', 'unit_offset', 'quantity', 'unit_price_rappen', 'base_rappen', 'rounding_allocation_rappen', 'amount_rappen']);
  for (const record of records) {
    const sale = record.sale; validateFinancialSale(sale); validateRefundHistory(sale, record.refunds);
    const refundedAmount = record.refunds.reduce((sum, refund) => sum + BigInt(refund.amountRappen), 0n);
    const quantities = new Map<string, number>();
    for (const refund of record.refunds) for (const item of refund.items) quantities.set(item.saleItemId, (quantities.get(item.saleItemId) ?? 0) + item.quantity);
    const methodSet = new Set(sale.payments.map((payment) => payment.method));
    const method = methodSet.size === 1 ? sale.payments[0]?.method ?? 'cash' : 'mixed';
    const isFull = sale.items.every((item) => (quantities.get(item.id) ?? 0) === item.quantity);
    const refundStatus = record.refunds.length === 0 ? 'none' : isFull ? 'full' : 'partial';
    paid += BigInt(sale.actualPaidRappen); refunded += refundedAmount;
    sales.append([sale.id, sale.checkoutSessionId, sale.completedAt, sale.source, sale.subtotalRappen, sale.roundingAdjustmentRappen, sale.actualPaidRappen, Number(refundedAmount), sale.actualPaidRappen - Number(refundedAmount), method, refundStatus, record.context.unresolvedRefundCount, record.context.reconciliationCount]);
    for (const item of sale.items) items.append([sale.id, item.id, item.productId, item.variantId, item.productName, item.variantName, item.quantity, item.unitPriceRappen, item.lineTotalRappen, quantities.get(item.id) ?? 0, item.quantity - (quantities.get(item.id) ?? 0)]);
    for (const payment of sale.payments) payments.append([sale.id, payment.attemptId, payment.method, payment.amountRappen, payment.cashTenderedRappen, payment.changeRappen, payment.operatorConfirmed, payment.confirmedAt, 'manual_operator_assertion']);
    for (const refund of record.refunds) {
      refunds.append([sale.id, refund.id, refund.attemptId, refund.idempotencyKey, refund.method, refund.amountRappen, refund.operatorConfirmed, refund.confirmedAt, refund.completedAt, 'manual_operator_assertion']);
      for (const item of refund.items) refundItems.append([sale.id, refund.id, item.saleItemId, item.unitOffset, item.quantity, item.unitPriceRappen, item.baseRappen, item.roundingAllocationRappen, item.amountRappen]);
    }
  }
  return { files: [sales.result(), items.result(), payments.result(), refunds.result(), refundItems.result()], saleCount: records.length, generatedAt, totals: { paidRappen: paid.toString(), refundedRappen: refunded.toString(), netRappen: (paid - refunded).toString() } };
}
