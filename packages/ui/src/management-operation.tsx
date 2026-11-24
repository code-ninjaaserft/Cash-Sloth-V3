import { operationStorage } from './operation-storage.js';
import { t, localeTag } from './preferences.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportOperation, ImportPreview, ImportSummary, ManagementApi } from '@cash-sloth/contracts';
import { clearManagementRecovery, managementError, readManagementRecovery, submitManagementOperation, unwrapManagement, type ManagementRecoveryReference } from './management-recovery.js';

const summaryLabels: readonly [keyof ImportSummary, string][] = [
  ['newProducts', 'New products'], ['newVariants', 'New variants'], ['newCategories', 'New categories'], ['existingMatches', 'Existing matches'],
  ['duplicateRows', 'Duplicate source rows'], ['skippedProducts', 'Preserved / skipped products'], ['conflictingRecords', 'Conflicts'], ['invalidRows', 'Invalid rows'],
];
export function ImportSummaryCards({ summary }: { summary: ImportSummary }): React.JSX.Element {
  return <dl className="import-summary">{summaryLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd data-testid={`import-summary-${key}`}>{summary[key]}</dd></div>)}</dl>;
}

export function useManagementOperation(api: ManagementApi) {
  const [reference, setReference] = useState<ManagementRecoveryReference | null>(null);
  const [receipt, setReceipt] = useState<ImportOperation | null>(null);
  const [inspected, setInspected] = useState(false);
  const [blocked, setBlocked] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const currentReference = useRef<ManagementRecoveryReference | null>(null);
  const inspect = useCallback(async (saved?: ManagementRecoveryReference): Promise<void> => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const found = saved ?? readManagementRecovery(operationStorage);
      currentReference.current = found; setReference(found);
      if (!found) { setBlocked(false); setInspected(true); return; }
      setBlocked(true);
      const stored = unwrapManagement(await api.getImportOperation({ idempotencyKey: found.operationId }));
      setReceipt(stored); setInspected(true);
    } catch (failure) { setBlocked(true); setInspected(false); setError(managementError(failure)); }
    finally { running.current = false; setBusy(false); }
  }, [api]);
  useEffect(() => { void inspect(); }, [inspect]);
  const submit = async (plan: ImportPreview): Promise<boolean> => {
    if (running.current || blocked) return false;
    running.current = true; setBusy(true); setError(null); setInspected(false);
    const saved: ManagementRecoveryReference = { operationId: window.crypto.randomUUID(), kind: plan.source };
    try {
      const pending = submitManagementOperation(operationStorage, saved, () => api.applyImportPlan({ planId: plan.planId, idempotencyKey: saved.operationId, operatorConfirmed: true }));
      currentReference.current = saved; setReference(saved); setBlocked(true);
      const completed = unwrapManagement(await pending);
      setReceipt(completed); setInspected(true);
      return true;
    } catch (failure) {
      setBlocked(true); setError(managementError(failure));
      // Read the actual saved reference even if storage rejected the new one.
      try { const found = readManagementRecovery(operationStorage); currentReference.current = found; setReference(found); } catch { /* invalid pointer stays blocked */ }
      return false;
    } finally { running.current = false; setBusy(false); }
  };
  const acknowledge = (): void => {
    if (running.current || !inspected || !reference) return;
    try { clearManagementRecovery(operationStorage, reference.operationId); setReference(null); currentReference.current = null; setReceipt(null); setBlocked(false); setError(null); }
    catch (failure) { setError(managementError(failure)); setBlocked(true); }
  };
  return { reference, receipt, inspected, blocked, busy, error, submit, inspect: () => inspect(currentReference.current ?? undefined), acknowledge };
}

export function ManagementOperationStatus({ operation, onAcknowledged }: { operation: ReturnType<typeof useManagementOperation>; onAcknowledged?: () => void }): React.JSX.Element | null {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (operation.receipt) heading.current?.focus(); }, [operation.receipt]);
  if (!operation.blocked && !operation.error && !operation.busy) return null;
  return <section className="management-panel import-operation" aria-label={t("Catalog operation result")}>
    {operation.error && <div className="pos-error" role="alert">{operation.error}</div>}
    {operation.busy && <p role="status">{t("Reading or committing the catalog operation…")}</p>}
    {operation.reference && <>
      <h2 ref={heading} tabIndex={-1}>{operation.receipt ? t("Catalog import completed") : t("Catalog operation needs review")}</h2>
      <p className="form-hint">{operation.receipt ? t("The committed result below is authoritative. Acknowledge it before creating another preview.") : operation.inspected ? t("No committed operation was found for this reference. No import is reported as successful. Acknowledge this result, then create a new preview before submitting again.") : t("The reply may have been lost. Check this exact operation before starting another import. Nothing is retried automatically.")}</p>
      <code className="management-reference">{operation.reference.operationId}</code>
      {operation.receipt && <><ImportSummaryCards summary={operation.receipt.summary} /><p className="form-hint">{t("Committed")}{' '}{new Date(operation.receipt.completedAt).toLocaleString(localeTag())}.</p></>}
      <div className="form-actions"><button type="button" className="subtle-button" disabled={operation.busy} onClick={() => { void operation.inspect(); }}>{t("Check stored import result")}</button><button type="button" className="primary-button" disabled={operation.busy || !operation.inspected} onClick={() => { operation.acknowledge(); onAcknowledged?.(); }}>{t("Acknowledge import result")}</button></div>
    </>}
    {!operation.reference && operation.blocked && !operation.busy && <><p>{t("The saved catalog-operation reference cannot be verified. Import is blocked until its stored result can be inspected.")}</p><button type="button" className="subtle-button" onClick={() => { void operation.inspect(); }}>{t("Read catalog recovery reference")}</button></>}
  </section>;
}

