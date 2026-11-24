import { t } from './preferences.js';
import React, { useRef, useState } from 'react';
import type { CashSlothApi, ImportPreview, ManagementRequest, ParsedCsv } from '@cash-sloth/contracts';
import { completeCsvMapping, CSV_MAPPING_FIELDS, suggestCsvMapping, type CsvMappingDraft } from './import-ui.js';
import { ImportPlanReview, ManagementOperationStatus, useManagementOperation } from './management-operation.js';
import { managementError, unwrapManagement } from './management-recovery.js';

type Delimiter = ManagementRequest<'parseCsv'>['delimiter'];
interface ChosenCsv { readonly name: string; readonly text: string; readonly encoding: 'UTF-8' | 'UTF-8 BOM' }

export function CatalogImport({ api, onImported }: { api: CashSlothApi; onImported: () => void }): React.JSX.Element {
  const operation = useManagementOperation(api.management);
  const [file, setFile] = useState<ChosenCsv | null>(null);
  const [delimiter, setDelimiter] = useState<Delimiter>('auto');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvMappingDraft | null>(null);
  const [plan, setPlan] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const disabled = busy || operation.busy || operation.blocked;
  let mappingValid = false;
  if (mapping && parsed) { try { completeCsvMapping(mapping, parsed.headers.length); mappingValid = true; } catch { /* fields remain selectable */ } }
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (running.current || operation.blocked) return;
    running.current = true; setBusy(true); setError(null); setNotice('');
    try { await action(); } catch (failure) { setError(managementError(failure)); }
    finally { running.current = false; setBusy(false); }
  };
  const parse = async (chosen: ChosenCsv, selectedDelimiter: Delimiter): Promise<void> => {
    setParsed(null); setMapping(null); setPlan(null);
    const recognized = unwrapManagement(await api.management.parseCsv({ text: chosen.text, delimiter: selectedDelimiter }));
    setParsed(recognized); setMapping(suggestCsvMapping(recognized.headers));
  };
  const choose = (): void => {
    void run(async () => {
      const chosen = unwrapManagement(await api.files.chooseCatalogCsv({}));
      if (chosen.cancelled) { setNotice('File selection cancelled.'); return; }
      setFile(chosen); setDelimiter('auto'); await parse(chosen, 'auto');
    });
  };
  return <main className="management-workspace import-workspace">
    <header className="pos-heading"><div><span className="pos-label">{t("Guided catalog import")}</span><h1>{t("CSV import")}</h1><p>{t("Inspect, map and validate your file before an all-or-nothing catalog update.")}</p></div><button type="button" className="subtle-button" disabled={disabled} onClick={choose}>{t("Choose CSV file")}</button></header>
    <ManagementOperationStatus operation={operation} onAcknowledged={() => { setPlan(null); onImported(); }} />
    {error && <div role="alert" className="pos-error">{error}</div>}
    <p role="status" className="catalog-save-status">{busy ? t("Inspecting the CSV file…") : notice}</p>
    <section className="management-panel">
      <div className="section-heading"><div><span className="management-step">{t("1 · File and format")}</span><h2>{file?.name ?? 'Choose a UTF-8 catalog file'}</h2></div>{file && <span className="management-badge">{parsed?.encoding ?? file.encoding}</span>}</div>
      <p className="form-hint">{t("UTF-8 with an optional BOM, comma or semicolon delimiters, quoted fields and escaped quotes are supported. Unsupported encodings and ambiguous separators are rejected.")}</p>
      {file && <div className="form-actions"><label>{t("CSV delimiter")}<select aria-label={t("CSV delimiter")} value={delimiter} disabled={disabled} onChange={(event) => { setDelimiter(event.target.value as Delimiter); setParsed(null); setMapping(null); setPlan(null); }}><option value="auto">{t("Detect automatically")}</option><option value=",">{t("Comma (,)")}</option><option value=";">{t("Semicolon (;)")}</option></select></label><button type="button" className="subtle-button" disabled={disabled} onClick={() => { void run(() => parse(file, delimiter)); }}>{t("Parse CSV")}</button></div>}
      {parsed && <p className="form-hint" data-testid="csv-detection">{parsed.encoding} · {parsed.delimiter === ';' ? t("Semicolon") : t("Comma")}{' '}{t("delimiter ·")}{' '}{parsed.totalRows}{' '}{t("source rows ·")}{' '}{parsed.headers.length}{' '}{t("columns")}</p>}
    </section>
    {parsed && <section className="management-panel" aria-label={t("CSV source preview")}><span className="management-step">{t("2 · Inspect source rows")}</span><h2>{t("CSV row preview")}</h2><p className="form-hint">{t("Showing the first")}{' '}{Math.min(10, parsed.rows.length)}{' '}{t("rows. Validation uses every source row, including rows beyond this preview.")}</p><div className="management-table-scroll"><table className="management-table csv-source-table"><thead><tr><th>{t("Row")}</th>{parsed.headers.map((header, index) => <th key={index}>{header || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 10).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div></section>}
    {parsed && mapping && <section className="management-panel"><span className="management-step">{t("3 · Map fields")}</span><h2>{t("Column mapping")}</h2><p className="form-hint">{t("Review suggested mappings. Product/variant keys identify records across retries; required fields never receive an invented price or identity. Repeated product fields must agree across their variant rows.")}</p><div className="management-form-grid import-mapping-grid">{CSV_MAPPING_FIELDS.map((field) => <label key={field.key}>{field.label}{field.required ? ' *' : ''}<select aria-label={`Map ${field.label}`} value={mapping[field.key] ?? ''} disabled={disabled} onChange={(event) => { setMapping({ ...mapping, [field.key]: event.target.value === '' ? null : Number(event.target.value) }); setPlan(null); }}><option value="">{field.required ? t("Choose required column") : t("Not provided")}</option>{parsed.headers.map((header, index) => <option key={index} value={index}>{index + 1} · {header || `Column ${index + 1}`}</option>)}</select></label>)}</div><p className="form-hint">{t("Category paths:")}{' '}<code>Drinks &gt; Water | Food &gt; Bakery</code>{t(". Escape a literal separator with a backslash:")}{' '}<code>Gifts \| Sets</code>{' '}{t("or")}{' '}<code>Size \&gt; Large</code>{t(". Use CHF prices with up to two decimal places.")}</p><button type="button" className="primary-button" disabled={disabled || !mappingValid || parsed.totalRows === 0} onClick={() => { void run(async () => { if (!file) return; const preview = unwrapManagement(await api.management.previewCsvImport({ text: file.text, delimiter, mapping: completeCsvMapping(mapping, parsed.headers.length) })); setPlan(preview); }); }}>{t("Preview catalog import")}</button>{!mappingValid && <p className="form-hint">{t("Map all five required fields to continue.")}</p>}</section>}
    {plan && <ImportPlanReview key={plan.planId} plan={plan} disabled={disabled} label="Confirm catalog import" onApply={() => { void operation.submit(plan).then((committed) => { if (committed) onImported(); }); }} />}
  </main>;
}

export function DevelopmentTools({ api, onImported }: { api: CashSlothApi; onImported: () => void }): React.JSX.Element {
  const operation = useManagementOperation(api.management);
  const [capabilities, setCapabilities] = useState<{ developmentDemoAllowed: boolean; demo: { products: number; variants: number; activeVariants: number; categories: number; version: string } } | null>(null);
  const [plan, setPlan] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  React.useEffect(() => { let current = true; void api.management.getCapabilities({}).then((response) => { const found = unwrapManagement(response); if (current) setCapabilities(found); }).catch((failure: unknown) => { if (current) setError(managementError(failure)); }); return () => { current = false; }; }, [api]);
  const preview = (): void => {
    if (running.current || operation.blocked || capabilities?.developmentDemoAllowed !== true) return;
    running.current = true; setBusy(true); setError(null);
    void api.management.previewDemoCatalog({}).then((response) => setPlan(unwrapManagement(response))).catch((failure: unknown) => setError(managementError(failure))).finally(() => { running.current = false; setBusy(false); });
  };
  return <main className="management-workspace development-workspace">
    <header className="pos-heading"><div><span className="pos-label">{t("Development only")}</span><h1>{t("Development tools")}</h1><p>{t("Load a deterministic fictional Swiss catalog without resetting existing records.")}</p></div></header>
    <ManagementOperationStatus operation={operation} onAcknowledged={() => { setPlan(null); onImported(); }} />
    {error && <div className="pos-error" role="alert">{error}</div>}
    <section className="management-panel"><div className="section-heading"><h2>{t("Swiss Development Demo Catalog")}</h2><span className="management-badge warning">{t("Fictional test data")}</span></div><p>{t("Water, soft drinks, hot drinks, bakery, meals, desserts, Faultir merchandise and clearly marked rounding/availability test cases.")}</p>{capabilities && <dl className="demo-catalog-counts"><div><dt>{t("Products")}</dt><dd>{capabilities.demo.products}</dd></div><div><dt>{t("Variants")}</dt><dd>{capabilities.demo.variants}</dd></div><div><dt>{t("Active variants")}</dt><dd>{capabilities.demo.activeVariants}</dd></div><div><dt>{t("Categories")}</dt><dd>{capabilities.demo.categories}</dd></div></dl>}<p className="form-hint">{t("The loader first prepares a review. Stable identities prevent duplicates; user edits are preserved and reported. Existing carts, sales, payments, refunds and audit records are never deleted. Fictional test barcodes do not identify real retail products.")}</p>{capabilities?.developmentDemoAllowed === false ? <p className="pos-error" role="alert">{t("Demo catalog loading is available only in Development. Beta and Stable cannot run this operation.")}</p> : <button type="button" className="primary-button" disabled={busy || operation.busy || operation.blocked || !capabilities} onClick={preview}>{busy ? t("Preparing demo preview…") : t("Load Demo Catalog")}</button>}</section>
    {plan && <ImportPlanReview key={plan.planId} plan={plan} disabled={busy || operation.busy || operation.blocked} label="Confirm demo catalog load" onApply={() => { void operation.submit(plan).then((committed) => { if (committed) onImported(); }); }} />}
  </main>;
}
