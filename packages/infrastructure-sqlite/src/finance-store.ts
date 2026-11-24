import {completeBenefit,postWalletEntry} from './promotion-completion.js';
import { issueSaleTickets } from './ticket-issuance.js';
import {
  checkoutBalance, DomainError, financialSaleFromLegacy, paymentAllocation, quoteRefundItems,
  validateCheckoutSession, validateFinancialSale, validatePaymentAttempt, validateRefund, validateRefundAttempt, validateRefundHistory,
  type CheckoutSession, type FinancialEvent, type FinancialSale, type PaymentAttempt,
  type ReconciliationAction, type Refund, type RefundAttempt,
} from '@cash-sloth/domain';
import type { FinanceStore } from '@cash-sloth/application';
import {
  TeamBookingSchema, PresetSchema, CheckoutSessionSchema, FinancialEventSchema, FinancialSaleSchema, PaymentAttemptSchema,
  ReconciliationActionSchema, RefundAttemptSchema, RefundSchema,
} from '@cash-sloth/contracts';
import type { DatabaseConnection } from './connection.js';
import { createPosStore, type PosStoreTestHooks } from './pos-store.js';

type Row = Record<string, unknown>;
function payload(row: Row): unknown {
  if (typeof row['data'] !== 'string') throw new Error('Missing persisted financial snapshot.');
  const parsed: unknown = JSON.parse(row['data']);
  // Our writes are canonical JSON.stringify output. Reject ambiguous duplicate
  // keys (SQLite and JavaScript can otherwise interpret those differently).
  if (JSON.stringify(parsed) !== row['data']) throw new Error('Persisted financial snapshot is noncanonical or ambiguous.');
  return parsed;
}
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function immutableFields(value: object, mutable: readonly string[]): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !mutable.includes(key))));
}
function conflict(message: string): never { throw new DomainError('CONFLICT', message); }
function checkTransition(before: string, after: string, transitions: Readonly<Record<string, readonly string[]>>): void {
  if (before !== after && !(transitions[before] ?? []).includes(after)) conflict('Invalid financial status transition.');
}
const paymentTransitions = { prepared: ['reported', 'uncertain', 'failed', 'excluded'], reported: ['confirmed', 'uncertain', 'excluded'], uncertain: ['confirmed', 'excluded'], confirmed: ['excluded'] } as const;
const refundTransitions = { prepared: ['reported', 'uncertain', 'failed', 'excluded'], reported: ['completed', 'uncertain', 'excluded'], uncertain: ['completed', 'excluded'] } as const;

/** Indexed, immutable JSON snapshots preserve the exact shared financial contracts.
 * All modifications and their application-supplied events share one SQLite transaction. */
