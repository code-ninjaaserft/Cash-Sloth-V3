import { describe, expect, it } from 'vitest';
import { CATALOG_IPC_CONTRACTS, type CatalogRequest, type Result } from '@cash-sloth/contracts';
import { DomainError, type Category, type ManagedProduct } from '@cash-sloth/domain';
import { createCatalogService, type CatalogService } from './catalog-service.js';
import type { CatalogStore } from './catalog-ports.js';
import { PersistenceError } from './ports.js';

class MemoryCatalogStore implements CatalogStore {
  products: ManagedProduct[] = [];
  categories: Category[] = [];
  transactions = 0;
  failNext: 'rolled-back' | 'unknown' | null = null;
  transaction<T>(operation: () => T): T {
    this.transactions++;
    const before = structuredClone({ products: this.products, categories: this.categories });
    try {
      const value = operation();
      if (this.failNext !== null) { const outcome = this.failNext; this.failNext = null; throw new PersistenceError(outcome); }
      return value;
    } catch (error) {
      if (!(error instanceof PersistenceError && error.outcome === 'unknown')) { this.products = before.products; this.categories = before.categories; }
      throw error;
    }
  }
  listProducts() { return this.products; }
  getProduct(id: string) { return this.products.find((product) => product.id === id) ?? null; }
  insertProduct(product: ManagedProduct) { this.products.push(product); }
  updateProduct(product: ManagedProduct, revision: number) {
    if (this.getProduct(product.id)?.revision !== revision) throw new DomainError('CONFLICT', 'Concurrent change.');
    this.products = this.products.map((entry) => entry.id === product.id ? product : entry);
  }
  listCategories() { return this.categories; }
  getCategory(id: string) { return this.categories.find((category) => category.id === id) ?? null; }
  insertCategory(category: Category) { this.categories.push(category); }
  updateCategory(category: Category, revision: number) {
    if (this.getCategory(category.id)?.revision !== revision) throw new DomainError('CONFLICT', 'Concurrent category change.');
    this.categories = this.categories.map((entry) => entry.id === category.id ? category : entry);
  }
}
const createRequest = (): CatalogRequest<'createProduct'> => ({
  name: 'Coffee', description: 'Fresh coffee', active: true, imageReference: null, categoryIds: [], primaryCategoryId: null,
  firstVariant: { name: 'Small', unitPriceRappen: 247, sku: ' coffee-s ', barcode: 'AbC', active: true, position: 10 },
});
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }
function fixture(): { store: MemoryCatalogStore; service: CatalogService; product: ManagedProduct } {
  const store = new MemoryCatalogStore(); let sequence = 0;
  const service = createCatalogService(store, { newId: () => `catalog-${++sequence}`, now: () => '2026-11-12T12:00:00.000Z' });
  return { store, service, product: unwrap(service.createProduct(createRequest())) };
}
const metadata = (product: ManagedProduct): CatalogRequest<'updateProduct'> => ({ productId: product.id, expectedRevision: product.revision, name: product.name, description: product.description, active: product.active, imageReference: product.imageReference });

