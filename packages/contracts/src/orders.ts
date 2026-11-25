import {z} from 'zod';
import {CartSchema,IdentifierSchema,PosErrorSchema} from './pos.js';
import {ManagedProductSchema,CategorySummarySchema} from './catalog.js';
import {PresetLogoSchema} from './presets.js';
export const OrderSettingsSchema=z.strictObject({kiosk:z.boolean(),tableService:z.boolean(),infoDisplay:z.boolean(),kitchen:z.boolean(),registerOrders:z.boolean(),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export type OrderSettings=z.infer<typeof OrderSettingsSchema>;
const empty=z.strictObject({});
const result=<T extends z.ZodType>(value:T)=>z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),value}),z.strictObject({ok:z.literal(false),error:PosErrorSchema})]);
export const OrderSchema=z.strictObject({source:z.enum(['kiosk','register','table']).default('kiosk'),serviceLabel:z.string().trim().min(1).max(80).nullable().default(null),preparation:z.enum(['received','preparing','ready','collected','cancelled']).default('received'),revision:z.number().int().nonnegative().default(0),paid:z.boolean().default(false),id:IdentifierSchema,number:z.number().int().min(1).max(99).nullable(),eventId:IdentifierSchema.nullable(),eventTitle:z.string().min(1).max(200),createdAt:z.iso.datetime(),cart:CartSchema,status:z.enum(['waiting','register','paid','ready','collected','cancelled']),cartId:IdentifierSchema.nullable()});
export const KioskCatalogSchema=z.strictObject({eventId:IdentifierSchema.nullable(),eventTitle:z.string().min(1).max(200),logo:PresetLogoSchema.nullable(),version:z.string().min(1).max(128),products:z.array(ManagedProductSchema).readonly(),categories:z.array(CategorySummarySchema).readonly(),demoMode:z.boolean(),demoSessionId:IdentifierSchema.nullable().optional()});
export const ORDERS_CONTRACTS={
 getSettings:{channel:'orders:getSettings',request:empty,response:result(OrderSettingsSchema)},
 setSettings:{channel:'orders:setSettings',request:z.strictObject({operationId:IdentifierSchema,expectedRevision:z.number().int().nonnegative(),settings:OrderSettingsSchema.omit({revision:true})}),response:result(OrderSettingsSchema)},
 resetCounter:{channel:'orders:resetCounter',request:z.strictObject({operationId:IdentifierSchema}),response:result(z.strictObject({reset:z.literal(true)}))},
 openInfo:{channel:'orders:openInfo',request:empty,response:result(z.strictObject({opened:z.literal(true)}))},
 openKitchen:{channel:'orders:openKitchen',request:empty,response:result(z.strictObject({opened:z.literal(true)}))},
 book:{channel:'orders:book',request:z.strictObject({operationId:IdentifierSchema,cartId:IdentifierSchema,expectedRevision:z.number().int().nonnegative(),serviceLabel:z.string().trim().min(1).max(80).refine(v=>!/[\p{Cc}]/u.test(v))}),response:result(OrderSchema)},
 prepare:{channel:'orders:prepare',request:z.strictObject({operationId:IdentifierSchema,orderId:IdentifierSchema,expectedRevision:z.number().int().nonnegative(),preparation:z.enum(['preparing','ready','collected'])}),response:result(OrderSchema)},
 board:{channel:'orders:board',request:empty,response:result(z.strictObject({eventTitle:z.string().max(200),demoMode:z.boolean(),logo:PresetLogoSchema.nullable(),orders:z.array(z.strictObject({id:IdentifierSchema,number:z.number().int().min(1).max(99),preparation:z.enum(['received','preparing','ready'])})).readonly()}))},
 kitchen:{channel:'orders:kitchen',request:empty,response:result(z.strictObject({demoSessionId:IdentifierSchema.nullable().optional(),eventTitle:z.string().max(200),demoMode:z.boolean(),orders:z.array(OrderSchema).readonly()}))},
 open:{channel:'orders:open',request:empty,response:result(z.strictObject({opened:z.literal(true)}))},
 catalog:{channel:'orders:catalog',request:empty,response:result(KioskCatalogSchema)},
 submit:{channel:'orders:submit',request:z.strictObject({operationId:IdentifierSchema,eventId:IdentifierSchema.nullable(),version:z.string().min(1).max(128),items:z.array(z.strictObject({variantId:IdentifierSchema,quantity:z.number().int().min(1).max(9999)})).min(1).max(100)}),response:result(OrderSchema)},
 list:{channel:'orders:list',request:empty,response:result(z.array(OrderSchema).readonly())},
 accept:{channel:'orders:accept',request:z.strictObject({operationId:IdentifierSchema,orderId:IdentifierSchema}),response:result(CartSchema)},
 release:{channel:'orders:release',request:z.strictObject({operationId:IdentifierSchema,orderId:IdentifierSchema}),response:result(OrderSchema)},
 status:{channel:'orders:status',request:z.strictObject({operationId:IdentifierSchema,orderId:IdentifierSchema,status:z.enum(['cancelled','ready','collected'])}),response:result(OrderSchema)},
} as const;
export type Order=z.infer<typeof OrderSchema>;
export type KioskCatalog=z.infer<typeof KioskCatalogSchema>;
export type OrdersMethod=keyof typeof ORDERS_CONTRACTS;
export type OrdersRequest<K extends OrdersMethod>=z.input<(typeof ORDERS_CONTRACTS)[K]['request']>;
export type OrdersResponse<K extends OrdersMethod>=z.output<(typeof ORDERS_CONTRACTS)[K]['response']>;
export type OrdersApi={readonly [K in OrdersMethod]:(input:OrdersRequest<K>)=>Promise<OrdersResponse<K>>};
export type OrderInfoApi=Pick<OrdersApi,'board'>;
export type KitchenApi=Pick<OrdersApi,'kitchen'|'prepare'>;
export type KioskApi=Pick<OrdersApi,'catalog'|'submit'>;
