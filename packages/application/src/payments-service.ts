import { PAYMENTS_IPC_CONTRACTS, type PaymentsMethod, type PaymentsRequest, type PaymentsResponse, type Result } from '@cash-sloth/contracts';
import { addMoney, checkoutBalance, DomainError, paymentAllocation, quotePayment, quoteRefundItems, validateCheckoutSession, validateFinancialSale, validatePaymentAttempt, validateRefundAttempt, validateRefundHistory,
  type CheckoutSession, type CheckoutView, type FinancialSale, type PaymentAttempt, type ReconciliationAction, type ReconciliationCase, type Refund, type RefundAttempt, type SaleDetails } from '@cash-sloth/domain';
import type { FinanceStore } from './finance-ports.js';
import { PersistenceError, type PosRuntime } from './ports.js';

export type PaymentsService = { [K in PaymentsMethod]: (request: PaymentsRequest<K>) => PaymentsResponse<K> };
function requireValue<T>(value: T | null, label: string): T { if (value === null) throw new DomainError('NOT_FOUND', `${label} not found.`); return value; }
function safe<K extends PaymentsMethod>(method: K, request: PaymentsRequest<K>, operation: () => unknown): PaymentsResponse<K> {
  try {
    if (!PAYMENTS_IPC_CONTRACTS[method].request.safeParse(request).success) throw new DomainError('INVALID_INPUT', 'Invalid payment request.');
    return PAYMENTS_IPC_CONTRACTS[method].response.parse({ ok: true, value: operation() }) as PaymentsResponse<K>;
  } catch (error) {
    const response: Result<unknown> = error instanceof DomainError ? { ok: false, error: { code: error.code, message: error.message } }
      : error instanceof PersistenceError && error.outcome === 'unknown'
        ? { ok: false, error: { code: 'COMMIT_UNCERTAIN', message: 'Commit outcome is uncertain. Read the same attempt before continuing; do not repeat the external transfer.' } }
        : { ok: false, error: { code: 'STORAGE_ERROR', message: 'Storage could not confirm the operation. Preserve this attempt reference and review recorded evidence before continuing.' } };
    return PAYMENTS_IPC_CONTRACTS[method].response.parse(response) as PaymentsResponse<K>;
  }
}
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

