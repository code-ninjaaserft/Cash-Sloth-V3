import { CATALOG_IPC_CONTRACTS, type CatalogMethod, type CatalogRequest, type CatalogResponse, type Result } from '@cash-sloth/contracts';
import {
  assertIdentifier, assertRevision, assertUniqueVariantMetadata, categorySummaries, compareCatalogOrder, DomainError, nextRevision,
  normalizeBarcode, normalizeSku, searchCatalog, validateCategoryForest, validateManagedProduct,
  type Category, type ManagedProduct, type ManagedVariant,
} from '@cash-sloth/domain';
import { PersistenceError } from './ports.js';
import type { CatalogRuntime, CatalogStore } from './catalog-ports.js';

export type CatalogService = { [K in CatalogMethod]: (request: CatalogRequest<K>) => CatalogResponse<K> };

function safe<T>(operation: () => T): Result<T> {
  try { return { ok: true, value: operation() }; }
  catch (error: unknown) {
    if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message } };
    if (error instanceof PersistenceError && error.outcome === 'unknown') return { ok: false, error: { code: 'COMMIT_UNCERTAIN', message: 'The catalog save outcome is uncertain. Reload the catalog before retrying; do not submit a new create request blindly.' } };
    return { ok: false, error: { code: 'STORAGE_ERROR', message: 'The catalog operation could not be confirmed. Reload before retrying.' } };
  }
}
function checkedRequest<K extends CatalogMethod>(method: K, request: CatalogRequest<K>): CatalogRequest<K> {
  const result = CATALOG_IPC_CONTRACTS[method].request.safeParse(request);
  if (!result.success) throw new DomainError('INVALID_INPUT', 'Invalid catalog request. Check names, prices, identifiers and required fields.');
  // All schemas share their exact method key; this cast narrows the mapped union.
  return result.data as CatalogRequest<K>;
}

