import type { CheckoutAttempt, CheckoutSession, FinancialEvent, FinancialSale, PaymentAttempt, ReconciliationAction, Refund, RefundAttempt } from '@cash-sloth/domain';
import type { PosStore } from './ports.js';

/** All writes use the same synchronous transaction/connection as the existing POS store. */
export interface FinanceStore {
  readonly pos: PosStore;
  transaction<T>(operation: () => T): T;
  getSession(id: string): CheckoutSession | null;
  getOpenSession(): CheckoutSession | null;
  putSession(session: CheckoutSession): void;
  getPaymentAttempt(id: string): PaymentAttempt | null;
  getPaymentAttemptByKey(key: string): PaymentAttempt | null;
  listPaymentAttempts(sessionId: string): readonly PaymentAttempt[];
  listUnresolvedPaymentAttempts(): readonly PaymentAttempt[];
  putPaymentAttempt(attempt: PaymentAttempt): void;
  getFinancialSale(id: string): FinancialSale | null;
  getSaleBySession(sessionId: string): FinancialSale | null;
  listFinancialSales(limit: number): readonly FinancialSale[];
  insertFinancialSale(sale: FinancialSale): void;
  getRefundAttempt(id: string): RefundAttempt | null;
  getRefundAttemptByKey(key: string): RefundAttempt | null;
  listRefundAttempts(saleId: string): readonly RefundAttempt[];
  listUnresolvedRefundAttempts(): readonly RefundAttempt[];
  putRefundAttempt(attempt: RefundAttempt): void;
  getRefundByAttempt(attemptId: string): Refund | null;
  listRefunds(saleId: string): readonly Refund[];
  insertRefund(refund: Refund): void;
  appendEvent(event: FinancialEvent): void;
  listEvents(referenceId: string): readonly FinancialEvent[];
  listLegacyUnresolved(): readonly CheckoutAttempt[];
  listReconciliationActions(kind: ReconciliationAction['kind'], referenceId: string): readonly ReconciliationAction[];
  listReconciliationHistory(): readonly ReconciliationAction[];
  getReconciliationActionByKey(key: string): ReconciliationAction | null;
  insertReconciliationAction(action: ReconciliationAction): void;
}
