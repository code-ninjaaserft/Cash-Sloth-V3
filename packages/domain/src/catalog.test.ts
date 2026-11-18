import { describe, expect, it } from 'vitest';
import {
  assertUniqueVariantMetadata, browseableCategoryIds, categorySummaries, descendantsOf, nextRevision,
  normalizeBarcode, normalizeSku, searchCatalog, validateCategoryForest, validateManagedProduct,
  type Category, type CatalogQuery, type ManagedProduct,
} from './catalog.js';
import { addVariantToCart, createCart, setCartQuantity } from './cart.js';

const date = '2026-11-12T12:00:00.000Z';
const root: Category = { id: 'root', name: 'Root', parentId: null, active: true, position: 0, revision: 0 };
const child: Category = { ...root, id: 'child', name: 'Child', parentId: 'root', position: 1 };
function product(id = 'product'): ManagedProduct {
  return { id, name: 'Café', description: null, active: true, imageReference: null, createdAt: date, updatedAt: date,
    revision: 0, categoryIds: ['root', 'child'], primaryCategoryId: 'child',
    variants: [
      { id: `${id}-small`, productId: id, name: 'Small', unitPriceRappen: 247, sku: 'COFFEE-S', barcode: 'AbC-1', active: true, position: 0, revision: 0 },
      { id: `${id}-large`, productId: id, name: 'Large', unitPriceRappen: 450, sku: 'COFFEE-L', barcode: 'AbC-2', active: true, position: 1, revision: 0 },
    ] };
}
const query = (overrides: Partial<CatalogQuery> = {}): CatalogQuery => ({ query: '', categoryId: null, restrictToCategory: false, includeInactive: false, ...overrides });

describe('managed product invariants', () => {
  it('normalizes SKU case/whitespace but preserves barcode case', () => {
    expect(normalizeSku(' café-s ')).toBe('CAFÉ-S');
    expect(normalizeBarcode(' AbC ')).toBe('AbC');
    expect(normalizeSku(null)).toBeNull();
    expect(() => normalizeSku(' ')).toThrow();
    expect(() => normalizeBarcode('\u0000')).toThrow();
  });
  it('requires a valid current price and at least one correctly parented variant', () => {
    const valid = product();
    expect(() => validateManagedProduct(valid)).not.toThrow();
    expect(() => validateManagedProduct({ ...valid, variants: [] })).toThrow();
    expect(() => validateManagedProduct({ ...valid, variants: valid.variants.map((variant) => ({ ...variant, unitPriceRappen: -1 })) })).toThrow();
    expect(() => validateManagedProduct({ ...valid, variants: valid.variants.map((variant) => ({ ...variant, productId: 'another' })) })).toThrow();
    expect(() => validateManagedProduct({ ...valid, primaryCategoryId: 'missing' })).toThrow();
    expect(() => validateManagedProduct({ ...valid, categoryIds: ['root', 'root'] })).toThrow();
  });
  it.each(['https://untrusted.invalid/image.png', '../private.png', 'assets/../private.png', '/absolute.png', 'C:\\private.png'])('rejects executable/network/escaping image references: %s', (imageReference) => {
    expect(() => validateManagedProduct({ ...product(), imageReference })).toThrow();
  });
  it('rejects duplicate metadata even on inactive variants and protects revision bounds', () => {
    const first = product(); const second = product('second');
    expect(() => assertUniqueVariantMetadata([first], second)).toThrow('SKU');
    const noSku = { ...second, variants: second.variants.map((variant) => ({ ...variant, sku: null, active: false })) };
    expect(() => assertUniqueVariantMetadata([first], noSku)).toThrow('barcode');
    const differentCaseBarcode = { ...noSku, variants: noSku.variants.map((variant) => ({ ...variant, barcode: variant.barcode?.toLowerCase() ?? null })) };
    expect(() => assertUniqueVariantMetadata([first], differentCaseBarcode)).not.toThrow();
    expect(() => nextRevision(Number.MAX_SAFE_INTEGER)).toThrow('overflow');
  });
});

