import { z } from 'zod';
import { PosErrorSchema } from './pos.js';
import { HistoryExportRequestSchema } from './history.js';

const cancelled = z.strictObject({ cancelled: z.literal(true) });
export const ChosenCatalogCsvSchema = z.discriminatedUnion('cancelled', [cancelled,
  z.strictObject({ cancelled: z.literal(false), name: z.string().min(1).max(255), text: z.string().max(2_097_152), encoding: z.enum(['UTF-8', 'UTF-8 BOM']) }),
]);
export const WrittenHistoryExportSchema = z.discriminatedUnion('cancelled', [cancelled,
  z.strictObject({ cancelled: z.literal(false), directory: z.string().min(1).max(4096), files: z.array(z.string().regex(/^[a-z_]+\.csv$/u)).length(5).readonly(), saleCount: z.number().int().min(0).max(5000), generatedAt: z.iso.datetime() }),
]);
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]);
}
export const FILES_IPC_CONTRACTS = {
  chooseCatalogCsv: { channel: 'files:chooseCatalogCsv', request: z.strictObject({}), response: result(ChosenCatalogCsvSchema) },
  exportSalesHistory: { channel: 'files:exportSalesHistory', request: HistoryExportRequestSchema, response: result(WrittenHistoryExportSchema) },
} as const;
export type FilesMethod = keyof typeof FILES_IPC_CONTRACTS;
export type FilesRequest<K extends FilesMethod> = z.input<(typeof FILES_IPC_CONTRACTS)[K]['request']>;
export type FilesResponse<K extends FilesMethod> = z.output<(typeof FILES_IPC_CONTRACTS)[K]['response']>;
export type FilesApi = { readonly [K in FilesMethod]: (request: FilesRequest<K>) => Promise<FilesResponse<K>> };
