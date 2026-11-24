import { z } from 'zod';
import { IdentifierSchema, PosErrorSchema, RappenSchema } from './pos.js';

const date = z.iso.date().refine((value) => value >= '1900-01-01' && value <= '9998-12-31', 'History dates must be from 1900 through 9998.');
const timestamp = z.iso.datetime();
export const HistoryFiltersSchema = z.strictObject({
  scope: z.enum(['device', 'event']).optional(), eventId: IdentifierSchema.nullable().optional(), includeRemoved: z.boolean().optional(),
  dateFrom: date.nullable(), dateTo: date.nullable(),
  paymentMethod: z.enum(['all', 'cash', 'card', 'twint', 'voucher', 'mixed']),
  minTotalRappen: RappenSchema.nullable(), maxTotalRappen: RappenSchema.nullable(),
  refundStatus: z.enum(['all', 'none', 'partial', 'full']),
  saleId: z.string().trim().max(128).refine((value) => !/\p{Cc}/u.test(value)), productQuery: z.string().trim().max(200).refine((value) => !/\p{Cc}/u.test(value)),
}).refine((value) => value.dateFrom === null || value.dateTo === null || value.dateFrom <= value.dateTo, 'Start date must not follow end date.')
  .refine((value) => value.minTotalRappen === null || value.maxTotalRappen === null || value.minTotalRappen <= value.maxTotalRappen, 'Minimum total must not exceed maximum total.');
export const HistorySortSchema = z.strictObject({ field: z.enum(['date', 'total']), direction: z.enum(['asc', 'desc']) });
export const HistorySearchRequestSchema = z.strictObject({ filters: HistoryFiltersSchema, sort: HistorySortSchema, page: z.number().int().min(1).max(1_000_000), pageSize: z.number().int().min(1).max(100) });
export const HistoryExportRequestSchema = z.strictObject({ filters: HistoryFiltersSchema, sort: HistorySortSchema });
export const SaleHistoryEntrySchema = z.strictObject({ tipRappen: RappenSchema.optional(),
  eventId: IdentifierSchema.nullable().optional(), eventTitle: z.string().max(200).nullable().optional(), removedAt: timestamp.nullable().optional(), removalReason: z.string().max(1000).nullable().optional(),
  id: IdentifierSchema, completedAt: timestamp, subtotalRappen: RappenSchema,
  roundingAdjustmentRappen: z.number().int().min(-2).max(2), actualPaidRappen: RappenSchema,
  refundedRappen: RappenSchema, refundableRappen: RappenSchema,
  paymentMethod: z.enum(['cash', 'card', 'twint', 'voucher', 'mixed']), refundStatus: z.enum(['none', 'partial', 'full']),
  itemSummary: z.string().max(1000), source: z.enum(['legacy', 'payments']),
  unresolvedRefundCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reconciliationCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export const HistoryPageSchema = z.strictObject({ items: z.array(SaleHistoryEntrySchema).max(100).readonly(), total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), page: z.number().int().min(1).max(1_000_000), pageSize: z.number().int().min(1).max(100) });
export const SaleHistoryContextSchema = z.strictObject({ unresolvedRefundCount: z.number().int().min(0), reconciliationCount: z.number().int().min(0), lastReconciliationAt: timestamp.nullable() });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
const removalScope = z.strictObject({ scope: z.enum(['event', 'device']), eventId: IdentifierSchema.nullable() }).refine((input) => input.scope === 'event' || input.eventId === null);
export const HISTORY_IPC_CONTRACTS = {
  previewRemoval: { channel: 'history:previewRemoval', request: removalScope, response: result(z.strictObject({ count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), version: z.string().regex(/^[a-f0-9]{64}$/u) })) },
  removeHistory: { channel: 'history:removeHistory', request: z.strictObject({ scope: z.enum(['event', 'device']), eventId: IdentifierSchema.nullable(), operationId: IdentifierSchema, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/u), reason: z.string().trim().min(1).max(1000).refine((value) => !/\p{Cc}/u.test(value)) }).refine((input) => input.scope === 'event' || input.eventId === null), response: result(z.strictObject({ removedCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })) },
  getEvents: { channel: 'history:getEvents', request: z.strictObject({}), response: result(z.strictObject({ activeEventId: IdentifierSchema.nullable(), events: z.array(z.strictObject({ id: IdentifierSchema, title: z.string().min(1).max(200) })).readonly() })) },
  removeSale: { channel: 'history:removeSale', request: z.strictObject({ saleId: IdentifierSchema, reason: z.string().trim().min(1).max(1000).refine((value) => !/\p{Cc}/u.test(value)) }), response: result(z.strictObject({ removed: z.literal(true) })) },
  search: { channel: 'history:search', request: HistorySearchRequestSchema, response: result(HistoryPageSchema) },
  getSaleContext: { channel: 'history:getSaleContext', request: z.strictObject({ saleId: IdentifierSchema }), response: result(SaleHistoryContextSchema) },
} as const;
export type HistoryFilters = z.infer<typeof HistoryFiltersSchema>;
export type HistorySort = z.infer<typeof HistorySortSchema>;
export type HistorySearchRequest = z.infer<typeof HistorySearchRequestSchema>;
export type HistoryExportRequest = z.infer<typeof HistoryExportRequestSchema>;
export type SaleHistoryEntry = z.infer<typeof SaleHistoryEntrySchema>;
export type HistoryPage = z.infer<typeof HistoryPageSchema>;
export type SaleHistoryContext = z.infer<typeof SaleHistoryContextSchema>;
export type HistoryMethod = keyof typeof HISTORY_IPC_CONTRACTS;
export type HistoryRequest<K extends HistoryMethod> = z.input<(typeof HISTORY_IPC_CONTRACTS)[K]['request']>;
export type HistoryResponse<K extends HistoryMethod> = z.output<(typeof HISTORY_IPC_CONTRACTS)[K]['response']>;
export type HistoryApi = { readonly [K in HistoryMethod]: (request: HistoryRequest<K>) => Promise<HistoryResponse<K>> };
