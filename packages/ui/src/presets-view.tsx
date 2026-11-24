import { operationStorage } from './operation-storage.js';
import { PresetLogoPicker } from './preset-logo-picker.js';
import type { CustomLogo } from './custom-logo.js';
import React, { useEffect, useRef, useState } from 'react';
import { PRESETS_IPC_CONTRACTS, type PresetState, type PresetsApi, type PresetsRequest } from '@cash-sloth/contracts';
import { Modal } from './modal.js';
import { localeTag, t, usePreferences } from './preferences.js';

type Pending = { [K in 'save' | 'load' | 'copy' | 'remove' | 'update']: { method: K; request: PresetsRequest<K> } }['save' | 'load' | 'copy' | 'remove' | 'update'];
const recoveryKey = 'cash-sloth.preset-operation.v1';
function readPending(): Pending | null {
  const raw = operationStorage.getItem(recoveryKey); if (!raw) return null;
  const saved: unknown = JSON.parse(raw);
  if (typeof saved !== 'object' || saved === null) throw new Error('Invalid preset recovery reference.');
  const entry = saved as Record<string, unknown>;
  if (entry['method'] === 'update') return { method: 'update', request: PRESETS_IPC_CONTRACTS.update.request.parse(entry['request']) };
  if (entry['method'] === 'save') return { method: 'save', request: PRESETS_IPC_CONTRACTS.save.request.parse(entry['request']) };
  if (entry['method'] === 'copy') return { method: 'copy', request: PRESETS_IPC_CONTRACTS.copy.request.parse(entry['request']) };
  if (entry['method'] === 'remove') return { method: 'remove', request: PRESETS_IPC_CONTRACTS.remove.request.parse(entry['request']) };
  if (entry['method'] === 'load') return { method: 'load', request: PRESETS_IPC_CONTRACTS.load.request.parse(entry['request']) };
  throw new Error('Invalid preset recovery reference.');
}
export function PresetsView({ api, onChanged, onCatalog }: { api: PresetsApi; onChanged: (state: PresetState) => void; onCatalog: () => void }): React.JSX.Element {
  const [state, setState] = useState<PresetState | null>(null);
  const { customLogo: legacyLogo } = usePreferences();
  const [newLogo, setNewLogo] = useState<CustomLogo | null>(null);
  const [activeLogo, setActiveLogo] = useState<CustomLogo | null>(null);
  const [editing, setEditing] = useState<PresetState['presets'][number] | null>(null);
  const [editName, setEditName] = useState('');
  const [editLogo, setEditLogo] = useState<CustomLogo | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeName, setActiveName] = useState('');
  const [copySource, setCopySource] = useState<PresetState['presets'][number] | null>(null);
  const [copyName, setCopyName] = useState('');
  const [remove, setRemove] = useState<PresetState['presets'][number] | null>(null);
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [invalidRecovery, setInvalidRecovery] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [load, setLoad] = useState<PresetState['presets'][number] | null>(null);
  const operation = useRef(false);
  const refresh = async (): Promise<void> => {
    const response = await api.getState({}); if (!response.ok) throw new Error(response.error.message);
    setState(response.value); setActiveName(response.value.active?.name ?? ''); setActiveLogo(response.value.active?.logo ?? null); onChanged(response.value);
  };
  useEffect(() => {
    let current = true;
    void (async () => {
      try { const saved = readPending(); if (current) setPending(saved); }
      catch { if (current) setInvalidRecovery(true); }
      try { const result = await api.getState({}); if (!result.ok) throw new Error(result.error.message); if (current) { setState(result.value); setActiveName(result.value.active?.name ?? ''); setActiveLogo(result.value.active?.logo ?? null); } }
      catch { if (current) setError(t('Presets could not be loaded. Try refreshing.')); }
      finally { if (current) setBusy(false); }
    })();
    return () => { current = false; };
  }, [api]);
  const clearPending = (): void => { operationStorage.removeItem(recoveryKey); setPending(null); setNotFound(false); };
  const execute = async (entry: Pending): Promise<void> => {
    if (operation.current) return; operation.current = true; setBusy(true); setError(null); setNotice(''); setLoad(null); setCopySource(null); setRemove(null); setEditing(null);
    try {
      operationStorage.setItem(recoveryKey, JSON.stringify(entry)); setPending(entry);
      const result = entry.method === 'update' ? await api.update(entry.request) : entry.method === 'save' ? await api.save(entry.request) : entry.method === 'load' ? await api.load(entry.request) : entry.method === 'copy' ? await api.copy(entry.request) : await api.remove(entry.request);
      if (!result.ok) {
        if (!['STORAGE_ERROR', 'COMMIT_UNCERTAIN'].includes(result.error.code)) clearPending();
        throw new Error(result.error.message);
      }
      clearPending(); await refresh(); setNewName(''); setNewLogo(null); setNotice(t(entry.method === 'update' ? 'Preset updated.' : entry.method === 'remove' ? 'Preset deleted.' : entry.method === 'copy' ? 'Preset copied and active.' : entry.method === 'save' ? 'Preset saved and active.' : 'Preset loaded. Ready for this event.'));
    } catch (failure) { setError(failure instanceof Error ? t(failure.message) : t('The preset operation could not be confirmed. Check its stored result before continuing.')); }
    finally { operation.current = false; setBusy(false); }
  };
  const inspect = async (): Promise<void> => {
    if (!pending || operation.current) return; operation.current = true; setBusy(true); setError(null);
    try {
      const result = await api.getOperation({ operationId: pending.request.operationId });
      if (!result.ok) throw new Error(result.error.message);
      if (result.value) { clearPending(); await refresh(); setNotice(t('The stored preset result was found.')); }
      else { setNotFound(true); setError(t('No saved result exists for this request. You may retry the same request or discard it.')); }
    } catch { setError(t('The preset operation could not be confirmed. Check its stored result before continuing.')); }
    finally { operation.current = false; setBusy(false); }
  };
  const blocked = busy || logoBusy || pending !== null || invalidRecovery || state === null;
  const save = (presetId: string | null, expectedRevision: number | null, name: string, empty: boolean, logo: CustomLogo | null): void => {
    if (blocked || !state || !name.trim()) return;
    void execute({ method: 'save', request: { operationId: window.crypto.randomUUID(), catalogVersion: state.catalogVersion, presetId, expectedRevision, name: name.trim(), empty, logo } });
  };
  const active = state?.presets.find((p) => p.id === state.active?.id);
  return <main className="management-workspace presets-workspace">
    <header className="pos-heading"><div><span className="pos-label">{t('Event catalogs')}</span><h1>{t('Presets')}</h1><p>{t('Save products, variants, prices and categories for each event. Edit products in Catalog, then save your changes here.')}</p></div><button type="button" className="subtle-button" disabled={busy} onClick={() => { setBusy(true); void refresh().catch(() => setError(t('Presets could not be loaded. Try refreshing.'))).finally(() => setBusy(false)); }}>{t('Refresh')}</button></header>
    {error && <p role="alert" className="pos-error">{error}</p>}
    {notice && <p role="status" className="preset-notice">{notice}</p>}
    {invalidRecovery && <p role="alert" className="pos-error">{t('The saved preset reference cannot be read. Preset changes are blocked.')}</p>}
    {pending && <section className="management-panel"><h2>{t('Check pending preset operation')}</h2><p>{t('Do not start another preset operation until this saved request has been checked.')}</p><div className="form-actions"><button type="button" disabled={busy} onClick={() => { void inspect(); }}>{t('Check stored result')}</button>{notFound && <><button type="button" disabled={busy} onClick={() => { void execute(pending); }}>{t('Retry same request')}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => { try { clearPending(); setError(null); } catch { setError(t('The saved preset reference cannot be read. Preset changes are blocked.')); } }}>{t('Discard request')}</button></>}</div></section>}
    <div className="preset-forms">
      <section className="management-panel"><h2>{t('Active event')}</h2>{active ? <form className="preset-active-form" onSubmit={(event) => { event.preventDefault(); save(active.id, active.revision, activeName, false, activeLogo); }}><label>{t('Event name')}<input required maxLength={200} value={activeName} disabled={blocked} onChange={(event) => setActiveName(event.target.value)} /></label><PresetLogoPicker value={activeLogo} legacyLogo={legacyLogo} disabled={blocked} onChange={setActiveLogo} onBusyChange={setLogoBusy} /><p>{t('This title appears on new receipts. Previous receipts keep their original event title.')}</p><div className="form-actions"><button type="submit" disabled={blocked || !activeName.trim()}>{t('Save changes to active preset')}</button><button type="button" className="subtle-button" onClick={onCatalog}>{t('Edit products')}</button></div></form> : <p>{t('No event preset is active yet. Save the current catalog as your first preset.')}</p>}</section>
      <section className="management-panel"><h2>{t('Create new preset')}</h2><form className="preset-create-form" onSubmit={(event) => { event.preventDefault(); save(null, null, newName, true, newLogo); }}><label>{t('New event name')}<input required maxLength={200} value={newName} disabled={blocked} onChange={(event) => setNewName(event.target.value)} /></label><PresetLogoPicker value={newLogo} legacyLogo={legacyLogo} disabled={blocked} onChange={setNewLogo} onBusyChange={setLogoBusy} /><p>{t('New presets start empty. Add their products in Catalog or copy an existing preset below.')}</p><div className="form-actions"><button type="submit" disabled={blocked || !newName.trim()}>{t('Create empty preset')}</button><button type="button" className="subtle-button" disabled={blocked || !newName.trim()} onClick={() => save(null, null, newName, false, newLogo)}>{t('Save current catalog as preset')}</button></div></form></section>
    </div>
    <section className="management-panel"><h2>{t('Saved event presets')}</h2><p>{t('Loading replaces the current editable catalog. Save any changes first. Completed sales remain unchanged.')}</p><div className="preset-list">{state?.presets.map((preset) => <article key={preset.id} className="preset-row"><div><h3>{preset.name}{preset.id === state.active?.id && <span className="management-badge">{t('Active')}</span>}</h3><p>{preset.products} {t('Products')} · {preset.variants} {t('Variants')} · {preset.categories} {t('Categories')}</p><small>{new Date(preset.updatedAt).toLocaleString(localeTag())}</small></div><div className="preset-row-actions"><button type="button" className="subtle-button" aria-label={t('Edit preset') + ' ' + preset.name} disabled={blocked} onClick={() => { setEditing(preset); setEditName(preset.name); setEditLogo(preset.logo ?? null); }}>{t('Edit preset')}</button><button type="button" className="subtle-button" aria-label={`${t('Copy preset')} ${preset.name}`} disabled={blocked} onClick={() => { setCopyName(preset.name + ' ' + t('Copy')); setCopySource(preset); }}>{t('Copy preset')}</button><button type="button" className="subtle-button" aria-label={`${t('Delete preset')} ${preset.name}`} disabled={blocked} onClick={() => setRemove(preset)}>{t('Delete preset')}</button><button type="button" className="subtle-button" aria-label={`${t('Load preset')} ${preset.name}`} disabled={blocked} onClick={() => setLoad(preset)}>{t('Load preset')}</button></div></article>)}</div>{state?.presets.length === 0 && <p>{t('No saved presets yet.')}</p>}</section>
    {editing && state && <Modal title={t('Edit preset')} closeDisabled={busy || logoBusy} onClose={() => { if (!busy && !logoBusy) setEditing(null); }}><form className="editor-form" onSubmit={(event) => {
      event.preventDefault(); if (blocked || !editName.trim()) return;
      void execute({ method: 'update', request: { operationId: window.crypto.randomUUID(), catalogVersion: state.catalogVersion, presetId: editing.id, expectedRevision: editing.revision, name: editName.trim(), logo: editLogo } });
    }}>
      <label>{t('Event name')}<input required maxLength={200} value={editName} disabled={blocked} onChange={(event) => setEditName(event.target.value)} /></label>
      <PresetLogoPicker value={editLogo} legacyLogo={legacyLogo} disabled={blocked} onChange={setEditLogo} onBusyChange={setLogoBusy} />
      <p>{t('Only the preset name and logo change here. Saved products and current catalog edits remain unchanged.')}</p>
      <div className="form-actions"><button type="submit" className="primary-button" disabled={blocked || !editName.trim()}>{t('Save preset settings')}</button><button type="button" className="subtle-button" disabled={busy || logoBusy} onClick={() => setEditing(null)}>{t('Cancel')}</button></div>
    </form></Modal>}
    {copySource && state && <Modal title={t('Copy preset')} onClose={() => setCopySource(null)}><form onSubmit={(event) => { event.preventDefault(); void execute({ method: 'copy', request: { operationId: window.crypto.randomUUID(), catalogVersion: state.catalogVersion, presetId: copySource.id, expectedRevision: copySource.revision, name: copyName.trim() } }); }}><p>{copySource.name}</p><label>{t('New event name')}<input required maxLength={200} value={copyName} onChange={(event) => setCopyName(event.target.value)} /></label><p>{t('The saved preset is copied and activated. The original remains unchanged. Save current catalog edits first.')}</p><div className="form-actions"><button type="submit" disabled={busy || !copyName.trim()}>{t('Create copy')}</button><button type="button" className="subtle-button" onClick={() => setCopySource(null)}>{t('Cancel')}</button></div></form></Modal>}
    {remove && state && <Modal title={t('Delete preset?')} onClose={() => setRemove(null)}><p><strong>{remove.name}</strong></p><p>{t(remove.id === state.active?.id ? 'This is the active preset. Deleting it also clears the working catalog. Completed sales and receipts remain unchanged.' : 'Delete this saved preset? Completed sales and receipts remain unchanged.')}</p><div className="form-actions"><button type="button" disabled={busy} onClick={() => { void execute({ method: 'remove', request: { operationId: window.crypto.randomUUID(), catalogVersion: state.catalogVersion, presetId: remove.id, expectedRevision: remove.revision } }); }}>{t('Confirm delete preset')}</button><button type="button" className="subtle-button" onClick={() => setRemove(null)}>{t('Cancel')}</button></div></Modal>}
    {load && state && <Modal title={t('Load preset?')} onClose={() => setLoad(null)}><p><strong>{load.name}</strong></p><p>{load.products} {t('Products')} · {load.variants} {t('Variants')} · {load.categories} {t('Categories')}</p><p>{t('Loading replaces the current editable catalog. Save any changes first. Completed sales remain unchanged.')}</p><div className="form-actions"><button type="button" disabled={busy} onClick={() => { void execute({ method: 'load', request: { operationId: window.crypto.randomUUID(), catalogVersion: state.catalogVersion, presetId: load.id, expectedRevision: load.revision } }); }}>{t('Confirm load preset')}</button><button type="button" className="subtle-button" onClick={() => setLoad(null)}>{t('Cancel')}</button></div></Modal>}
  </main>;
}
