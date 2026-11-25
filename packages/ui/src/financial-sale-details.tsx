import {OrderReference} from './order-reference.js';
import { operationStorage } from './operation-storage.js';
import { ReceiptPreview } from './receipt-preview.js';
import { variantLabel } from './catalog-ui.js';
import { t } from './preferences.js';
import React, { useEffect, useRef, useState } from 'react';
import type { TicketsApi, HistoryApi, PaymentsApi, PaymentMethod, RefundAttempt, SaleDetails, SaleHistoryContext } from '@cash-sloth/contracts';
import { addMoney, formatChf, quoteRefundItems, type RefundSelection } from '@cash-sloth/domain';
import { Modal } from './modal.js';
import { PaymentRequestFailure, financialDate, paymentErrorMessage, paymentMethodLabel, signedChf, unwrapPaymentResult } from './payment-components.js';
import { clearFinanceRecovery, readFinanceRecovery, saveFinanceRecovery, submitFinancialConfirmation } from './finance-recovery.js';

function RefundDialog({ api, details, initialAttempt, onUpdate, onClose, onReconciliation }: {
  api: PaymentsApi; details: SaleDetails; initialAttempt: RefundAttempt | null;
  onUpdate: (details: SaleDetails) => void; onClose: () => void; onReconciliation: () => void;
}): React.JSX.Element {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PaymentMethod>(initialAttempt?.method ?? (details.sale.payments.some(p=>p.method==='voucher')?'voucher':'cash'));
  const [attempt, setAttempt] = useState<RefundAttempt | null>(initialAttempt);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(initialAttempt !== null);
  const [viewFresh, setViewFresh] = useState(true);
  const [completed, setCompleted] = useState(initialAttempt?.status === 'completed');
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [verified, setVerified] = useState(false);
  const key = useRef(window.crypto.randomUUID());
  const running = useRef(false);
  const marker = (current: RefundAttempt | null) => ({ kind: 'refund' as const, reference: details.sale.id, attemptId: current?.id ?? null, confirmationSubmitted: false });
  const selections: RefundSelection[] = [];
  let selectionError: string | null = null;
  let quote = initialAttempt?.items ?? [];
  if (!attempt) {
    for (const item of details.items) {
      const raw = quantities[item.saleItemId] ?? '0';
      const value = /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(value) || value < 0 || value > item.quantityRemaining) selectionError = 'Select whole quantities within the remaining original units.';
      else if (value > 0) selections.push({ saleItemId: item.saleItemId, quantity: value });
    }
    try { quote = selections.length > 0 && !selectionError ? [...quoteRefundItems(details.sale, details.refunds, selections)] : []; }
    catch { selectionError = 'The selected units cannot be refunded. Reload the original sale and refund history.'; }
  } else quote = [...attempt.items];
  const total = quote.reduce((sum, item) => addMoney(sum, item.amountRappen), 0);
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try { await operation(); } catch (failure) { setError(paymentErrorMessage(failure)); setReviewRequired(true); setViewFresh(false); }
    finally { running.current = false; setBusy(false); }
  };
  const refresh = async (): Promise<void> => { onUpdate(unwrapPaymentResult(await api.getSaleDetails({ saleId: details.sale.id }))); };
  const prepare = (): void => {
    if (selections.length === 0 || selectionError) return;
    void run(async () => {
      try {
        saveFinanceRecovery(operationStorage, marker(null));
        const prepared = unwrapPaymentResult(await api.prepareRefund({ saleId: details.sale.id, idempotencyKey: key.current, method, items: selections }));
        saveFinanceRecovery(operationStorage, marker(prepared)); setAttempt(prepared); setReviewRequired(false); await refresh();
      } catch (failure) {
        if (failure instanceof PaymentRequestFailure && ['INVALID_INPUT', 'REFUND_LIMIT', 'CASH_DENOMINATION'].includes(failure.code)) {
          clearFinanceRecovery(operationStorage, 'refund', details.sale.id); setReviewRequired(false);
          setError(paymentErrorMessage(failure)); return;
        } else setReviewRequired(true);
        throw failure;
      }
    });
  };
  const confirm = (): void => {
    if (!attempt || !confirmed || !viewFresh) return;
    void run(async () => {
      try {
        unwrapPaymentResult(await submitFinancialConfirmation(operationStorage, marker(attempt), () => api.confirmRefund({ attemptId: attempt.id, operatorConfirmed: true })));
        const stored = unwrapPaymentResult(await api.getRefundAttempt({ attemptId: attempt.id }));
        setAttempt(stored); setCompleted(true); setConfirmed(false); setReviewRequired(false);
        await refresh();
        saveFinanceRecovery(operationStorage, marker(stored));
      } catch (failure) { setReviewRequired(true); throw failure; }
    });
  };
  const inspect = (): void => {
    void run(async () => {
      const refreshed = unwrapPaymentResult(await api.getSaleDetails({ saleId: details.sale.id }));
      onUpdate(refreshed);
      const stored = attempt ? unwrapPaymentResult(await api.getRefundAttempt({ attemptId: attempt.id })) : refreshed.refundAttempts.find((candidate) => candidate.idempotencyKey === key.current) ?? refreshed.refundAttempts.find((candidate) => ['prepared', 'reported', 'uncertain'].includes(candidate.status));
      if (!stored) {
        setError('No matching refund attempt was found. No refund is confirmed. Review the original sale before preparing a new refund.');
        return;
      }
      setAttempt(stored); setCompleted(stored.status === 'completed'); setViewFresh(true);
      setReviewRequired(['reported', 'uncertain', 'prepared'].includes(stored.status));
      if (stored.status === 'completed') saveFinanceRecovery(operationStorage, marker(stored));
      setConfirmed(false);
    });
  };
  const report = (outcome: 'failed' | 'uncertain'): void => {
    if (!attempt || !viewFresh || !verified || reason.trim().length < 3) return;
    void run(async () => {
      const stored = unwrapPaymentResult(await submitFinancialConfirmation(operationStorage, marker(attempt), () => api.reportRefundOutcome({ attemptId: attempt.id, outcome, reason: reason.trim(), operatorConfirmed: true })));
      setAttempt(stored); setReviewRequired(outcome === 'uncertain'); setConfirmed(false);
      if (outcome === 'failed') { saveFinanceRecovery(operationStorage, marker(stored)); await refresh(); }
    });
  };
  const done = (): void => {
    if (busy) return;
    try { if (completed || attempt?.status === 'failed' || attempt?.status === 'excluded') clearFinanceRecovery(operationStorage, 'refund', details.sale.id); }
    catch { setError('The matching refund recovery reference could not be acknowledged. Keep this review open.'); return; }
    onClose();
    window.requestAnimationFrame(() => document.getElementById('receipt-new-sale')?.focus());
  };

  return <Modal title={t("Refund sale")} className="payments-dialog" closeDisabled={busy} onClose={() => { if (!busy) done(); }}>
    <div className="payment-balance"><span>{t("Remaining refundable balance")}</span><strong>{formatChf(details.refundableRappen)}</strong></div>
    <p className="dialog-description">{t("Select original items and quantities. Amounts use the sale's historical prices and fixed rounding allocation, regardless of today's catalog or the original payment method.")}</p>
    {error && <div role="alert" className="pos-error">{error}</div>}
    {busy && <p role="status">{t("Saving refund evidence…")}</p>}
    {completed ? <div className="payment-review" role="status"><h3>{t("Refund completed")}</h3><p>{formatChf(attempt?.amountRappen ?? total)} · {paymentMethodLabel(attempt?.method ?? method)}</p><p>{t("The refund is stored separately. The original sale is unchanged.")}</p><button type="button" className="primary-button" onClick={done}>{t("Done")}</button></div> : <>
      {!attempt && <>
        <div className="form-actions"><button type="button" className="subtle-button" disabled={busy || reviewRequired} onClick={() => { setQuantities(Object.fromEntries(details.items.map((item) => [item.saleItemId, String(item.quantityRemaining)]))); key.current = window.crypto.randomUUID(); }}>{t("Select all remaining items")}</button></div>
        <div className="refund-lines">{details.sale.items.map((item) => {
          const remaining = details.items.find((candidate) => candidate.saleItemId === item.id)?.quantityRemaining ?? 0;
          return <div className="refund-line" key={item.id}><span><strong>{item.productName} — {variantLabel(item.variantName)}</strong><small>{remaining}{' '}{t("of")}{' '}{item.quantity}{' '}{t("remaining ·")}{' '}{formatChf(item.unitPriceRappen)}{' '}{t("original unit price")}</small></span><label>{t("Quantity")}<input type="number" inputMode="numeric" min={0} max={remaining} step={1} aria-label={`Refund quantity for ${item.productName} — ${item.variantName}`} value={quantities[item.id] ?? '0'} disabled={busy || remaining === 0 || reviewRequired} onChange={(event) => { setQuantities({ ...quantities, [item.id]: event.target.value }); key.current = window.crypto.randomUUID(); }} /></label></div>;
        })}</div>
        <label className="cash-field">{t("Refund method")}<select aria-label={t("Refund method")} value={method} disabled={busy || reviewRequired} onChange={(event) => { setMethod(event.target.value as PaymentMethod); key.current = window.crypto.randomUUID(); }}><option value="cash">{t("Cash")}</option><option value="card">{t("Card")}</option><option value="twint">TWINT</option>{details.sale.payments.some(p=>p.method==='voucher')&&<option value="voucher">Gutschein-Guthaben</option>}</select></label>
        {selectionError && <p role="alert" className="pos-error">{selectionError}</p>}
        <div className="cash-change"><span>{t("Exact selected refund")}</span><strong data-testid="refund-amount">{formatChf(total)}</strong></div>
        <p className="form-hint">{t("Cash refunds must be payable in CHF 0.05 coins. If the exact allocated amount cannot be paid in cash, choose Card/TWINT or another selection; it is never rounded a second time.")}</p>
        <button type="button" className="primary-button" disabled={busy || reviewRequired || selections.length === 0 || !!selectionError} onClick={prepare}>{t("Prepare refund")}</button>
      </>}
      {attempt && <section className="payment-review"><h3>{paymentMethodLabel(attempt.method)}{' '}{t("refund ·")}{' '}{formatChf(attempt.amountRappen)}</h3><span className={`payment-status ${attempt.status}`}>{attempt.status}</span>
        <ul>{attempt.items.map((item) => { const original = details.sale.items.find((line) => line.id === item.saleItemId); return <li key={item.saleItemId}>{item.quantity} × {original?.productName} — {original ? variantLabel(original.variantName) : ''}: {formatChf(item.amountRappen)} <small>{t("(rounding share")}{' '}{signedChf(item.roundingAllocationRappen)})</small></li>; })}</ul>
        <p>{t("Pay this exact refund independently, then record the outcome. Confirming here does not send money or verify an external provider. A retry records the same refund; it must never pay it again.")}</p>
        {!['failed', 'excluded', 'uncertain'].includes(attempt.status) && <><label className="operator-confirmation"><input type="checkbox" checked={confirmed} disabled={busy || !viewFresh} onChange={(event) => setConfirmed(event.target.checked)} />{t("I confirm the refund was paid")}</label><button type="button" className="primary-button" disabled={busy || !confirmed || !viewFresh} onClick={confirm}>{t("Confirm refund")}</button></>}
        {attempt.status === 'uncertain' && <p className="form-hint">{t("An uncertain refund requires an investigated decision in Reconciliation. Do not disburse it again.")}</p>}
        {attempt.status === 'prepared' && <details><summary>{t("Refund failed or uncertain?")}</summary><label className="cash-field">{t("Reason")}<textarea aria-label={t("Refund outcome reason")} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setVerified(false); }} /></label><label className="inline-check"><input type="checkbox" checked={verified} disabled={busy} onChange={(event) => setVerified(event.target.checked)} />{t("I verified the refund outcome")}</label><div className="form-actions"><button type="button" className="subtle-button" disabled={busy || !viewFresh || !verified || reason.trim().length < 3} onClick={() => report('failed')}>{t("Record failed refund")}</button><button type="button" className="subtle-button" disabled={busy || !viewFresh || !verified || reason.trim().length < 3} onClick={() => report('uncertain')}>{t("Report uncertain refund")}</button></div></details>}
      </section>}
      {reviewRequired && <div className="recovery-notice">{t("Review the stored refund and actual transfer before acting. Never pay another refund simply because the reply was lost.")}<div className="form-actions"><button type="button" className="subtle-button" disabled={busy} onClick={inspect}>{t("Check stored refund")}</button><button type="button" className="subtle-button" disabled={busy} onClick={onReconciliation}>{t("Open reconciliation")}</button></div></div>}
      {attempt && ['failed', 'excluded'].includes(attempt.status) && <button type="button" className="subtle-button" disabled={busy} onClick={done}>{t("Close reviewed refund")}</button>}
    </>}
  </Modal>;
}

