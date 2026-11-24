import {WalletPayment} from './wallet-payment.js';
import { operationStorage } from './operation-storage.js';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { CheckoutView, CustomerDisplayApi, FinancialSale, PaymentMethod, PaymentsApi, PromotionsApi } from '@cash-sloth/contracts';
import { addMoney, formatChf, previewCash, roundCashRappen } from '@cash-sloth/domain';
import { TipOptions } from './tip-options.js';
import { Modal } from './modal.js';
import { t } from './preferences.js';
import { paymentErrorMessage, unwrapPaymentResult } from './payment-components.js';
import { clearFinanceRecovery, saveFinanceRecovery, submitFinancialConfirmation } from './finance-recovery.js';

export interface CheckoutProps {
  promotions?:PromotionsApi|undefined;
  customerDisplay?: CustomerDisplayApi | undefined;
  api: PaymentsApi; initial: CheckoutView; recovery?: boolean; cashArtwork?: string | undefined; cashNoteArtwork?: Readonly<Record<number, string>> | undefined;
  onComplete: (sale: FinancialSale, returnToRegister?: boolean) => Promise<void>;
  onClose: () => void; onChanged: (view: CheckoutView) => void; onReconciliation: () => void;
}
const denominations = [
  { value: 5, crop: '264 4 237 240' }, { value: 10, crop: '516 6 235 240' },
  { value: 20, crop: '774 6 238 240' }, { value: 50, crop: '1030 6 240 240' },
  { value: 100, crop: '346 241 267 260' }, { value: 200, crop: '625 242 264 260' },
  { value: 500, crop: '917 242 270 260' }, { value: 1000, crop: '8 513 249 505' },
  { value: 2000, crop: '264 513 249 505' }, { value: 5000, crop: '521 513 249 505' },
  { value: 10000, crop: '778 513 249 505' }, { value: 20000, crop: '1034 513 249 505' },
  { value: 100000, crop: '1287 513 249 505' },
] as const;

function MoneyArtwork({ crop, src, coin }: { crop: string; src: string; coin: boolean }): React.JSX.Element {
  const clipId = useId();
  const [x, y, width, height] = crop.split(' ').map(Number) as [number, number, number, number];
  return <svg className="cash-artwork" viewBox={crop} aria-hidden="true">
    <defs><clipPath id={clipId}>{coin ? <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} /> : <rect x={x} y={y} width={width} height={height} />}</clipPath></defs>
    <image href={src} width="1536" height="1024" clipPath={`url(#${clipId})`} />
  </svg>;
}

