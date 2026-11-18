import type { CheckoutView } from '@cash-sloth/contracts';
import type { Cart, CheckoutAttempt } from '@cash-sloth/domain';

/** The footer displays the current draft or its stored checkout quote. */
export function cartPayableRappen(
  cart: Cart | null, checkout: CheckoutView | null, legacy: CheckoutAttempt | null,
): number | null {
  if (!cart) return null;
  if (checkout?.session.status === 'open' && checkout.session.cart.id === cart.id && checkout.session.cart.revision === cart.revision) {
    if (checkout.attempts.some(({ status }) => status === 'reported' || status === 'uncertain')) return null;
    return checkout.balance.finalPayableRappen;
  }
  if (legacy?.status === 'confirmed' && legacy.cartId === cart.id && legacy.cartRevision === cart.revision) {
    return legacy.amountDueRappen;
  }
  return cart.subtotalRappen;
}
