import { DemoBanner } from './demo-banner.js';
import React, { useEffect, useState } from 'react';
import type { CustomerDisplayState, CustomerReadApi } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';
import { t, useAppearance, usePreferences } from './preferences.js';
import { signedChf } from './payment-components.js';
import { variantLabel } from './catalog-ui.js';

export function CustomerDisplay({ api, logo }: { api: CustomerReadApi | undefined; logo: string }): React.JSX.Element {
  useAppearance(); const { locale } = usePreferences();
  useEffect(() => { document.title = t('Customer display'); }, [locale]);
  const [state, setState] = useState<CustomerDisplayState | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const customLogo = state?.logo ?? null;
  useEffect(() => {
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const read = async (): Promise<void> => {
      try { const result = await api?.getState({}); if (!cancelled) { setState(result?.ok ? result.value : null); if (result?.ok) setDemoMode(result.value.demoMode ?? false); } }
      catch { if (!cancelled) setState(null); }
      if (!cancelled) timer = setTimeout(() => { void read(); }, 300);
    };
    void read(); return () => { cancelled = true; clearTimeout(timer); };
  }, [api]);
  return <>{demoMode && <DemoBanner />}<main className="customer-display">
    <header><img className={customLogo ? 'customer-event-logo' : undefined} src={customLogo?.dataUrl ?? logo} alt={customLogo ? t('Custom logo') : 'Cash Sloth'} /><div><span>{t('Welcome')}</span><h1>{state?.eventTitle ?? 'Cash Sloth'}</h1></div></header>
    {!state ? <section className="customer-welcome"><h2>{t('Waiting for the register…')}</h2></section> : state.items.length === 0 ? <section className="customer-welcome"><h2>{t('Welcome!')}</h2><p>{t('Your items will appear here.')}</p></section> : <div className="customer-display-grid">
      <section className="customer-items" aria-label={t('Your cart')}><h2>{t('Your cart')}</h2>{state.items.map((item, index) => <article key={index}><span className="customer-quantity" aria-label={t('Quantity') + ': ' + item.quantity}><strong>{item.quantity}×</strong><small>{t('Quantity')}</small></span><div className="customer-item-description"><strong>{item.productName}{item.variantName === 'Default' ? '' : ' — ' + variantLabel(item.variantName)}</strong><span>{formatChf(item.unitPriceRappen)} {t('each')}</span></div><strong>{formatChf(item.lineTotalRappen)}</strong></article>)}</section>
      <aside className="customer-total" aria-live="polite"><dl><dt>{t('Subtotal')}</dt><dd>{formatChf(state.subtotalRappen)}</dd>{state.tipRappen > 0 && <><dt>{t('Tip')}</dt><dd data-testid="customer-tip">{formatChf(state.tipRappen)}</dd></>}{state.roundingAdjustmentRappen !== 0 && <><dt>{t('Cash rounding')}</dt><dd>{signedChf(state.roundingAdjustmentRappen)}</dd></>}</dl><span>{t('Amount due')}</span><strong data-testid="customer-total">{formatChf(state.outstandingRappen)}</strong>
        {state.cashReceivedRappen !== null && <dl><dt>{t('Cash received')}</dt><dd>{formatChf(state.cashReceivedRappen)}</dd>{state.changeRappen !== null && <><dt>{t('Change')}</dt><dd data-testid="customer-change">{formatChf(state.changeRappen)}</dd></>}</dl>}
        {state.checkoutActive && state.outstandingRappen < state.totalRappen && <p>{t('Still required')}: {formatChf(state.outstandingRappen)}</p>}
      </aside>
    </div>}
  </main></>;
}