export function ImportPlanReview({ plan, disabled, onApply, label }: { plan: ImportPreview; disabled: boolean; onApply: () => void; label: string }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [confirmed, setConfirmed] = useState(false);
  const [issuePage, setIssuePage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const pageSize = 25;
  const issuePages = Math.max(1, Math.ceil(plan.issues.length / pageSize));
  const productPages = Math.max(1, Math.ceil(plan.products.length / pageSize));
  return <section className="management-panel import-plan" aria-label={t("Catalog import preview")}>
    <div className="section-heading"><div><span className="pos-label">{t("Review before applying")}</span><h2 ref={heading} tabIndex={-1}>{t("Catalog import preview")}</h2></div><span className={`management-badge ${plan.canApply ? '' : 'warning'}`}>{plan.canApply ? t("Ready for confirmation") : t("Changes blocked")}</span></div>
    <ImportSummaryCards summary={plan.summary} />
    <p className="form-hint">{t("Existing records are never silently overwritten. The catalog is revalidated when you confirm; a changed catalog requires a new preview. A failed transaction reports no partial success.")}</p>
    {plan.issues.length > 0 && <section aria-label={t("Import validation issues")}><h3>{t("Validation and conflict review")}</h3><div className="management-table-scroll"><table className="management-table"><thead><tr><th>{t("Row")}</th><th>{t("Field")}</th><th>{t("Severity")}</th><th>{t("Message")}</th></tr></thead><tbody>{plan.issues.slice((issuePage - 1) * pageSize, issuePage * pageSize).map((issue, index) => <tr key={`${issuePage}:${index}`}><td>{issue.rowNumber || 'Plan'}</td><td>{issue.field}</td><td><span className={`management-badge ${issue.severity === 'error' ? 'warning' : 'muted'}`}>{issue.severity}</span></td><td>{issue.message}</td></tr>)}</tbody></table></div>{issuePages > 1 && <div className="history-pagination"><button type="button" className="subtle-button" disabled={issuePage === 1} onClick={() => setIssuePage((value) => value - 1)}>{t("Previous issues")}</button><span>{t("Issues page")}{' '}{issuePage}{' '}{t("of")}{' '}{issuePages}</span><button type="button" className="subtle-button" disabled={issuePage === issuePages} onClick={() => setIssuePage((value) => value + 1)}>{t("Next issues")}</button></div>}</section>}
    {plan.products.length > 0 && <section aria-label={t("Recognized import products")}><h3>{t("Products and variants")}</h3><div className="management-table-scroll"><table className="management-table"><thead><tr><th>{t("Product")}</th><th>{t("Import key")}</th><th>{t("Variants")}</th><th>{t("Plan")}</th></tr></thead><tbody>{plan.products.slice((productPage - 1) * pageSize, productPage * pageSize).map((product) => <tr key={product.productKey}><td>{product.name}</td><td>{product.productKey}</td><td>{product.variants}</td><td><span className="management-badge">{product.status}</span></td></tr>)}</tbody></table></div>{productPages > 1 && <div className="history-pagination"><button type="button" className="subtle-button" disabled={productPage === 1} onClick={() => setProductPage((value) => value - 1)}>{t("Previous preview products")}</button><span>{t("Products page")}{' '}{productPage}{' '}{t("of")}{' '}{productPages}</span><button type="button" className="subtle-button" disabled={productPage === productPages} onClick={() => setProductPage((value) => value + 1)}>{t("Next preview products")}</button></div>}</section>}
    {plan.categories.length > 0 && <details className="import-categories"><summary>{plan.categories.length}{' '}{t("recognized category paths")}</summary><ul>{plan.categories.slice(0, 100).map((category) => <li key={category.path}>{category.path} <span className="management-badge muted">{category.status}</span></li>)}</ul>{plan.categories.length > 100 && <p>{t("Showing the first 100 category paths.")}</p>}</details>}
    <label className="operator-confirmation"><input type="checkbox" checked={confirmed} disabled={disabled || !plan.canApply} onChange={(event) => setConfirmed(event.target.checked)} />{t("I reviewed this catalog plan")}</label>
    <button type="button" className="primary-button" disabled={disabled || !plan.canApply || !confirmed} onClick={onApply}>{label}</button>
  </section>;
}
