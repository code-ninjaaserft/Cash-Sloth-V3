import { describe, expect, it } from 'vitest';
import { CATALOG_IPC_CONTRACTS, ManagedProductSchema } from './catalog.js';

describe('catalog contracts', () => {
  it.each(Object.entries(CATALOG_IPC_CONTRACTS))('%s rejects null and unknown fields', (_name, contract) => {
    expect(contract.request.safeParse(null).success).toBe(false);
    expect(contract.request.safeParse({ unexpected: true }).success).toBe(false);
    expect(contract.response.safeParse({ ok: true, value: null }).success).toBe(false);
    expect(contract.response.safeParse({ ok: false, error: { code: 'CONFLICT', message: 'Reload.' } }).success).toBe(true);
  });
  it('requires first-variant pricing and revision-aware editing', () => {
    const fields = { name: 'Coffee', description: null, imageReference: null, active: true, categoryIds: [], primaryCategoryId: null };
    expect(CATALOG_IPC_CONTRACTS.createProduct.request.safeParse(fields).success).toBe(false);
    const variant = { name: 'Default', unitPriceRappen: 247, sku: null, barcode: null, active: true, position: 0 };
    expect(CATALOG_IPC_CONTRACTS.createProduct.request.safeParse({ ...fields, firstVariant: variant }).success).toBe(true);
    expect(CATALOG_IPC_CONTRACTS.createProduct.request.safeParse({ ...fields, firstVariant: { ...variant, unitPriceRappen: -1 } }).success).toBe(false);
    expect(CATALOG_IPC_CONTRACTS.updateVariant.request.safeParse({ productId: 'p', variantId: 'v', expectedProductRevision: 0, ...variant }).success).toBe(false);
  });
  it('preserves legacy stored names while enforcing clean new input names', () => {
    expect(CATALOG_IPC_CONTRACTS.createCategory.request.safeParse({ name: ' Parent ', parentId: null, active: true, position: 0 }).success).toBe(false);
    expect(ManagedProductSchema.safeParse({ id: 'p', name: ' Parent ', description: null, imageReference: null, active: true, createdAt: '2026-11-12T12:00:00.000Z', updatedAt: '2026-11-12T12:00:00.000Z', revision: 0, categoryIds: [], primaryCategoryId: null, variants: [{ id: 'v', productId: 'p', name: ' Default ', unitPriceRappen: 1, sku: null, barcode: null, active: true, position: 0, revision: 0 }] }).success).toBe(true);
  });
});
