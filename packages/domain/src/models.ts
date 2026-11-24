// Semantic identifiers are serialized strings; every boundary validates their form.
export type ProductId = string;
export type VariantId = string;
export type CartId = string;
export type CartItemId = string;
export type SaleId = string;
export type IdempotencyKey = string;

export class DomainError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DomainError'; }
}

export function assertIdentifier(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new DomainError('INVALID_INPUT', 'Invalid identifier.');
}

export interface Product { readonly id: ProductId; readonly name: string; readonly active: boolean }
export interface ProductVariant { readonly id: VariantId; readonly productId: ProductId; readonly name: string; readonly unitPriceRappen: number; readonly active: boolean }
export interface CatalogItem {
  readonly ticketUses?: number | undefined;
  readonly productId: ProductId;
  readonly variantId: VariantId;
  readonly productName: string;
  readonly variantName: string;
  readonly unitPriceRappen: number;
  readonly productActive: boolean;
  readonly active: boolean;
}
export interface CartItem {
  readonly originalUnitPriceRappen?:number|undefined;
  readonly discountLabel?:string|undefined;
  readonly ticketUses?: number | undefined;
  readonly id: CartItemId;
  readonly productId: ProductId;
  readonly variantId: VariantId;
  readonly productName: string;
  readonly variantName: string;
  readonly unitPriceRappen: number;
  readonly quantity: number;
  readonly lineTotalRappen: number;
}
export interface Cart {
  readonly id: CartId;
  readonly revision: number;
  readonly items: readonly CartItem[];
  readonly subtotalRappen: number;
}
export interface CheckoutAttempt {
  readonly idempotencyKey: IdempotencyKey;
  readonly cartId: CartId;
  readonly cartRevision: number;
  readonly subtotalRappen: number;
  readonly roundingAdjustmentRappen: number;
  readonly amountDueRappen: number;
  readonly status: 'prepared' | 'confirmed' | 'completed';
  readonly cashReceivedRappen: number | null;
  readonly confirmedAt: string | null;
  readonly saleId: SaleId | null;
  readonly createdAt: string;
}
export interface SalePayment {
  readonly method: 'cash';
  readonly cashReceivedRappen: number;
  readonly cashAppliedRappen: number;
  readonly changeRappen: number;
  readonly operatorConfirmed: true;
  readonly confirmedAt: string;
}
export type SaleItem = CartItem;
export interface Sale {
  readonly id: SaleId;
  readonly idempotencyKey: IdempotencyKey;
  readonly cartId: CartId;
  readonly cartRevision: number;
  readonly completedAt: string;
  readonly items: readonly SaleItem[];
  readonly subtotalRappen: number;
  readonly roundingAdjustmentRappen: number;
  readonly amountDueRappen: number;
  readonly payment: SalePayment;
}
