import { z } from 'zod';
import { IdentifierSchema, PosErrorSchema } from './pos.js';

export const CsvDelimiterSchema = z.enum(['auto', ',', ';']);
const column = z.number().int().min(0).max(63);
export const CsvMappingSchema = z.strictObject({
  productKey: column, productName: column, variantKey: column, variantName: column, price: column,
  description: column.nullable(), sku: column.nullable(), barcode: column.nullable(),
  categoryPaths: column.nullable(), productActive: column.nullable(), variantActive: column.nullable(),
});
export const ParsedCsvSchema = z.strictObject({
  encoding: z.enum(['UTF-8', 'UTF-8 BOM']), delimiter: z.enum([',', ';']),
  headers: z.array(z.string().max(4000)).min(1).max(64).readonly(),
  rows: z.array(z.strictObject({ rowNumber: z.number().int().min(2), values: z.array(z.string().max(4000)).max(64).readonly() })).max(100).readonly(),
  totalRows: z.number().int().min(0).max(10_000),
});
export const ImportIssueSchema = z.strictObject({ rowNumber: z.number().int().min(0), field: z.string().max(64), code: z.string().max(64), message: z.string().max(500), severity: z.enum(['error', 'warning']) });
export const ImportSummarySchema = z.strictObject({ newProducts: z.number().int().min(0), newVariants: z.number().int().min(0), newCategories: z.number().int().min(0), existingMatches: z.number().int().min(0), duplicateRows: z.number().int().min(0), skippedProducts: z.number().int().min(0), conflictingRecords: z.number().int().min(0), invalidRows: z.number().int().min(0) });
export const ImportPreviewSchema = z.strictObject({
  planId: IdentifierSchema, source: z.enum(['csv', 'demo']), canApply: z.boolean(), summary: ImportSummarySchema,
  issues: z.array(ImportIssueSchema).max(10_000).readonly(),
  products: z.array(z.strictObject({ productKey: z.string().max(64), name: z.string().max(200), variants: z.number().int().min(1), status: z.enum(['new', 'extend', 'match', 'skipped']) })).max(10_000).readonly(),
  categories: z.array(z.strictObject({ path: z.string().max(4000), status: z.enum(['new', 'match']) })).max(10_000).readonly(),
  createdAt: z.iso.datetime(),
});
export const ImportOperationSchema = z.strictObject({ idempotencyKey: IdentifierSchema, planId: IdentifierSchema, source: z.enum(['csv', 'demo']), completedAt: z.iso.datetime(), summary: ImportSummarySchema });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
const empty = z.strictObject({});
export const MANAGEMENT_IPC_CONTRACTS = {
  getCapabilities: { channel: 'management:getCapabilities', request: empty, response: result(z.strictObject({ developmentDemoAllowed: z.boolean(), demo: z.strictObject({ products: z.number().int(), variants: z.number().int(), activeVariants: z.number().int(), categories: z.number().int(), version: z.string().max(64) }) })) },
  parseCsv: { channel: 'management:parseCsv', request: z.strictObject({ text: z.string().max(2_097_152), delimiter: CsvDelimiterSchema }), response: result(ParsedCsvSchema) },
  previewCsvImport: { channel: 'management:previewCsvImport', request: z.strictObject({ text: z.string().max(2_097_152), delimiter: CsvDelimiterSchema, mapping: CsvMappingSchema }), response: result(ImportPreviewSchema) },
  previewDemoCatalog: { channel: 'management:previewDemoCatalog', request: empty, response: result(ImportPreviewSchema) },
  applyImportPlan: { channel: 'management:applyImportPlan', request: z.strictObject({ planId: IdentifierSchema, idempotencyKey: IdentifierSchema, operatorConfirmed: z.literal(true) }), response: result(ImportOperationSchema) },
  getImportOperation: { channel: 'management:getImportOperation', request: z.strictObject({ idempotencyKey: IdentifierSchema }), response: result(ImportOperationSchema.nullable()) },
} as const;
export type ManagementMethod = keyof typeof MANAGEMENT_IPC_CONTRACTS;
export type ManagementRequest<K extends ManagementMethod> = z.input<(typeof MANAGEMENT_IPC_CONTRACTS)[K]['request']>;
export type ManagementResponse<K extends ManagementMethod> = z.output<(typeof MANAGEMENT_IPC_CONTRACTS)[K]['response']>;
export type ManagementApi = { readonly [K in ManagementMethod]: (request: ManagementRequest<K>) => Promise<ManagementResponse<K>> };
export type CsvMapping = z.infer<typeof CsvMappingSchema>;
export type ParsedCsv = z.infer<typeof ParsedCsvSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type ImportIssue = z.infer<typeof ImportIssueSchema>;
export type ImportSummary = z.infer<typeof ImportSummarySchema>;
export type ImportOperation = z.infer<typeof ImportOperationSchema>;
