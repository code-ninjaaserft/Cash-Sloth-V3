import {OrderSettingsPanel} from './order-settings.js';
import type {OrdersApi} from '@cash-sloth/contracts';
import { TicketdeskButton } from './ticketdesk-button.js';
import { parseCustomLogo, type CustomLogo } from './custom-logo.js';
import type { TicketdeskControlApi, DemoApi, CustomerDisplayApi } from '@cash-sloth/contracts';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { translate, type Locale } from '@cash-sloth/i18n';

export type Theme = 'light' | 'dark' | 'system';
interface SavedColor { name: string; color: string }
interface Preferences { customLogo?: CustomLogo | undefined; theme: Theme; locale: Locale; accent: string; savedColors: readonly SavedColor[] }
const storageKey = 'cash-sloth.preferences.v1';
const defaults: Preferences = { theme: 'system', locale: 'en', accent: '#4f9271', savedColors: [] };
export function parseSavedColors(value: unknown): SavedColor[] {
  if (!Array.isArray(value)) return [];
  const colors: SavedColor[] = [];
  for (const entry of value.slice(0, 100)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, color } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 48 || /\p{Cc}/u.test(name) || typeof color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color)) continue;
    if (!colors.some((saved) => saved.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) colors.push({ name: name.trim(), color: color.toLowerCase() });
  }
  return colors;
}
export function parsePreferences(raw: string | null): Preferences {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (typeof value !== 'object' || value === null) return defaults;
    const saved = value as Record<string, unknown>;
    const customLogo = parseCustomLogo(saved['customLogo']);
    return {
      ...(customLogo ? { customLogo } : {}),
      savedColors: parseSavedColors(saved['savedColors']),
      theme: saved['theme'] === 'light' || saved['theme'] === 'dark' || saved['theme'] === 'system' ? saved['theme'] : defaults.theme,
      accent: typeof saved['accent'] === 'string' && /^#[0-9a-f]{6}$/iu.test(saved['accent']) ? saved['accent'].toLowerCase() : defaults.accent,
      locale: saved['locale'] === 'de' || saved['locale'] === 'en' ? saved['locale'] : defaults.locale,
    };
  } catch { return defaults; }
}
let preferences = defaults;
let initialized = false;
let storageError = false;
const listeners = new Set<() => void>();
function initialize(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try { preferences = parsePreferences(window.localStorage.getItem(storageKey)); }
  catch { storageError = true; }
  window.addEventListener('storage', (event) => { if (event.key === storageKey || event.key === null) { preferences = parsePreferences(event.key === null ? null : event.newValue); for (const listener of listeners) listener(); } });
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function t(text: string): string {
  initialize();
  return translate(text, preferences.locale);
}
export function localeTag(): 'de-CH' | 'en-CH' { initialize(); return preferences.locale === 'de' ? 'de-CH' : 'en-CH'; }
export function usePreferences(): Preferences {
  initialize();
  return useSyncExternalStore(subscribe, () => preferences, () => defaults);
}
export function setPreferences(next: Preferences): void {
  preferences = next;
  try { window.localStorage.setItem(storageKey, JSON.stringify(next)); storageError = false; }
  catch { storageError = true; }
  for (const listener of listeners) listener();
}
export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? systemDark ? 'dark' : 'light' : theme;
}
/** Secondary palette accents use this hue; primary controls retain the chosen RGB color. */
export function accentHue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  if (delta === 0) return 0;
  const sector = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}