export function createCatalogService(store: CatalogStore, runtime: CatalogRuntime): CatalogService {
  const get = (productId: string, revision?: number): ManagedProduct => {
    assertIdentifier(productId);
    const product = store.getProduct(productId);
    if (product === null) throw new DomainError('NOT_FOUND', 'Product does not exist.');
    validateManagedProduct(product);
    if (revision !== undefined) { assertRevision(revision); if (product.revision !== revision) throw new DomainError('CONFLICT', 'This product changed in another editor. Reload it before saving.'); }
    return product;
  };
  const checkAssignments = (product: ManagedProduct): void => {
    const categories = new Set(store.listCategories().map((category) => category.id));
    for (const id of product.categoryIds) if (!categories.has(id)) throw new DomainError('NOT_FOUND', 'An assigned category no longer exists.');
  };
  const persist = (product: ManagedProduct, expectedRevision: number): ManagedProduct => {
    validateManagedProduct(product); checkAssignments(product); assertUniqueVariantMetadata(store.listProducts(), product);
    const sorted = { ...product, variants: [...product.variants].sort(compareCatalogOrder) };
    store.updateProduct(sorted, expectedRevision);
    return sorted;
  };
  const changed = (product: ManagedProduct): ManagedProduct => ({ ...product, revision: nextRevision(product.revision), updatedAt: runtime.now() });
  const newVariant = (productId: string, fields: CatalogRequest<'createProduct'>['firstVariant']): ManagedVariant => ({
    id: runtime.newId(), productId, name: fields.name, unitPriceRappen: fields.unitPriceRappen,
    active: fields.active, position: fields.position, sku: normalizeSku(fields.sku), barcode: normalizeBarcode(fields.barcode), revision: 0,
  });
  return {
    listProducts: (request) => safe(() => {
      const query = checkedRequest('listProducts', request);
      return store.transaction(() => searchCatalog(store.listProducts(), store.listCategories(), query));
    }),
    getProduct: (request) => safe(() => {
      const input = checkedRequest('getProduct', request);
      return store.transaction(() => get(input.productId));
    }),
    createProduct: (request) => safe(() => {
      const input = checkedRequest('createProduct', request);
      return store.transaction(() => {
        if (!input.categoryIds.some((id) => store.getCategory(id)?.active)) throw new DomainError('CATEGORY_REQUIRED', 'Choose an active category before creating a product.');
        const id = runtime.newId(); const now = runtime.now();
        const product: ManagedProduct = { ...((input.ticketUses ?? 0) > 0 ? { ticketUses: input.ticketUses } : {}), id, name: input.name, description: input.description, active: input.active, imageReference: input.imageReference, createdAt: now, updatedAt: now, revision: 0, categoryIds: [...input.categoryIds], primaryCategoryId: input.primaryCategoryId, variants: [input.firstVariant, ...(input.additionalVariants ?? [])].map((fields) => newVariant(id, fields)) };
        validateManagedProduct(product); checkAssignments(product); assertUniqueVariantMetadata(store.listProducts(), product);
        store.insertProduct(product);
        return product;
      });
    }),
    updateProduct: (request) => safe(() => {
      const input = checkedRequest('updateProduct', request);
      return store.transaction(() => {
        const product = get(input.productId, input.expectedRevision);
        return persist({ ...changed(product), ...(input.ticketUses === undefined ? {} : { ticketUses: input.ticketUses }), name: input.name, description: input.description, active: input.active, imageReference: input.imageReference }, input.expectedRevision);
      });
    }),
    createVariant: (request) => safe(() => {
      const input = checkedRequest('createVariant', request);
      return store.transaction(() => {
        const product = get(input.productId, input.expectedProductRevision);
        const variant = newVariant(product.id, input);
        return persist({ ...changed(product), variants: [...product.variants, variant] }, input.expectedProductRevision);
      });
    }),
    updateVariant: (request) => safe(() => {
      const input = checkedRequest('updateVariant', request);
      return store.transaction(() => {
        const product = get(input.productId, input.expectedProductRevision);
        const variant = product.variants.find((entry) => entry.id === input.variantId);
        if (variant === undefined) throw new DomainError('NOT_FOUND', 'Variant does not belong to this product.');
        if (variant.revision !== input.expectedRevision) throw new DomainError('CONFLICT', 'This variant changed in another editor. Reload it before saving.');
        const updated: ManagedVariant = { ...variant, name: input.name, unitPriceRappen: input.unitPriceRappen, sku: normalizeSku(input.sku), barcode: normalizeBarcode(input.barcode), active: input.active, position: input.position, revision: nextRevision(variant.revision) };
        return persist({ ...changed(product), variants: product.variants.map((entry) => entry.id === updated.id ? updated : entry) }, input.expectedProductRevision);
      });
    }),
    assignCategories: (request) => safe(() => {
      const input = checkedRequest('assignCategories', request);
      return store.transaction(() => {
        const product = get(input.productId, input.expectedRevision);
        return persist({ ...changed(product), categoryIds: [...input.categoryIds], primaryCategoryId: input.primaryCategoryId }, input.expectedRevision);
      });
    }),
    removeVariant: (request) => safe(() => {
      const input = checkedRequest('removeVariant', request);
      return store.transaction(() => {
        const product = get(input.productId, input.expectedProductRevision);
        const variant = product.variants.find((entry) => entry.id === input.variantId);
        if (!variant) throw new DomainError('NOT_FOUND', 'Variant does not belong to this product.');
        if (variant.revision !== input.expectedRevision) throw new DomainError('CONFLICT', 'This variant changed. Reload it before deleting.');
        if (product.variants.length === 1) throw new DomainError('LAST_VARIANT', 'Keep at least one variant, or delete the product.');
        if (!store.removeVariant) throw new DomainError('NOT_SUPPORTED', 'Catalog deletion is unavailable.');
        store.removeVariant(product.id, variant.id, product.revision, variant.revision, runtime.now());
        return get(product.id);
      });
    }),
    removeProduct: (request) => safe(() => {
      const input = checkedRequest('removeProduct', request);
      return store.transaction(() => { get(input.productId, input.expectedRevision); if (!store.removeProduct) throw new DomainError('NOT_SUPPORTED', 'Catalog deletion is unavailable.'); store.removeProduct(input.productId, input.expectedRevision, runtime.now()); return { deleted: true as const }; });
    }),
    removeCategory: (request) => safe(() => {
      const input = checkedRequest('removeCategory', request);
      return store.transaction(() => { if (!store.getCategory(input.categoryId)) throw new DomainError('NOT_FOUND', 'Category does not exist.'); if (!store.removeCategory) throw new DomainError('NOT_SUPPORTED', 'Catalog deletion is unavailable.'); store.removeCategory(input.categoryId, input.expectedRevision, runtime.now()); return { deleted: true as const }; });
    }),
    listCategories: (request) => safe(() => {
      const input = checkedRequest('listCategories', request);
      return store.transaction(() => categorySummaries(store.listProducts(), store.listCategories(), input.includeInactive));
    }),
    createCategory: (request) => safe(() => {
      const input = checkedRequest('createCategory', request);
      return store.transaction(() => {
        const category: Category = { id: runtime.newId(), ...input, color: input.color ?? null, revision: 0 };
        validateCategoryForest([...store.listCategories(), category]);
        store.insertCategory(category);
        return category;
      });
    }),
    updateCategory: (request) => safe(() => {
      const input = checkedRequest('updateCategory', request);
      return store.transaction(() => {
        const category = store.getCategory(input.categoryId);
        if (category === null) throw new DomainError('NOT_FOUND', 'Category does not exist.');
        if (category.revision !== input.expectedRevision) throw new DomainError('CONFLICT', 'This category changed in another editor. Reload it before saving.');
        const updated: Category = { color: input.color === undefined ? category.color ?? null : input.color, id: category.id, name: input.name, parentId: input.parentId, active: input.active, position: input.position, revision: nextRevision(category.revision) };
        validateCategoryForest(store.listCategories().map((entry) => entry.id === category.id ? updated : entry));
        store.updateCategory(updated, input.expectedRevision);
        return updated;
      });
    }),
  };
}
