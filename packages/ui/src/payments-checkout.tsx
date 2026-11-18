import React, { useEffect, useRef, useState } from 'react';
import type { CheckoutView, FinancialSale, PaymentAttempt, PaymentMethod, PaymentsApi } from '@cash-sloth/contracts';
import { DomainError, formatChf, parseChfInput, previewCash, quotePayment } from '@cash-sloth/domain';
import { Modal } from './modal.js';
import { PaymentMethodSelector, financialDate, inputChf, paymentErrorMessage, paymentMethodLabel, signedChf, unwrapPaymentResult } from './payment-components.js';
import { clearFinanceRecovery, readFinanceRecovery, saveFinanceRecovery, submitFinancialConfirmation } from './finance-recovery.js';

export function PaymentsCheckout({ api, initial, recovery = false, onComplete, onClose, onChanged, onReconciliation }: {
  api: PaymentsApi; initial: CheckoutView; recovery?: boolean;
  onComplete: (sale: FinancialSale) => Promise<void>; onClose: () => void;
  onChanged: (view: CheckoutView) => void; onReconciliation: () => void;
}): React.JSX.Element {
  const [view, setView] = useState(initial);
  const pending = view.attempts.find((attempt) => ['prepared', 'reported', 'uncertain'].includes(attempt.status)) ?? null;
  const [method, setMethod] = useState<PaymentMethod>(pending?.method ?? 'cash');
  const [amount, setAmount] = useState(pending ? inputChf(pending.intendedRappen) : '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(recovery);
  const [viewFresh, setViewFresh] = useState(true);
  const [reason, setReason] = useState('');
  const [outcomeAcknowledged, setOutcomeAcknowledged] = useState(false);
  const operation = useRef(false);
  const prepareKey = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  let intended: number | null = null;
  let invalidAmount = false;
  try { if (amount !== '') intended = parseChfInput(amount); } catch { invalidAmount = true; }
  const cashPreview = method === 'cash' && intended !== null ? previewCash(view.balance.cashDueRappen, intended) : null;
  let validAmount = intended !== null && !invalidAmount;
  let quoteError: string | null = null;
  if (intended !== null && !pending && !view.balance.settled) {
    try { quotePayment(view.session.cart.subtotalRappen, view.attempts, method, intended); }
    catch (failure) { validAmount = false; if (failure instanceof DomainError && failure.code !== 'INSUFFICIENT_CASH') quoteError = failure.message; }
  }
  const hasUncertain = view.attempts.some((attempt) => ['reported', 'uncertain'].includes(attempt.status));
  const update = (next: CheckoutView): void => { setView(next); onChanged(next); };
  const marker = (attempt: PaymentAttempt | null) => ({ kind: 'checkout' as const, reference: view.session.id, attemptId: attempt?.id ?? null, confirmationSubmitted: false });

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    try { await action(); } catch (failure) { setError(paymentErrorMessage(failure)); setReviewRequired(true); setViewFresh(false); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  const prepare = async (): Promise<void> => {
    if (!validAmount || intended === null || pending || view.balance.settled || reviewRequired) return;
    await run(async () => {
      prepareKey.current ??= window.crypto.randomUUID();
      try {
        saveFinanceRecovery(window.localStorage, marker(null));
        const prepared = unwrapPaymentResult(await api.preparePayment({ sessionId: view.session.id, idempotencyKey: prepareKey.current, method, intendedRappen: intended }));
        saveFinanceRecovery(window.localStorage, marker(prepared));
        const next = unwrapPaymentResult(await api.getCheckout({ sessionId: view.session.id }));
        update(next); setConfirmed(false); prepareKey.current = null;
      } catch (failure) {
        setReviewRequired(true);
        throw failure;
      }
    });
  };

  // Cash keeps the fast path: persist the entered tender before enabling its
  // operator confirmation. The database still owns the quote and allocation.
  useEffect(() => {
    if (method !== 'cash' || !validAmount || pending || busy || reviewRequired || view.balance.settled) return;
    const timer = window.setTimeout(() => { void prepare(); }, 220);
    return () => window.clearTimeout(timer);
  }, [amount, method, validAmount, pending?.id, busy, reviewRequired, view.balance.settled]);

  const finish = async (): Promise<void> => {
    const sale = unwrapPaymentResult(await api.completeCheckout({ sessionId: view.session.id }));
    await onComplete(sale);
  };
  const confirm = (): void => {
    if (!pending || !confirmed || !viewFresh || hasUncertain || reviewRequired) return;
    void run(async () => {
      try {
        const result = unwrapPaymentResult(await submitFinancialConfirmation(window.localStorage, marker(pending), () => api.confirmPayment({ attemptId: pending.id, operatorConfirmed: true })));
        update(result); setConfirmed(false); setAmount('');
        saveFinanceRecovery(window.localStorage, marker(pending));
        if (pending.method === 'cash') await finish();
      } catch (failure) { setReviewRequired(true); throw failure; }
    });
  };
  const inspect = (): void => {
    void run(async () => {
      const next = unwrapPaymentResult(await api.getCheckout({ sessionId: view.session.id }));
      update(next); setViewFresh(true);
      if (next.sale) { await onComplete(next.sale); return; }
      const saved = readFinanceRecovery(window.localStorage);
      const submitted = saved?.confirmationSubmitted === true;
      const savedAttempt = next.attempts.find((attempt) => attempt.id === saved?.attemptId);
      const uncertain = next.attempts.some((attempt) => ['reported', 'uncertain'].includes(attempt.status));
      if (submitted && savedAttempt?.status === 'prepared') {
        setReviewRequired(true);
        setError('The database still shows a prepared attempt, but this screen previously submitted confirmation. Investigate the actual transfer and resolve this exact attempt; do not pay again.');
      } else {
        setReviewRequired(uncertain);
        if (!uncertain) saveFinanceRecovery(window.localStorage, { ...marker(savedAttempt ?? null), confirmationSubmitted: false });
      }
      setConfirmed(false);
    });
  };
  const report = (outcome: 'failed' | 'uncertain'): void => {
    if (!pending || !viewFresh || reason.trim().length < 3 || !outcomeAcknowledged) return;
    void run(async () => {
      const next = unwrapPaymentResult(await submitFinancialConfirmation(window.localStorage, marker(pending), () => api.reportPaymentOutcome({ attemptId: pending.id, outcome, reason: reason.trim(), operatorConfirmed: true })));
      update(next); setReviewRequired(outcome === 'uncertain'); setConfirmed(false);
      if (outcome === 'failed') { saveFinanceRecovery(window.localStorage, marker(pending)); setAmount(''); }
      setReason(''); setOutcomeAcknowledged(false);
    });
  };
  const retryRecordedConfirmation = (): void => {
    if (!pending || !confirmed || !viewFresh) return;
    void run(async () => {
      const next = unwrapPaymentResult(await submitFinancialConfirmation(window.localStorage, marker(pending), () => api.confirmPayment({ attemptId: pending.id, operatorConfirmed: true })));
      update(next); setReviewRequired(false); setConfirmed(false);
      saveFinanceRecovery(window.localStorage, marker(pending));
    });
  };
  const canLeave = !busy;
  const close = (): void => {
    if (!canLeave) return;
    onClose();
    window.requestAnimationFrame(() => { (document.getElementById('resume-checkout') ?? document.getElementById('start-checkout'))?.focus(); });
  };

  return <Modal title={recovery ? 'Recover checkout' : 'Checkout'} className="payments-dialog" closeDisabled={busy} onClose={close}>
    <div className="payment-balance" aria-live="polite"><span>Outstanding balance</span><strong data-testid="outstanding-balance">{formatChf(view.balance.outstandingRappen)}</strong></div>
    <dl className="checkout-summary">
      <dt>Original subtotal</dt><dd>{formatChf(view.balance.subtotalRappen)}</dd>
      <dt>Confirmed applied payments</dt><dd>{formatChf(view.balance.confirmedAppliedRappen)}</dd>
      <dt>Remaining cash settlement</dt><dd data-testid="checkout-amount-due">{formatChf(view.balance.cashDueRappen)}</dd>
      <dt>Cash rounding</dt><dd>{signedChf(pending?.method === 'cash' ? pending.roundingAdjustmentRappen : view.balance.roundingAdjustmentRappen)}</dd>
    </dl>
    <p className="form-hint">Card and TWINT are exact, manually confirmed payments. Cash settles the final remaining amount; no additional payment follows cash. This app does not contact a provider.</p>
    {error && <div role="alert" className="pos-error">{error}</div>}
    {busy && <p role="status" className="pos-status">Saving the payment record…</p>}
    {(reviewRequired || hasUncertain) && <div className="recovery-notice">
      <strong>Payment outcome needs review</strong><p>Check the stored result and the actual transfer. Never take another payment merely because a reply was lost.</p>
      <div className="form-actions"><button type="button" className="subtle-button" disabled={busy} onClick={inspect}>Check stored result</button><button type="button" className="subtle-button" disabled={busy} onClick={onReconciliation}>Open reconciliation</button></div>
    </div>}
    {view.attempts.length > 0 && <section className="payment-allocations" aria-label="Payment allocation history"><h3>Payment history</h3>{view.attempts.map((attempt) => <div className="payment-allocation" key={attempt.id}>
      <span><strong>{paymentMethodLabel(attempt.method)} · {formatChf(attempt.appliedRappen)}</strong><small>{financialDate(attempt.createdAt)}{attempt.cashTenderedRappen !== null && <> · Tendered {formatChf(attempt.cashTenderedRappen)} · Change {formatChf(attempt.changeRappen)}</>}<br />{attempt.note}</small></span>
      <span className={`payment-status ${attempt.status}`}>{attempt.status === 'reported' ? 'reported · review' : attempt.status}</span>
    </div>)}</section>}
    {view.balance.settled ? <button type="button" className="primary-button" disabled={busy || hasUncertain || reviewRequired} onClick={() => { void run(async () => { try { await finish(); } catch (failure) { setReviewRequired(true); throw failure; } }); }}>Complete sale</button> : <>
      <PaymentMethodSelector value={method} disabled={busy || pending !== null || reviewRequired || hasUncertain} onChange={(next) => { setMethod(next); setAmount(next === 'cash' ? '' : inputChf(view.balance.outstandingRappen)); setConfirmed(false); }} />
      {!pending && !reviewRequired && !hasUncertain && <>
        <label className="cash-field">{method === 'cash' ? 'Cash received (CHF)' : 'Payment amount (CHF)'}<input type="text" inputMode="decimal" aria-label={method === 'cash' ? 'Cash received (CHF)' : 'Payment amount (CHF)'} value={amount} disabled={busy} placeholder="0.00" onChange={(event) => { setAmount(event.target.value); setConfirmed(false); prepareKey.current = null; }} /></label>
        {method === 'cash' && <p className="form-hint">Enter physical CHF cash in increments of CHF 0.05. The tender is recorded before confirmation is enabled.</p>}
        {method === 'cash' && <div className="quick-cash">{[view.balance.cashDueRappen, 1000, 2000, 5000, 10000].filter((value, index, all) => value >= view.balance.cashDueRappen && all.indexOf(value) === index).map((value) => <button type="button" key={value} disabled={busy} onClick={() => { setAmount(inputChf(value)); prepareKey.current = null; }}>{value === view.balance.cashDueRappen ? 'Exact amount' : formatChf(value)}</button>)}</div>}
        {invalidAmount && <p role="alert" className="pos-error">Enter a valid CHF amount with at most two decimal places.</p>}
        {quoteError && <p role="alert" className="pos-error">{quoteError}</p>}
        {method !== 'cash' && <button type="button" className="primary-button" disabled={busy || !validAmount} onClick={() => { void prepare(); }}>Review payment</button>}
      </>}
      {method === 'cash' && !pending && <div className={`cash-change${cashPreview && !cashPreview.sufficient ? ' insufficient' : ''}`}><span>{cashPreview && !cashPreview.sufficient ? 'Still required' : 'Change'}</span><strong data-testid="cash-change">{formatChf(cashPreview ? cashPreview.sufficient ? cashPreview.changeRappen : cashPreview.remainingRappen : 0)}</strong></div>}
      {pending && <section className="payment-review" aria-label="Review payment"><h3>{paymentMethodLabel(pending.method)} · {formatChf(pending.appliedRappen)}</h3>
        {pending.method === 'cash' ? <><p>Cash tendered: {formatChf(pending.cashTenderedRappen ?? 0)}. Cash applied: {formatChf(pending.appliedRappen)}.</p><div className="cash-change"><span>Change</span><strong data-testid="cash-change">{formatChf(pending.changeRappen)}</strong></div></> : <p>Use your external payment service independently. Confirm here only after checking the actual result. This records your assertion and does not verify provider settlement.</p>}
        {pending.status !== 'uncertain' && <><label className="operator-confirmation"><input type="checkbox" disabled={busy || !viewFresh} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{pending.method === 'cash' ? 'I confirm that the cash was received' : 'I confirm the external payment succeeded'}</label>
        <button type="button" className="primary-button" disabled={busy || !confirmed || !viewFresh} onClick={reviewRequired || hasUncertain ? retryRecordedConfirmation : confirm}>{reviewRequired || hasUncertain ? 'Record same payment confirmation' : pending.method === 'cash' ? 'Complete sale' : 'Confirm payment'}</button></>}
        {pending.status === 'uncertain' && <p className="form-hint">This uncertain transfer requires an explicit investigated decision in Reconciliation before normal checkout can resume.</p>}
        {pending.status === 'prepared' && !confirmed && !reviewRequired && <button type="button" className="subtle-button" disabled={busy || !viewFresh} onClick={() => { void run(async () => {
          const next = unwrapPaymentResult(await api.reportPaymentOutcome({ attemptId: pending.id, outcome: 'failed', reason: 'Operator corrected the entered amount before any transfer occurred.', operatorConfirmed: true }));
          saveFinanceRecovery(window.localStorage, marker(pending)); update(next); setAmount('');
        }); }}>{pending.method === 'cash' ? 'Change amount · no cash received' : 'Change amount · no transfer occurred'}</button>}
        {pending.status === 'prepared' && <details className="payment-outcome"><summary>Payment failed or result unknown?</summary><p className="form-hint">Only report failure if no transfer occurred. An uncertain transfer remains blocked for investigation.</p>
          <label className="cash-field">Outcome reason<textarea aria-label="Payment outcome reason" value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setOutcomeAcknowledged(false); }} /></label>
          <label className="inline-check"><input type="checkbox" checked={outcomeAcknowledged} disabled={busy} onChange={(event) => setOutcomeAcknowledged(event.target.checked)} />I verified the recorded outcome</label>
          <div className="form-actions"><button type="button" className="subtle-button" disabled={busy || !viewFresh || !outcomeAcknowledged || reason.trim().length < 3} onClick={() => report('failed')}>Record failed payment</button><button type="button" className="subtle-button" disabled={busy || !viewFresh || !outcomeAcknowledged || reason.trim().length < 3} onClick={() => report('uncertain')}>Report uncertain outcome</button></div>
        </details>}
      </section>}
      {!pending && method === 'cash' && <><label className="operator-confirmation"><input type="checkbox" checked={false} disabled />I confirm that the cash was received</label><button type="button" className="primary-button" disabled>Complete sale</button></>}
    </>}
    <div className="form-actions"><button type="button" className="subtle-button" disabled={busy} onClick={close}>Keep checkout for later</button>
      {view.attempts.every((attempt) => ['failed', 'excluded'].includes(attempt.status)) && !reviewRequired && <button type="button" className="subtle-button" disabled={busy || confirmed} onClick={() => { void run(async () => { const next = unwrapPaymentResult(await api.cancelCheckout({ sessionId: view.session.id })); clearFinanceRecovery(window.localStorage, 'checkout', view.session.id); update(next); onClose(); }); }}>Return to cart · no payment received</button>}
    </div>
    <p className="financial-reference">Checkout reference: {view.session.id}</p>
  </Modal>;
}
