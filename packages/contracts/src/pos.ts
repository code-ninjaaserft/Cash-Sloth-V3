import { z } from 'zod';

export const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const RappenSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const RevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantity = z.number().int().min(1).max(9999);
const name = z.string().min(1).max(200).refine((value) => value.trim().length > 0);
const timestamp = z.iso.datetime();
export const CatalogItemSchema = z.strictObject({ ticketUses: z.union([z.number().int().min(0).max(1000),z.literal(2147483647)]).optional(), productId: IdentifierSchema, variantId: IdentifierSchema, productName: name, variantName: name, unitPriceRappen: RappenSchema, productActive: z.boolean(), active: z.boolean() });
export const CartItemSchema = z.strictObject({ originalUnitPriceRappen:RappenSchema.optional(),discountLabel:z.string().min(1).max(120).optional(), ticketUses: z.union([z.number().int().min(0).max(1000),z.literal(2147483647)]).optional(), id: IdentifierSchema, productId: IdentifierSchema, variantId: IdentifierSchema, productName: name, variantName: name, unitPriceRappen: RappenSchema, quantity, lineTotalRappen: RappenSchema });
export const CartSchema = z.strictObject({ id: IdentifierSchema, revision: RevisionSchema, items: z.array(CartItemSchema).max(1000).readonly(), subtotalRappen: RappenSchema });
export const CheckoutAttemptSchema = z.strictObject({
  idempotencyKey: IdentifierSchema, cartId: IdentifierSchema, cartRevision: RevisionSchema,
  subtotalRappen: RappenSchema, roundingAdjustmentRappen: z.number().int().min(-2).max(2), amountDueRappen: RappenSchema,
  status: z.enum(['prepared', 'confirmed', 'completed']), cashReceivedRappen: RappenSchema.nullable(),
  confirmedAt: timestamp.nullable(), saleId: IdentifierSchema.nullable(), createdAt: timestamp,
});
export const SalePaymentSchema = z.strictObject({ method: z.literal('cash'), cashReceivedRappen: RappenSchema, cashAppliedRappen: RappenSchema, changeRappen: RappenSchema, operatorConfirmed: z.literal(true), confirmedAt: timestamp });
export const SaleSchema = z.strictObject({
  id: IdentifierSchema, idempotencyKey: IdentifierSchema, cartId: IdentifierSchema, cartRevision: RevisionSchema,
  completedAt: timestamp, items: z.array(CartItemSchema).min(1).max(1000).readonly(),
  subtotalRappen: RappenSchema, roundingAdjustmentRappen: z.number().int().min(-2).max(2), amountDueRappen: RappenSchema,
  payment: SalePaymentSchema,
});
export const PosErrorSchema = z.strictObject({ code: z.string().min(1).max(64), message: z.string().min(1).max(300) });
export type PosError = z.infer<typeof PosErrorSchema>;
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PosError };
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]);
}
const empty = z.strictObject({});
const cartMutation = { cartId: IdentifierSchema, expectedRevision: RevisionSchema };
const cartState = z.strictObject({ cart: CartSchema, pendingCheckout: CheckoutAttemptSchema.nullable() });
export const POS_IPC_CONTRACTS = {
  listCatalog: { channel: 'pos:listCatalog', request: empty, response: result(z.array(CatalogItemSchema).readonly()) },
  getCart: { channel: 'pos:getCart', request: empty, response: result(cartState) },
  addItem: { channel: 'pos:addItem', request: z.strictObject({ ...cartMutation, variantId: IdentifierSchema }), response: result(CartSchema) },
  setQuantity: { channel: 'pos:setQuantity', request: z.strictObject({ ...cartMutation, lineId: IdentifierSchema, quantity }), response: result(CartSchema) },
  removeItem: { channel: 'pos:removeItem', request: z.strictObject({ ...cartMutation, lineId: IdentifierSchema }), response: result(CartSchema) },
  clearCart: { channel: 'pos:clearCart', request: z.strictObject(cartMutation), response: result(CartSchema) },
  prepareCheckout: { channel: 'pos:prepareCheckout', request: z.strictObject(cartMutation), response: result(CheckoutAttemptSchema) },
  completeSale: { channel: 'pos:completeSale', request: z.strictObject({ idempotencyKey: IdentifierSchema, cashReceivedRappen: RappenSchema, operatorConfirmed: z.literal(true) }), response: result(SaleSchema) },
  reconcileCheckout: { channel: 'pos:reconcileCheckout', request: z.strictObject({ idempotencyKey: IdentifierSchema }), response: result(z.strictObject({ attempt: CheckoutAttemptSchema, sale: SaleSchema.nullable() })) },
  getSale: { channel: 'pos:getSale', request: z.strictObject({ saleId: IdentifierSchema }), response: result(SaleSchema) },
  listRecentSales: { channel: 'pos:listRecentSales', request: empty, response: result(z.array(SaleSchema).max(20).readonly()) },
} as const;
export type PosMethod = keyof typeof POS_IPC_CONTRACTS;
export type PosRequest<K extends PosMethod> = z.input<(typeof POS_IPC_CONTRACTS)[K]['request']>;
export type PosResponse<K extends PosMethod> = z.output<(typeof POS_IPC_CONTRACTS)[K]['response']>;
export type PosApi = { readonly [K in PosMethod]: (request: PosRequest<K>) => Promise<PosResponse<K>> };
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type Cart = z.infer<typeof CartSchema>;
export type CartItem = z.infer<typeof CartItemSchema>;
export type CheckoutAttempt = z.infer<typeof CheckoutAttemptSchema>;
export type Sale = z.infer<typeof SaleSchema>;
export type CartState = z.infer<typeof cartState>;
