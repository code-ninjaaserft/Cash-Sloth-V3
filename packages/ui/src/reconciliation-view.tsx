import { t } from './preferences.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PaymentsApi, ReconciliationAction, ReconciliationCase, PaymentsRequest } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';
import { Modal } from './modal.js';
import { financialDate, paymentErrorMessage, paymentMethodLabel, unwrapPaymentResult } from './payment-components.js';

type Resolution = PaymentsRequest<'reconcile'>['resolution'];
const resolutionLabels: Record<Resolution, string> = {
  'confirm-recorded': 'Confirm recorded transfer',
  'exclude-no-transfer': 'No transfer occurred',
  'exclude-compensated': 'Transfer compensated externally',
};
const resolutionExplanation: Record<Resolution, string> = {
  'confirm-recorded': 'I investigated this exact transfer and confirm that the recorded amount really changed hands. This only records evidence; it does not execute or independently verify a payment.',
  'exclude-no-transfer': 'I investigated this attempt and confirm that no money changed hands. Its original evidence will remain in the audit trail.',
  'exclude-compensated': 'I investigated this attempt and confirm that its transfer was already compensated outside this application. This action does not pay a refund or undo a physical transfer.',
};

export function ReconciliationView({ api, onResolved }: { api: PaymentsApi; onResolved: () => void }): React.JSX.Element {
  const [cases, setCases] = useState<readonly ReconciliationCase[]>([]);
  const [history, setHistory] = useState<readonly ReconciliationAction[]>([]);
  const [selected, setSelected] = useState<{ item: ReconciliationCase; resolution: Resolution } | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [feedback, setFeedback] = useState('');
  const key = useRef(window.crypto.randomUUID());
  const running = useRef(false);
  const load = useCallback(async (): Promise<void> => {
    const [foundCases, foundHistory] = await Promise.all([api.listReconciliationCases({}), api.listReconciliationHistory({})]);
    setCases(unwrapPaymentResult(foundCases)); setHistory(unwrapPaymentResult(foundHistory));
  }, [api]);
  useEffect(() => { let current = true; void load().catch((failure: unknown) => { if (current) setError(paymentErrorMessage(failure)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [load]);
  const reload = (): void => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    void load().then(() => { setReviewRequired(false); setFeedback('Stored cases and immutable audit history reloaded.'); onResolved(); }).catch((failure: unknown) => setError(paymentErrorMessage(failure))).finally(() => { running.current = false; setBusy(false); });
  };
  const submit = (): void => {
    if (!selected || reason.trim().length < 10 || !confirmed || running.current || reviewRequired) return;
    running.current = true; setBusy(true); setError(null);
    void (async () => {
      try {
        const action = unwrapPaymentResult(await api.reconcile({ kind: selected.item.kind, referenceId: selected.item.referenceId, idempotencyKey: key.current, resolution: selected.resolution, reason: reason.trim(), deliberateConfirmation: true }));
        setFeedback(`Resolution recorded: ${resolutionLabels[action.resolution]}.`); setSelected(null); setReason(''); setConfirmed(false);
        await load(); onResolved();
      } catch (failure) { setError(paymentErrorMessage(failure)); setReviewRequired(true); }
      finally { running.current = false; setBusy(false); }
    })();
  };
  return <main className="reconciliation-workspace">
    <header className="pos-heading"><div><span className="pos-label">{t("Local privileged operations")}</span><h1>{t("Reconciliation")}</h1><p>{t("Investigate incomplete payments and refunds without deleting evidence.")}</p></div><button type="button" className="subtle-button" disabled={busy} onClick={reload}>{t("Reload cases and audit")}</button></header>
    <div className="recovery-notice"><strong>{t("Local trust limitation")}</strong><p>{t("This development MVP has no authentication or administrator roles. Anyone controlling this local register can use these privileged contracts. There is no remote administrative API. A button does not establish administrator identity or provider settlement.")}</p></div>
    {error && <div role="alert" className="pos-error">{error}</div>}
    <p role="status" className="cart-feedback">{feedback}</p>
    {(busy || loading) && <p className="pos-status" role="status">{t("Reading financial evidence…")}</p>}
    {reviewRequired && <div className="recovery-notice">{t("The resolution reply could not be confirmed. Reload the audit history before making another decision. Keep the same reference; do not repeat a transfer.")}</div>}
    {!loading && cases.length === 0 && <p className="pos-empty">{t("No unresolved reconciliation cases.")}</p>}
    <div className="reconciliation-list">{cases.map((item) => {
      const attempt = item.paymentAttempt ?? item.refundAttempt;
      const confirmedPartialPayment = item.paymentAttempt?.status === 'confirmed';
      return <article className="reconciliation-case" key={item.id}>
        <h2>{confirmedPartialPayment ? t("Recorded partial payment") : item.kind === 'legacy' ? t("Historical cash confirmation") : item.kind === 'refund' ? t("Refund investigation") : t("Payment investigation")}</h2><p>{item.reason}</p>
        <code>{item.referenceId}</code>
        {attempt && <p>{paymentMethodLabel(attempt.method)} · {formatChf('appliedRappen' in attempt ? attempt.appliedRappen : attempt.amountRappen)} · {attempt.status}</p>}
        {confirmedPartialPayment && item.paymentAttempt && <p>{t("Original confirmed amount to return manually:")}{' '}<strong>{formatChf(item.paymentAttempt.appliedRappen)}</strong>{t(". You can keep or resume this checkout normally. If it is abandoned, return this exact digital payment externally and verify the completed return before recording compensation. This action sends no money. Cash-settled or completed sales use normal completion and refunds.")}</p>}
        {item.legacyCheckout && <p>{t("Cash received")}{' '}{formatChf(item.legacyCheckout.cashReceivedRappen ?? 0)}{' '}{t("· Original cart")}{' '}{item.legacyCheckout.cartId}{t(", revision")}{' '}{item.legacyCheckout.cartRevision}</p>}
        {item.sale && <p>{t("Related sale")}{' '}{item.sale.id}{' '}{t("· Recorded payment")}{' '}{formatChf(item.sale.actualPaidRappen)}</p>}
        <details><summary>{t("Inspect recorded evidence and events")}</summary><pre className="reconciliation-evidence">{JSON.stringify({ paymentAttempt: item.paymentAttempt, refundAttempt: item.refundAttempt, legacyCheckout: item.legacyCheckout, sale: item.sale, events: item.events, actions: item.actions }, null, 2)}</pre></details>
        <div className="reconciliation-actions">{(['confirm-recorded', 'exclude-no-transfer', 'exclude-compensated'] as const).filter((resolution) => confirmedPartialPayment ? resolution === 'exclude-compensated' : item.kind !== 'legacy' || resolution !== 'confirm-recorded').map((resolution) => <button type="button" className="subtle-button" key={resolution} disabled={busy || reviewRequired} onClick={() => { setSelected({ item, resolution }); setReason(''); setConfirmed(false); key.current = window.crypto.randomUUID(); }}>{resolutionLabels[resolution]}</button>)}</div>
      </article>;
    })}</div>
    <section className="reconciliation-case" aria-label={t("Immutable reconciliation audit")} style={{ marginTop: 24 }}><h2>{t("Reconciliation audit history")}</h2>{history.length === 0 && <p>{t("No reconciliation actions recorded.")}</p>}{history.map((action) => <article className="reconciliation-audit" key={action.id}><strong>{resolutionLabels[action.resolution]}</strong><p>{action.reason}</p><code>{action.kind} · {action.referenceId}</code><small>{financialDate(action.at)}{' '}{t("· Action")}{' '}{action.id}</small></article>)}</section>
    {selected && <Modal title={t("Confirm reconciliation decision")} closeDisabled={busy} onClose={() => { if (!busy) setSelected(null); }} className="payments-dialog">
      <h3>{resolutionLabels[selected.resolution]}</h3><p className="dialog-description">{resolutionExplanation[selected.resolution]}</p><p className="financial-reference">{t("Reference:")}{' '}{selected.item.referenceId}</p>
      <label className="cash-field">{t("Investigation reason")}<textarea aria-label={t("Reconciliation reason")} rows={4} maxLength={1000} value={reason} disabled={busy || reviewRequired} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} /></label>
      <label className="operator-confirmation"><input type="checkbox" checked={confirmed} disabled={busy || reviewRequired} onChange={(event) => setConfirmed(event.target.checked)} />{t("I deliberately confirm this investigated resolution")}</label>
      <button type="button" className="primary-button" disabled={busy || reviewRequired || !confirmed || reason.trim().length < 10} onClick={submit}>{t("Record reconciliation decision")}</button>
      {reviewRequired && <button type="button" className="subtle-button" disabled={busy} onClick={reload}>{t("Check reconciliation history")}</button>}
    </Modal>}
  </main>;
}
