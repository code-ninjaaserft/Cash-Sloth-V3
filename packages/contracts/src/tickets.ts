import { z } from 'zod';
import { IdentifierSchema, PosErrorSchema } from './pos.js';
export const TicketCodeSchema = z.string().regex(/^(?:CS|DS)[0-9A-F]{14}$/u);
export const TicketSchema = z.strictObject({ mode: z.enum(['normal','demo']).default('normal'), code: TicketCodeSchema, saleId: IdentifierSchema, saleItemId: IdentifierSchema, ordinal: z.number().int().min(1).max(9999), productName: z.string().min(1).max(200), variantName: z.string().min(1).max(200), eventTitle: z.string().min(1).max(200).nullable(), issuedAt: z.iso.datetime(), maxUses: z.union([z.number().int().min(1).max(1000),z.literal(2147483647)]) });
export const TicketControlsSchema=z.strictObject({expiresAt:z.iso.datetime().nullable(),revokedAt:z.iso.datetime().nullable()});
export const TicketInfoSchema = TicketSchema.extend({ expiresAt:z.iso.datetime().nullable().optional(),revokedAt:z.iso.datetime().nullable().optional(),status: z.enum(['valid','used','refunded','expired','revoked']), remainingUses: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), redemptions: z.array(z.strictObject({ operationId: IdentifierSchema, redeemedAt: z.iso.datetime() })).readonly() });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
export const TICKETS_CONTRACTS = {
 invalidate: {channel:'tickets:invalidate',request:z.strictObject({code:TicketCodeSchema}),response:result(TicketInfoSchema)},
 setExpiry: {channel:'tickets:setExpiry',request:z.strictObject({code:TicketCodeSchema,expiresAt:z.iso.datetime().nullable()}),response:result(TicketInfoSchema)},
 listForSale: { channel: 'tickets:listForSale', request: z.strictObject({ saleId: IdentifierSchema }), response: result(z.array(TicketInfoSchema).max(1000).readonly()) },
 lookup: { channel: 'tickets:lookup', request: z.strictObject({ code: TicketCodeSchema }), response: result(TicketInfoSchema) },
 redeem: { channel: 'tickets:redeem', request: z.strictObject({ code: TicketCodeSchema, operationId: IdentifierSchema, expectedUses: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1), operatorConfirmed: z.literal(true) }), response: result(TicketInfoSchema) },
} as const;
export type TicketInfo = z.infer<typeof TicketInfoSchema>;
export type TicketsApi = { [K in keyof typeof TICKETS_CONTRACTS]: (request: z.input<(typeof TICKETS_CONTRACTS)[K]['request']>) => Promise<z.infer<(typeof TICKETS_CONTRACTS)[K]['response']>> };
