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
export interface OrderContext {readonly id:string;readonly number:number|null;readonly numbers:readonly number[];readonly source:'kiosk'|'register'|'table';readonly serviceLabel:string|null}
export interface Sale {
 readonly order?:OrderContext|undefined;
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

export function validateOrderContext(order:OrderContext):void{
 assertIdentifier(order.id);if((order.number!==null&&(!Number.isSafeInteger(order.number)||order.number<1||order.number>99))||!Array.isArray(order.numbers)||(order.number===null?(order.source!=='table'||order.numbers.length!==0):order.numbers[0]!==order.number)||order.numbers.length>99||new Set(order.numbers).size!==order.numbers.length||order.numbers.some(n=>!Number.isSafeInteger(n)||n<1||n>99)||!['kiosk','register','table'].includes(order.source)||order.serviceLabel!==null&&(!order.serviceLabel.trim()||order.serviceLabel.length>80||/\p{Cc}/u.test(order.serviceLabel)))throw new DomainError('INVALID_INPUT','Invalid order reference.');
}

export function assertOrderItemsUnchanged(items:readonly CartItem[],ordered:readonly CartItem[]):void{
 const inventory=(lines:readonly CartItem[])=>{const counts=new Map<string,number>();for(const item of lines){const key=item.variantId+'|'+(item.originalUnitPriceRappen??item.unitPriceRappen)+'|'+(item.ticketUses??0);counts.set(key,(counts.get(key)??0)+item.quantity);}return JSON.stringify([...counts].sort(([a],[b])=>a.localeCompare(b)));};
 if(inventory(items)!==inventory(ordered))throw new DomainError('CONFLICT','Release the order before changing its items. Discounts can be applied during payment.');
}
