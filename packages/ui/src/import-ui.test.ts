import { describe, expect, it } from 'vitest';
import { completeCsvMapping, suggestCsvMapping } from './import-ui.js';

describe('CSV column mapping presentation', () => {
  it('suggests only recognized unique headers while keeping optional fields absent', () => {
    expect(suggestCsvMapping(['Product Key', 'Product_Name', 'variant_id', 'Variant name', 'Price CHF'])).toMatchObject({ productKey: 0, productName: 1, variantKey: 2, variantName: 3, price: 4, sku: null });
  });
  it('requires explicit operator choice for duplicate aliases', () => {
    const draft = suggestCsvMapping(['product_key', 'product_id', 'product_name', 'variant_key', 'variant_name', 'price']);
    expect(draft.productKey).toBeNull();
    expect(() => completeCsvMapping(draft, 6)).toThrow('Product import key');
  });
  it('does not map an unrelated name or manufacture missing price data', () => {
    const draft = suggestCsvMapping(['product_key', 'product_name', 'variant_key', 'variant_name', 'retail amount']);
    expect(draft.price).toBeNull();
    expect(() => completeCsvMapping(draft, 5)).toThrow('Variant price');
  });
  it('rejects stale or invalid column indices', () => {
    const draft = suggestCsvMapping(['product_key', 'product_name', 'variant_key', 'variant_name', 'price']);
    expect(() => completeCsvMapping({ ...draft, price: 5 }, 5)).toThrow();
    expect(() => completeCsvMapping({ ...draft, price: 1.5 }, 5)).toThrow();
    expect(completeCsvMapping(draft, 5)).toMatchObject({ productKey: 0, price: 4 });
  });
});
