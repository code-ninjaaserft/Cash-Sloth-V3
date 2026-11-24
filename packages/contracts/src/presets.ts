import { z } from 'zod';
import { IdentifierSchema, RevisionSchema, PosErrorSchema } from './pos.js';
import { CategorySchema, ManagedProductSchema } from './catalog.js';
export const PresetLogoSchema = z.strictObject({ name: z.string().trim().min(1).max(200).refine((value) => !/\p{Cc}/u.test(value)), dataUrl: z.string().max(1_500_000).startsWith('data:image/png;base64,iVBORw0KGgo').regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u).refine((value) => value.slice(22).length % 4 === 0) });
export type PresetLogo = z.infer<typeof PresetLogoSchema>;
const title = z.string().trim().min(1).max(200).refine((value) => !/\p{Cc}/u.test(value));
export const PresetSnapshotSchema = z.strictObject({ products: z.array(ManagedProductSchema).max(10000).readonly(), categories: z.array(CategorySchema).max(10000).readonly() });
export const PresetSchema = z.strictObject({ logo: PresetLogoSchema.nullable().optional(), id: IdentifierSchema, name: title, revision: RevisionSchema, updatedAt: z.iso.datetime(), snapshot: PresetSnapshotSchema });
export const PresetSummarySchema = PresetSchema.omit({ snapshot: true }).extend({ products: z.number().int().min(0), variants: z.number().int().min(0), categories: z.number().int().min(0) });
export const PresetStateSchema = z.strictObject({ active: z.strictObject({ logo: PresetLogoSchema.nullable().optional(), id: IdentifierSchema, name: title }).nullable(), presets: z.array(PresetSummarySchema).readonly(), catalogVersion: z.string().length(64) });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
const operation = { operationId: IdentifierSchema, catalogVersion: z.string().length(64) };
export const PRESETS_IPC_CONTRACTS = {
  update: { channel: 'presets:update', request: z.strictObject({ ...operation, presetId: IdentifierSchema, expectedRevision: RevisionSchema, name: title, logo: PresetLogoSchema.nullable() }), response: result(PresetStateSchema) },
  getState: { channel: 'presets:getState', request: z.strictObject({}), response: result(PresetStateSchema) },
  save: { channel: 'presets:save', request: z.strictObject({ ...operation, presetId: IdentifierSchema.nullable(), expectedRevision: RevisionSchema.nullable(), name: title, logo: PresetLogoSchema.nullable().optional(), empty: z.boolean() }), response: result(PresetStateSchema) },
  load: { channel: 'presets:load', request: z.strictObject({ ...operation, presetId: IdentifierSchema, expectedRevision: RevisionSchema }), response: result(PresetStateSchema) },
  copy: { channel: 'presets:copy', request: z.strictObject({ ...operation, presetId: IdentifierSchema, expectedRevision: RevisionSchema, name: title }), response: result(PresetStateSchema) },
  remove: { channel: 'presets:remove', request: z.strictObject({ ...operation, presetId: IdentifierSchema, expectedRevision: RevisionSchema }), response: result(PresetStateSchema) },
  getOperation: { channel: 'presets:getOperation', request: z.strictObject({ operationId: IdentifierSchema }), response: result(PresetStateSchema.nullable()) },
} as const;
export type Preset = z.infer<typeof PresetSchema>;
export type PresetSnapshot = z.infer<typeof PresetSnapshotSchema>;
export type PresetState = z.infer<typeof PresetStateSchema>;
export type PresetsMethod = keyof typeof PRESETS_IPC_CONTRACTS;
export type PresetsRequest<K extends PresetsMethod> = z.input<(typeof PRESETS_IPC_CONTRACTS)[K]['request']>;
export type PresetsResponse<K extends PresetsMethod> = z.output<(typeof PRESETS_IPC_CONTRACTS)[K]['response']>;
export type PresetsApi = { readonly [K in PresetsMethod]: (request: PresetsRequest<K>) => Promise<PresetsResponse<K>> };
