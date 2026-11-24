import { PresetLogoSchema } from './presets.js';
import { z } from 'zod';
import { IdentifierSchema, PosErrorSchema, RappenSchema } from './pos.js';
const item = z.strictObject({ productName: z.string().min(1).max(200), variantName: z.string().min(1).max(200), quantity: z.number().int().min(1).max(9999), unitPriceRappen: RappenSchema, lineTotalRappen: RappenSchema });
export const CustomerDisplayStateSchema = z.strictObject({ demoMode: z.boolean().optional(), logo: PresetLogoSchema.nullable().optional(), eventTitle: z.string().min(1).max(200).nullable(), items: z.array(item).max(1000).readonly(), subtotalRappen: RappenSchema, tipRappen: RappenSchema, roundingAdjustmentRappen: z.number().int().min(-2).max(2), totalRappen: RappenSchema, outstandingRappen: RappenSchema, cashReceivedRappen: RappenSchema.nullable(), changeRappen: RappenSchema.nullable(), checkoutActive: z.boolean() });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
export const CUSTOMER_DISPLAY_CONTRACTS = {
  open: { channel: 'customerDisplay:open', request: z.strictObject({}), response: result(z.strictObject({ opened: z.literal(true) })) },
  preview: { channel: 'customerDisplay:preview', request: z.strictObject({ sessionId: IdentifierSchema, method: z.enum(['cash', 'card', 'twint', 'voucher']).nullable(), tipRappen: RappenSchema, cashReceivedRappen: RappenSchema.nullable() }), response: result(z.strictObject({ accepted: z.literal(true) })) },
  getState: { channel: 'customerDisplay:getState', request: z.strictObject({}), response: result(CustomerDisplayStateSchema) },
} as const;
export type CustomerDisplayState = z.infer<typeof CustomerDisplayStateSchema>;
export type CustomerPaymentPreview = z.infer<typeof CUSTOMER_DISPLAY_CONTRACTS.preview.request>;
export interface CustomerDisplayApi {
  open(input: Record<string, never>): Promise<z.infer<typeof CUSTOMER_DISPLAY_CONTRACTS.open.response>>;
  preview(input: CustomerPaymentPreview): Promise<z.infer<typeof CUSTOMER_DISPLAY_CONTRACTS.preview.response>>;
}
export interface CustomerReadApi { getState(input: Record<string, never>): Promise<z.infer<typeof CUSTOMER_DISPLAY_CONTRACTS.getState.response>> }
