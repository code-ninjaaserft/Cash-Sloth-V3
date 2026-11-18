import { describe, expect, it } from 'vitest';
import { addVariantToCart, clearCart, createCart, removeCartItem, setCartQuantity, validateCart } from './cart.js';
import type { CatalogItem } from './models.js';

const variant: CatalogItem = { productId: 'coffee', variantId: 'coffee-default', productName: 'Coffee', variantName: 'Default', unitPriceRappen: 247, productActive: true, active: true };

describe('persistent-cart domain snapshots', () => {
  it('calculates line totals and revisions without mutating previous drafts', () => {
    const empty = createCart('cart-1');
    const added = addVariantToCart(empty, variant, 'line-1');
    const updated = setCartQuantity(added, 'line-1', 3);
    expect(updated).toMatchObject({ revision: 2, subtotalRappen: 741 });
    expect(updated.items[0]?.lineTotalRappen).toBe(741);
    expect(added.items[0]?.quantity).toBe(1);
    expect(empty.items).toHaveLength(0);
  });
  it('merges repeated adds only when the complete snapshot matches', () => {
    const first = addVariantToCart(createCart('cart-1'), variant, 'line-1');
    const second = addVariantToCart(first, variant, 'unused-line');
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ id: 'line-1', quantity: 2, lineTotalRappen: 494 });
  });
  it('preserves old prices when quantities change and separates new-price adds', () => {
    const first = addVariantToCart(createCart('cart-1'), variant, 'line-1');
    const changed = addVariantToCart(first, { ...variant, unitPriceRappen: 300, productName: 'New name' }, 'line-2');
    const updated = setCartQuantity(changed, 'line-1', 2);
    expect(updated.items).toHaveLength(2);
    expect(updated.items[0]).toMatchObject({ productName: 'Coffee', unitPriceRappen: 247, quantity: 2 });
    expect(updated.items[1]).toMatchObject({ productName: 'New name', unitPriceRappen: 300, quantity: 1 });
    expect(updated.subtotalRappen).toBe(794);
  });
  it('rejects zero/negative quantities, inactive variants and overflow', () => {
    const cart = addVariantToCart(createCart('cart-1'), variant, 'line-1');
    expect(() => setCartQuantity(cart, 'line-1', 0)).toThrow();
    expect(() => setCartQuantity(cart, 'line-1', -1)).toThrow();
    expect(() => addVariantToCart(cart, { ...variant, active: false }, 'line-2')).toThrow();
    expect(() => addVariantToCart(cart, { ...variant, productActive: false }, 'line-2')).toThrow();
    const huge = addVariantToCart(createCart('cart-2'), { ...variant, unitPriceRappen: Number.MAX_SAFE_INTEGER }, 'line-3');
    expect(() => setCartQuantity(huge, 'line-3', 2)).toThrow();
  });
  it('removes and clears without persisting zero quantities', () => {
    const cart = addVariantToCart(createCart('cart-1'), variant, 'line-1');
    expect(removeCartItem(cart, 'line-1')).toMatchObject({ items: [], subtotalRappen: 0, revision: 2 });
    expect(clearCart(cart)).toMatchObject({ items: [], subtotalRappen: 0 });
    expect(() => removeCartItem(cart, 'unknown')).toThrow();
  });
  it('rejects forged line/cart totals and duplicate line identifiers', () => {
    const cart = addVariantToCart(createCart('cart-1'), variant, 'line-1');
    expect(() => validateCart({ ...cart, subtotalRappen: 1 })).toThrow();
    expect(() => validateCart({ ...cart, items: [cart.items[0]!, cart.items[0]!] })).toThrow();
    expect(() => validateCart({ ...cart, items: [{ ...cart.items[0]!, lineTotalRappen: 1 }] })).toThrow();
  });
});
