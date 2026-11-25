import type { OrderContext, Cart, CatalogItem, CheckoutAttempt, Sale } from '@cash-sloth/domain';

/** Synchronous transaction callback; return only after a confirmed COMMIT. */
export interface PosStore {
  prepareSaleOrder?(cart:Cart,at:string):OrderContext|undefined;
  /** Optional until migration 3; implemented by hosts that expose payment sessions. */
  assertNoFinancialCheckout?(): void;
  transaction<T>(operation: () => T): T;
  listCatalog(): readonly CatalogItem[];
  getVariant(variantId: string): CatalogItem | null;
  getDraftCart(): Cart | null;
  getCart(cartId: string): Cart | null;
  createCart(cart: Cart): void;
  updateCart(cart: Cart, expectedRevision: number): void;
  getPendingCheckout(cartId: string): CheckoutAttempt | null;
  getUnresolvedCheckout(): CheckoutAttempt | null;
  getCheckout(idempotencyKey: string): CheckoutAttempt | null;
  putCheckout(attempt: CheckoutAttempt): void;
  getSale(saleId: string): Sale | null;
  getSaleByCheckoutKey(idempotencyKey: string): Sale | null;
  listRecentSales(limit: number): readonly Sale[];
  insertSale(sale: Sale): void;
  consumeCart(cartId: string, expectedRevision: number): void;
}

export interface PosRuntime {
  newId(): string;
  now(): string;
}

/** Infrastructure must distinguish a known rollback from uncertain COMMIT. */
export class PersistenceError extends Error {
  constructor(readonly outcome: 'rolled-back' | 'unknown', message = 'Persistence operation failed.') { super(message); this.name = 'PersistenceError'; }
}
