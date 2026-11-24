import { describe, expect, it, vi } from 'vitest';
import { CATALOG_IPC_CONTRACTS, type CatalogMethod } from '@cash-sloth/contracts';
import { handleValidatedIpc, type RuntimeParser, type SenderIdentity } from './ipc-security.js';

const trusted: SenderIdentity = { webContentsId: 1, frameProcessId: 2, frameRoutingId: 3, url: 'file:///pos/index.html' };
const product = { name: 'Test product', description: null, imageReference: null, active: true };
const variant = { name: 'Default', unitPriceRappen: 100, sku: null, barcode: null, active: true, position: 0 };
const category = { name: 'Test category', parentId: null, active: true, position: 0 };
const requests: Record<CatalogMethod, unknown> = {
  removeVariant: { productId: 'product-security', variantId: 'variant-security', expectedProductRevision: 0, expectedRevision: 0 },
  removeProduct: { productId: 'product-security', expectedRevision: 0 },
  removeCategory: { categoryId: 'category-security', expectedRevision: 0 },
  listProducts: { query: '', categoryId: null, restrictToCategory: false, includeInactive: false },
  getProduct: { productId: 'product-security' },
  createProduct: { ...product, firstVariant: variant, categoryIds: ['category-security'], primaryCategoryId: null },
  updateProduct: { ...product, productId: 'product-security', expectedRevision: 0 },
  createVariant: { ...variant, productId: 'product-security', expectedProductRevision: 0 },
  updateVariant: { ...variant, productId: 'product-security', variantId: 'variant-security', expectedProductRevision: 0, expectedRevision: 0 },
  assignCategories: { productId: 'product-security', expectedRevision: 0, categoryIds: [], primaryCategoryId: null },
  listCategories: { includeInactive: false }, createCategory: category,
  updateCategory: { ...category, categoryId: 'category-security', expectedRevision: 0 },
};
const rejected = { ok: false, error: { code: 'TEST_FAILURE', message: 'No catalog mutation executed.' } } as const;

describe.each(Object.entries(CATALOG_IPC_CONTRACTS))('%s catalog IPC boundary', (name, definition) => {
  const contract: { request: RuntimeParser<unknown>; response: RuntimeParser<unknown> } = definition;
  const request = requests[name as CatalogMethod];
  it('authorizes the window, top-level frame and exact URL before any catalog operation', () => {
    for (const sender of [null, { ...trusted, webContentsId: 99 }, { ...trusted, frameRoutingId: 99 }, { ...trusted, url: 'https://untrusted.invalid/' }]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(sender, trusted, [request], contract, execute)).toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects extra fields or arguments without executing the operation', () => {
    for (const args of [[], [request, request], [null], [{ ...(request as object), unexpected: true }]]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(trusted, trusted, args, contract, execute)).toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('validates accepted requests and every response', () => {
    expect(handleValidatedIpc(trusted, trusted, [request], contract, () => rejected)).toEqual(rejected);
    expect(() => handleValidatedIpc(trusted, trusted, [request], contract, () => ({ ok: true, value: 'invalid' }))).toThrow('Invalid IPC response');
  });
});
