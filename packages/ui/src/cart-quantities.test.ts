import { describe, expect, it } from 'vitest';
import type { CartItem } from '@cash-sloth/domain';
import { cartQuantities } from './cart-quantities.js';

describe('POS tile quantities', () => {
  it('counts units across variants for each product and separately for each variant', () => {
    const counts = cartQuantities([
      { productId: 'tea', variantId: 'tea-small', quantity: 3 },
      { productId: 'coffee', variantId: 'coffee-small', quantity: 2 },
      { productId: 'tea', variantId: 'tea-large', quantity: 1 },
    ]);

    expect(counts.byProduct).toEqual(new Map([['tea', 4], ['coffee', 2]]));
    expect(counts.byVariant).toEqual(new Map([['tea-small', 3], ['coffee-small', 2], ['tea-large', 1]]));
  });

  it('sums quantities from separate, immutable price and name snapshots for the same IDs', () => {
    const oldLine: CartItem = Object.freeze({
      id: 'first', productId: 'tea', variantId: 'tea-small', productName: 'Tea', variantName: 'Small',
      quantity: 2, unitPriceRappen: 333, lineTotalRappen: 666,
    });
    const newLine: CartItem = Object.freeze({
      ...oldLine, id: 'second', productName: 'Alpine tea', variantName: 'Cup',
      quantity: 1, unitPriceRappen: 444, lineTotalRappen: 444,
    });
    const counts = cartQuantities(Object.freeze([oldLine, newLine]));

    expect(counts.byProduct).toEqual(new Map([['tea', 3]]));
    expect(counts.byVariant).toEqual(new Map([['tea-small', 3]]));
  });

  it('drops removed variants and products when deriving badges from the next saved cart', () => {
    const small = { productId: 'tea', variantId: 'small', quantity: 1 };
    const large = { productId: 'tea', variantId: 'large', quantity: 2 };
    const before = cartQuantities([small, large]);
    const after = cartQuantities([large]);

    expect(after.byVariant.has('small')).toBe(false);
    expect(after.byProduct.get('tea')).toBe(2);
    expect(before.byProduct.get('tea')).toBe(3);
    expect(cartQuantities([])).toEqual({ byProduct: new Map(), byVariant: new Map() });
  });
});