/** Host-independent financial orchestration. SQLite and physical transfers are never claimed atomic. */
export function createPaymentsService(store: FinanceStore, runtime: PosRuntime): PaymentsService {
  const event = (kind: 'payment' | 'refund' | 'session', referenceId: string, status: string, note: string | null = null) => store.appendEvent({ id: runtime.newId(), kind, referenceId, status, at: runtime.now(), note });
  const sessionById = (id: string): CheckoutSession => { const session = requireValue(store.getSession(id), 'Checkout session'); validateCheckoutSession(session); return session; };
  const view = (id: string): CheckoutView => {
    const session = sessionById(id); const attempts = store.listPaymentAttempts(id);
    return { session, attempts, balance: checkoutBalance(session.cart.subtotalRappen, attempts, session.tipRappen ?? 0), sale: store.getSaleBySession(id) };
  };
  const requireOpen = (id: string): CheckoutSession => {
    const session = sessionById(id);
    if (session.status !== 'open') throw new DomainError('CONFLICT', 'Checkout session is no longer open.');
    const cart = store.pos.getCart(session.cart.id);
    if (cart === null || !sameJson(cart, session.cart)) throw new DomainError('CONFLICT', 'The cart differs from its checkout snapshot. Investigate the recorded payment before continuing.');
    return session;
  };
  const assertNoLegacyConflict = () => {
    if (store.listLegacyUnresolved().length > 0) throw new DomainError('RECONCILIATION_REQUIRED', 'An earlier cash confirmation requires reconciliation.');
  };
  const saleDetails = (saleId: string): SaleDetails => {
    const sale = requireValue(store.getFinancialSale(saleId), 'Sale'); validateFinancialSale(sale);
    const refunds = store.listRefunds(saleId); validateRefundHistory(sale, refunds);
    const refundedRappen = refunds.reduce((sum, refund) => addMoney(sum, refund.amountRappen), 0);
    return { sale, refunds, refundAttempts: store.listRefundAttempts(saleId), refundedRappen, refundableRappen: sale.actualPaidRappen - (sale.tipRappen ?? 0) - refundedRappen,
      items: sale.items.map((item) => { const quantityRefunded = refunds.reduce((sum, refund) => sum + (refund.items.find((line) => line.saleItemId === item.id)?.quantity ?? 0), 0);
        return { saleItemId: item.id, quantitySold: item.quantity, quantityRefunded, quantityRemaining: item.quantity - quantityRefunded }; }) };
  };
  const applyPayment = (attemptId: string, allowUncertain: boolean): CheckoutView => {
    const attempt = requireValue(store.getPaymentAttempt(attemptId), 'Payment attempt'); validatePaymentAttempt(attempt);
    if (attempt.status === 'confirmed') return view(attempt.sessionId);
    if (attempt.status !== 'reported' && !(allowUncertain && attempt.status === 'uncertain')) throw new DomainError('RECONCILIATION_REQUIRED', 'Only a recorded confirmation or investigated uncertain attempt can be allocated.');
    const session = requireOpen(attempt.sessionId); assertNoLegacyConflict();
    const attempts = store.listPaymentAttempts(session.id);
    if (attempts.some((other) => other.id !== attempt.id && ['prepared', 'reported', 'uncertain'].includes(other.status))) throw new DomainError('RECONCILIATION_REQUIRED', 'Another pending payment must be resolved before allocation.');
    const quote = quotePayment(session.cart.subtotalRappen, attempts.filter((other) => other.id !== attempt.id), attempt.method, attempt.intendedRappen, session.tipRappen ?? 0);
    if (quote.appliedRappen !== attempt.appliedRappen || quote.cashTenderedRappen !== attempt.cashTenderedRappen || quote.changeRappen !== attempt.changeRappen || quote.roundingAdjustmentRappen !== attempt.roundingAdjustmentRappen) throw new DomainError('CONFLICT', 'Recorded payment no longer matches the outstanding balance.');
    const now = runtime.now();
    store.putPaymentAttempt({ ...attempt, status: 'confirmed', reportedAt: attempt.reportedAt ?? now, confirmedAt: now }); event('payment', attempt.id, 'confirmed');
    return view(session.id);
  };
  const applyRefund = (attemptId: string, allowUncertain: boolean, investigationConfirmedAt?: string): Refund => {
    const existing = store.getRefundByAttempt(attemptId); if (existing !== null) return existing;
    const attempt = requireValue(store.getRefundAttempt(attemptId), 'Refund attempt'); validateRefundAttempt(attempt);
    if (attempt.status !== 'reported' && !(allowUncertain && attempt.status === 'uncertain')) throw new DomainError('RECONCILIATION_REQUIRED', 'Refund needs a recorded or investigated confirmation.');
    const details = saleDetails(attempt.saleId);
    if (details.refundAttempts.some((other) => other.id !== attempt.id && ['prepared', 'reported', 'uncertain'].includes(other.status))) throw new DomainError('RECONCILIATION_REQUIRED', 'Another refund is pending for this sale.');
    const quoted = quoteRefundItems(details.sale, details.refunds, attempt.items);
    if (!sameJson(quoted, attempt.items) || attempt.amountRappen > details.refundableRappen) throw new DomainError('REFUND_LIMIT', 'Recorded refund conflicts with the remaining original sale units.');
    const now = runtime.now();
    const confirmedAt = attempt.status === 'uncertain' ? requireValue(investigationConfirmedAt ?? null, 'Investigation confirmation timestamp') : attempt.reportedAt ?? now;
    const refund: Refund = { id: runtime.newId(), idempotencyKey: attempt.idempotencyKey, attemptId: attempt.id, saleId: attempt.saleId, items: attempt.items, amountRappen: attempt.amountRappen, method: attempt.method, operatorConfirmed: true, confirmedAt, completedAt: now };
    validateRefundHistory(details.sale, [...details.refunds, refund]);
    store.insertRefund(refund); store.putRefundAttempt({ ...attempt, status: 'completed', reportedAt: attempt.reportedAt ?? now, refundId: refund.id }); event('refund', attempt.id, 'completed');
    return refund;
  };
  const cases = (): readonly ReconciliationCase[] => {
    const paymentCases: ReconciliationCase[] = store.listUnresolvedPaymentAttempts().map((attempt) => ({ id: attempt.id, kind: 'payment', referenceId: attempt.id,
      reason: attempt.status === 'uncertain' ? 'The operator reported an uncertain external outcome. Investigate without repeating the transfer.' : attempt.status === 'confirmed'
        ? 'Confirmed digital funds remain in an uncompleted checkout. Resume settlement or record an already completed manual compensation. Original payment evidence is retained; this action does not return money.'
        : 'Operator confirmation was recorded but has not been allocated. Review the original attempt and cart snapshot.',
      paymentAttempt: attempt, refundAttempt: null, legacyCheckout: null, sale: store.getSaleBySession(attempt.sessionId), events: store.listEvents(attempt.id), actions: store.listReconciliationActions('payment', attempt.id) }));
    const refundCases: ReconciliationCase[] = store.listUnresolvedRefundAttempts().map((attempt) => ({ id: attempt.id, kind: 'refund', referenceId: attempt.id,
      reason: 'Refund outcome needs investigation. Do not disburse the refund again.', paymentAttempt: null, refundAttempt: attempt, legacyCheckout: null, sale: store.getFinancialSale(attempt.saleId), events: store.listEvents(attempt.id), actions: store.listReconciliationActions('refund', attempt.id) }));
    const legacyCases: ReconciliationCase[] = store.listLegacyUnresolved().map((attempt) => ({ id: attempt.idempotencyKey, kind: 'legacy', referenceId: attempt.idempotencyKey,
      reason: 'Legacy cash confirmation remains unresolved, possibly after a stale cart or competing confirmation. Resolve the physical cash disposition explicitly.', paymentAttempt: null, refundAttempt: null, legacyCheckout: attempt,
      sale: store.getSaleBySession(attempt.idempotencyKey), events: [], actions: store.listReconciliationActions('legacy', attempt.idempotencyKey) }));
    return [...paymentCases, ...refundCases, ...legacyCases];
  };
  return {
 listTeam: request=>safe('listTeam',request,()=>store.transaction(()=>store.listTeamBookings?.()??[])),
 completeTeam: request=>safe('completeTeam',request,()=>store.transaction(()=>{
 if(store.hasTeamBooking?.(request.sessionId))return view(request.sessionId);
 const session=requireOpen(request.sessionId);assertNoLegacyConflict();
 if(session.cart.items.some(item=>item.originalUnitPriceRappen!==undefined))throw new DomainError('CONFLICT','Remove discounts before complimentary consumption.');
 if(store.listPaymentAttempts(session.id).length || (session.tipRappen??0)!==0)throw new DomainError('CONFLICT','Team consumption cannot contain payments or tips.');
 if(!store.recordTeamBooking)throw new DomainError('CONFLICT','Team consumption is unavailable.');
 store.recordTeamBooking(session,runtime.now());store.pos.consumeCart(session.cart.id,session.cart.revision);store.putSession({...session,status:'cancelled'});return view(session.id);
 })),
    setTip: (request) => safe('setTip', request, () => store.transaction(() => {
      const session = requireOpen(request.sessionId);
      if ((session.tipRappen ?? 0) === request.tipRappen) return view(session.id);
      if ((session.tipRappen ?? 0) !== request.expectedTipRappen) throw new DomainError('CONFLICT', 'The tip changed. Refresh checkout before continuing.');
      if (store.listPaymentAttempts(session.id).some((attempt) => !['failed', 'excluded'].includes(attempt.status))) throw new DomainError('PAYMENT_PENDING', 'Choose the tip before preparing a payment.');
      addMoney(session.cart.subtotalRappen, request.tipRappen);
      store.putSession({ ...session, tipRappen: request.tipRappen }); event('session', session.id, 'tip-updated');
      return view(session.id);
    })),
    startCheckout: (request) => safe('startCheckout', request, () => store.transaction(() => {
      const existing = store.getOpenSession();
      if (existing !== null) {
        if (existing.cart.id !== request.cartId || existing.cart.revision !== request.expectedRevision) throw new DomainError('CHECKOUT_PENDING', 'Recover the existing checkout session first.');
        return view(existing.id);
      }
      assertNoLegacyConflict();
      if (store.listUnresolvedPaymentAttempts().length > 0 || store.listUnresolvedRefundAttempts().length > 0) throw new DomainError('RECONCILIATION_REQUIRED', 'An unresolved payment or refund requires investigation first.');
      const cart = requireValue(store.pos.getCart(request.cartId), 'Cart');
      if (cart.revision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The cart changed. Refresh before starting checkout.');
      const session: CheckoutSession = { id: runtime.newId(), cart, status: 'open', createdAt: runtime.now(), saleId: null };
      validateCheckoutSession(session); store.putSession(session); event('session', session.id, 'open'); return view(session.id);
    })),
    getCheckout: (request) => safe('getCheckout', request, () => store.transaction(() => view(request.sessionId))),
    getActiveCheckout: (request) => safe('getActiveCheckout', request, () => store.transaction(() => { const session = store.getOpenSession(); return session === null ? null : view(session.id); })),
    cancelCheckout: (request) => safe('cancelCheckout', request, () => store.transaction(() => {
      const session = requireOpen(request.sessionId); const attempts = store.listPaymentAttempts(session.id);
      if (attempts.some((attempt) => !['failed', 'excluded'].includes(attempt.status))) throw new DomainError('RECONCILIATION_REQUIRED', 'Every prepared or reported transfer must be explicitly resolved before returning to the cart.');
      store.putSession({ ...session, status: 'cancelled' }); event('session', session.id, 'cancelled'); return view(session.id);
    })),
    preparePayment: (request) => safe('preparePayment', request, () => store.transaction(() => {
      if(request.method==='voucher')throw new DomainError('INVALID_INPUT','Use the value-voucher payment function.');
      const replay = store.getPaymentAttemptByKey(request.idempotencyKey);
      if (replay !== null) {
        if (replay.sessionId !== request.sessionId || replay.method !== request.method || replay.intendedRappen !== request.intendedRappen) throw new DomainError('CONFLICT', 'Payment key is already bound to different input.');
        return replay;
      }
      const session = requireOpen(request.sessionId); assertNoLegacyConflict(); const attempts = store.listPaymentAttempts(session.id);
      if (attempts.length >= 1000) throw new DomainError('LIMIT_REACHED', 'Too many payment attempts. Resolve this checkout before continuing.');
      if (attempts.some((attempt) => ['prepared', 'reported', 'uncertain'].includes(attempt.status))) throw new DomainError('PAYMENT_PENDING', 'Resolve the existing prepared or uncertain attempt before preparing another transfer.');
      const quote = quotePayment(session.cart.subtotalRappen, attempts, request.method, request.intendedRappen, session.tipRappen ?? 0);
      const attempt: PaymentAttempt = { id: runtime.newId(), idempotencyKey: request.idempotencyKey, sessionId: session.id, method: request.method, intendedRappen: request.intendedRappen, ...quote, status: 'prepared', createdAt: runtime.now(), reportedAt: null, confirmedAt: null, note: null };
      validatePaymentAttempt(attempt); store.putPaymentAttempt(attempt); event('payment', attempt.id, 'prepared'); return attempt;
    })),
    confirmPayment: (request) => safe('confirmPayment', request, () => {
      store.transaction(() => {
        const attempt = requireValue(store.getPaymentAttempt(request.attemptId), 'Payment attempt');
        if (attempt.status === 'prepared') { store.putPaymentAttempt({ ...attempt, status: 'reported', reportedAt: runtime.now() }); event('payment', attempt.id, 'reported'); }
        else if (!['reported', 'confirmed'].includes(attempt.status)) throw new DomainError('RECONCILIATION_REQUIRED', 'Review this attempt through reconciliation; do not repeat the transfer.');
      });
      return store.transaction(() => applyPayment(request.attemptId, false));
    }),
    reportPaymentOutcome: (request) => safe('reportPaymentOutcome', request, () => store.transaction(() => {
      const attempt = requireValue(store.getPaymentAttempt(request.attemptId), 'Payment attempt');
      if (attempt.status === request.outcome && attempt.note === request.reason.trim()) return view(attempt.sessionId);
      if (attempt.status !== 'prepared') throw new DomainError('RECONCILIATION_REQUIRED', 'Recorded payment evidence requires privileged reconciliation.');
      store.putPaymentAttempt({ ...attempt, status: request.outcome, note: request.reason.trim(), reportedAt: request.outcome === 'uncertain' ? runtime.now() : null }); event('payment', attempt.id, request.outcome, request.reason.trim()); return view(attempt.sessionId);
    })),
    completeCheckout: (request) => safe('completeCheckout', request, () => store.transaction(() => {
      const existing = store.getSaleBySession(request.sessionId); if (existing !== null) return existing;
      const session = requireOpen(request.sessionId); assertNoLegacyConflict(); const attempts = store.listPaymentAttempts(session.id);
      if (attempts.some((attempt) => ['prepared', 'reported', 'uncertain'].includes(attempt.status))) throw new DomainError('PAYMENT_PENDING', 'Resolve every pending attempt before completing this sale.');
      const balance = checkoutBalance(session.cart.subtotalRappen, attempts, session.tipRappen ?? 0);
      const confirmed = attempts.filter((attempt) => attempt.status === 'confirmed');
      if (!balance.settled || confirmed.length === 0) throw new DomainError('OUTSTANDING_BALANCE', 'The sale requires confirmed allocations covering its final payable amount.');
      const order=store.pos.prepareSaleOrder?.(session.cart,runtime.now());
      const sale: FinancialSale = { ...(order?{order}:{}), tipRappen: session.tipRappen ?? 0, eventId: store.getEventId?.() ?? null, eventTitle: store.getEventTitle?.() ?? null, id: runtime.newId(), checkoutSessionId: session.id, cartId: session.cart.id, cartRevision: session.cart.revision, completedAt: runtime.now(), items: session.cart.items,
        subtotalRappen: session.cart.subtotalRappen, roundingAdjustmentRappen: balance.roundingAdjustmentRappen, amountDueRappen: balance.finalPayableRappen, actualPaidRappen: balance.confirmedAppliedRappen, payments: confirmed.map(paymentAllocation), source: 'payments' };
      validateFinancialSale(sale); store.insertFinancialSale(sale); store.pos.consumeCart(session.cart.id, session.cart.revision); store.putSession({ ...session, status: 'completed', saleId: sale.id }); event('session', session.id, 'completed'); return sale;
    })),
    getSaleDetails: (request) => safe('getSaleDetails', request, () => store.transaction(() => saleDetails(request.saleId))),
    listRecentSales: (request) => safe('listRecentSales', request, () => store.transaction(() => store.listFinancialSales(20))),
    prepareRefund: (request) => safe('prepareRefund', request, () => store.transaction(() => {
      const replay = store.getRefundAttemptByKey(request.idempotencyKey);
      if (replay !== null) {
        if (replay.saleId !== request.saleId || replay.method !== request.method || !sameJson(replay.items.map(({ saleItemId, quantity }) => ({ saleItemId, quantity })), request.items)) throw new DomainError('CONFLICT', 'Refund key is already bound to different input.');
        return replay;
      }
      const details = saleDetails(request.saleId);
      const fundedByVoucher=details.sale.payments.some(p=>p.method==='voucher');if(fundedByVoucher!== (request.method==='voucher'))throw new DomainError('INVALID_INPUT',fundedByVoucher?'Refund this sale to its original voucher credit.':'This sale has no value-voucher payment.');
      if (details.refundAttempts.some((attempt) => ['prepared', 'reported', 'uncertain'].includes(attempt.status))) throw new DomainError('REFUND_PENDING', 'An existing refund reserves quantities for this sale. Review that attempt first.');
      const items = quoteRefundItems(details.sale, details.refunds, request.items); const amountRappen = items.reduce((sum, item) => addMoney(sum, item.amountRappen), 0);
      if (amountRappen > details.refundableRappen) throw new DomainError('REFUND_LIMIT', 'Refund exceeds the original actual payment.');
      if (request.method === 'cash' && amountRappen % 5 !== 0) throw new DomainError('CASH_DENOMINATION', 'This historical refund allocation cannot be paid in CHF 0.05 coins. Select Card/TWINT or a different item selection; the amount will not be rounded again.');
      const attempt: RefundAttempt = { id: runtime.newId(), idempotencyKey: request.idempotencyKey, saleId: request.saleId, method: request.method, items, amountRappen, status: 'prepared', createdAt: runtime.now(), reportedAt: null, refundId: null, note: null };
      validateRefundAttempt(attempt); store.putRefundAttempt(attempt); event('refund', attempt.id, 'prepared'); return attempt;
    })),
    getRefundAttempt: (request) => safe('getRefundAttempt', request, () => requireValue(store.getRefundAttempt(request.attemptId), 'Refund attempt')),
    confirmRefund: (request) => safe('confirmRefund', request, () => {
      store.transaction(() => {
        const attempt = requireValue(store.getRefundAttempt(request.attemptId), 'Refund attempt');
        if (attempt.status === 'prepared') { store.putRefundAttempt({ ...attempt, status: 'reported', reportedAt: runtime.now() }); event('refund', attempt.id, 'reported'); }
        else if (!['reported', 'completed'].includes(attempt.status)) throw new DomainError('RECONCILIATION_REQUIRED', 'Review the refund outcome through reconciliation; do not disburse it again.');
      });
      return store.transaction(() => applyRefund(request.attemptId, false));
    }),
    reportRefundOutcome: (request) => safe('reportRefundOutcome', request, () => store.transaction(() => {
      const attempt = requireValue(store.getRefundAttempt(request.attemptId), 'Refund attempt');
      if (attempt.status === request.outcome && attempt.note === request.reason.trim()) return attempt;
      if (attempt.status !== 'prepared') throw new DomainError('RECONCILIATION_REQUIRED', 'Recorded refund evidence requires privileged reconciliation.');
      const updated: RefundAttempt = { ...attempt, status: request.outcome, note: request.reason.trim(), reportedAt: request.outcome === 'uncertain' ? runtime.now() : null };
      store.putRefundAttempt(updated); event('refund', attempt.id, request.outcome, request.reason.trim()); return updated;
    })),
    listReconciliationCases: (request) => safe('listReconciliationCases', request, () => store.transaction(cases)),
    listReconciliationHistory: (request) => safe('listReconciliationHistory', request, () => store.transaction(() => store.listReconciliationHistory())),
    reconcile: (request) => safe('reconcile', request, () => store.transaction(() => {
      if(request.kind==='payment'&&store.getPaymentAttempt(request.referenceId)?.method==='voucher')throw new DomainError('INVALID_INPUT','Use the voucher reversal function to return local credit.');
      const replay = store.getReconciliationActionByKey(request.idempotencyKey);
      if (replay !== null) {
        if (replay.kind !== request.kind || replay.referenceId !== request.referenceId || replay.resolution !== request.resolution || replay.reason !== request.reason.trim()) throw new DomainError('CONFLICT', 'Reconciliation key is already bound to another decision.');
        return replay;
      }
      const action: ReconciliationAction = { id: runtime.newId(), idempotencyKey: request.idempotencyKey, kind: request.kind, referenceId: request.referenceId, resolution: request.resolution, reason: request.reason.trim(), at: runtime.now() };
      let actionInserted = false;
      if (request.kind === 'legacy') {
        const attempt = requireValue(store.listLegacyUnresolved().find((candidate) => candidate.idempotencyKey === request.referenceId) ?? null, 'Unresolved legacy confirmation');
        if (request.resolution === 'confirm-recorded') throw new DomainError('CONSERVATIVE_RESOLUTION', 'Legacy confirmations can be completed through their original cash checkout if consistent. Otherwise document no transfer or a completed manual compensation; do not invent a replacement sale.');
        if (attempt.status !== 'confirmed') throw new DomainError('CONFLICT', 'Legacy confirmation is no longer unresolved.');
      } else if (request.kind === 'payment') {
        const attempt = requireValue(store.getPaymentAttempt(request.referenceId), 'Payment attempt');
        if (!['reported', 'uncertain', 'prepared', 'confirmed'].includes(attempt.status)) throw new DomainError('CONFLICT', 'This payment has no unresolved outcome.');
        if (attempt.status === 'confirmed') {
          const session = sessionById(attempt.sessionId);
          const activeCash = store.listPaymentAttempts(session.id).some((allocation) => allocation.method === 'cash' && !['failed', 'excluded'].includes(allocation.status));
          if (request.resolution !== 'exclude-compensated' || attempt.method === 'cash' || session.status !== 'open' || activeCash || store.getSaleBySession(session.id) !== null) throw new DomainError('CONSERVATIVE_RESOLUTION', 'Only confirmed digital allocations in an open checkout without active cash may be excluded after manual compensation. Resolve pending cash first; complete cash-settled sales and use refunds.');
          // This does not erase the received-funds assertion: the original amount,
          // timestamps and events stay intact beside a new compensation assertion.
          store.insertReconciliationAction(action); actionInserted = true;
          store.putPaymentAttempt({ ...attempt, status: 'excluded', note: request.reason.trim() }); event('payment', attempt.id, 'excluded', request.reason.trim());
        }
        else if (request.resolution === 'confirm-recorded') applyPayment(attempt.id, true);
        else { store.putPaymentAttempt({ ...attempt, status: 'excluded', note: request.reason.trim() }); event('payment', attempt.id, 'excluded', request.reason.trim()); }
      } else {
        const attempt = requireValue(store.getRefundAttempt(request.referenceId), 'Refund attempt');
        if (!['reported', 'uncertain', 'prepared'].includes(attempt.status)) throw new DomainError('CONFLICT', 'This refund has no unresolved outcome.');
        if (request.resolution === 'confirm-recorded') {
          // The investigation timestamp belongs to this new assertion. Keep the
          // original unknown-outcome timestamp on the immutable attempt evidence.
          store.insertReconciliationAction(action); actionInserted = true;
          applyRefund(attempt.id, true, action.at);
        }
        else { store.putRefundAttempt({ ...attempt, status: 'excluded', note: request.reason.trim() }); event('refund', attempt.id, 'excluded', request.reason.trim()); }
      }
      if (!actionInserted) store.insertReconciliationAction(action); return action;
    })),
  };
}
