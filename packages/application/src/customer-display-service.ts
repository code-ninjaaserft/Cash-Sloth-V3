import { CUSTOMER_DISPLAY_CONTRACTS, CustomerDisplayStateSchema, type CustomerPaymentPreview, type CustomerDisplayState, type PresetLogo, type Result } from '@cash-sloth/contracts';
import { addMoney, checkoutBalance, DomainError, previewCash, roundCashRappen, validateCart, type Cart, type CheckoutView } from '@cash-sloth/domain';
export interface CustomerDisplaySource {
  transaction<T>(operation: () => T): T;
  getCart(): Cart | null;
  getCheckout(): Pick<CheckoutView, 'session' | 'attempts'> | null;
  getEventLogo?(): PresetLogo | null;
  getEventTitle(): string | null;
}
export function createCustomerDisplayService(source: CustomerDisplaySource) {
  let preview: CustomerPaymentPreview | null = null;
  const safe = <T>(operation: () => T): Result<T> => {
    try { return { ok: true, value: source.transaction(operation) }; }
    catch (failure) { return { ok: false, error: { code: failure instanceof DomainError ? failure.code : 'STORAGE_ERROR', message: 'The customer display could not be updated.' } }; }
  };
  return {
    preview(input: CustomerPaymentPreview) {
      return safe(() => {
        if (!CUSTOMER_DISPLAY_CONTRACTS.preview.request.safeParse(input).success) throw new DomainError('INVALID_INPUT', 'Invalid customer payment preview.');
        const checkout = source.getCheckout();
        if (!checkout || checkout.session.id !== input.sessionId) throw new DomainError('NOT_FOUND', 'Checkout is no longer active.');
        addMoney(checkout.session.cart.subtotalRappen, input.tipRappen); preview = { ...input };
        return { accepted: true as const };
      });
    },
    getState(): Result<CustomerDisplayState> {
      return safe(() => {
        const checkout = source.getCheckout();
        const cart = checkout?.session.cart ?? source.getCart();
        if (cart) validateCart(cart);
        const draft = checkout && preview?.sessionId === checkout.session.id ? preview : null;
        const canChangeTip = !checkout?.attempts.some((attempt) => !['failed', 'excluded'].includes(attempt.status));
        const tipRappen = canChangeTip ? draft?.tipRappen ?? checkout?.session.tipRappen ?? 0 : checkout?.session.tipRappen ?? 0;
        const subtotalRappen = cart?.subtotalRappen ?? 0;
        const balance = checkout ? checkoutBalance(subtotalRappen, checkout.attempts, tipRappen) : null;
        const cashAttempt = checkout?.attempts.find((attempt) => attempt.method === 'cash' && ['prepared', 'reported', 'uncertain', 'confirmed'].includes(attempt.status));
        const totalRappen = cashAttempt ? addMoney(balance?.confirmedDigitalRappen ?? 0, cashAttempt.appliedRappen)
          : draft?.method === 'cash' ? addMoney(balance?.confirmedDigitalRappen ?? 0, roundCashRappen(addMoney(subtotalRappen, tipRappen) - (balance?.confirmedDigitalRappen ?? 0))) : balance?.finalPayableRappen ?? subtotalRappen;
        const tendered = cashAttempt?.cashTenderedRappen ?? (draft?.method === 'cash' ? draft.cashReceivedRappen : null);
        const cash = tendered === null || tendered === undefined ? null : previewCash(Math.max(0, totalRappen - (balance?.confirmedAppliedRappen ?? 0)), tendered);
        return CustomerDisplayStateSchema.parse({ logo: source.getEventLogo?.() ?? null, eventTitle: source.getEventTitle(),
          items: cart?.items.map(({ productName, variantName, quantity, unitPriceRappen, lineTotalRappen }) => ({ productName, variantName, quantity, unitPriceRappen, lineTotalRappen })) ?? [],
          subtotalRappen, tipRappen, roundingAdjustmentRappen: totalRappen - addMoney(subtotalRappen, tipRappen), totalRappen, outstandingRappen: balance ? Math.max(0, totalRappen - balance.confirmedAppliedRappen) : totalRappen,
          cashReceivedRappen: tendered ?? null, changeRappen: cashAttempt?.changeRappen ?? (cash?.sufficient ? cash.changeRappen : null), checkoutActive: checkout !== null });
      });
    },
  };
}
