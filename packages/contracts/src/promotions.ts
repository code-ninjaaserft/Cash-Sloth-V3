import {z} from 'zod';
import {CartSchema,IdentifierSchema,PosErrorSchema,RappenSchema} from './pos.js';
import {CheckoutViewSchema} from './payments.js';
export const VoucherCodeSchema=z.string().regex(/^(?:AC|AD)[0-9A-F]{14}$/u);
export const DiscountRuleSchema=z.strictObject({name:z.string().trim().min(1).max(120),kind:z.enum(['percent','amount','freeProduct']),value:RappenSchema,productId:IdentifierSchema.nullable(),variantId:IdentifierSchema.nullable().optional()});
export const DiscountTemplateSchema=DiscountRuleSchema.extend({id:IdentifierSchema});
export const VoucherSchema=z.strictObject({id:IdentifierSchema,code:VoucherCodeSchema,name:z.string().trim().min(1).max(120),kind:z.enum(['percent','amount','freeProduct','wallet']),value:RappenSchema,productId:IdentifierSchema.nullable(),variantId:IdentifierSchema.nullable().optional(),benefitLabel:z.string().min(1).max(450).optional(),maxUses:z.number().int().min(1).max(1000000).nullable(),expiresAt:z.iso.datetime().nullable(),revokedAt:z.iso.datetime().nullable(),issuedAt:z.iso.datetime(),mode:z.enum(['normal','demo'])});
export const VoucherInfoSchema=VoucherSchema.extend({uses:z.number().int().min(0),balanceRappen:RappenSchema,status:z.enum(['valid','expired','revoked','used'])});
const state=z.strictObject({templates:z.array(DiscountTemplateSchema).readonly(),vouchers:z.array(VoucherInfoSchema).readonly()});
function result<T extends z.ZodType>(value:T){return z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),value}),z.strictObject({ok:z.literal(false),error:PosErrorSchema})]);}
const cart={cartId:IdentifierSchema,expectedRevision:z.number().int().min(0),operationId:IdentifierSchema};
export const PROMOTIONS_CONTRACTS={
 getState:{channel:'promotions:getState',request:z.strictObject({}),response:result(state)},
 saveTemplate:{channel:'promotions:saveTemplate',request:z.strictObject({id:IdentifierSchema.nullable(),rule:DiscountRuleSchema,operationId:IdentifierSchema}),response:result(state)},
 removeTemplate:{channel:'promotions:removeTemplate',request:z.strictObject({id:IdentifierSchema}),response:result(state)},
 issue:{channel:'promotions:issue',request:VoucherSchema.omit({id:true,code:true,issuedAt:true,revokedAt:true,mode:true,benefitLabel:true}).extend({operationId:IdentifierSchema}),response:result(VoucherInfoSchema)},
 control:{channel:'promotions:control',request:z.strictObject({code:VoucherCodeSchema,maxUses:z.number().int().min(1).max(1000000).nullable(),expiresAt:z.iso.datetime().nullable(),revoke:z.boolean()}),response:result(VoucherInfoSchema)},
 apply:{channel:'promotions:apply',request:z.strictObject({...cart,rule:DiscountRuleSchema.nullable(),voucherCode:VoucherCodeSchema.nullable()}),response:result(CartSchema)},
 clear:{channel:'promotions:clear',request:z.strictObject(cart),response:result(CartSchema)},
 walletPay:{channel:'promotions:walletPay',request:z.strictObject({sessionId:IdentifierSchema,code:VoucherCodeSchema,amountRappen:RappenSchema,operationId:IdentifierSchema}),response:result(CheckoutViewSchema)},
 walletCancel:{channel:'promotions:walletCancel',request:z.strictObject({sessionId:IdentifierSchema,attemptId:IdentifierSchema,operationId:IdentifierSchema}),response:result(CheckoutViewSchema)},
} as const;
export type DiscountRule=z.infer<typeof DiscountRuleSchema>;export type DiscountTemplate=z.infer<typeof DiscountTemplateSchema>;export type Voucher=z.infer<typeof VoucherSchema>;export type VoucherInfo=z.infer<typeof VoucherInfoSchema>;
export type PromotionsState=z.infer<typeof state>;
export type PromotionsMethod=keyof typeof PROMOTIONS_CONTRACTS;
export type PromotionsRequest<K extends PromotionsMethod>=z.infer<(typeof PROMOTIONS_CONTRACTS)[K]['request']>;
export type PromotionsResponse<K extends PromotionsMethod>=z.infer<(typeof PROMOTIONS_CONTRACTS)[K]['response']>;
export type PromotionsApi={[K in PromotionsMethod]:(input:PromotionsRequest<K>)=>Promise<PromotionsResponse<K>>};
