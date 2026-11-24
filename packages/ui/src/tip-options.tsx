import React, { useState } from 'react';
import { customTip, formatChf, parseChfInput, roundUpTip } from '@cash-sloth/domain';
import { t } from './preferences.js';

export function TipOptions({ baseRappen, tipRappen, disabled, cash = false, receivedRappen, onChange }: {
  baseRappen: number; tipRappen: number; disabled: boolean; cash?: boolean; receivedRappen?: number; onChange: (tip: number) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<'tip' | 'total' | null>(null);
  const [amount, setAmount] = useState('');
  let candidate: { tipRappen: number; totalRappen: number } | null = null;
  let error: string | null = null;
  if (mode && amount.trim()) {
    try {
      candidate = customTip(baseRappen, parseChfInput(amount), mode, cash);
      if (receivedRappen !== undefined && receivedRappen > 0 && candidate.totalRappen > receivedRappen) { error = t('The total exceeds the cash received.'); candidate = null; }
    } catch (failure) { error = failure instanceof Error ? t(failure.message) : t('Enter a valid amount.'); }
  }
  const apply = (tip: number): void => { setMode(null); setAmount(''); onChange(tip); };
  const open = (next: 'tip' | 'total'): void => { setMode(next); setAmount(''); };
  return <section className="tip-options" aria-label={t('Tip')}>
    <h4>{t('Add a tip')}</h4><div className="tip-options-buttons">
      {([500, 1000] as const).map((step) => {
        let option; try { option = roundUpTip(baseRappen, step); } catch { return null; }
        const insufficient = receivedRappen !== undefined && receivedRappen > 0 && receivedRappen < option.totalRappen;
        return <button type="button" className="subtle-button" key={step} aria-pressed={tipRappen === option.tipRappen} disabled={disabled || insufficient} onClick={() => apply(tipRappen === option.tipRappen ? 0 : option.tipRappen)}>
          <strong>{t(step === 500 ? 'Round up to next CHF 5' : 'Round up to next CHF 10')}</strong><span>{formatChf(option.totalRappen)} · +{formatChf(option.tipRappen)} {t('Tip')}</span>
        </button>;
      })}
      <button type="button" className="subtle-button" aria-pressed={mode === 'tip'} disabled={disabled} onClick={() => open('tip')}>{t('Custom tip')}</button>
      <button type="button" className="subtle-button" aria-pressed={mode === 'total'} disabled={disabled} onClick={() => open('total')}>{t('Round up to amount')}</button>
      {tipRappen > 0 && <button type="button" className="subtle-button" disabled={disabled} onClick={() => apply(0)}>{t('Remove tip')}</button>}
    </div>
    {mode && <div className="custom-tip-entry">
      <label>{t(mode === 'tip' ? 'Tip amount (CHF)' : 'Desired total (CHF)')}<input autoFocus type="text" inputMode="decimal" placeholder="0.00" value={amount} disabled={disabled} onChange={(event) => setAmount(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (candidate && !disabled) apply(candidate.tipRappen); } }} /></label>
      {cash && <small>{t('Use CHF 0.05 increments for cash.')}</small>}
      {error && <p className="pos-error" role="alert">{error}</p>}
      {candidate && <p aria-live="polite">{t('Total')}: <strong>{formatChf(candidate.totalRappen)}</strong> · {t('Tip')}: {formatChf(candidate.tipRappen)}</p>}
      <div className="form-actions"><button type="button" className="primary-button" disabled={disabled || candidate === null} onClick={() => { if (candidate) apply(candidate.tipRappen); }}>{t('Apply tip')}</button><button type="button" className="subtle-button" disabled={disabled} onClick={() => setMode(null)}>{t('Cancel')}</button></div>
    </div>}
  </section>;
}
