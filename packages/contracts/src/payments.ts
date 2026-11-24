import { z } from 'zod';
import { CartItemSchema, CartSchema, CheckoutAttemptSchema, IdentifierSchema, PosErrorSchema, RappenSchema, RevisionSchema } from './pos.js';

export const PaymentMethodSchema = z.enum(['cash', 'card', 'twint', 'voucher']);
const timestamp = z.iso.datetime();
const adjustment = z.number().int().min(-2).max(2);
export const CheckoutSessionSchema = z.strictObject({ tipRappen: RappenSchema.optional(), id: IdentifierSchema, cart: CartSchema, status: z.enum(['open', 'completed', 'cancelled']), createdAt: timestamp, saleId: IdentifierSchema.nullable() });
export const PaymentAttemptSchema = z.strictObject({ id: IdentifierSchema, idempotencyKey: IdentifierSchema, sessionId: IdentifierSchema, method: PaymentMethodSchema, intendedRappen: RappenSchema, appliedRappen: RappenSchema, cashTenderedRappen: RappenSchema.nullable(), changeRappen: RappenSchema, roundingAdjustmentRappen: adjustment,
  status: z.enum(['prepared', 'reported', 'confirmed', 'uncertain', 'failed', 'excluded']), createdAt: timestamp, reportedAt: timestamp.nullable(), confirmedAt: timestamp.nullable(), note: z.string().max(1000).nullable() });
