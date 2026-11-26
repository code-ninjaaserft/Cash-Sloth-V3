import {useOrderSettings} from './order-settings.js';
import {TableBooking} from './table-booking.js';
import {OrderReference} from './order-reference.js';
import {OrdersView} from './orders-view.js';
import {PromotionManager} from './promotion-manager.js';
import {CartDiscounts} from './cart-discounts.js';
import { TeamStatistics } from './team-statistics.js';
import { TicketsView } from './tickets-view.js';
import { DemoBanner } from './demo-banner.js';
import { operationStorage } from './operation-storage.js';
import type { CustomLogo } from './custom-logo.js';
import { PresetsView } from './presets-view.js';
import { ReceiptPreview } from './receipt-preview.js';
import { t, localeTag } from './preferences.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CashSlothApi, FinancialSale, CheckoutView, RefundAttempt, SaleDetails } from '@cash-sloth/contracts';
import {
  formatChf,
  MAX_QUANTITY,
  parseChfInput,
  previewCash,
  type Cart,
  type CartItem,
  type CheckoutAttempt,
  type Sale,
} from '@cash-sloth/domain';
import { FoundationStatus } from './foundation-status.js';
import { clearCashRecovery, readCashRecovery } from './recovery-marker.js';
import { restoreCashConfirmation, submitCashConfirmation } from './checkout-recovery.js';
import { initialProductBrowserState, ProductBrowser } from './product-browser.js';
import { ApplicationNavigation, type ApplicationView } from './application-navigation.js';
import { PosCategoryBrowser } from './pos-category-browser.js';
import { cartPayableRappen } from './cart-payable.js';
import { CatalogEditor } from './catalog-editor.js';
import { cartLineLabel, groupCartLines, variantLabel } from './catalog-ui.js';
import { Modal } from './modal.js';
import { PaymentsCheckout } from './payments-checkout.js';
import { FinancialSaleDetails } from './financial-sale-details.js';
import { ReconciliationView } from './reconciliation-view.js';
import { clearFinanceRecovery, readFinanceRecovery, saveFinanceRecovery } from './finance-recovery.js';
import { CatalogImport, DevelopmentTools } from './catalog-import.js';
import { initialSalesHistoryState, SalesHistory } from './sales-history.js';

import { Settings, useAppearance } from './preferences.js';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

class RequestFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new RequestFailure(result.error.code, result.error.message);
  return result.value;
}

function errorMessage(error: unknown): string {
  return error instanceof RequestFailure
    ? error.message
    : t("The application could not confirm this action. Check its status before trying again.");
}

function cashInput(amount: number): string { return formatChf(amount).replace(/^CHF\s+/u, ''); }
function signedChf(amount: number): string {
  return amount < 0 ? `−${formatChf(-amount)}` : amount > 0 ? `+${formatChf(amount)}` : formatChf(0);
}
function displayDate(timestamp: string): string { return new Date(timestamp).toLocaleString(localeTag()); }

