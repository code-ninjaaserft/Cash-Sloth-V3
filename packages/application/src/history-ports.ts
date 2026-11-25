import type { FinancialSale, Refund } from '@cash-sloth/domain';
import type { HistoryFilters, HistoryPage, HistorySort, SaleHistoryContext } from '@cash-sloth/contracts';

export interface NormalizedHistoryFilters extends Omit<HistoryFilters, 'dateFrom' | 'dateTo'> { readonly fromInclusive: string | null; readonly toExclusive: string | null }
export interface HistoryExportRecord { readonly removedAt?: string | null; readonly removalReason?: string | null; readonly sale: FinancialSale; readonly refunds: readonly Refund[]; readonly context: SaleHistoryContext }
export interface HistoryStore {
  getReceiptCode?(saleId:string):string;
  previewRemoval?(scope: 'event' | 'device', eventId: string | null): { count: number; version: string };
  removeHistory?(input: { scope: 'event' | 'device'; eventId: string | null; operationId: string; expectedVersion: string; reason: string }, at: string): { removedCount: number };
  getEvents?(): { activeEventId: string | null; events: readonly { id: string; title: string }[] };
  removeSale?(saleId: string, reason: string, at: string): void;
  transaction<T>(operation: () => T): T;
  search(filters: NormalizedHistoryFilters, sort: HistorySort, page: number, pageSize: number): HistoryPage;
  getSaleContext(saleId: string): SaleHistoryContext | null;
  exportRecords(filters: NormalizedHistoryFilters, sort: HistorySort, maxSales: number, maxRows: number): readonly HistoryExportRecord[];
}
export interface HistoryExportFile { readonly name: 'sales.csv' | 'sale_items.csv' | 'payments.csv' | 'refunds.csv' | 'refund_items.csv'; readonly content: string; readonly rows: number }
export interface PreparedHistoryExport { readonly files: readonly HistoryExportFile[]; readonly saleCount: number; readonly generatedAt: string; readonly totals: { readonly paidRappen: string; readonly refundedRappen: string; readonly netRappen: string } }