describe('catalog application use cases', () => {
  it('atomically creates product and first variant with stable identities and canonical metadata', () => {
    const { store, product } = fixture();
    expect(store.products).toHaveLength(1);
    expect(product).toMatchObject({ id: 'catalog-1', revision: 0, variants: [{ id: 'catalog-2', productId: 'catalog-1', revision: 0, sku: 'COFFEE-S', barcode: 'AbC', unitPriceRappen: 247 }] });
    expect(CATALOG_IPC_CONTRACTS.createProduct.response.safeParse({ ok: true, value: product }).success).toBe(true);
  });
  it('validates untrusted requests before opening a transaction or creating identifiers', () => {
    const { store, service } = fixture(); const before = store.transactions;
    for (const request of [null, {}, { ...createRequest(), unexpected: true }, { ...createRequest(), name: ' Coffee ' }, { ...createRequest(), firstVariant: { ...createRequest().firstVariant, unitPriceRappen: 1.5 } }]) {
      expect(service.createProduct(request as CatalogRequest<'createProduct'>)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(store.transactions).toBe(before);
    expect(store.products).toHaveLength(1);
  });
  it('updates product metadata without changing its identity, creation time or variants', () => {
    const { service, product } = fixture();
    const updated = unwrap(service.updateProduct({ ...metadata(product), name: 'Renamed coffee', description: null, active: false }));
    expect(updated).toMatchObject({ id: product.id, createdAt: product.createdAt, revision: 1, name: 'Renamed coffee', active: false, variants: product.variants });
    expect(service.updateProduct({ ...metadata(product), name: 'Stale writer' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('creates and edits independently priced variants with aggregate and own revision checks', () => {
    const { service, product } = fixture();
    const withLarge = unwrap(service.createVariant({ productId: product.id, expectedProductRevision: 0, name: 'Large', unitPriceRappen: 450, sku: 'COFFEE-L', barcode: null, active: true, position: 0 }));
    expect(withLarge.revision).toBe(1);
    expect(withLarge.variants.map((variant) => variant.name)).toEqual(['Large', 'Small']);
    expect(CATALOG_IPC_CONTRACTS.createVariant.response.safeParse({ ok: true, value: withLarge }).success).toBe(true);
    const large = withLarge.variants[0]; if (!large) throw new Error('Missing fixture variant');
    const update = { productId: product.id, variantId: large.id, expectedProductRevision: 1, expectedRevision: 0, name: large.name, unitPriceRappen: 500, sku: large.sku, barcode: 'large', active: false, position: 0 };
    const changed = unwrap(service.updateVariant(update));
    expect(changed.variants[0]).toMatchObject({ id: large.id, revision: 1, unitPriceRappen: 500, active: false });
    expect(service.updateVariant(update)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(service.updateVariant({ ...update, expectedProductRevision: 2 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('reserves duplicate SKU/barcode globally including inactive variants', () => {
    const { service, product } = fixture();
    expect(service.createProduct(createRequest())).toMatchObject({ ok: false, error: { code: 'DUPLICATE_SKU' } });
    expect(service.createProduct({ ...createRequest(), firstVariant: { ...createRequest().firstVariant, sku: null } })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_BARCODE' } });
    const alternative = unwrap(service.createProduct({ ...createRequest(), name: 'Other', firstVariant: { ...createRequest().firstVariant, sku: null, barcode: 'abc', active: false } }));
    expect(alternative.variants[0]?.barcode).toBe('abc');
    expect(service.createVariant({ productId: product.id, expectedProductRevision: 0, name: 'Duplicate', unitPriceRappen: 100, sku: 'coffee-s', barcode: null, active: false, position: 2 })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_SKU' } });
  });
  it('creates, moves and deactivates categories while rejecting stale writes and cycles', () => {
    const { service } = fixture();
    const root = unwrap(service.createCategory({ name: 'Drinks', parentId: null, active: true, position: 0 }));
    const child = unwrap(service.createCategory({ name: 'Coffee', parentId: root.id, active: true, position: 1 }));
    expect(service.updateCategory({ categoryId: root.id, expectedRevision: 0, name: root.name, parentId: child.id, active: true, position: 0 })).toMatchObject({ ok: false, error: { code: 'CATEGORY_CYCLE' } });
    const moved = unwrap(service.updateCategory({ categoryId: child.id, expectedRevision: 0, name: child.name, parentId: null, active: false, position: 2 }));
    expect(moved).toMatchObject({ parentId: null, active: false, revision: 1 });
    expect(service.updateCategory({ categoryId: child.id, expectedRevision: 0, name: child.name, parentId: null, active: true, position: 3 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('assigns multiple categories with a primary and deduplicated descendant counts', () => {
    const { service, product } = fixture();
    const root = unwrap(service.createCategory({ name: 'Drinks', parentId: null, active: true, position: 0 }));
    const child = unwrap(service.createCategory({ name: 'Coffee', parentId: root.id, active: true, position: 0 }));
    const assigned = unwrap(service.assignCategories({ productId: product.id, expectedRevision: 0, categoryIds: [root.id, child.id], primaryCategoryId: child.id }));
    expect(assigned.revision).toBe(1);
    expect(unwrap(service.listCategories({ includeInactive: false })).map((category) => category.productCount)).toEqual([1, 1]);
    expect(unwrap(service.listProducts({ query: '', categoryId: root.id, restrictToCategory: false, includeInactive: false }))).toHaveLength(1);
    expect(service.assignCategories({ productId: product.id, expectedRevision: 1, categoryIds: [root.id], primaryCategoryId: child.id })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(service.assignCategories({ productId: product.id, expectedRevision: 1, categoryIds: ['missing'], primaryCategoryId: null })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('preserves migrated legacy whitespace names when reading and editing another field', () => {
    const { service, store, product } = fixture();
    store.products = [{ ...product, name: ' Coffee ', variants: product.variants.map((variant) => ({ ...variant, name: ' Small ' })) }];
    const read = unwrap(service.getProduct({ productId: product.id }));
    expect(read.name).toBe(' Coffee ');
    const variant = read.variants[0]; if (!variant) throw new Error('Missing fixture variant');
    const updated = unwrap(service.updateVariant({ productId: product.id, variantId: variant.id, expectedProductRevision: 0, expectedRevision: 0, name: 'Small', unitPriceRappen: 300, sku: variant.sku, barcode: variant.barcode, active: true, position: 10 }));
    expect(updated.name).toBe(' Coffee ');
    expect(updated.variants[0]?.unitPriceRappen).toBe(300);
  });
  it('distinguishes failed saves from uncertain commits and never returns unchecked success', () => {
    const { service, store, product } = fixture();
    store.failNext = 'rolled-back';
    expect(service.updateProduct({ ...metadata(product), name: 'Rolled back' })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    expect(store.products[0]?.name).toBe('Coffee');
    store.failNext = 'unknown';
    expect(service.updateProduct({ ...metadata(product), name: 'Possibly saved' })).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    expect(store.products[0]?.name).toBe('Possibly saved');
    expect(unwrap(service.getProduct({ productId: product.id })).name).toBe('Possibly saved');
  });
});