export function QuickCheckout({ api, promotions, initial, customerDisplay, cashArtwork, cashNoteArtwork, onClose, onComplete, onChanged, onAdvanced }: CheckoutProps & { onAdvanced: (view: CheckoutView, recovery?: boolean) => void }): React.JSX.Element {
  const [step, setStep] = useState<'choose' | 'cash' | 'digital' | 'team'>('choose');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [entries, setEntries] = useState<readonly number[]>([]);
  const [tipRappen, setTipRappen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const operation = useRef(false);
  const latest = useRef(initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const received = entries.reduce(addMoney, 0);
  const cash = previewCash(roundCashRappen(addMoney(initial.session.cart.subtotalRappen, tipRappen)), received);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (customerDisplay && !review) { void customerDisplay.preview({ sessionId: initial.session.id, method: step === 'choose' ? null : step === 'cash' ? 'cash' : method, tipRappen, cashReceivedRappen: step === 'cash' ? received : null }).catch(() => undefined); } }, [customerDisplay, initial.session.id, step, method, tipRappen, received, review]);

  const complete = async (): Promise<void> => {
    if (operation.current || review || (step === 'cash' && !cash.sufficient)) return;
    operation.current = true; setBusy(true); setError(null);
    const marker = { kind: 'checkout' as const, reference: initial.session.id, attemptId: null as string | null, confirmationSubmitted: false };
    try {
      saveFinanceRecovery(operationStorage, marker);
      let checkout = latest.current;
      if ((checkout.session.tipRappen ?? 0) !== tipRappen) {
        checkout = unwrapPaymentResult(await api.setTip({ sessionId: initial.session.id, expectedTipRappen: checkout.session.tipRappen ?? 0, tipRappen })); latest.current = checkout;
      }
      const attempt = unwrapPaymentResult(await api.preparePayment({ sessionId: initial.session.id, idempotencyKey: window.crypto.randomUUID(), method:checkout.balance.outstandingRappen===0?'cash':step === 'cash' ? 'cash' : method, intendedRappen:checkout.balance.outstandingRappen===0?0:step === 'cash' ? received : checkout.balance.outstandingRappen }));
      marker.attemptId = attempt.id;
      saveFinanceRecovery(operationStorage, marker);
      const confirmed = unwrapPaymentResult(await submitFinancialConfirmation(operationStorage, marker, () => api.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })));
      latest.current = confirmed;
      saveFinanceRecovery(operationStorage, marker);
      const sale = unwrapPaymentResult(await api.completeCheckout({ sessionId: initial.session.id }));
      await onComplete(sale, true);
    } catch (failure) {
      setError(paymentErrorMessage(failure)); setReview(true);
    } finally { operation.current = false; setBusy(false); }
  };
  const returnToCart = async (): Promise<void> => {
    if (operation.current || review) return;
    operation.current = true; setBusy(true);
    try {
      const next = unwrapPaymentResult(await api.cancelCheckout({ sessionId: initial.session.id }));
      clearFinanceRecovery(operationStorage, 'checkout', initial.session.id);
      onChanged(next); onClose();
    } catch (failure) { setError(paymentErrorMessage(failure)); setReview(true); }
    finally { operation.current = false; setBusy(false); }
  };
  const inspect = async (): Promise<void> => {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try {
      const next = unwrapPaymentResult(await api.getCheckout({ sessionId: initial.session.id }));
      if (next.sale) await onComplete(next.sale, true);
      else onAdvanced(next, true);
    } catch (failure) { setError(paymentErrorMessage(failure)); }
    finally { operation.current = false; setBusy(false); }
  };
  return <Modal title={t('Checkout')} className={`quick-checkout quick-checkout-${step}`} closeDisabled={busy || review} onClose={() => { if (!busy && !review) void returnToCart(); }}>
    {error && <p role="alert" className="pos-error">{error}</p>}
    {review ? <section className="recovery-notice"><h3>{t('Payment outcome needs review')}</h3><p>{t('Check the stored result and the actual transfer. Never take another payment merely because a reply was lost.')}</p><button type="button" className="primary-button" disabled={busy} onClick={() => { void inspect(); }}>{t('Check stored result')}</button></section> : <>
      <div className="quick-checkout-top"><button type="button" className="subtle-button" disabled={busy} onClick={() => { if (step === 'choose') void returnToCart(); else { setTipRappen(0); setStep('choose'); } }}>← {step === 'choose' ? t('Return to cart') : t('Change payment method')}</button><span>{initial.session.cart.items.reduce((sum, item) => sum + item.quantity, 0)} {t('Items')}</span></div>
      {step !== 'choose' && step !== 'team' && <TipOptions cash={step === 'cash'} baseRappen={step === 'cash' ? initial.balance.cashDueRappen : initial.balance.outstandingRappen} tipRappen={tipRappen} disabled={busy} {...(step === 'cash' ? { receivedRappen: received } : {})} onChange={setTipRappen} />}
      {step === 'choose' ? <section className="payment-choice">{promotions&&<WalletPayment api={promotions} view={latest.current} onChanged={async()=>{const next=unwrapPaymentResult(await api.getCheckout({sessionId:initial.session.id}));latest.current=next;onChanged(next);onAdvanced(next);}}/>}{initial.balance.outstandingRappen===0&&<button type="button" onClick={()=>{void complete();}}>Ohne Zahlung abschliessen</button>}<h3 tabIndex={-1} ref={heading}>{t('How would you like to pay?')}</h3><strong className="quick-total">{formatChf(initial.balance.outstandingRappen)}</strong>
        <div className="payment-choice-grid"><button type="button" disabled={busy||initial.session.cart.items.some(item=>item.originalUnitPriceRappen!==undefined)} onClick={()=>setStep('team')}><strong>{t("Helpers / Team")}</strong><span>{t("Complimentary consumption without income")}</span></button>
          <button type="button" aria-label={t('Card / TWINT')} disabled={busy} onClick={() => setStep('digital')}><svg viewBox="0 0 48 40" aria-hidden="true"><rect x="3" y="5" width="42" height="30" rx="5" /><path d="M3 15h42" /></svg><strong>{t('Card / TWINT')}</strong><span>{t('Accept the payment externally')}</span><span aria-hidden="true">→</span></button>
          <button type="button" aria-label={t('Cash')} disabled={busy} onClick={() => setStep('cash')}><svg viewBox="0 0 48 40" aria-hidden="true"><rect x="3" y="7" width="42" height="26" rx="4" /><circle cx="24" cy="20" r="6" /><path d="M10 20h2m24 0h2" /></svg><strong>{t('Cash')}</strong><span>{t('Tap the received coins and notes')}</span><span aria-hidden="true">→</span></button>
        </div><button type="button" className="quick-advanced" disabled={busy} onClick={() => onAdvanced(latest.current)}>{t('More payment options')}</button>
      </section> : step === 'cash' ? <div className="cash-entry-layout"><section><h3 tabIndex={-1} ref={heading}>{t('Cash received.')}</h3><p className="form-hint">{t('Tap the received coins and notes')}</p>
        <div className="denomination-groups">{[denominations.filter((entry) => entry.value < 1000), denominations.filter((entry) => entry.value >= 1000)].map((group, groupIndex) => <div className={`denomination-grid denomination-grid-${groupIndex === 0 ? 'coins' : 'notes'}`} key={groupIndex}>{group.map(({ value, crop }) => <button type="button" className={value < 1000 ? 'denomination-coin' : 'denomination-note'} key={value} aria-label={`${t('Add cash')} ${formatChf(value)}`} disabled={busy} onClick={() => { try { addMoney(received, value); setEntries((current) => [...current, value]); } catch (failure) { setError(paymentErrorMessage(failure)); } }}>
          {cashNoteArtwork?.[value] ? <img className="cash-artwork" src={cashNoteArtwork[value]} alt="" aria-hidden="true" /> : cashArtwork && <MoneyArtwork crop={crop} src={cashArtwork} coin={value < 1000} />}<span>{formatChf(value)}</span>
        </button>)}</div>)}</div><div className="cash-entry-tools"><button type="button" className="subtle-button" disabled={busy || entries.length === 0} onClick={() => setEntries((current) => current.slice(0, -1))}>↶ {t('Undo last entry')}</button><button type="button" className="subtle-button" disabled={busy || entries.length === 0} onClick={() => setEntries([])}>{t('Reset')}</button></div>
        <div className="cash-entry-history" aria-label={t('Entered cash')}>{entries.length === 0 ? t('No cash entered yet') : entries.map((value, index) => <span key={index}>{formatChf(value)}</span>)}</div>
      </section><aside className="cash-bill"><h3>{t('Your payment summary')}</h3><dl><dt>{t('Amount due')}</dt><dd>{formatChf(roundCashRappen(addMoney(initial.session.cart.subtotalRappen, tipRappen)))}</dd>{tipRappen > 0 && <><dt>{t('Tip')}</dt><dd data-testid="quick-tip">{formatChf(tipRappen)}</dd></>}<dt>{t('Cash received')}</dt><dd data-testid="quick-cash-received">{formatChf(received)}</dd></dl><div className="quick-change" aria-live="polite"><span>{cash.sufficient ? t('Change') : t('Still required')}</span><strong data-testid="quick-cash-change">{formatChf(cash.sufficient ? cash.changeRappen : cash.remainingRappen)}</strong></div><button type="button" className="primary-button" disabled={busy || !cash.sufficient} onClick={() => { void complete(); }}>{t('Complete transaction')}</button><p className="form-hint">{t('By completing, you confirm that you received the cash and returned the displayed change.')}</p></aside></div> : step === 'team' ? <section className="digital-confirmation"><h3>{t("Helpers / Team")}</h3><p>{t("Record consumption without collecting money.")}</p><button type="button" className="primary-button" disabled={busy} onClick={async()=>{if(operation.current)return;operation.current=true;setBusy(true);try{saveFinanceRecovery(operationStorage,{kind:'checkout',reference:initial.session.id,attemptId:null,confirmationSubmitted:false});const next=unwrapPaymentResult(await api.completeTeam({sessionId:initial.session.id}));clearFinanceRecovery(operationStorage,'checkout',initial.session.id);onChanged(next);onClose();}catch(failure){setError(paymentErrorMessage(failure));}finally{operation.current=false;setBusy(false);}}}>{t("Confirm complimentary consumption")}</button></section> : <section className="digital-confirmation"><h3 tabIndex={-1} ref={heading}>{t('Confirm external payment')}</h3><strong className="quick-total">{formatChf(addMoney(initial.balance.outstandingRappen, tipRappen))}</strong>{tipRappen > 0 && <p data-testid="quick-tip">{t('Tip')}: {formatChf(tipRappen)}</p>}<fieldset disabled={busy}><legend>{t('Payment method')}</legend>{(['card', 'twint'] as const).map((value) => <label key={value}><input type="radio" aria-label={value === 'card' ? t('Card') : 'TWINT'} name="quick-digital-method" checked={method === value} onChange={() => setMethod(value)} /><span className="digital-method-name">{value === 'card' ? t('Card') : 'TWINT'}</span><span className="digital-method-state" aria-hidden="true">{method === value ? t('Selected') : t('Tap to select')}</span></label>)}</fieldset><p>{t('Confirm only after your terminal or TWINT confirms the payment.')}</p><button type="button" className="primary-button" disabled={busy} onClick={() => { void complete(); }}>{t('Your transaction was completed successfully')}</button></section>}
    </>}
    {busy && <p role="status">{t('Saving the payment record…')}</p>}
  </Modal>;
}
