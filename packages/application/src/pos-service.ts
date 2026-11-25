import type { PosMethod, PosRequest, PosResponse, Result } from '@cash-sloth/contracts';
import {
  addVariantToCart, assertIdentifier, assertRappen, calculateCashPayment, calculateCashQuote,
  clearCart, createCart, DomainError, removeCartItem, setCartQuantity, validateCart, validateSale, validateCheckoutAttempt,
  type Cart, type CheckoutAttempt, type Sale,
} from '@cash-sloth/domain';
import { PersistenceError, type PosRuntime, type PosStore } from './ports.js';

export type PosService = { [K in PosMethod]: (request: PosRequest<K>) => PosResponse<K> };

function attemptMatchesCash(attempt: CheckoutAttempt, received: number): void {
  if (attempt.cashReceivedRappen !== null && attempt.cashReceivedRappen !== received) throw new DomainError('CONFLICT', 'This checkout key is already bound to a different cash confirmation.');
}
function requireCart(store: PosStore, cartId: string, revision: number): Cart {
  assertIdentifier(cartId);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new DomainError('INVALID_INPUT', 'Invalid cart revision.');
  const cart = store.getCart(cartId);
  if (cart === null) throw new DomainError('CONFLICT', 'This cart is no longer open. Reconcile the original checkout; do not take another payment.');
  validateCart(cart);
  if (cart.revision !== revision) throw new DomainError('CONFLICT', 'The cart changed. Refresh it before continuing.');
  return cart;
}
function ensureNoConfirmedCheckout(store: PosStore): void {
  store.assertNoFinancialCheckout?.();
  if (store.getUnresolvedCheckout() !== null) throw new DomainError('CHECKOUT_PENDING', 'A cash confirmation is unresolved. Reconcile that checkout before editing or starting another sale.');
}
function safe<T>(operation: () => T): Result<T> {
  try { return { ok: true, value: operation() }; }
  catch (error: unknown) {
    if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message } };
    if (error instanceof PersistenceError && error.outcome === 'unknown') return { ok: false, error: { code: 'COMMIT_UNCERTAIN', message: 'The commit outcome is uncertain. Reconcile the same checkout key; do not take another payment.' } };
    return { ok: false, error: { code: 'STORAGE_ERROR', message: 'Storage could not confirm the operation. If cash was confirmed, reconcile the same checkout key before continuing.' } };
  }
}

/** The only application operation that finalizes a sale. No UI-specific shortcut. */
export class CompleteSaleUseCase {
  constructor(private readonly store: PosStore, private readonly runtime: PosRuntime) {}

  execute(request: PosRequest<'completeSale'>): Sale {
    assertIdentifier(request.idempotencyKey); assertRappen(request.cashReceivedRappen);
    if (request.operatorConfirmed !== true) throw new DomainError('CONFIRMATION_REQUIRED', 'Explicit operator cash confirmation is required.');

    // This durable evidence deliberately survives a later sale rollback or stale
    // cart conflict. Database rollback cannot reverse a physical cash transfer.
    this.store.transaction(() => {
      const attempt = this.store.getCheckout(request.idempotencyKey);
      if (attempt === null) throw new DomainError('NOT_FOUND', 'Checkout attempt not found.');
      attemptMatchesCash(attempt, request.cashReceivedRappen);
      calculateCashPayment(attempt.amountDueRappen, request.cashReceivedRappen);
      if (attempt.status === 'prepared') {
        const confirmed: CheckoutAttempt = { ...attempt, status: 'confirmed', cashReceivedRappen: request.cashReceivedRappen, confirmedAt: this.runtime.now() };
        validateCheckoutAttempt(confirmed);
        this.store.putCheckout(confirmed);
      }
    });

    // Sale, its item/payment snapshots, cart consumption and completion marker
    // commit atomically. transaction() must return only after confirmed COMMIT.
    return this.store.transaction(() => {
      const attempt = this.store.getCheckout(request.idempotencyKey);
      if (attempt === null) throw new DomainError('NOT_FOUND', 'Checkout attempt not found.');
      attemptMatchesCash(attempt, request.cashReceivedRappen);
      const existing = this.store.getSaleByCheckoutKey(attempt.idempotencyKey);
      if (existing !== null) {
        if (existing.payment.cashReceivedRappen !== request.cashReceivedRappen) throw new DomainError('CONFLICT', 'Checkout cash does not match the saved sale.');
        return existing;
      }
      this.store.assertNoFinancialCheckout?.();
      const unresolved = this.store.getUnresolvedCheckout();
      if (unresolved !== null && unresolved.idempotencyKey !== attempt.idempotencyKey) throw new DomainError('CHECKOUT_PENDING', 'Another cash confirmation must be reconciled first. This confirmation remains recorded; do not take another payment.');
      if (attempt.status !== 'confirmed' || attempt.confirmedAt === null || attempt.cashReceivedRappen === null) throw new DomainError('CONFLICT', 'Checkout has no durable cash confirmation.');
      const cart = requireCart(this.store, attempt.cartId, attempt.cartRevision);
      if (cart.items.length === 0) throw new DomainError('EMPTY_CART', 'An empty cart cannot be sold.');
      const quote = calculateCashQuote(cart.subtotalRappen);
      if (quote.subtotalRappen !== attempt.subtotalRappen || quote.amountDueRappen !== attempt.amountDueRappen || quote.roundingAdjustmentRappen !== attempt.roundingAdjustmentRappen) throw new DomainError('CONFLICT', 'Checkout quote does not match the cart snapshot.');
      const payment = calculateCashPayment(attempt.amountDueRappen, attempt.cashReceivedRappen);
      const order=this.store.prepareSaleOrder?.(cart,this.runtime.now());
      const sale: Sale = { ...(order?{order}:{}),
        id: this.runtime.newId(), idempotencyKey: attempt.idempotencyKey,
        cartId: cart.id, cartRevision: cart.revision, completedAt: this.runtime.now(),
        items: cart.items.map((item) => ({ ...item })), ...quote,
        payment: { method: 'cash', cashReceivedRappen: payment.cashReceivedRappen, cashAppliedRappen: payment.cashAppliedRappen, changeRappen: payment.changeRappen, operatorConfirmed: true, confirmedAt: attempt.confirmedAt },
      };
      assertIdentifier(sale.id);
      validateSale(sale);
      this.store.insertSale(sale);
      this.store.consumeCart(cart.id, cart.revision);
      this.store.putCheckout({ ...attempt, status: 'completed', saleId: sale.id });
      return sale;
    });
  }
}