describe('hierarchies, category counts and global search', () => {
  it('traverses and counts a 12000-level hierarchy without recursion or duplicate products', () => {
    const categories: Category[] = Array.from({ length: 12_000 }, (_, index) => ({ ...root, id: `category-${index}`, parentId: index === 0 ? null : `category-${index - 1}` }));
    const item = { ...product(), categoryIds: ['category-0', 'category-11999'], primaryCategoryId: 'category-11999' };
    expect(descendantsOf(categories, 'category-0').size).toBe(12_000);
    const summaries = categorySummaries([item], categories, false);
    expect(summaries).toHaveLength(12_000);
    expect(summaries.every((category) => category.productCount === 1)).toBe(true);
  });
  it('rejects self-parenting, indirect cycles and missing parents', () => {
    expect(() => validateCategoryForest([{ ...root, parentId: 'root' }])).toThrow();
    expect(() => validateCategoryForest([{ ...root, parentId: 'child' }, child])).toThrow('cycle');
    expect(() => validateCategoryForest([{ ...child, parentId: 'missing' }])).toThrow();
  });
  it('includes descendants once and changes scope after a move', () => {
    const item = product();
    expect(searchCatalog([item], [root, child], query({ categoryId: 'root' }))).toHaveLength(1);
    expect(categorySummaries([item], [root, child], false).find((category) => category.id === 'root')?.productCount).toBe(1);
    const moved = { ...child, parentId: null };
    const onlyChild = { ...item, categoryIds: ['child'], primaryCategoryId: 'child' };
    expect(searchCatalog([onlyChild], [root, moved], query({ categoryId: 'root' }))).toHaveLength(0);
  });
  it('searches globally by default, including names, variants, SKU and barcode', () => {
    const other: Category = { ...root, id: 'other' };
    for (const text of ['cafe', 'large', 'coffee-l', 'abc-2']) {
      expect(searchCatalog([product()], [root, child, other], query({ query: text, categoryId: 'other' }))).toHaveLength(1);
      expect(searchCatalog([product()], [root, child, other], query({ query: text, categoryId: 'other', restrictToCategory: true }))).toHaveLength(0);
    }
  });
  it('hides inactive category branches but retains their active products in global search', () => {
    const categories = [{ ...root, active: false }, child];
    expect(browseableCategoryIds(categories).size).toBe(0);
    expect(categorySummaries([product()], categories, false)).toEqual([]);
    expect(searchCatalog([product()], categories, query({ categoryId: 'root' }))).toEqual([]);
    expect(searchCatalog([product()], categories, query({ query: 'cafe', categoryId: 'root' }))).toHaveLength(1);
  });
  it('omits inactive products and variants from normal search, keeping all for administration', () => {
    const item = { ...product(), variants: product().variants.map((variant) => ({ ...variant, active: false })) };
    expect(searchCatalog([item], [root, child], query())).toEqual([]);
    expect(searchCatalog([item], [root, child], query({ includeInactive: true }))).toHaveLength(1);
    expect(searchCatalog([{ ...product(), active: false }], [root, child], query())).toEqual([]);
  });
  it('keeps existing cart snapshots when a newly added variant price changes', () => {
    const source = { productId: 'product', variantId: 'variant', productName: 'Before', variantName: 'Small', unitPriceRappen: 247, productActive: true, active: true };
    const first = addVariantToCart(createCart('cart'), source, 'line-old');
    const increased = setCartQuantity(first, 'line-old', 2);
    const changed = addVariantToCart(increased, { ...source, productName: 'After', unitPriceRappen: 450 }, 'line-new');
    expect(changed.items.map((line) => [line.unitPriceRappen, line.quantity])).toEqual([[247, 2], [450, 1]]);
    expect(() => addVariantToCart(changed, { ...source, active: false }, 'inactive')).toThrow();
  });
});