export const PaymentAllocationSchema = z.strictObject({ attemptId: IdentifierSchema, method: PaymentMethodSchema, amountRappen: RappenSchema, cashTenderedRappen: RappenSchema.nullable(), changeRappen: RappenSchema, operatorConfirmed: z.literal(true), confirmedAt: timestamp });
export const FinancialSaleSchema = z.strictObject({ tipRappen: RappenSchema.optional(), eventId: IdentifierSchema.nullable().optional(), eventTitle: z.string().min(1).max(200).nullable().optional(), id: IdentifierSchema, checkoutSessionId: IdentifierSchema, cartId: IdentifierSchema, cartRevision: RevisionSchema, completedAt: timestamp, items: z.array(CartItemSchema).min(1).max(1000).readonly(), subtotalRappen: RappenSchema, roundingAdjustmentRappen: adjustment, amountDueRappen: RappenSchema, actualPaidRappen: RappenSchema, payments: z.array(PaymentAllocationSchema).min(1).max(1000).readonly(), source: z.enum(['legacy', 'payments']) });
export const CheckoutBalanceSchema = z.strictObject({ subtotalRappen: RappenSchema, confirmedDigitalRappen: RappenSchema, confirmedAppliedRappen: RappenSchema, outstandingRappen: RappenSchema, cashDueRappen: RappenSchema, roundingAdjustmentRappen: adjustment, finalPayableRappen: RappenSchema, settled: z.boolean() });
export const CheckoutViewSchema = z.strictObject({ session: CheckoutSessionSchema, attempts: z.array(PaymentAttemptSchema).max(1000).readonly(), balance: CheckoutBalanceSchema, sale: FinancialSaleSchema.nullable() });
const selection = z.strictObject({ saleItemId: IdentifierSchema, quantity: z.number().int().min(1).max(9999) });
export const RefundItemSchema = z.strictObject({ saleItemId: IdentifierSchema, quantity: z.number().int().min(1).max(9999), unitOffset: z.number().int().min(0).max(9999), unitPriceRappen: RappenSchema, baseRappen: RappenSchema, roundingAllocationRappen: adjustment, amountRappen: RappenSchema });
export const RefundAttemptSchema = z.strictObject({ id: IdentifierSchema, idempotencyKey: IdentifierSchema, saleId: IdentifierSchema, method: PaymentMethodSchema, items: z.array(RefundItemSchema).min(1).max(1000).readonly(), amountRappen: RappenSchema, status: z.enum(['prepared', 'reported', 'completed', 'uncertain', 'failed', 'excluded']), createdAt: timestamp, reportedAt: timestamp.nullable(), refundId: IdentifierSchema.nullable(), note: z.string().max(1000).nullable() });
export const RefundSchema = z.strictObject({ id: IdentifierSchema, idempotencyKey: IdentifierSchema, attemptId: IdentifierSchema, saleId: IdentifierSchema, items: z.array(RefundItemSchema).min(1).max(1000).readonly(), amountRappen: RappenSchema, method: PaymentMethodSchema, operatorConfirmed: z.literal(true), confirmedAt: timestamp, completedAt: timestamp });
export const SaleDetailsSchema = z.strictObject({ sale: FinancialSaleSchema, refunds: z.array(RefundSchema).readonly(), refundAttempts: z.array(RefundAttemptSchema).readonly(), refundedRappen: RappenSchema, refundableRappen: RappenSchema, items: z.array(z.strictObject({ saleItemId: IdentifierSchema, quantitySold: z.number().int().min(1).max(9999), quantityRefunded: z.number().int().min(0).max(9999), quantityRemaining: z.number().int().min(0).max(9999) })).readonly() });
export const FinancialEventSchema = z.strictObject({ id: IdentifierSchema, kind: z.enum(['payment', 'refund', 'session']), referenceId: IdentifierSchema, status: z.string().min(1).max(64), at: timestamp, note: z.string().max(1000).nullable() });
export const ReconciliationActionSchema = z.strictObject({ id: IdentifierSchema, idempotencyKey: IdentifierSchema, kind: z.enum(['payment', 'refund', 'legacy']), referenceId: IdentifierSchema, resolution: z.enum(['confirm-recorded', 'exclude-no-transfer', 'exclude-compensated']), reason: z.string().trim().min(10).max(1000), at: timestamp });
export const ReconciliationCaseSchema = z.strictObject({ id: IdentifierSchema, kind: z.enum(['payment', 'refund', 'legacy']), referenceId: IdentifierSchema, reason: z.string().min(1).max(1000), paymentAttempt: PaymentAttemptSchema.nullable(), refundAttempt: RefundAttemptSchema.nullable(), legacyCheckout: CheckoutAttemptSchema.nullable(), sale: FinancialSaleSchema.nullable(), events: z.array(FinancialEventSchema).readonly(), actions: z.array(ReconciliationActionSchema).readonly() });
function result<T extends z.ZodType>(value: T) { return z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]); }
const empty = z.strictObject({});
const sessionRef = z.strictObject({ sessionId: IdentifierSchema });
const attemptRef = z.strictObject({ attemptId: IdentifierSchema });
export const TeamBookingSchema = z.strictObject({ sessionId: IdentifierSchema, eventTitle:z.string().nullable(), completedAt:timestamp, cart:CartSchema });
export const PAYMENTS_IPC_CONTRACTS = {
 completeTeam: { channel:'payments:completeTeam',request:sessionRef,response:result(CheckoutViewSchema) },
 listTeam: { channel:'payments:listTeam',request:empty,response:result(z.array(TeamBookingSchema).max(10000).readonly()) },
  setTip: { channel: 'payments:setTip', request: z.strictObject({ sessionId: IdentifierSchema, expectedTipRappen: RappenSchema, tipRappen: RappenSchema }), response: result(CheckoutViewSchema) },
  startCheckout: { channel: 'payments:startCheckout', request: z.strictObject({ cartId: IdentifierSchema, expectedRevision: RevisionSchema }), response: result(CheckoutViewSchema) },
  getCheckout: { channel: 'payments:getCheckout', request: sessionRef, response: result(CheckoutViewSchema) },
  getActiveCheckout: { channel: 'payments:getActiveCheckout', request: empty, response: result(CheckoutViewSchema.nullable()) },
  cancelCheckout: { channel: 'payments:cancelCheckout', request: sessionRef, response: result(CheckoutViewSchema) },
  preparePayment: { channel: 'payments:preparePayment', request: z.strictObject({ sessionId: IdentifierSchema, idempotencyKey: IdentifierSchema, method: PaymentMethodSchema, intendedRappen: RappenSchema }), response: result(PaymentAttemptSchema) },
  confirmPayment: { channel: 'payments:confirmPayment', request: z.strictObject({ attemptId: IdentifierSchema, operatorConfirmed: z.literal(true) }), response: result(CheckoutViewSchema) },
  reportPaymentOutcome: { channel: 'payments:reportPaymentOutcome', request: z.strictObject({ attemptId: IdentifierSchema, outcome: z.enum(['failed', 'uncertain']), reason: z.string().trim().min(3).max(1000), operatorConfirmed: z.literal(true) }), response: result(CheckoutViewSchema) },
  completeCheckout: { channel: 'payments:completeCheckout', request: sessionRef, response: result(FinancialSaleSchema) },
  getSaleDetails: { channel: 'payments:getSaleDetails', request: z.strictObject({ saleId: IdentifierSchema }), response: result(SaleDetailsSchema) },
  listRecentSales: { channel: 'payments:listRecentSales', request: empty, response: result(z.array(FinancialSaleSchema).max(20).readonly()) },
  prepareRefund: { channel: 'payments:prepareRefund', request: z.strictObject({ saleId: IdentifierSchema, idempotencyKey: IdentifierSchema, method: PaymentMethodSchema, items: z.array(selection).min(1).max(1000) }), response: result(RefundAttemptSchema) },
  getRefundAttempt: { channel: 'payments:getRefundAttempt', request: attemptRef, response: result(RefundAttemptSchema) },
  confirmRefund: { channel: 'payments:confirmRefund', request: z.strictObject({ attemptId: IdentifierSchema, operatorConfirmed: z.literal(true) }), response: result(RefundSchema) },
  reportRefundOutcome: { channel: 'payments:reportRefundOutcome', request: z.strictObject({ attemptId: IdentifierSchema, outcome: z.enum(['failed', 'uncertain']), reason: z.string().trim().min(3).max(1000), operatorConfirmed: z.literal(true) }), response: result(RefundAttemptSchema) },
  listReconciliationCases: { channel: 'payments:listReconciliationCases', request: empty, response: result(z.array(ReconciliationCaseSchema).readonly()) },
  listReconciliationHistory: { channel: 'payments:listReconciliationHistory', request: empty, response: result(z.array(ReconciliationActionSchema).readonly()) },
  reconcile: { channel: 'payments:reconcile', request: z.strictObject({ kind: z.enum(['payment', 'refund', 'legacy']), referenceId: IdentifierSchema, idempotencyKey: IdentifierSchema, resolution: z.enum(['confirm-recorded', 'exclude-no-transfer', 'exclude-compensated']), reason: z.string().trim().min(10).max(1000), deliberateConfirmation: z.literal(true) }), response: result(ReconciliationActionSchema) },
} as const;
export type PaymentsMethod = keyof typeof PAYMENTS_IPC_CONTRACTS;
export type PaymentsRequest<K extends PaymentsMethod> = z.input<(typeof PAYMENTS_IPC_CONTRACTS)[K]['request']>;
export type PaymentsResponse<K extends PaymentsMethod> = z.output<(typeof PAYMENTS_IPC_CONTRACTS)[K]['response']>;
export type PaymentsApi = { readonly [K in PaymentsMethod]: (request: PaymentsRequest<K>) => Promise<PaymentsResponse<K>> };
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;
export type PaymentAttempt = z.infer<typeof PaymentAttemptSchema>;
export type FinancialSale = z.infer<typeof FinancialSaleSchema>;
export type CheckoutView = z.infer<typeof CheckoutViewSchema>;
export type RefundAttempt = z.infer<typeof RefundAttemptSchema>;
export type Refund = z.infer<typeof RefundSchema>;
export type SaleDetails = z.infer<typeof SaleDetailsSchema>;
export type ReconciliationCase = z.infer<typeof ReconciliationCaseSchema>;
export type ReconciliationAction = z.infer<typeof ReconciliationActionSchema>;

export type TeamBooking = z.infer<typeof TeamBookingSchema>;
