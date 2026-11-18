import { addMoney, assertQuantity, assertRappen, multiplyMoney } from './money.js';
import { assertIdentifier, DomainError, type Cart, type CartItem, type CatalogItem } from './models.js';

export function createCart(id: string): Cart {
  assertIdentifier(id);
  return { id, revision: 0, items: [], subtotalRappen: 0 };
}
export function validateCart(cart: Cart): void {
  assertIdentifier(cart.id);
  if (!Number.isSafeInteger(cart.revision) || cart.revision < 0) throw new DomainError('INVALID_INPUT', 'Invalid cart revision.');
  if (cart.items.length > 1000 || new Set(cart.items.map((item) => item.id)).size !== cart.items.length) throw new DomainError('INVALID_INPUT', 'Invalid cart lines.');
  let total = 0;
  for (const item of cart.items) {
    assertIdentifier(item.id); assertIdentifier(item.productId); assertIdentifier(item.variantId);
    if (!item.productName.trim() || item.productName.length > 200 || !item.variantName.trim() || item.variantName.length > 200) throw new DomainError('INVALID_INPUT', 'Invalid item names.');
    if (item.lineTotalRappen !== multiplyMoney(item.unitPriceRappen, item.quantity)) throw new DomainError('INVALID_INPUT', 'Invalid line total.');
    total = addMoney(total, item.lineTotalRappen);
  }
  if (cart.subtotalRappen !== total) throw new DomainError('INVALID_INPUT', 'Invalid cart total.');
}
function withItems(cart: Cart, items: readonly CartItem[]): Cart {
  if (cart.revision === Number.MAX_SAFE_INTEGER) throw new DomainError('OVERFLOW', 'Cart revision overflow.');
  const updated = { ...cart, revision: cart.revision + 1, items, subtotalRappen: items.reduce((total, item) => addMoney(total, item.lineTotalRappen), 0) };
  validateCart(updated);
  return updated;
}
export function addVariantToCart(cart: Cart, variant: CatalogItem, newLineId: string): Cart {
  validateCart(cart);
  assertIdentifier(newLineId); assertIdentifier(variant.productId); assertIdentifier(variant.variantId); assertRappen(variant.unitPriceRappen);
  if (!variant.productActive || !variant.active) throw new DomainError('INACTIVE_VARIANT', 'This product is not available for sale.');
  const matching = cart.items.find((item) => item.productId === variant.productId && item.variantId === variant.variantId && item.unitPriceRappen === variant.unitPriceRappen && item.productName === variant.productName && item.variantName === variant.variantName);
  if (matching) return setCartQuantity(cart, matching.id, matching.quantity + 1);
  if (cart.items.length >= 1000) throw new DomainError('INVALID_INPUT', 'The cart has too many lines.');
  const line: CartItem = { id: newLineId, productId: variant.productId, variantId: variant.variantId, productName: variant.productName, variantName: variant.variantName, unitPriceRappen: variant.unitPriceRappen, quantity: 1, lineTotalRappen: variant.unitPriceRappen };
  return withItems(cart, [...cart.items, line]);
}
export function setCartQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  validateCart(cart); assertQuantity(quantity);
  if (!cart.items.some((line) => line.id === lineId)) throw new DomainError('NOT_FOUND', 'Cart line not found.');
  return withItems(cart, cart.items.map((line) => line.id === lineId ? { ...line, quantity, lineTotalRappen: multiplyMoney(line.unitPriceRappen, quantity) } : line));
}
export function removeCartItem(cart: Cart, lineId: string): Cart {
  validateCart(cart);
  if (!cart.items.some((line) => line.id === lineId)) throw new DomainError('NOT_FOUND', 'Cart line not found.');
  return withItems(cart, cart.items.filter((line) => line.id !== lineId));
}
export function clearCart(cart: Cart): Cart { validateCart(cart); return withItems(cart, []); }