export function createPosService(store: PosStore, runtime: PosRuntime): PosService {
  const completeSale = new CompleteSaleUseCase(store, runtime);
  const mutate = (cartId: string, expectedRevision: number, operation: (cart: Cart) => Cart): Cart => store.transaction(() => {
    ensureNoConfirmedCheckout(store);
    const updated = operation(requireCart(store, cartId, expectedRevision));
    store.updateCart(updated, expectedRevision);
    return updated;
  });
  return {
    listCatalog: (_request) => safe(() => store.listCatalog()),
    getCart: (_request) => safe(() => store.transaction(() => {
      let cart = store.getDraftCart();
      if (cart === null) { cart = createCart(runtime.newId()); store.createCart(cart); }
      validateCart(cart);
      const pending = store.getUnresolvedCheckout() ?? store.getPendingCheckout(cart.id);
      const pendingCheckout = pending !== null && (pending.status === 'confirmed' || pending.cartRevision === cart.revision) ? pending : null;
      return { cart, pendingCheckout };
    })),
    addItem: (request) => safe(() => mutate(request.cartId, request.expectedRevision, (cart) => {
      assertIdentifier(request.variantId);
      const variant = store.getVariant(request.variantId);
      if (variant === null) throw new DomainError('NOT_FOUND', 'Product variant not found.');
      return addVariantToCart(cart, variant, runtime.newId());
    })),
    setQuantity: (request) => safe(() => mutate(request.cartId, request.expectedRevision, (cart) => setCartQuantity(cart, request.lineId, request.quantity))),
    removeItem: (request) => safe(() => mutate(request.cartId, request.expectedRevision, (cart) => removeCartItem(cart, request.lineId))),
    clearCart: (request) => safe(() => mutate(request.cartId, request.expectedRevision, clearCart)),
    prepareCheckout: (request) => safe(() => store.transaction(() => {
      ensureNoConfirmedCheckout(store);
      const cart = requireCart(store, request.cartId, request.expectedRevision);
      if (cart.items.length === 0) throw new DomainError('EMPTY_CART', 'Add a product before checkout.');
      const existing = store.getPendingCheckout(cart.id);
      if (existing?.status === 'prepared' && existing.cartRevision === cart.revision) return existing;
      store.prepareSaleOrder?.(cart,runtime.now());
      const attempt: CheckoutAttempt = {
        idempotencyKey: runtime.newId(), cartId: cart.id, cartRevision: cart.revision,
        ...calculateCashQuote(cart.subtotalRappen), status: 'prepared', cashReceivedRappen: null,
        confirmedAt: null, saleId: null, createdAt: runtime.now(),
      };
      assertIdentifier(attempt.idempotencyKey);
      validateCheckoutAttempt(attempt);
      store.putCheckout(attempt);
      return attempt;
    })),
    completeSale: (request) => safe(() => completeSale.execute(request)),
    reconcileCheckout: (request) => safe(() => store.transaction(() => {
      assertIdentifier(request.idempotencyKey);
      const attempt = store.getCheckout(request.idempotencyKey);
      if (attempt === null) throw new DomainError('NOT_FOUND', 'Checkout attempt not found.');
      const sale = store.getSaleByCheckoutKey(request.idempotencyKey);
      if ((attempt.status === 'completed') !== (sale !== null)) throw new DomainError('CONFLICT', 'Checkout records disagree. Keep the original key for investigation.');
      return { attempt, sale };
    })),
    getSale: (request) => safe(() => {
      assertIdentifier(request.saleId);
      const sale = store.getSale(request.saleId);
      if (sale === null) throw new DomainError('NOT_FOUND', 'Sale not found.');
      return sale;
    }),
    listRecentSales: (_request) => safe(() => store.listRecentSales(20)),
  };
}