export function accentInk(hex: string): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map((offset) => { const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const luminance = channels.reduce((sum, c, index) => sum + c * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
export function useAppearance(): void {
  const { theme, locale, accent } = usePreferences();
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const resolved = resolveTheme(theme, media.matches);
      document.documentElement.dataset['theme'] = resolved;
      document.documentElement.style.colorScheme = resolved;
      document.documentElement.lang = locale;
      document.documentElement.style.setProperty('--theme-accent', accent);
      document.documentElement.style.setProperty('--accent-fill', accent);
      document.documentElement.style.setProperty('--accent-ink', accentInk(accent));
      document.documentElement.style.setProperty('--accent-hue', String(accentHue(accent)));
      document.documentElement.style.setProperty('--accent-chroma', /^#([0-9a-f]{2})\1\1$/iu.test(accent) ? '0' : '1');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, locale, accent]);
}
export function Settings({ orders, customerDisplay, ticketdesk, demo, demoMode = false }: { orders?:OrdersApi|undefined; customerDisplay?: CustomerDisplayApi | undefined; ticketdesk?: TicketdeskControlApi | undefined; demo?: DemoApi | undefined; demoMode?: boolean }): React.JSX.Element {
  const value = usePreferences();
  const [switchingDemo, setSwitchingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [colorName, setColorName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [editedColor, setEditedColor] = useState('#4f9271');
  const [openingDisplay, setOpeningDisplay] = useState(false);
  const [displayNotice, setDisplayNotice] = useState<string | null>(null);
  const editDuplicate = value.savedColors.some((entry) => entry.name !== editingName && entry.name.toLocaleLowerCase() === editedName.trim().toLocaleLowerCase());
  const duplicateName = value.savedColors.some((entry) => entry.name.toLocaleLowerCase() === colorName.trim().toLocaleLowerCase());
  return <main className="pos-content settings-page">
    <section className="settings-card"><h2>{t("Cash drawer")}</h2><button type="button" disabled>{t("Open drawer")}</button><p>{t("Placeholder — the cash drawer is not connected yet.")}</p></section><header className="pos-heading"><div><span className="pos-label">Cash Sloth V3</span><h1>{t('Settings')}</h1><p>{t('Changes apply immediately and are saved on this device.')}</p></div></header>
    {orders&&<OrderSettingsPanel api={orders}/>}
    {demo && <section className="settings-card"><h2>{t('Demo mode')}</h2><p>{t('Demonstrate sales without changing real history or revenue. Each demo starts with empty sales history. Ending demo mode clears this history and invalidates all demo tickets and vouchers. Restarting returns to normal mode.')}</p>
      <button type="button" aria-pressed={demoMode} disabled={switchingDemo} onClick={async () => {
        setSwitchingDemo(true); setDemoError(null);
        try { const result = await demo.setMode({ enabled: !demoMode }); if (!result.ok) { setDemoError(t(result.error)); setSwitchingDemo(false); } else window.dispatchEvent(new Event('cash-sloth-mode-changed')); }
        catch { window.dispatchEvent(new Event('cash-sloth-mode-changed')); }
      }}>{t(demoMode ? 'End demo mode' : 'Activate demo mode')}</button>
      {demoError && <p role="alert">{demoError}</p>}
    </section>}
    <section className="settings-card" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">{t('Appearance')}</h2>
      <p>{t('Follow the Windows appearance automatically.')}</p>
      <div className="theme-options" role="group" aria-labelledby="appearance-heading">
        {(['light', 'dark', 'system'] as const).map((theme) => <button type="button" key={theme} aria-pressed={value.theme === theme} onClick={() => setPreferences({ ...value, theme })}>
          <span className={`theme-preview theme-preview-${theme}`} aria-hidden="true"><span /></span>
          {t(theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System')}
        </button>)}
      </div>
    </section>
    <section className="settings-card" aria-labelledby="accent-heading">
      <h2 id="accent-heading">{t('Theme color')}</h2>
      <p>{t('A subtle tint for surfaces and controls. Text stays easy to read.')}</p>
      <div className="accent-options" role="group" aria-labelledby="accent-heading">
        {([{ name: 'Green', color: '#4f9271' }, { name: 'Yellow', color: '#ffff00' }, { name: 'Red', color: '#ff0000' }, { name: 'Blue', color: '#0000ff' }, { name: 'Purple', color: '#9270bf' }] as const).map(({ name, color }) =>
          <button type="button" key={name} aria-pressed={value.accent === color} onClick={() => setPreferences({ ...value, accent: color })}>
            <span className="accent-swatch" style={{ backgroundColor: color }} aria-hidden="true" />{t(name)}
          </button>)}
      </div>
      <label className="custom-accent" htmlFor="settings-accent">{t('Custom color')}
        <input id="settings-accent" type="color" value={value.accent} onChange={(event) => setPreferences({ ...value, accent: event.target.value })} />
      </label>
      <form className="save-color-form" onSubmit={(event) => {
        event.preventDefault();
        if (!colorName.trim() || duplicateName || value.savedColors.length >= 100) return;
        setPreferences({ ...value, savedColors: [...value.savedColors, { name: colorName.trim(), color: value.accent }] });
        setColorName('');
      }}>
        <label htmlFor="color-name">{t('Color name')}<input id="color-name" required maxLength={48} value={colorName} onChange={(event) => setColorName(event.target.value.replace(/\p{Cc}/gu, ''))} /></label>
        <button type="submit" className="subtle-button" disabled={!colorName.trim() || duplicateName || value.savedColors.length >= 100}>{t('Save color')}</button>
      </form>
      {duplicateName && <p role="status">{t('This name is already used. Choose another name.')}</p>}
      {value.savedColors.length >= 100 && <p role="status">{t('Up to 100 colors can be saved.')}</p>}
      {value.savedColors.length > 0 && <><h3>{t('Saved colors')}</h3><div className="saved-color-list">{value.savedColors.map((entry) => <div className="saved-color-row" key={entry.name}>
        <button type="button" className="subtle-button" aria-pressed={value.accent === entry.color} onClick={() => setPreferences({ ...value, accent: entry.color })}><span className="accent-swatch" aria-hidden="true" style={{ backgroundColor: entry.color }} />{entry.name}</button>
        <button type="button" className="subtle-button" aria-label={t('Edit color') + ' ' + entry.name} onClick={() => { setEditingName(entry.name); setEditedName(entry.name); setEditedColor(entry.color); }}>{t('Edit')}</button>
        <button type="button" className="subtle-button" aria-label={t('Delete color') + ' ' + entry.name} onClick={() => { setPreferences({ ...value, savedColors: value.savedColors.filter((item) => item.name !== entry.name) }); if (editingName === entry.name) setEditingName(null); }}>{t('Delete color')}</button>
      </div>)}</div></>}
      {editingName !== null && <form className="editor-form saved-color-editor" aria-label={t('Edit saved color')} onSubmit={(event) => {
        event.preventDefault(); if (!editedName.trim() || editDuplicate) return;
        const original = value.savedColors.find((entry) => entry.name === editingName); if (!original) return;
        setPreferences({ ...value, accent: value.accent === original.color ? editedColor : value.accent, savedColors: value.savedColors.map((entry) => entry.name === editingName ? { name: editedName.trim(), color: editedColor } : entry) }); setEditingName(null);
      }}>
        <h3>{t('Edit saved color')}</h3><label>{t('Saved color name')}<input required maxLength={48} value={editedName} onChange={(event) => setEditedName(event.target.value.replace(/\p{Cc}/gu, ''))} /></label>
        <label>{t('Saved color value')}<input type="color" value={editedColor} onChange={(event) => setEditedColor(event.target.value)} /></label>
        {editDuplicate && <p role="status">{t('This name is already used. Choose another name.')}</p>}
        <div className="form-actions"><button type="submit" className="primary-button" disabled={!editedName.trim() || editDuplicate}>{t('Save color changes')}</button><button type="button" className="subtle-button" onClick={() => setEditingName(null)}>{t('Cancel')}</button></div>
      </form>}
    </section>
    <section className="settings-card"><h2><label htmlFor="settings-language">{t('Language')}</label></h2>
      <select id="settings-language" value={value.locale} onChange={(event) => setPreferences({ ...value, locale: event.target.value === 'de' ? 'de' : 'en' })}>
        <option value="en" lang="en">English</option><option value="de" lang="de">Deutsch</option>
      </select>
    </section>
    <section className="settings-card"><h2>{t('Ticketdesk')}</h2><p>{t('Open a separate ticket station for scanning, checking and confirming ticket redemptions.')}</p><TicketdeskButton api={ticketdesk} translate={t} /></section>
    <section className="settings-card"><h2>{t('Customer display')}</h2><p>{t('Open a separate window and move it to the customer-facing screen. The cart and amount due update automatically.')}</p>
      <button type="button" className="subtle-button" disabled={!customerDisplay || openingDisplay} onClick={() => {
        if (!customerDisplay || openingDisplay) return; setOpeningDisplay(true); setDisplayNotice(null);
        void customerDisplay.open({}).then((result) => { if (!result.ok) throw new Error(result.error.message); setDisplayNotice(t('Customer display opened. Move the window to your second screen.')); }).catch(() => setDisplayNotice(t('The customer display could not be opened. Try again.'))).finally(() => setOpeningDisplay(false));
      }}>{t('Open customer display')}</button>{displayNotice && <p role="status">{displayNotice}</p>}
    </section>
    {storageError && <p role="alert" className="pos-error">{value.locale === 'de' ? 'Die Auswahl konnte nicht gespeichert werden. Sie gilt nur bis zum Schliessen der App.' : 'Preferences could not be saved. They apply only until the app closes.'}</p>}
  </main>;
}