export function FinancialSaleDetails({ api, ticketsApi, historyApi, initial, onNewSale, onReconciliation, onDetailsChanged, recoveryAttempt = null }: {
  api: PaymentsApi; ticketsApi?: TicketsApi | undefined; historyApi?: HistoryApi; initial: SaleDetails; onNewSale: () => void; onReconciliation: () => void; onDetailsChanged: (details: SaleDetails) => void; recoveryAttempt?: RefundAttempt | null;
}): React.JSX.Element {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [details, setDetails] = useState(initial);
  const [refundOpen, setRefundOpen] = useState(recoveryAttempt !== null);
  const [selectedAttempt, setSelectedAttempt] = useState(recoveryAttempt);
  const [error, setError] = useState<string | null>(null);
  const [historyContext, setHistoryContext] = useState<SaleHistoryContext | null>(null);
  const [contextError, setContextError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const sale = details.sale;
  const outstanding = details.refundAttempts.filter((attempt) => ['prepared', 'reported', 'uncertain'].includes(attempt.status));
  useEffect(() => { heading.current?.focus(); }, [sale.id]);
  useEffect(() => {
    if (!historyApi) return;
    let current = true;
    void historyApi.getSaleContext({ saleId: sale.id }).then((response) => {
      const found = unwrapPaymentResult(response);
      if (current) { setHistoryContext(found); setContextError(false); }
    }).catch(() => { if (current) { setHistoryContext(null); setContextError(true); } });
    return () => { current = false; };
  }, [historyApi, sale.id, details.refunds.length, details.refundAttempts]);
  const openRefund = (attempt: RefundAttempt | null): void => {
    try {
      const marker = readFinanceRecovery(operationStorage);
      if (marker?.kind === 'checkout') clearFinanceRecovery(operationStorage, 'checkout', sale.checkoutSessionId);
      else if (marker?.kind === 'refund' && marker.reference !== sale.id) throw new Error('An unrelated refund still needs review.');
      setError(null); setSelectedAttempt(attempt); setRefundOpen(true);
    } catch { setError('Another financial recovery reference needs review before preparing this refund.'); }
  };
  return <section className="receipt" aria-label={t("Sale receipt")}>
    <span className="receipt-label">{t("Committed ·")}{' '}{sale.payments.map((payment) => paymentMethodLabel(payment.method)).join(' + ')}</span>
    <h2 ref={heading} tabIndex={-1}>{t("Sale completed")}</h2>
    {error && <div role="alert" className="pos-error">{error}</div>}
    <OrderReference order={sale.order}/><p className="receipt-meta">{t("Sale")}{' '}<strong data-testid="receipt-sale-id">{sale.id}</strong><br />{financialDate(sale.completedAt)}</p>
    <table className="receipt-items"><thead><tr><th scope="col">{t("Item")}</th><th scope="col">{t("Qty")}</th><th scope="col">{t("Total")}</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.id}><td>{item.productName}<small>{item.variantName} · {formatChf(item.unitPriceRappen)}{' '}{t("each")}</small></td><td>{item.quantity}<small>{details.items.find((candidate) => candidate.saleItemId === item.id)?.quantityRemaining ?? 0}{' '}{t("refundable")}</small></td><td>{formatChf(item.lineTotalRappen)}</td></tr>)}</tbody></table>
    <dl className="receipt-totals"><dt>{t("Subtotal")}</dt><dd>{formatChf(sale.subtotalRappen)}</dd>{(sale.tipRappen ?? 0) > 0 && <><dt>{t("Tip")}</dt><dd>{formatChf(sale.tipRappen ?? 0)}</dd></>}<dt>{t("Cash rounding")}</dt><dd>{signedChf(sale.roundingAdjustmentRappen)}</dd><dt className="receipt-final">{t("Amount due")}</dt><dd className="receipt-final">{formatChf(sale.amountDueRappen)}</dd><dt>{t("Actual recorded payment total")}</dt><dd>{formatChf(sale.actualPaidRappen)}</dd></dl>
    <section className="payment-history" aria-label={t("Recorded sale payments")}><h3>{t("Payment history")}</h3>{sale.payments.map((payment) => <article className="payment-allocation" key={payment.attemptId}><span><strong>{paymentMethodLabel(payment.method)} · {formatChf(payment.amountRappen)}</strong><small>{t("Operator confirmed")}{' '}{financialDate(payment.confirmedAt)}<br />{payment.cashTenderedRappen !== null && <>{t("Cash received")}{' '}{formatChf(payment.cashTenderedRappen)}{' '}{t("· Cash applied")}{' '}{formatChf(payment.amountRappen)}{' '}{t("· Change returned")}{' '}{formatChf(payment.changeRappen)}<br /></>}{payment.attemptId}</small></span><span className="payment-status">{t("Recorded")}</span></article>)}</section>
    <section className="refund-history" aria-label={t("Refund history")}><h3>{t("Refund history")}</h3><dl className="receipt-totals"><dt>{t("Previously refunded")}</dt><dd>{formatChf(details.refundedRappen)}</dd><dt>{t("Remaining refundable")}</dt><dd data-testid="refundable-balance">{formatChf(details.refundableRappen)}</dd></dl>
      {details.refunds.length === 0 && <p className="receipt-meta">{t("No refunds recorded.")}</p>}
      {details.refunds.map((refund) => <article className="payment-allocation" key={refund.id}><span><strong>{paymentMethodLabel(refund.method)} · {formatChf(refund.amountRappen)}</strong><small>{financialDate(refund.completedAt)}{' '}{t("· Refund")}{' '}{refund.id}<br />{refund.items.map((item) => { const original = sale.items.find((line) => line.id === item.saleItemId); return `${item.quantity} × ${original?.productName ?? item.saleItemId} (${signedChf(item.roundingAllocationRappen)} rounding share)`; }).join(' · ')}</small></span><span className="payment-status">{t("Recorded")}</span></article>)}
      {outstanding.map((attempt) => <button type="button" className="subtle-button" key={attempt.id} onClick={() => openRefund(attempt)}>{t("Review")}{' '}{attempt.status}{' '}{t("refund ·")}{' '}{formatChf(attempt.amountRappen)}</button>)}
    </section>
    {historyContext && <section className="receipt-record-status" aria-label={t("Financial record status")}><h3>{t("Record status")}</h3><p>{historyContext.unresolvedRefundCount}{' '}{t("unresolved refund outcome(s) ·")}{' '}{historyContext.reconciliationCount}{' '}{t("recorded reconciliation action(s).")}{historyContext.lastReconciliationAt && <>{' '}{t("Latest action")}{' '}{financialDate(historyContext.lastReconciliationAt)}.</>}</p>{historyContext.unresolvedRefundCount > 0 && <button type="button" className="subtle-button" onClick={onReconciliation}>{t("Review financial reconciliation")}</button>}</section>}
    {contextError && <p className="receipt-meta">{t("Reconciliation status could not be refreshed. Original sale and refund records remain shown above; use Reconciliation to investigate.")}</p>}
    <p className="receipt-footer">{t("Operator confirmation is a local assertion, not independent provider verification.")}<br />{t("Checkout reference:")}{' '}{sale.checkoutSessionId}</p>
    <div className="receipt-actions"><button type="button" className="subtle-button" onClick={() => setPreviewOpen(true)}>{t('View / print receipt')}</button><button type="button" id="receipt-new-sale" className="primary-button" onClick={onNewSale}>{t("Start new sale")}</button><button type="button" className="subtle-button" disabled={details.items.every((item) => item.quantityRemaining === 0) || outstanding.length > 0} onClick={() => openRefund(null)}>{t("Refund sale")}</button></div>
    {previewOpen && <ReceiptPreview historyApi={historyApi} ticketsApi={ticketsApi} sale={sale} onClose={() => setPreviewOpen(false)} />}
    {refundOpen && <RefundDialog api={api} details={details} initialAttempt={selectedAttempt} onUpdate={(next) => { setDetails(next); onDetailsChanged(next); }} onClose={() => setRefundOpen(false)} onReconciliation={() => { setRefundOpen(false); onReconciliation(); }} />}
  </section>;
}