export function createFinanceStore(connection: DatabaseConnection, hooks: PosStoreTestHooks = {}): FinanceStore {
  const { sqlite } = connection;
  const pos = createPosStore(connection, hooks);
  const { transaction } = pos;
  const requireTransaction = (): void => { if (!sqlite.isTransaction) throw new Error('Financial writes require a transaction.'); };
  const snapshot = <T>(operation: () => T): T => sqlite.isTransaction ? operation() : transaction(operation);
  const decodeSession = (row: Row): CheckoutSession => {
    const session = CheckoutSessionSchema.parse(payload(row)); validateCheckoutSession(session); return session;
  };
  const decodePayment = (row: Row): PaymentAttempt => {
    const attempt = PaymentAttemptSchema.parse(payload(row)); validatePaymentAttempt(attempt); return attempt;
  };
  const decodeSale = (row: Row): FinancialSale => {
    const sale = FinancialSaleSchema.parse(payload(row)); validateFinancialSale(sale); return sale;
  };
  const decodeRefundAttempt = (row: Row): RefundAttempt => {
    const attempt = RefundAttemptSchema.parse(payload(row));
    validateRefundAttempt(attempt);
    return attempt;
  };
  const decodeRefund = (row: Row): Refund => {
    const refund = RefundSchema.parse(payload(row)); validateRefund(refund); return refund;
  };
  const store: FinanceStore = {
 hasTeamBooking: (id) => !!sqlite.prepare('SELECT 1 FROM team_consumption WHERE session_id=?').get(id),
 recordTeamBooking(session,completedAt) { requireTransaction(); sqlite.prepare('INSERT INTO team_consumption VALUES(?,?)').run(session.id,JSON.stringify({sessionId:session.id,eventTitle:store.getEventTitle?.()??null,completedAt,cart:session.cart})); issueSaleTickets(connection,{id:session.id,completedAt,items:session.cart.items,eventTitle:store.getEventTitle?.()??null}); },
 listTeamBookings: () => sqlite.prepare('SELECT data FROM team_consumption ORDER BY rowid DESC LIMIT 10000').all().map(row => TeamBookingSchema.parse(JSON.parse(String(row['data'])) as unknown)),
    getEventId() {
      if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='active_event_preset'").get()) return null;
      const row = sqlite.prepare('SELECT preset_id FROM active_event_preset WHERE singleton=1').get();
      return row ? String(row['preset_id']) : null;
    },
    getEventTitle() {
      // Earlier schema versions have no event context; their receipts retain the fallback title.
      if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='active_event_preset'").get()) return null;
      const row = sqlite.prepare('SELECT p.data FROM active_event_preset a JOIN event_presets p ON p.id=a.preset_id WHERE a.singleton=1').get();
      if (!row) return null;
      if (typeof row['data'] !== 'string') throw new Error('Invalid active event.');
      return PresetSchema.parse(JSON.parse(row['data']) as unknown).name;
    },
    pos, transaction,
    getSession(id) {
      const row = sqlite.prepare('SELECT data FROM payment_sessions WHERE id = ?').get(id);
      return row === undefined ? null : decodeSession(row);
    },
    getOpenSession() {
      const row = sqlite.prepare("SELECT data FROM payment_sessions WHERE state = 'open' ORDER BY rowid LIMIT 1").get();
      return row === undefined ? null : decodeSession(row);
    },
    putSession(input) {
      requireTransaction(); const session = CheckoutSessionSchema.parse(input); validateCheckoutSession(session);
      const existing = store.getSession(session.id);
      if (existing === null) {
        if (session.status !== 'open' || session.saleId !== null) conflict('New checkout sessions must be open.');
        const cart = pos.getCart(session.cart.id);
        if (!equal(cart, session.cart)) conflict('Checkout snapshot does not match the saved cart.');
        sqlite.prepare('INSERT INTO payment_sessions (id, cart_id, state, created_at, data) VALUES (?, ?, ?, ?, ?)')
          .run(session.id, session.cart.id, session.status, session.createdAt, JSON.stringify(session));
      } else {
        if (immutableFields(existing, ['status', 'saleId', 'tipRappen']) !== immutableFields(session, ['status', 'saleId', 'tipRappen']) || existing.status !== 'open' && !equal(existing, session)) conflict('Checkout snapshot is immutable.');
        if ((existing.tipRappen ?? 0) !== (session.tipRappen ?? 0) && (existing.status !== 'open' || store.listPaymentAttempts(session.id).some((attempt) => !['failed', 'excluded'].includes(attempt.status)))) conflict('Tip cannot change after a payment is prepared.');
        if (session.status === 'completed' && store.getSaleBySession(session.id)?.id !== session.saleId) conflict('A completed checkout requires its committed sale snapshot.');
        sqlite.prepare('UPDATE payment_sessions SET state = ?, data = ? WHERE id = ?').run(session.status, JSON.stringify(session), session.id);
      }
    },
    getPaymentAttempt(id) {
      const row = sqlite.prepare('SELECT data FROM payment_attempts WHERE id = ?').get(id);
      return row === undefined ? null : decodePayment(row);
    },
    getPaymentAttemptByKey(key) {
      const row = sqlite.prepare('SELECT data FROM payment_attempts WHERE idempotency_key = ?').get(key);
      return row === undefined ? null : decodePayment(row);
    },
    listPaymentAttempts(sessionId) { return sqlite.prepare('SELECT data FROM payment_attempts WHERE session_id = ? ORDER BY rowid').all(sessionId).map(decodePayment); },
    listUnresolvedPaymentAttempts() {
      return sqlite.prepare(`SELECT a.data FROM payment_attempts a WHERE a.state IN ('reported', 'uncertain') OR (
        a.state = 'confirmed' AND json_extract(a.data, '$.method') IN ('card', 'twint')
        AND EXISTS(SELECT 1 FROM payment_sessions s WHERE s.id = a.session_id AND s.state = 'open')
        AND NOT EXISTS(SELECT 1 FROM financial_sales f WHERE f.session_id = a.session_id)
        AND NOT EXISTS(SELECT 1 FROM payment_attempts c WHERE c.session_id = a.session_id AND c.state NOT IN ('failed', 'excluded') AND json_extract(c.data, '$.method') = 'cash'))
        ORDER BY a.rowid`).all().map(decodePayment);
    },
    putPaymentAttempt(input) {
      requireTransaction(); const attempt = PaymentAttemptSchema.parse(input); validatePaymentAttempt(attempt);
      const existing = store.getPaymentAttempt(attempt.id);
      if (existing === null) {
        if (attempt.status !== 'prepared' || store.getSession(attempt.sessionId)?.status !== 'open') conflict('A new payment must be prepared for an open checkout.');
        const keyOwner = store.getPaymentAttemptByKey(attempt.idempotencyKey);
        if (keyOwner !== null) conflict('Payment idempotency key is already in use.');
        sqlite.prepare('INSERT INTO payment_attempts (id, idempotency_key, session_id, state, data) VALUES (?, ?, ?, ?, ?)')
          .run(attempt.id, attempt.idempotencyKey, attempt.sessionId, attempt.status, JSON.stringify(attempt));
      } else {
        if (immutableFields(existing, ['status', 'reportedAt', 'confirmedAt', 'note']) !== immutableFields(attempt, ['status', 'reportedAt', 'confirmedAt', 'note'])) conflict('Payment request identity and amounts are immutable.');
        checkTransition(existing.status, attempt.status, paymentTransitions);
        if (existing.status === 'confirmed' && attempt.status === 'excluded') {
          const actions = store.listReconciliationActions('payment', attempt.id);
          if (attempt.method === 'cash' || store.getSession(attempt.sessionId)?.status !== 'open' || store.getSaleBySession(attempt.sessionId) !== null
              || store.listPaymentAttempts(attempt.sessionId).some((candidate) => !['failed', 'excluded'].includes(candidate.status) && candidate.method === 'cash')
              || !actions.some((action) => action.resolution === 'exclude-compensated' && action.reason === attempt.note)) {
            conflict('Confirmed digital allocations require audited manual compensation before cash or a completed sale.');
          }
        }
        if (existing.reportedAt !== null && existing.reportedAt !== attempt.reportedAt || existing.confirmedAt !== null && existing.confirmedAt !== attempt.confirmedAt) conflict('Payment confirmation timestamps are immutable.');
        sqlite.prepare('UPDATE payment_attempts SET state = ?, data = ? WHERE id = ?').run(attempt.status, JSON.stringify(attempt), attempt.id);
      }
    },
    getFinancialSale(id) {
      return snapshot(() => {
        const row = sqlite.prepare('SELECT data FROM financial_sales WHERE id = ?').get(id);
        if (row !== undefined) return decodeSale(row);
        const legacy = pos.getSale(id); return legacy === null ? null : FinancialSaleSchema.parse(financialSaleFromLegacy(legacy));
      });
    },
    getSaleBySession(sessionId) {
      return snapshot(() => {
        const row = sqlite.prepare('SELECT data FROM financial_sales WHERE session_id = ?').get(sessionId);
        if (row !== undefined) return decodeSale(row);
        const legacy = pos.getSaleByCheckoutKey(sessionId); return legacy === null ? null : FinancialSaleSchema.parse(financialSaleFromLegacy(legacy));
      });
    },
    listFinancialSales(limit) {
      return snapshot(() => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new DomainError('INVALID_INPUT', 'Invalid financial history limit.');
        const current = sqlite.prepare('SELECT data FROM financial_sales ORDER BY completed_at DESC, id DESC LIMIT ?').all(limit).map(decodeSale);
        const legacy = pos.listRecentSales(limit).map(financialSaleFromLegacy);
        return [...current, ...legacy].sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id)).slice(0, limit);
      });
    },
    insertFinancialSale(input) {
      requireTransaction(); const sale = FinancialSaleSchema.parse(input); validateFinancialSale(sale);
      const existing = store.getFinancialSale(sale.id);
      if (existing !== null) { if (!equal(existing, sale)) conflict('Sale identity is already bound to another snapshot.'); return; }
      const session = store.getSession(sale.checkoutSessionId);
      if (session === null || session.status !== 'open' || session.cart.id !== sale.cartId || session.cart.revision !== sale.cartRevision || !equal(session.cart.items, sale.items) || session.cart.subtotalRappen !== sale.subtotalRappen || sale.source !== 'payments' || (session.tipRappen ?? 0) !== (sale.tipRappen ?? 0)) conflict('Sale does not match its open checkout snapshot.');
      const attempts = store.listPaymentAttempts(session.id);
      if (attempts.some((a) => ['prepared', 'reported', 'uncertain'].includes(a.status))) conflict('Resolve outstanding payment attempts before completing a sale.');
      const balance = checkoutBalance(session.cart.subtotalRappen, attempts, session.tipRappen ?? 0);
      const allocations = attempts.filter((attempt) => attempt.status === 'confirmed').map(paymentAllocation);
      if (!balance.settled || balance.finalPayableRappen !== sale.amountDueRappen || balance.roundingAdjustmentRappen !== sale.roundingAdjustmentRappen || !equal(allocations, sale.payments)) conflict('Sale payment allocations do not match durable confirmations.');
      sqlite.prepare('INSERT INTO financial_sales (id, session_id, cart_id, completed_at, actual_paid_rappen, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sale.id, sale.checkoutSessionId, sale.cartId, sale.completedAt, sale.actualPaidRappen, JSON.stringify(sale));
      issueSaleTickets(connection, sale);
      completeBenefit(connection,sale.cartId,sale.id,sale.completedAt);
    },
    getRefundAttempt(id) {
      const row = sqlite.prepare('SELECT data FROM refund_attempts WHERE id = ?').get(id);
      return row === undefined ? null : decodeRefundAttempt(row);
    },
    getRefundAttemptByKey(key) {
      const row = sqlite.prepare('SELECT data FROM refund_attempts WHERE idempotency_key = ?').get(key);
      return row === undefined ? null : decodeRefundAttempt(row);
    },
    listRefundAttempts(saleId) { return sqlite.prepare('SELECT data FROM refund_attempts WHERE sale_id = ? ORDER BY rowid').all(saleId).map(decodeRefundAttempt); },
    listUnresolvedRefundAttempts() { return sqlite.prepare("SELECT data FROM refund_attempts WHERE state IN ('reported', 'uncertain') ORDER BY rowid").all().map(decodeRefundAttempt); },
    putRefundAttempt(input) {
      requireTransaction(); const attempt = decodeRefundAttempt({ data: JSON.stringify(RefundAttemptSchema.parse(input)) });
      const existing = store.getRefundAttempt(attempt.id);
      if (existing === null) {
        const sale = store.getFinancialSale(attempt.saleId);
        if (attempt.status !== 'prepared' || sale === null) conflict('A new refund must be prepared for a completed sale.');
        const expected = quoteRefundItems(sale, store.listRefunds(sale.id), attempt.items);
        if (!equal(expected, attempt.items)) conflict('Refund items do not match remaining original units.');
        sqlite.prepare('INSERT INTO refund_attempts (id, idempotency_key, sale_id, state, data) VALUES (?, ?, ?, ?, ?)')
          .run(attempt.id, attempt.idempotencyKey, attempt.saleId, attempt.status, JSON.stringify(attempt));
      } else {
        if (immutableFields(existing, ['status', 'reportedAt', 'refundId', 'note']) !== immutableFields(attempt, ['status', 'reportedAt', 'refundId', 'note'])) conflict('Refund identity, quantities and amounts are immutable.');
        checkTransition(existing.status, attempt.status, refundTransitions);
        if (existing.reportedAt !== null && existing.reportedAt !== attempt.reportedAt) conflict('Refund confirmation timestamp is immutable.');
        if (attempt.status === 'completed' && store.getRefundByAttempt(attempt.id)?.id !== attempt.refundId) conflict('A completed refund requires its immutable refund record.');
        sqlite.prepare('UPDATE refund_attempts SET state = ?, data = ? WHERE id = ?').run(attempt.status, JSON.stringify(attempt), attempt.id);
      }
    },
    getRefundByAttempt(attemptId) {
      const row = sqlite.prepare('SELECT data FROM refunds WHERE attempt_id = ?').get(attemptId);
      return row === undefined ? null : decodeRefund(row);
    },
    listRefunds(saleId) {
      return snapshot(() => {
        const refunds = sqlite.prepare('SELECT data FROM refunds WHERE sale_id = ? ORDER BY rowid').all(saleId).map(decodeRefund);
        const sale = store.getFinancialSale(saleId);
        if (sale === null && refunds.length > 0) throw new Error('Persisted refunds have no original sale.');
        if (sale !== null) validateRefundHistory(sale, refunds);
        return refunds;
      });
    },
    insertRefund(input) {
      requireTransaction(); const refund = RefundSchema.parse(input); validateRefund(refund);
      const existing = store.getRefundByAttempt(refund.attemptId);
      if (existing !== null) { if (!equal(existing, refund)) conflict('Refund attempt already has another completed refund.'); return; }
      const sale = store.getFinancialSale(refund.saleId);
      if (sale === null) conflict('Original sale not found.');
      validateRefundHistory(sale, [...store.listRefunds(sale.id), refund]);
      sqlite.prepare('INSERT INTO refunds (id, idempotency_key, attempt_id, sale_id, amount_rappen, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(refund.id, refund.idempotencyKey, refund.attemptId, refund.saleId, refund.amountRappen, JSON.stringify(refund));
      if(refund.method==='voucher'){const sale=store.getFinancialSale(refund.saleId);if(!sale)throw new Error('Missing voucher sale');const ledger=sqlite.prepare("SELECT l.code FROM wallet_ledger l JOIN payment_attempts a ON a.id=l.id WHERE l.session_id=? AND l.kind='pay' AND a.state='confirmed' ORDER BY l.rowid LIMIT 1").get(sale.checkoutSessionId);if(!ledger)throw new Error('Missing original voucher');postWalletEntry(connection,{id:refund.id,code:String(ledger['code']),sessionId:sale.checkoutSessionId,amountRappen:refund.amountRappen,kind:'refund',at:refund.completedAt});}
    },
    appendEvent(input) {
      requireTransaction(); const event = FinancialEventSchema.parse(input);
      const existing = sqlite.prepare('SELECT data FROM financial_events WHERE id = ?').get(event.id);
      if (existing !== undefined) { if (!equal(FinancialEventSchema.parse(payload(existing)), event)) conflict('Event identity is immutable.'); return; }
      sqlite.prepare('INSERT INTO financial_events (id, reference_id, data) VALUES (?, ?, ?)').run(event.id, event.referenceId, JSON.stringify(event));
    },
    listEvents(referenceId) { return sqlite.prepare('SELECT data FROM financial_events WHERE reference_id = ? ORDER BY rowid').all(referenceId).map((row): FinancialEvent => FinancialEventSchema.parse(payload(row))); },
    listLegacyUnresolved() {
      return sqlite.prepare(`SELECT idempotency_key FROM checkout_attempts a WHERE state = 'confirmed'
        AND NOT EXISTS(SELECT 1 FROM reconciliation_actions r WHERE r.kind = 'legacy' AND r.reference_id = a.idempotency_key)
        ORDER BY a.created_at, a.idempotency_key`).all().map((row) => {
        if (typeof row['idempotency_key'] !== 'string') throw new Error('Invalid persisted legacy checkout key.');
        const attempt = pos.getCheckout(row['idempotency_key']); if (attempt === null) throw new Error('Missing legacy checkout.'); return attempt;
      });
    },
    listReconciliationActions(kind, referenceId) { return sqlite.prepare('SELECT data FROM reconciliation_actions WHERE kind = ? AND reference_id = ? ORDER BY rowid').all(kind, referenceId).map((row): ReconciliationAction => ReconciliationActionSchema.parse(payload(row))); },
    listReconciliationHistory() { return sqlite.prepare('SELECT data FROM reconciliation_actions ORDER BY rowid').all().map((row): ReconciliationAction => ReconciliationActionSchema.parse(payload(row))); },
    getReconciliationActionByKey(key) {
      const row = sqlite.prepare('SELECT data FROM reconciliation_actions WHERE idempotency_key = ?').get(key);
      return row === undefined ? null : ReconciliationActionSchema.parse(payload(row));
    },
    insertReconciliationAction(input) {
      requireTransaction(); const action = ReconciliationActionSchema.parse(input);
      const existing = store.getReconciliationActionByKey(action.idempotencyKey);
      if (existing !== null) { if (!equal(existing, action)) conflict('Reconciliation key is bound to another action.'); return; }
      sqlite.prepare('INSERT INTO reconciliation_actions (id, idempotency_key, kind, reference_id, resolution, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(action.id, action.idempotencyKey, action.kind, action.referenceId, action.resolution, JSON.stringify(action));
    },
  };
  return store;
}
