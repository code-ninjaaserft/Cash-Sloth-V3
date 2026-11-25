import {ReceiptBarcode} from './receipt-barcode.js';
import {OrderReference} from './order-reference.js';
import { TicketBatch } from './ticket-preview.js';
import React from 'react';
import type { HistoryApi, FinancialSale, TicketsApi } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';
import { Modal } from './modal.js';
import { cartLineLabel } from './catalog-ui.js';
import { localeTag, t } from './preferences.js';
import { paymentMethodLabel, signedChf } from './payment-components.js';

/** Display only committed, immutable sale values; never recalculate catalog prices. */
export function ReceiptPreview({ sale, historyApi, ticketsApi, afterSale = false, onClose }: {
  sale: FinancialSale; historyApi?:HistoryApi|undefined; ticketsApi?: TicketsApi | undefined; afterSale?: boolean; onClose: () => void;
}): React.JSX.Element {
  return <Modal title={t('Receipt preview')} className="receipt-preview-dialog" onClose={onClose}>
    <p className="receipt-preview-hint">{t('80 mm receipt preview. Printer connection will be added later.')}</p>
    <div className="receipt-paper-surround"><article className="receipt-paper" aria-label={t('Receipt')}>
      <header><strong>{sale.eventTitle ?? 'Cash Sloth V3'}</strong><span>{t('Receipt')}</span></header>
      <p className="receipt-paper-meta">{new Date(sale.completedAt).toLocaleString(localeTag(), { timeZone: 'Europe/Zurich' })}<br />{t('Sale identifier')}: {sale.id}</p>
      <OrderReference order={sale.order}/><div className="receipt-paper-items">{sale.items.map((item) => <div key={item.id} className="receipt-paper-item"><strong>{cartLineLabel(item)}</strong>{item.discountLabel&&<p>{item.discountLabel}: vorher {formatChf(item.originalUnitPriceRappen??item.unitPriceRappen)} pro Stück</p>}<div><span>{item.quantity} × {formatChf(item.unitPriceRappen)}</span><span>{formatChf(item.lineTotalRappen)}</span></div></div>)}</div>
      <dl className="receipt-paper-totals"><dt>{t('Subtotal')}</dt><dd>{formatChf(sale.subtotalRappen)}</dd>
        {(sale.tipRappen ?? 0) > 0 && <><dt>{t('Tip')}</dt><dd>{formatChf(sale.tipRappen ?? 0)}</dd></>}
        {sale.roundingAdjustmentRappen !== 0 && <><dt>{t('Cash rounding')}</dt><dd>{signedChf(sale.roundingAdjustmentRappen)}</dd></>}
        <dt className="receipt-paper-total">{t('Total')}</dt><dd className="receipt-paper-total">{formatChf(sale.actualPaidRappen)}</dd>
      </dl>
      <div className="receipt-paper-payments">{sale.payments.map((payment) => <dl key={payment.attemptId}><dt>{paymentMethodLabel(payment.method)}</dt><dd>{formatChf(payment.amountRappen)}</dd>{payment.cashTenderedRappen !== null && <><dt>{t('Cash received')}</dt><dd>{formatChf(payment.cashTenderedRappen)}</dd><dt>{t('Change returned')}</dt><dd>{formatChf(payment.changeRappen)}</dd></>}</dl>)}</div>
      <ReceiptBarcode api={historyApi} saleId={sale.id}/><footer>{t('Thank you for your purchase!')}</footer>
    </article></div>
    {ticketsApi && <TicketBatch api={ticketsApi} saleId={sale.id} />}
    <div className="receipt-preview-actions"><button type="button" className="primary-button" disabled aria-describedby="receipt-print-unavailable">{t('Print receipt')}</button><button type="button" className="subtle-button" onClick={onClose}>{t(afterSale ? 'Do not print' : 'Close')}</button></div>
    <p id="receipt-print-unavailable" className="receipt-preview-hint">{t('Printing is not available yet.')}</p>
  </Modal>;
}
