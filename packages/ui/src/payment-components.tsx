import { t, localeTag } from './preferences.js';
import React from 'react';
import type { Result } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';

export type DisplayPaymentMethod = 'cash' | 'card' | 'twint' | 'voucher';
export const paymentMethodLabel = (method: DisplayPaymentMethod): string => t(({ cash: 'Cash', card: 'Card', twint: 'TWINT', voucher:'Voucher' })[method]);
export function signedChf(amount: number): string { return amount < 0 ? `−${formatChf(-amount)}` : amount > 0 ? `+${formatChf(amount)}` : formatChf(0); }
export function inputChf(amount: number): string { return formatChf(amount).replace(/^CHF\s+/u, ''); }
export function financialDate(timestamp: string): string { return new Date(timestamp).toLocaleString(localeTag()); }

export class PaymentRequestFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function unwrapPaymentResult<T>(result: Result<T>): T {
  if (!result.ok) throw new PaymentRequestFailure(result.error.code, result.error.message);
  return result.value;
}
export function paymentErrorMessage(error: unknown): string {
  return error instanceof PaymentRequestFailure ? error.message : t("The recorded outcome could not be confirmed. Inspect the stored result before making another payment or refund.");
}

export function PaymentMethodSelector({ value, disabled, onChange, label = 'Payment method' }: {
  value: DisplayPaymentMethod;
  disabled: boolean;
  onChange: (method: DisplayPaymentMethod) => void;
  label?: string;
}): React.JSX.Element {
  return <fieldset className="payment-methods" disabled={disabled}>
    <legend>{t(label)}</legend>
    {(['cash', 'card', 'twint'] as const).map((method) => <button type="button" key={method} aria-pressed={value === method} onClick={() => onChange(method)}>{paymentMethodLabel(method)}</button>)}
  </fieldset>;
}