function QuantityControl({ item, disabled, onQuantity, onError }: {
  item: CartItem;
  disabled: boolean;
  onQuantity: (quantity: number) => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(item.quantity));
  const [editing, setEditing] = useState(false);
  return (
    <>
      <button type="button" aria-label={`Decrease ${cartLineLabel(item)}`} disabled={disabled || item.quantity === 1} onClick={() => onQuantity(item.quantity - 1)}>−</button>
      <input
        type="number" min={1} max={MAX_QUANTITY} step={1} inputMode="numeric" aria-label={`Quantity for ${cartLineLabel(item)}`}
        value={editing ? draft : String(item.quantity)} disabled={disabled}
        onFocus={() => { setDraft(String(item.quantity)); setEditing(true); }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={(event) => {
          const entered = event.currentTarget.value;
          setEditing(false);
          const quantity = /^\d+$/u.test(entered) ? Number(entered) : Number.NaN;
          if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            onError(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
          } else if (quantity !== item.quantity) {
            onQuantity(quantity);
          }
        }}
      />
      <button type="button" aria-label={`Increase ${cartLineLabel(item)}`} disabled={disabled || item.quantity >= MAX_QUANTITY} onClick={() => onQuantity(item.quantity + 1)}>+</button>
    </>
  );
}

function SaleReceipt({ sale, onNewSale }: { sale: Sale; onNewSale: () => void }): React.JSX.Element {
  return (
    <section className="receipt" aria-label={t("Sale receipt")}>
      <span className="receipt-label">{t("Committed · Cash payment")}</span>
      <h2>{t("Sale completed")}</h2>
      <p className="receipt-meta">{t("Sale")}{' '}<strong data-testid="receipt-sale-id">{sale.id}</strong><br />{displayDate(sale.completedAt)}</p>
      <table className="receipt-items">
        <thead><tr><th scope="col">{t("Item")}</th><th scope="col">{t("Qty")}</th><th scope="col">{t("Total")}</th></tr></thead>
        <tbody>{sale.items.map((item) => <tr key={item.id}>
          <td>{cartLineLabel(item)}<small>{item.discountLabel&&<><strong>{item.discountLabel}</strong> · vorher {formatChf(item.originalUnitPriceRappen??item.unitPriceRappen)} · </>}{item.variantName === 'Default' && <>{variantLabel(item.variantName)} · </>}{formatChf(item.unitPriceRappen)}{' '}{t("each")}</small></td>
          <td>{item.quantity}</td><td>{formatChf(item.lineTotalRappen)}</td>
        </tr>)}</tbody>
      </table>
      <dl className="receipt-totals">
        <dt>{t("Subtotal")}</dt><dd>{formatChf(sale.subtotalRappen)}</dd>
        <dt>{t("Cash rounding")}</dt><dd>{signedChf(sale.roundingAdjustmentRappen)}</dd>
        <dt className="receipt-final">{t("Amount due")}</dt><dd className="receipt-final">{formatChf(sale.amountDueRappen)}</dd>
        <dt>{t("Cash received")}</dt><dd>{formatChf(sale.payment.cashReceivedRappen)}</dd>
        <dt>{t("Cash applied")}</dt><dd>{formatChf(sale.payment.cashAppliedRappen)}</dd>
        <dt>{t("Change returned")}</dt><dd>{formatChf(sale.payment.changeRappen)}</dd>
      </dl>
      <OrderReference order={sale.order}/><p className="receipt-footer">{t("Cash receipt explicitly confirmed by the operator at")}{' '}{displayDate(sale.payment.confirmedAt)}.<br />{t("Checkout reference:")}{' '}{sale.idempotencyKey}</p>
      <button type="button" className="primary-button" onClick={onNewSale}>{t("Start new sale")}</button>
    </section>
  );
}

export function PosApp({ api, logo, cashArtwork, cashNoteArtwork, demoMode = false, inputMode = 'standard' }: {
  api: CashSlothApi | undefined;
  demoMode?: boolean;
  cashArtwork?: string;
  cashNoteArtwork?: Readonly<Record<number, string>>;
  logo: { src: string; srcSet: string };
  inputMode?: 'standard' | 'touch';
}): React.JSX.Element {
  useAppearance();
  const [customLogo, setCustomLogo] = useState<CustomLogo | null>(null);
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  useEffect(() => { let current = true; if (api) void api.presets.getState({}).then((result) => { if (current && result.ok) { setEventTitle(result.value.active?.name ?? null); setCustomLogo(result.value.active?.logo ?? null); } }).catch(() => { if (current) setError(t('Presets could not be loaded. Try refreshing.')); }); return () => { current = false; }; }, [api]);
  const [previewSale, setPreviewSale] = useState<FinancialSale | null>(null);
  const [view, setView] = useState<ApplicationView>('pos');
  const [applicationNavigationExpanded, setApplicationNavigationExpanded] = useState(false);
  const [categoryInteractionBlocked, setCategoryInteractionBlocked] = useState(false);
  const [productBrowserState, setProductBrowserState] = useState(initialProductBrowserState);
  const [cart, setCart] = useState<Cart | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<CheckoutAttempt | null>(null);
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(null);
  const [cash, setCash] = useState('');
  const [operatorConfirmed, setOperatorConfirmed] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [frozenReceived, setFrozenReceived] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [demoAllowed, setDemoAllowed] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [salesHistoryState, setSalesHistoryState] = useState(initialSalesHistoryState);
  const [activeCheckout, setActiveCheckout] = useState<CheckoutView | null>(null);
  const orderSettings=useOrderSettings(api?.orders);
  const [ordersPayOpen,setOrdersPayOpen]=useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutRecovery, setCheckoutRecovery] = useState(false);
  const [financialReceipt, setFinancialReceipt] = useState<SaleDetails | null>(null);
  const [refundRecovery, setRefundRecovery] = useState<RefundAttempt | null>(null);
  const [modernBlocked, setModernBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (cartOpen) drawerClose.current?.focus({ preventScroll: true });
  }, [cartOpen]);
  const closeCartDrawer = (): void => {
    setCartOpen(false);
    requestAnimationFrame(() => drawerToggle.current?.focus({ preventScroll: true }));
  };
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [catalogReviewRequired, setCatalogReviewRequired] = useState(false);
  const checkoutDialog = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!api) return;
    let current = true;
    void api.management.getCapabilities({}).then((response) => {
      const capabilities = unwrap(response);
      if (current) { setDemoAllowed(capabilities.developmentDemoAllowed); setCapabilityError(null); }
    }).catch(() => { if (current) { setDemoAllowed(false); setCapabilityError('Development-tool availability could not be verified. Reload the application to check again.'); } });
    return () => { current = false; };
  }, [api]);

  const loadCart = useCallback(async (showLegacyRecovery = true): Promise<void> => {
    if (api === undefined) return;
    const next = unwrap(await api.pos.getCart({}));
    setCart(next.cart);
    setPendingCheckout(next.pendingCheckout);
    if (showLegacyRecovery && next.pendingCheckout?.status === 'confirmed') {
      setAttempt(next.pendingCheckout);
      setFrozenReceived(next.pendingCheckout.cashReceivedRappen);
      setConfirmationSent(true);
    }
  }, [api]);

  useEffect(() => {
    let current = true;
    if (api === undefined) { setLoading(false); return; }
    const initialize = async (): Promise<void> => {
      try {
        if (current) await loadCart();
        if (current) {
          let restoration;
          try { restoration = await restoreCashConfirmation(api.pos, operationStorage); } catch {
            setRecoveryBlocked(true);
            setError('The saved checkout reference could not be read. New checkout is blocked to avoid a duplicate sale.');
            return;
          }
          if (restoration !== null) {
            const { marker } = restoration;
            setRecoveryBlocked(true);
            try {
              const result = unwrap(restoration.result);
              if (!current) return;
              if (result.sale !== null) {
                setReceipt(result.sale);
                setAttempt(null);
                setConfirmationSent(false);
              } else {
                const history = unwrap(await api.payments.listReconciliationHistory({}));
                const resolved = history.some((action) => action.kind === 'legacy' && action.referenceId === result.attempt.idempotencyKey && action.resolution !== 'confirm-recorded');
                if (resolved) {
                  clearCashRecovery(operationStorage, marker.idempotencyKey); setAttempt(null); setConfirmationSent(false); setFrozenReceived(null); setPendingCheckout(null);
                } else {
                  setAttempt(result.attempt);
                  setFrozenReceived(result.attempt.cashReceivedRappen ?? marker.cashReceivedRappen);
                  setConfirmationSent(result.attempt.status === 'confirmed' || marker.cashReceivedRappen !== null);
                }
              }
              setRecoveryBlocked(false);
            } catch (failure) {
              if (current) { setRecoveryBlocked(true); setError(`The pending checkout could not be reconciled. ${errorMessage(failure)}`); }
            }
          }
          try {
            const marker = readFinanceRecovery(operationStorage);
            if (marker?.kind === 'checkout') {
              const saved = unwrap(await api.payments.getCheckout({ sessionId: marker.reference }));
              if (!current) return;
              if (saved.sale) setFinancialReceipt(unwrap(await api.payments.getSaleDetails({ saleId: saved.sale.id })));
              else if (saved.session.status === 'cancelled') clearFinanceRecovery(operationStorage, 'checkout', marker.reference);
              else { setActiveCheckout(saved); setCheckoutOpen(true); setCheckoutRecovery(true); }
            } else if (marker?.kind === 'refund') {
              const details = unwrap(await api.payments.getSaleDetails({ saleId: marker.reference }));
              if (!current) return;
              setFinancialReceipt(details);
              const saved = details.refundAttempts.find((candidate) => candidate.id === marker.attemptId) ?? details.refundAttempts.find((candidate) => ['prepared', 'reported', 'uncertain'].includes(candidate.status));
              setRefundRecovery(saved ?? null);
              if (!saved) { setModernBlocked(true); setError('The saved refund reference needs investigation. Inspect the sale and reconciliation history before preparing another refund.'); }
            } else {
              const saved = unwrap(await api.payments.getActiveCheckout({}));
              if (!current) return;
              if (saved) { setActiveCheckout(saved); setCheckoutOpen(true); setCheckoutRecovery(true); }
            }
          } catch (failure) {
            setModernBlocked(true);
            setError(`The financial recovery reference could not be verified. ${errorMessage(failure)}`);
          }
        }
      } catch (failure) {
        if (current) setError(errorMessage(failure));
      } finally {
        if (current) setLoading(false);
      }
    };
    void initialize();
    return () => { current = false; };
  }, [api, loadCart]);

  const perform = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await operation(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }, [busy]);

  useEffect(() => {
    if (attempt === null) return;
    const previous = document.activeElement;
    checkoutDialog.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [attempt?.idempotencyKey]);

  const locked = previewSale !== null || busy || loading || api === undefined || pendingCheckout?.status === 'confirmed' || confirmationSent || recoveryBlocked || receipt !== null || financialReceipt !== null || activeCheckout?.session.status === 'open' || modernBlocked;
  let received: number | null = null;
  let invalidCash = false;
  try { if (cash !== '') received = parseChfInput(cash); } catch { invalidCash = true; }
  const cashPreview = attempt !== null && received !== null ? previewCash(attempt.amountDueRappen, received) : null;
  const recovering = confirmationSent || attempt?.status === 'confirmed';

  const historySaleRemoved = (saleId: string): void => {
        if (financialReceipt?.sale.id === saleId) {
          const marker = readFinanceRecovery(operationStorage);
          if (marker?.kind === 'checkout' && marker.reference === financialReceipt.sale.checkoutSessionId || marker?.kind === 'refund' && marker.reference === saleId) clearFinanceRecovery(operationStorage, marker.kind, marker.reference);
          if (financialReceipt.sale.source === 'legacy' && readCashRecovery(operationStorage)?.idempotencyKey === financialReceipt.sale.checkoutSessionId) clearCashRecovery(operationStorage, financialReceipt.sale.checkoutSessionId);
          setFinancialReceipt(null); setRefundRecovery(null);
        }
        if (receipt?.id === saleId) { if (readCashRecovery(operationStorage)?.idempotencyKey === receipt.idempotencyKey) clearCashRecovery(operationStorage, receipt.idempotencyKey); setReceipt(null); }
        if (activeCheckout?.sale?.id === saleId) { setActiveCheckout(null); setCheckoutOpen(false); }
        void perform(loadCart);
      };
  const navigate = (next: ApplicationView): void => {
    setApplicationNavigationExpanded(false);
    setView(next);
    setError(null);
    if (next !== 'pos') setCartOpen(false);
  };
  const catalogImported = (): void => { setCatalogVersion((value) => value + 1); };

  const mutateCart = (operation: () => Promise<Result<Cart>>, message = 'Cart saved.'): void => {
    void perform(async () => { unwrap(await operation()); await loadCart(); setFeedback(message); });
  };

  const payAcceptedOrder=async():Promise<void>=>{
    if(!api)return;await loadCart();const current=unwrap(await api.pos.getCart({})).cart;const prepared=unwrap(await api.payments.startCheckout({cartId:current.id,expectedRevision:current.revision}));saveFinanceRecovery(operationStorage,{kind:'checkout',reference:prepared.session.id,attemptId:null,confirmationSubmitted:false});setOrdersPayOpen(false);setFinancialReceipt(null);setReceipt(null);navigate('pos');setActiveCheckout(prepared);setCheckoutRecovery(false);setCheckoutOpen(true);
  };
  const prepare = (): void => {
    if (api === undefined || cart === null) return;
    void perform(async () => {
      const prepared = unwrap(await api.payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
      try { saveFinanceRecovery(operationStorage, { kind: 'checkout', reference: prepared.session.id, attemptId: null, confirmationSubmitted: false }); }
      catch { throw new RequestFailure('RECOVERY_STORAGE', 'The checkout recovery reference could not be saved. Payment confirmation is unavailable.'); }
      setActiveCheckout(prepared); setCheckoutRecovery(false); setCheckoutOpen(true);
    });
  };

  const complete = (): void => {
    if (api === undefined || attempt === null || busy) return;
    const cashReceivedRappen = recovering ? frozenReceived ?? attempt.cashReceivedRappen : received;
    if (cashReceivedRappen === null || (!recovering && !operatorConfirmed)) return;
    let completion;
    try { completion = submitCashConfirmation(api.pos, operationStorage, { idempotencyKey: attempt.idempotencyKey, cashReceivedRappen, operatorConfirmed: true }); }
    catch {
      setCheckoutError('The recovery reference could not be saved. The sale was not submitted. Do not take additional cash.');
      return;
    }
    setFrozenReceived(cashReceivedRappen);
    setConfirmationSent(true);
    setCheckoutError(null);
    void perform(async () => {
      try {
        const sale = unwrap(await completion);
        setReceipt(sale);
        setView('pos');
        setAttempt(null);
        setPendingCheckout(null);
        setConfirmationSent(false);
        setFrozenReceived(null);
        setCartOpen(false);
        await loadCart();
      } catch (failure) {
        setCheckoutError(errorMessage(failure));
      }
    });
  };

  const reconcile = (): void => {
    if (api === undefined || attempt === null) return;
    setCheckoutError(null);
    void perform(async () => {
      try {
        const result = unwrap(await api.pos.reconcileCheckout({ idempotencyKey: attempt.idempotencyKey }));
        if (result.sale !== null) {
          setReceipt(result.sale);
          setView('pos');
          setAttempt(null);
          setPendingCheckout(null);
          setConfirmationSent(false);
          setFrozenReceived(null);
          setCartOpen(false);
          await loadCart();
        } else {
          setAttempt(result.attempt);
          setFrozenReceived(result.attempt.cashReceivedRappen ?? frozenReceived);
          setCheckoutError('No completed sale was found. Retry this same confirmation without taking cash again.');
        }
      } catch (failure) { setCheckoutError(errorMessage(failure)); }
    });
  };

  const registerVisible = view === 'pos' && receipt === null && financialReceipt === null;
  const payable = modernBlocked || recoveryBlocked || loading ? null : cartPayableRappen(cart, activeCheckout, pendingCheckout);
  return (
    <>{demoMode && <DemoBanner />}<div className={registerVisible ? 'pos-shell pos-register' : 'pos-shell'} data-input-mode={inputMode}>
      <aside className="pos-sidebar" aria-label={t("Register navigation")}>
        <div className="pos-brand">
          <img src={logo.src} srcSet={logo.srcSet} alt="Cash Sloth V3 logo" width={72} height={72} />
          <div className="pos-brand-name"><strong>Cash Sloth V3</strong><br /><small>{t("THE OFFLINE REGISTER")}</small></div>
        </div>
        <div className="pos-category-layer" inert={categoryInteractionBlocked} aria-hidden={categoryInteractionBlocked || undefined}>
          {view === 'pos' && receipt === null && financialReceipt === null && api && <PosCategoryBrowser key={catalogVersion} api={api.catalog} state={productBrowserState} onStateChange={setProductBrowserState} />}
        </div>
        <ApplicationNavigation view={view} onNavigate={navigate} expanded={applicationNavigationExpanded} onExpandedChange={setApplicationNavigationExpanded} onInteractionBlockedChange={setCategoryInteractionBlocked} developmentAllowed={demoAllowed} />
      </aside>

      {view === 'orders' ? api?.orders ? <OrdersView api={api.orders} onAccepted={payAcceptedOrder}/> : <p>{t('Orders are unavailable on this host.')}</p> : view === 'promotions' ? api?.promotions ? <PromotionManager api={api}/> : <p>Gutscheine nicht verfügbar.</p> : view === 'team' ? api ? <TeamStatistics tickets={api.tickets} api={api.payments} /> : null : view === 'tickets' ? api?.tickets ? <TicketsView admin={api.tickets} api={api.tickets} ticketdesk={api.ticketdesk} /> : <p>{t('Tickets are unavailable on this host.')}</p> : view === 'presets' ? api ? <PresetsView api={api.presets} onChanged={(state) => {
        setEventTitle(state.active?.name ?? null); setCustomLogo(state.active?.logo ?? null); setCatalogVersion((value) => value + 1); setProductBrowserState(initialProductBrowserState);
        try { if (!readFinanceRecovery(operationStorage) && !readCashRecovery(operationStorage)) { setFinancialReceipt(null); setReceipt(null); setRefundRecovery(null); } }
        catch { setError(t('The preset operation could not be confirmed. Check its stored result before continuing.')); }
      }} onCatalog={() => navigate('catalog')} /> : <p>{t('The desktop bridge is unavailable.')}</p> : view === 'settings' ? <Settings orders={api?.orders} ticketdesk={api?.ticketdesk} demo={api?.demo} demoMode={demoMode} customerDisplay={api?.customerDisplay} /> : view === 'system' ? <div className="pos-system-status"><FoundationStatus api={api} logo={logo} showBranding={false} />{capabilityError && <p role="alert" className="pos-error">{capabilityError}</p>}</div> : view === 'catalog' ? <div className="catalog-workspace">{api ? <CatalogEditor key={catalogVersion} api={api.catalog} reviewRequired={catalogReviewRequired} onReviewRequiredChange={setCatalogReviewRequired} /> : <p className="pos-error" role="alert">{t("The desktop bridge is unavailable.")}</p>}</div> : view === 'import' ? api ? <CatalogImport api={api} onImported={catalogImported} /> : <p role="alert">{t("The desktop bridge is unavailable.")}</p> : view === 'development' ? api ? <DevelopmentTools api={api} onImported={catalogImported} /> : <p role="alert">{t("The desktop bridge is unavailable.")}</p> : view === 'sales' ? api ? <SalesHistory demoMode={demoMode} api={api} onRemoved={historySaleRemoved} onCleared={(scope, eventId) => {
        if (financialReceipt && (scope === 'device' || (financialReceipt.sale.eventId ?? null) === eventId)) historySaleRemoved(financialReceipt.sale.id);
        if (receipt && (scope === 'device' || eventId === null)) historySaleRemoved(receipt.id);
      }} savedState={salesHistoryState} onStateChange={setSalesHistoryState} onOpen={async (saleId) => {
        if (busy) return;
        setBusy(true);
        try { const details = unwrap(await api.payments.getSaleDetails({ saleId })); setReceipt(null); setRefundRecovery(null); setFinancialReceipt(details); setCartOpen(false); setView('pos'); }
        finally { setBusy(false); }
      }} /> : <p role="alert">{t("The desktop bridge is unavailable.")}</p> : view === 'reconciliation' ? api ? <ReconciliationView api={api.payments} onResolved={() => {
        void perform(async () => {
          await loadCart(false);
          const legacy = unwrap(await api.pos.getCart({}));
          if (legacy.pendingCheckout?.status !== 'confirmed') {
            setAttempt(null); setConfirmationSent(false); setFrozenReceived(null);
            const cashMarker = readCashRecovery(operationStorage);
            if (cashMarker) {
              const history = unwrap(await api.payments.listReconciliationHistory({}));
              if (history.some((action) => action.kind === 'legacy' && action.referenceId === cashMarker.idempotencyKey && action.resolution !== 'confirm-recorded')) {
                clearCashRecovery(operationStorage, cashMarker.idempotencyKey); setRecoveryBlocked(false);
              }
            }
          }
          const saved = unwrap(await api.payments.getActiveCheckout({}));
          setActiveCheckout(saved);
          const marker = readFinanceRecovery(operationStorage);
          if (marker?.kind === 'checkout') {
            const checked = unwrap(await api.payments.getCheckout({ sessionId: marker.reference }));
            if (checked.sale || checked.session.status === 'cancelled') { clearFinanceRecovery(operationStorage, 'checkout', marker.reference); setModernBlocked(false); }
          } else if (marker?.kind === 'refund' && marker.attemptId) {
            const checked = unwrap(await api.payments.getRefundAttempt({ attemptId: marker.attemptId }));
            if (['completed', 'failed', 'excluded'].includes(checked.status)) { clearFinanceRecovery(operationStorage, 'refund', marker.reference); setModernBlocked(false); }
          }
        });
      }} /> : <p className="pos-error" role="alert">{t("The desktop bridge is unavailable.")}</p> : <>
        <main className="pos-content">
          <header className="pos-heading">
            <div className="pos-event-heading">{customLogo && <img className="pos-event-logo" src={customLogo.dataUrl} alt={t('Custom logo')} />}<div><span className="pos-label">{t("Point of sale")}</span><h1>{eventTitle ?? 'Cash Sloth V3'}</h1><p>{t("Choose a product to begin a sale.")}</p></div></div>
            <span className="cash-badge">{t("CHF · CASH / CARD / TWINT")}</span>
          </header>
          {api === undefined && <div className="pos-error" role="alert">{t("The desktop bridge is unavailable. Open Cash Sloth through Electron.")}</div>}
          {error !== null && <div className="pos-error" role="alert">{error}</div>}
          {loading && <p role="status" className="pos-status">{t("Loading the catalog and saved cart…")}</p>}
          {busy && <p role="status" className="pos-status">{t("Saving…")}</p>}
          <p className="cart-feedback" role="status" aria-live="polite">{feedback}</p>
          {financialReceipt !== null && api ? <FinancialSaleDetails key={`${financialReceipt.sale.id}:${refundRecovery?.id ?? ''}`} ticketsApi={api.tickets} api={api.payments} historyApi={api.history} initial={financialReceipt} recoveryAttempt={refundRecovery} onDetailsChanged={setFinancialReceipt} onReconciliation={() => { setCheckoutOpen(false); navigate('reconciliation'); }} onNewSale={() => {
            try {
              const marker = readFinanceRecovery(operationStorage);
              if (marker?.kind === 'checkout') clearFinanceRecovery(operationStorage, 'checkout', financialReceipt.sale.checkoutSessionId);
              else if (marker?.kind === 'refund') throw new Error('Review the pending refund first.');
              if (financialReceipt.sale.source === 'legacy') clearCashRecovery(operationStorage, financialReceipt.sale.checkoutSessionId);
            } catch { setError('A financial recovery reference still needs review. Acknowledge the matching refund or checkout before starting another sale.'); return; }
            setFinancialReceipt(null); setRefundRecovery(null); setModernBlocked(false); void perform(loadCart);
          }} /> : receipt !== null ? <SaleReceipt sale={receipt} onNewSale={() => {
            try { clearCashRecovery(operationStorage, receipt.idempotencyKey); }
            catch { setError('The completed receipt could not be acknowledged locally. Keep this receipt open and restart to reconcile.'); return; }
            setReceipt(null); setRecoveryBlocked(false); void perform(loadCart);
          }} /> : <>
            {api && <ProductBrowser key={catalogVersion} api={api.catalog} cart={cart} state={productBrowserState} onStateChange={setProductBrowserState} disabled={locked || cart === null} onAdd={(variantId, label) => {
              if (locked || cart === null) return;
              mutateCart(() => api.pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId }), `Added ${label}.`);
            }} />}
          </>}
        </main>

        <aside id="register-cart" className={`cart-panel${cartOpen ? '' : ' drawer-closed'}`} aria-label={t("Shopping cart")}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && cartOpen && drawerClose.current?.getClientRects().length) {
              event.preventDefault();
              closeCartDrawer();
            }
          }}>
          <div className="cart-panel-header"><h2>{t("Current cart")}</h2><button ref={drawerClose} type="button" className="subtle-button cart-drawer-close" onClick={closeCartDrawer}>{t("Close cart")}</button></div>
          <div className="cart-lines" role="region" aria-label={t("Cart items")} tabIndex={0}>
          {pendingCheckout?.status === 'confirmed' && <div className="recovery-notice">{t("A cash confirmation needs to be checked before editing this cart.")}<button type="button" className="subtle-button" onClick={() => { setAttempt(pendingCheckout); setFrozenReceived(pendingCheckout.cashReceivedRappen); setConfirmationSent(true); }}>{t("Review pending payment")}</button></div>}
          {activeCheckout?.session.status === 'open' && <div className="recovery-notice">{t("An existing checkout owns this cart. Its confirmed payments are retained.")}<button type="button" id="resume-checkout" className="subtle-button" onClick={() => { setCheckoutRecovery(true); setCheckoutOpen(true); }}>{t("Resume checkout")}</button></div>}
          {cart?.items.length === 0 && <div className="pos-empty">{t("Your cart is empty.")}<br />{t("Select a product to add it.")}</div>}
          {groupCartLines(cart?.items ?? []).map((group) => <section className="cart-product-group" key={group.productId} aria-label={`Cart product ${group.name}`}>
            {group.items.length > 1 && <h3 className="cart-group-heading">{group.name}<small>{group.items.length}{' '}{t("separate lines")}</small></h3>}
            {group.items.map((item) => <article className="cart-line" key={item.id}>
            <div className="cart-line-heading"><strong>{cartLineLabel(item)}</strong><span>{formatChf(item.lineTotalRappen)}</span></div>
            <small>{item.variantName === 'Default' && <>{variantLabel(item.variantName)} · </>}{formatChf(item.unitPriceRappen)}{' '}{t("each")}</small>
            <div className="cart-line-controls">
              <QuantityControl item={item} disabled={locked||item.originalUnitPriceRappen!==undefined} onError={setError} onQuantity={(quantity) => {
                if (api === undefined || cart === null) return;
                mutateCart(() => api.pos.setQuantity({ cartId: cart.id, expectedRevision: cart.revision, lineId: item.id, quantity }));
              }} />
              <button type="button" className="remove-line" aria-label={`Remove ${cartLineLabel(item)}`} disabled={locked} onClick={() => {
                if (api === undefined || cart === null) return;
                mutateCart(() => api.pos.removeItem({ cartId: cart.id, expectedRevision: cart.revision, lineId: item.id }));
              }}>{t("Remove")}</button>
            </div>
          </article>)}</section>)}</div>
          <div className="cart-summary"><div className="cart-order-tools">{api?.orders&&<button type="button" disabled={locked} onClick={()=>setOrdersPayOpen(true)}>{t("Pay orders")}</button>}{api?.promotions&&cart&&<CartDiscounts api={api.promotions} cart={cart} disabled={locked} onChanged={loadCart}/>}</div>{api?.orders&&cart&&orderSettings?.tableService&&<TableBooking api={api.orders} cart={cart} disabled={locked} onChanged={loadCart}/>}
            <div className="cart-total"><span>{t("Subtotal")}</span><strong data-testid="cart-subtotal">{formatChf(cart?.subtotalRappen ?? 0)}</strong></div>
            {registerVisible && <div className="cart-total"><span>{t("Payable total")}</span><strong data-testid="cart-payable">{payable === null ? '—' : formatChf(payable)}</strong></div>}
            <button type="button" id="start-checkout" className="primary-button" disabled={locked || cart === null || cart.items.length === 0} onClick={prepare}>{t("Checkout")}</button>
            <button type="button" className="subtle-button clear-cart" disabled={locked || cart === null || cart.items.length === 0} onClick={() => setConfirmClear(true)}>{t("Clear cart")}</button>
            <p className="cart-caption">{t("Draft prices stay fixed. Existing lines remain valid if a product is later deactivated; newly added items use current active variants.")}</p>
          </div>
        </aside>
        {registerVisible && <button ref={drawerToggle} type="button" className="cart-drawer-toggle" aria-controls="register-cart" onClick={() => setCartOpen(true)} aria-expanded={cartOpen}><span>{t("Open cart")}</span><strong>{formatChf(cart?.subtotalRappen ?? 0)}</strong></button>}
      </>}

      {confirmClear && <Modal title={t("Clear cart?")} onClose={() => { if (!busy) setConfirmClear(false); }}>
        <p className="dialog-description">{t("Remove all items from this draft? Saved sales are not changed.")}</p>
        <div className="form-actions"><button type="button" className="primary-button" disabled={locked || cart === null || api === undefined} onClick={() => {
          if (!api || !cart || locked) return;
          setConfirmClear(false); mutateCart(() => api.pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision }), 'Cart cleared.');
        }}>{t("Confirm clear cart")}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => setConfirmClear(false)}>{t("Cancel")}</button></div>
      </Modal>}

      {previewSale && <ReceiptPreview historyApi={api?.history} ticketsApi={api?.tickets} sale={previewSale} afterSale onClose={() => {
        setPreviewSale(null); setFeedback(t('Transaction completed. Ready for the next sale.'));
        window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.product-card:not([aria-disabled="true"])')?.focus());
      }} />}
      {ordersPayOpen&&api?.orders&&<Modal title={t("Pay orders")} className="order-payment-dialog" onClose={()=>setOrdersPayOpen(false)}><OrdersView api={api.orders} paymentOnly onAccepted={payAcceptedOrder}/></Modal>}
      {checkoutOpen && activeCheckout && api && <PaymentsCheckout promotions={api.promotions} customerDisplay={api.customerDisplay} cashNoteArtwork={cashNoteArtwork} cashArtwork={cashArtwork} key={activeCheckout.session.id} api={api.payments} initial={activeCheckout} recovery={checkoutRecovery} onChanged={(next) => { setActiveCheckout(next.session.status === 'open' ? next : null); }} onClose={() => { setCheckoutOpen(false); void loadCart(); }} onReconciliation={() => { setCheckoutOpen(false); navigate('reconciliation'); }} onComplete={async (sale, returnToRegister = false) => {
        if (returnToRegister) {
          await loadCart();
          clearFinanceRecovery(operationStorage, 'checkout', sale.checkoutSessionId);
          setFinancialReceipt(null); setRefundRecovery(null); setReceipt(null); setView('pos'); setActiveCheckout(null); setCheckoutOpen(false); setCartOpen(false); setModernBlocked(false); setCheckoutRecovery(false);
          setPreviewSale(sale);
          setFeedback(t('Sale completed'));
          return;
        }
        const details = unwrap(await api.payments.getSaleDetails({ saleId: sale.id }));
        setFinancialReceipt(details); setRefundRecovery(null); setReceipt(null); setView('pos'); setActiveCheckout(null); setCheckoutOpen(false); setCartOpen(false); await loadCart();
      }} />}

      {attempt !== null && <div className="checkout-backdrop">
        <section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title" ref={checkoutDialog} tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const controls = checkoutDialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
            const first = controls?.[0];
            const last = controls?.[controls.length - 1];
            if (first && last && (event.shiftKey && (document.activeElement === first || document.activeElement === checkoutDialog.current) || !event.shiftKey && document.activeElement === last)) {
              event.preventDefault(); (event.shiftKey ? last : first).focus();
            }
          }
        }}>
          <span className="pos-label">{recovering ? t("Payment recovery") : t("Cash payment")}</span><h2 id="checkout-title">{recovering ? t("Check cash confirmation") : t("Cash checkout")}</h2>
          <dl className="checkout-summary"><dt>{t("Subtotal")}</dt><dd>{formatChf(attempt.subtotalRappen)}</dd><dt>{t("Cash rounding")}</dt><dd>{signedChf(attempt.roundingAdjustmentRappen)}</dd><dt className="amount-due">{t("Amount due")}</dt><dd className="amount-due" data-testid="checkout-amount-due">{formatChf(attempt.amountDueRappen)}</dd></dl>
          {checkoutError !== null && <div className="pos-error" role="alert">{checkoutError}</div>}
          {recovering ? <>
            <div className="recovery-notice">{t("The sale has not been confirmed on this screen. Check the stored result first. If it is still pending, retry the same confirmation. Do not take the cash a second time.")}<code>{attempt.idempotencyKey}</code></div>
            <p className="pos-status">{t("Cash amount recorded for this attempt:")}{' '}{formatChf(frozenReceived ?? attempt.cashReceivedRappen ?? 0)}</p>
            <div className="checkout-actions"><button type="button" className="primary-button" disabled={busy} onClick={reconcile}>{t("Check stored result")}</button><button type="button" className="subtle-button" disabled={busy || (frozenReceived === null && attempt.cashReceivedRappen === null)} onClick={complete}>{t("Retry same confirmation")}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => { setAttempt(null); setConfirmationSent(false); navigate('reconciliation'); }}>{t("Open reconciliation")}</button></div>
          </> : <>
            <label className="cash-field">{t("Cash received (CHF)")}<input autoFocus type="text" inputMode="decimal" aria-label={t("Cash received (CHF)")} placeholder="0.00" value={cash} disabled={busy} onChange={(event) => { setCash(event.target.value); setOperatorConfirmed(false); }} /></label>
            <div className="quick-cash">{[attempt.amountDueRappen, 1000, 2000, 5000, 10000].filter((amount, index, all) => amount >= attempt.amountDueRappen && all.indexOf(amount) === index).map((amount) => <button type="button" key={amount} disabled={busy} onClick={() => { setCash(cashInput(amount)); setOperatorConfirmed(false); }}>{amount === attempt.amountDueRappen ? t("Exact amount") : formatChf(amount)}</button>)}</div>
            {invalidCash && <p role="alert" className="pos-error">{t("Enter a valid CHF amount with at most two decimal places.")}</p>}
            <div className={`cash-change${cashPreview !== null && !cashPreview.sufficient ? ' insufficient' : ''}`}><span>{cashPreview !== null && !cashPreview.sufficient ? t("Still required") : t("Change")}</span><strong data-testid="cash-change">{formatChf(cashPreview === null ? 0 : cashPreview.sufficient ? cashPreview.changeRappen : cashPreview.remainingRappen)}</strong></div>
            <label className="operator-confirmation"><input type="checkbox" checked={operatorConfirmed} disabled={busy || cashPreview?.sufficient !== true} onChange={(event) => setOperatorConfirmed(event.target.checked)} />{t("I confirm that the cash was received")}</label>
            <div className="checkout-actions"><button type="button" className="primary-button" disabled={busy || !operatorConfirmed || cashPreview?.sufficient !== true} onClick={complete}>{t("Complete sale")}</button><button type="button" className="subtle-button" disabled={busy || operatorConfirmed} onClick={() => {
              try { clearCashRecovery(operationStorage, attempt.idempotencyKey); }
              catch { setCheckoutError('The unused checkout reference could not be cleared. Keep this checkout open.'); return; }
              setAttempt(null); setCheckoutError(null);
            }}>{t("Return to cart")}</button></div>
          </>}
        </section>
      </div>}
    </div></>
  );
}
