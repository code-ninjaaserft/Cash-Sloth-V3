import { z } from 'zod';
import { IdentifierSchema, RappenSchema, RevisionSchema, PosErrorSchema } from './pos.js';

const storedName = z.string().min(1).max(200).refine((value) => value.trim().length > 0);
const name = storedName.refine((value) => value === value.trim() && !/\p{Cc}/u.test(value));
const text = z.string().max(4000).nullable();
const metadata = z.string().min(1).max(100).nullable();
const imageReference = z.string().min(1).max(500).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u).refine((value) => !value.split('/').includes('..')).nullable();
const position = z.number().int().min(0).max(1_000_000);
const variantFields = { name, unitPriceRappen: RappenSchema, sku: metadata, barcode: metadata, active: z.boolean(), position };
const productFields = { name, description: text, active: z.boolean(), imageReference };
const assignments = { categoryIds: z.array(IdentifierSchema).readonly(), primaryCategoryId: IdentifierSchema.nullable() };
const categoryFields = { name, parentId: IdentifierSchema.nullable(), active: z.boolean(), position };
export const ManagedVariantSchema = z.strictObject({ id: IdentifierSchema, productId: IdentifierSchema, ...variantFields, name: storedName, revision: RevisionSchema });
export const ManagedProductSchema = z.strictObject({ id: IdentifierSchema, ...productFields, name: storedName, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), revision: RevisionSchema, ...assignments, variants: z.array(ManagedVariantSchema).min(1).readonly() });
export const CategorySchema = z.strictObject({ id: IdentifierSchema, ...categoryFields, revision: RevisionSchema });
export const CategorySummarySchema = CategorySchema.extend({ productCount: z.number().int().min(0), browseable: z.boolean() });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
export const CATALOG_IPC_CONTRACTS = {
  listProducts: { channel: 'catalog:listProducts', request: z.strictObject({ query: z.string().max(200), categoryId: IdentifierSchema.nullable(), restrictToCategory: z.boolean(), includeInactive: z.boolean() }), response: result(z.array(ManagedProductSchema).readonly()) },
  getProduct: { channel: 'catalog:getProduct', request: z.strictObject({ productId: IdentifierSchema }), response: result(ManagedProductSchema) },
  createProduct: { channel: 'catalog:createProduct', request: z.strictObject({ ...productFields, ...assignments, firstVariant: z.strictObject(variantFields) }), response: result(ManagedProductSchema) },
  updateProduct: { channel: 'catalog:updateProduct', request: z.strictObject({ productId: IdentifierSchema, expectedRevision: RevisionSchema, ...productFields }), response: result(ManagedProductSchema) },
  createVariant: { channel: 'catalog:createVariant', request: z.strictObject({ productId: IdentifierSchema, expectedProductRevision: RevisionSchema, ...variantFields }), response: result(ManagedProductSchema) },
  updateVariant: { channel: 'catalog:updateVariant', request: z.strictObject({ productId: IdentifierSchema, variantId: IdentifierSchema, expectedProductRevision: RevisionSchema, expectedRevision: RevisionSchema, ...variantFields }), response: result(ManagedProductSchema) },
  assignCategories: { channel: 'catalog:assignCategories', request: z.strictObject({ productId: IdentifierSchema, expectedRevision: RevisionSchema, ...assignments }), response: result(ManagedProductSchema) },
  listCategories: { channel: 'catalog:listCategories', request: z.strictObject({ includeInactive: z.boolean() }), response: result(z.array(CategorySummarySchema).readonly()) },
  createCategory: { channel: 'catalog:createCategory', request: z.strictObject(categoryFields), response: result(CategorySchema) },
  updateCategory: { channel: 'catalog:updateCategory', request: z.strictObject({ categoryId: IdentifierSchema, expectedRevision: RevisionSchema, ...categoryFields }), response: result(CategorySchema) },
} as const;
export type CatalogMethod = keyof typeof CATALOG_IPC_CONTRACTS;
export type CatalogRequest<K extends CatalogMethod> = z.input<(typeof CATALOG_IPC_CONTRACTS)[K]['request']>;
export type CatalogResponse<K extends CatalogMethod> = z.output<(typeof CATALOG_IPC_CONTRACTS)[K]['response']>;
export type CatalogApi = { readonly [K in CatalogMethod]: (request: CatalogRequest<K>) => Promise<CatalogResponse<K>> };
export type ManagedProduct = z.infer<typeof ManagedProductSchema>;
export type ManagedVariant = z.infer<typeof ManagedVariantSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type CategorySummary = z.infer<typeof CategorySummarySchema>;
