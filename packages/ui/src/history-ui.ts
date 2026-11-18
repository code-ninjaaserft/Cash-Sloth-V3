import { HistoryFiltersSchema, type HistoryFilters, type HistorySort } from '@cash-sloth/contracts';
import { parseChfInput } from '@cash-sloth/domain';

export interface HistoryFilterDraft {
  readonly dateFrom: string; readonly dateTo: string;
  readonly paymentMethod: HistoryFilters['paymentMethod']; readonly refundStatus: HistoryFilters['refundStatus'];
  readonly minimum: string; readonly maximum: string; readonly saleId: string; readonly productQuery: string;
}
export const EMPTY_HISTORY_DRAFT: HistoryFilterDraft = { dateFrom: '', dateTo: '', paymentMethod: 'all', refundStatus: 'all', minimum: '', maximum: '', saleId: '', productQuery: '' };
export const DEFAULT_HISTORY_SORT: HistorySort = { field: 'date', direction: 'desc' };

/** Calendar dates stay dates: the Application owns Europe/Zurich DST conversion. */
export function historyFiltersFromDraft(draft: HistoryFilterDraft): HistoryFilters {
  const filters = {
    dateFrom: draft.dateFrom || null, dateTo: draft.dateTo || null,
    paymentMethod: draft.paymentMethod, refundStatus: draft.refundStatus,
    minTotalRappen: draft.minimum.trim() ? parseChfInput(draft.minimum) : null,
    maxTotalRappen: draft.maximum.trim() ? parseChfInput(draft.maximum) : null,
    saleId: draft.saleId.trim(), productQuery: draft.productQuery.trim(),
  };
  const parsed = HistoryFiltersSchema.safeParse(filters);
  if (!parsed.success) throw new Error('Check the date range, minimum/maximum total and search lengths.');
  return parsed.data;
}
export function historySortFromValue(value: string): HistorySort {
  if (!/^(?:date|total)-(?:asc|desc)$/u.test(value)) throw new Error('Invalid history sort.');
  const [field, direction] = value.split('-');
  if ((field !== 'date' && field !== 'total') || (direction !== 'asc' && direction !== 'desc')) throw new Error('Invalid history sort.');
  return { field, direction };
}
