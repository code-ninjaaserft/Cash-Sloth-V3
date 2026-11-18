import type { CartItem } from '@cash-sloth/domain';

export interface CartQuantities {
  byProduct: ReadonlyMap<string, number>;
  byVariant: ReadonlyMap<string, number>;
}

/** Display counts across all price snapshots in the current cart. */
export function cartQuantities(items: readonly Pick<CartItem, 'productId' | 'variantId' | 'quantity'>[]): CartQuantities {
  const byProduct = new Map<string, number>();
  const byVariant = new Map<string, number>();
  for (const { productId, variantId, quantity } of items) {
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity);
    byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + quantity);
  }
  return { byProduct, byVariant };
}
