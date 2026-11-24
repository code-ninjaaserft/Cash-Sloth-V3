import {WalletPayment} from './wallet-payment.js';
import { operationStorage } from './operation-storage.js';
import { QuickCheckout, type CheckoutProps } from './quick-checkout.js';
import { t } from './preferences.js';
import { TipOptions } from './tip-options.js';
import React, { useEffect, useRef, useState } from 'react';
import type { CheckoutView, CustomerDisplayApi, FinancialSale, PaymentAttempt, PaymentMethod, PaymentsApi, PromotionsApi } from '@cash-sloth/contracts';
import { DomainError, formatChf, parseChfInput, previewCash, quotePayment, roundCashRappen } from '@cash-sloth/domain';
import { Modal } from './modal.js';
import { PaymentMethodSelector, financialDate, inputChf, paymentErrorMessage, paymentMethodLabel, signedChf, unwrapPaymentResult } from './payment-components.js';
import { clearFinanceRecovery, readFinanceRecovery, saveFinanceRecovery, submitFinancialConfirmation } from './finance-recovery.js';

function DetailedPaymentsCheckout({ api, promotions, initial, customerDisplay, recovery = false, onComplete, onClose, onChanged, onReconciliation }: {
  promotions?:PromotionsApi|undefined;
  customerDisplay?: CustomerDisplayApi | undefined;
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
    try { quotePayment(view.session.cart.subtotalRappen, view.attempts, method, intended, view.session.tipRappen ?? 0); }
    catch (failure) { validAmount = false; if (failure instanceof DomainError && failure.code !== 'INSUFFICIENT_CASH') quoteError = failure.message; }
  }
  useEffect(() => { if (customerDisplay && !reviewRequired) { void customerDisplay.preview({ sessionId: view.session.id, method, tipRappen: view.session.tipRappen ?? 0, cashReceivedRappen: method === 'cash' ? intended : null }).catch(() => undefined); } }, [customerDisplay, view.session.id, view.session.tipRappen, method, intended, reviewRequired]);
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
        saveFinanceRecovery(operationStorage, marker(null));
        const prepared = unwrapPaymentResult(await api.preparePayment({ sessionId: view.session.id, idempotencyKey: prepareKey.current, method, intendedRappen: intended }));
        saveFinanceRecovery(operationStorage, marker(prepared));
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
        const result = unwrapPaymentResult(await submitFinancialConfirmation(operationStorage, marker(pending), () => api.confirmPayment({ attemptId: pending.id, operatorConfirmed: true })));
        update(result); setConfirmed(false); setAmount('');
        saveFinanceRecovery(operationStorage, marker(pending));
        if (pending.method === 'cash') await finish();
      } catch (failure) { setReviewRequired(true); throw failure; }
    });
  };
  const inspect = (): void => {
    void run(async () => {
      const next = unwrapPaymentResult(await api.getCheckout({ sessionId: view.session.id }));
      update(next); setViewFresh(true);
      if (next.sale) { await onComplete(next.sale); return; }
      const saved = readFinanceRecovery(operationStorage);
      const submitted = saved?.confirmationSubmitted === true;
      const savedAttempt = next.attempts.find((attempt) => attempt.id === saved?.attemptId);
      const uncertain = next.attempts.some((attempt) => ['reported', 'uncertain'].includes(attempt.status));
      if (submitted && savedAttempt?.status === 'prepared') {
        setReviewRequired(true);
        setError('The database still shows a prepared attempt, but this screen previously submitted confirmation. Investigate the actual transfer and resolve this exact attempt; do not pay again.');
      } else {
        setReviewRequired(uncertain);
        if (!uncertain) saveFinanceRecovery(operationStorage, { ...marker(savedAttempt ?? null), confirmationSubmitted: false });
      }
      setConfirmed(false);
    });
  };
  const report = (outcome: 'failed' | 'uncertain'): void => {
    if (!pending || !viewFresh || reason.trim().length < 3 || !outcomeAcknowledged) return;
    void run(async () => {
      const next = unwrapPaymentResult(await submitFinancialConfirmation(operationStorage, marker(pending), () => api.reportPaymentOutcome({ attemptId: pending.id, outcome, reason: reason.trim(), operatorConfirmed: true })));
      update(next); setReviewRequired(outcome === 'uncertain'); setConfirmed(false);
      if (outcome === 'failed') { saveFinanceRecovery(operationStorage, marker(pending)); setAmount(''); }
      setReason(''); setOutcomeAcknowledged(false);
    });
  };
  const retryRecordedConfirmation = (): void => {
    if (!pending || !confirmed || !viewFresh) return;
    void run(async () => {
      const next = unwrapPaymentResult(await submitFinancialConfirmation(operationStorage, marker(pending), () => api.confirmPayment({ attemptId: pending.id, operatorConfirmed: true })));
      update(next); setReviewRequired(false); setConfirmed(false);
      saveFinanceRecovery(operationStorage, marker(pending));
    });
  };
  const canLeave = !busy;
  const close = (): void => {
    if (!canLeave) return;
    onClose();
    window.requestAnimationFrame(() => { (document.getElementById('resume-checkout') ?? document.getElementById('start-checkout'))?.focus(); });
  };

  return <Modal title={recovery ? t("Recover checkout") : t("Checkout")} className="payments-dialog" closeDisabled={busy} onClose={close}>
    <div className="payment-balance" aria-live="polite"><span>{t("Outstanding balance")}</span><strong data-testid="outstanding-balance">{formatChf(view.balance.outstandingRappen)}</strong></div>
    {!view.attempts.some((attempt) => !['failed', 'excluded'].includes(attempt.status)) && !reviewRequired && <TipOptions cash={method === 'cash'} baseRappen={method === 'cash' ? roundCashRappen(view.session.cart.subtotalRappen) : view.session.cart.subtotalRappen} tipRappen={view.session.tipRappen ?? 0} disabled={busy} onChange={(tipRappen) => { void run(async () => { const next = unwrapPaymentResult(await api.setTip({ sessionId: view.session.id, expectedTipRappen: view.session.tipRappen ?? 0, tipRappen })); update(next); setAmount(''); }); }} />}
    <dl className="checkout-summary">
      <dt>{t("Original subtotal")}</dt><dd>{formatChf(view.balance.subtotalRappen)}</dd>
      {(view.session.tipRappen ?? 0) > 0 && <><dt>{t("Tip")}</dt><dd>{formatChf(view.session.tipRappen ?? 0)}</dd></>}<dt>{t("Confirmed applied payments")}</dt><dd>{formatChf(view.balance.confirmedAppliedRappen)}</dd>
      <dt>{t("Remaining cash settlement")}</dt><dd data-testid="checkout-amount-due">{formatChf(view.balance.cashDueRappen)}</dd>
      <dt>{t("Cash rounding")}</dt><dd>{signedChf(pending?.method === 'cash' ? pending.roundingAdjustmentRappen : view.balance.roundingAdjustmentRappen)}</dd>
    </dl>
    <p className="form-hint">{t("Card and TWINT are exact, manually confirmed payments. Cash settles the final remaining amount; no additional payment follows cash. This app does not contact a provider.")}</p>
    {error && <div role="alert" className="pos-error">{error}</div>}
    {busy && <p role="status" className="pos-status">{t("Saving the payment record…")}</p>}
    {(reviewRequired || hasUncertain) && <div className="recovery-notice">
      <strong>{t("Payment outcome needs review")}</strong><p>{t("Check the stored result and the actual transfer. Never take another payment merely because a reply was lost.")}</p>
      <div className="form-actions"><button type="button" className="subtle-button" disabled={busy} onClick={inspect}>{t("Check stored result")}</button><button type="button" className="subtle-button" disabled={busy} onClick={onReconciliation}>{t("Open reconciliation")}</button></div>
    </div>}
    {view.attempts.length > 0 && <section className="payment-allocations" aria-label={t("Payment allocation history")}><h3>{t("Payment history")}</h3>{view.attempts.map((attempt) => <div className="payment-allocation" key={attempt.id}>
      <span><strong>{paymentMethodLabel(attempt.method)} · {formatChf(attempt.appliedRappen)}</strong><small>{financialDate(attempt.createdAt)}{attempt.cashTenderedRappen !== null && <>{' '}{t("· Tendered")}{' '}{formatChf(attempt.cashTenderedRappen)}{' '}{t("· Change")}{' '}{formatChf(attempt.changeRappen)}</>}<br />{attempt.note}</small></span>
      <span className={`payment-status ${attempt.status}`}>{attempt.status === 'reported' ? 'reported · review' : attempt.status}</span>
    </div>)}</section>}
    {view.balance.settled ? <button type="button" className="primary-button" disabled={busy || hasUncertain || reviewRequired} onClick={() => { void run(async () => { try { await finish(); } catch (failure) { setReviewRequired(true); throw failure; } }); }}>{t("Complete sale")}</button> : <>
      <PaymentMethodSelector value={method} disabled={busy || pending !== null || reviewRequired || hasUncertain} onChange={(next) => { setMethod(next); setAmount(next === 'cash' ? '' : inputChf(view.balance.outstandingRappen)); setConfirmed(false); }} />
      {!pending && !reviewRequired && !hasUncertain && <>
        <label className="cash-field">{method === 'cash' ? t("Cash received (CHF)") : t("Payment amount (CHF)")}<input type="text" inputMode="decimal" aria-label={method === 'cash' ? t("Cash received (CHF)") : t("Payment amount (CHF)")} value={amount} disabled={busy} placeholder="0.00" onChange={(event) => { setAmount(event.target.value); setConfirmed(false); prepareKey.current = null; }} /></label>
        {method === 'cash' && <p className="form-hint">{t("Enter physical CHF cash in increments of CHF 0.05. The tender is recorded before confirmation is enabled.")}</p>}
        {method === 'cash' && <div className="quick-cash">{[view.balance.cashDueRappen, 1000, 2000, 5000, 10000].filter((value, index, all) => value >= view.balance.cashDueRappen && all.indexOf(value) === index).map((value) => <button type="button" key={value} disabled={busy} onClick={() => { setAmount(inputChf(value)); prepareKey.current = null; }}>{value === view.balance.cashDueRappen ? t("Exact amount") : formatChf(value)}</button>)}</div>}
        {invalidAmount && <p role="alert" className="pos-error">{t("Enter a valid CHF amount with at most two decimal places.")}</p>}
        {quoteError && <p role="alert" className="pos-error">{quoteError}</p>}
        {method !== 'cash' && <button type="button" className="primary-button" disabled={busy || !validAmount} onClick={() => { void prepare(); }}>{t("Review payment")}</button>}
      </>}
      {method === 'cash' && !pending && <div className={`cash-change${cashPreview && !cashPreview.sufficient ? ' insufficient' : ''}`}><span>{cashPreview && !cashPreview.sufficient ? t("Still required") : t("Change")}</span><strong data-testid="cash-change">{formatChf(cashPreview ? cashPreview.sufficient ? cashPreview.changeRappen : cashPreview.remainingRappen : 0)}</strong></div>}
      {pending && <section className="payment-review" aria-label={t("Review payment")}><h3>{paymentMethodLabel(pending.method)} · {formatChf(pending.appliedRappen)}</h3>
        {pending.method === 'cash' ? <><p>{t("Cash tendered:")}{' '}{formatChf(pending.cashTenderedRappen ?? 0)}{t(". Cash applied:")}{' '}{formatChf(pending.appliedRappen)}.</p><div className="cash-change"><span>{t("Change")}</span><strong data-testid="cash-change">{formatChf(pending.changeRappen)}</strong></div></> : <p>{t("Use your external payment service independently. Confirm here only after checking the actual result. This records your assertion and does not verify provider settlement.")}</p>}
        {pending.status !== 'uncertain' && <><label className="operator-confirmation"><input type="checkbox" disabled={busy || !viewFresh} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{pending.method === 'cash' ? t("I confirm that the cash was received") : t("I confirm the external payment succeeded")}</label>
        <button type="button" className="primary-button" disabled={busy || !confirmed || !viewFresh} onClick={reviewRequired || hasUncertain ? retryRecordedConfirmation : confirm}>{reviewRequired || hasUncertain ? t("Record same payment confirmation") : pending.method === 'cash' ? t("Complete sale") : t("Confirm payment")}</button></>}
        {pending.status === 'uncertain' && <p className="form-hint">{t("This uncertain transfer requires an explicit investigated decision in Reconciliation before normal checkout can resume.")}</p>}
        {pending.status === 'prepared' && !confirmed && !reviewRequired && <button type="button" className="subtle-button" disabled={busy || !viewFresh} onClick={() => { void run(async () => {
          const next = unwrapPaymentResult(await api.reportPaymentOutcome({ attemptId: pending.id, outcome: 'failed', reason: 'Operator corrected the entered amount before any transfer occurred.', operatorConfirmed: true }));
          saveFinanceRecovery(operationStorage, marker(pending)); update(next); setAmount('');
        }); }}>{pending.method === 'cash' ? t("Change amount · no cash received") : t("Change amount · no transfer occurred")}</button>}
        {pending.status === 'prepared' && <details className="payment-outcome"><summary>{t("Payment failed or result unknown?")}</summary><p className="form-hint">{t("Only report failure if no transfer occurred. An uncertain transfer remains blocked for investigation.")}</p>
          <label className="cash-field">{t("Outcome reason")}<textarea aria-label={t("Payment outcome reason")} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setOutcomeAcknowledged(false); }} /></label>
          <label className="inline-check"><input type="checkbox" checked={outcomeAcknowledged} disabled={busy} onChange={(event) => setOutcomeAcknowledged(event.target.checked)} />{t("I verified the recorded outcome")}</label>
          <div className="form-actions"><button type="button" className="subtle-button" disabled={busy || !viewFresh || !outcomeAcknowledged || reason.trim().length < 3} onClick={() => report('failed')}>{t("Record failed payment")}</button><button type="button" className="subtle-button" disabled={busy || !viewFresh || !outcomeAcknowledged || reason.trim().length < 3} onClick={() => report('uncertain')}>{t("Report uncertain outcome")}</button></div>
        </details>}
      </section>}
      {!pending && method === 'cash' && <><label className="operator-confirmation"><input type="checkbox" checked={false} disabled />{t("I confirm that the cash was received")}</label><button type="button" className="primary-button" disabled>{t("Complete sale")}</button></>}
    </>}
    <div className="form-actions"><button type="button" className="subtle-button" disabled={busy} onClick={close}>{t("Keep checkout for later")}</button>
      {view.attempts.every((attempt) => ['failed', 'excluded'].includes(attempt.status)) && !reviewRequired && <button type="button" className="subtle-button" disabled={busy || confirmed} onClick={() => { void run(async () => { const next = unwrapPaymentResult(await api.cancelCheckout({ sessionId: view.session.id })); clearFinanceRecovery(operationStorage, 'checkout', view.session.id); update(next); onClose(); }); }}>{t("Return to cart · no payment received")}</button>}
    </div>
    {promotions&&<WalletPayment api={promotions} view={view} onChanged={async()=>update(unwrapPaymentResult(await api.getCheckout({sessionId:view.session.id})))}/>}
    <p className="financial-reference">{t("Checkout reference:")}{' '}{view.session.id}</p>
  </Modal>;
}

export function PaymentsCheckout(props: CheckoutProps): React.JSX.Element {
  const [advanced, setAdvanced] = useState(props.recovery === true || props.initial.attempts.length > 0 || (props.initial.balance.settled && props.initial.session.cart.subtotalRappen>0));
  const [advancedRecovery, setAdvancedRecovery] = useState(props.recovery === true);
  const [advancedView, setAdvancedView] = useState(props.initial);
  return advanced ? <DetailedPaymentsCheckout {...props} initial={advancedView} recovery={advancedRecovery} /> : <QuickCheckout {...props} onAdvanced={(view, recovery = false) => { setAdvancedView(view); setAdvancedRecovery(recovery); setAdvanced(true); }} />;
}
