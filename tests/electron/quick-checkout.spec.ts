import { navigateTo } from './navigation-helpers.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';

async function launchQuick() {
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-quick-checkout-'));
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ args: [resolve('apps/desktop')], env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory } });
  return { application, cleanup: async () => { await application.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); } };
}
async function openCheckout(page: Page) {
  await page.getByRole('button', { name: 'Add Chocolate', exact: true }).click();
  await page.getByRole('button', { name: 'Checkout', exact: true }).click();
}

test('artwork cash keys add, undo and reset exactly, then commit once and return to the register', async () => {
  const { application, cleanup } = await launchQuick();
  try {
    const page = await application.firstWindow();
    await openCheckout(page);
    await page.screenshot({ path: 'test-results/quick-checkout-choice.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await expect(page.locator('.cash-artwork')).toHaveCount(13);
    await expect(page.getByRole('button', { name: 'Add cash CHF 50.00', exact: true }).locator('img')).toHaveAttribute('src', /cash-note-50-/);
    await expect(page.getByRole('button', { name: 'Add cash CHF 200.00', exact: true }).locator('img')).toHaveAttribute('src', /cash-note-200-/);
    await expect(page.getByRole('button', { name: 'Complete transaction', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Add cash CHF 2.00', exact: true }).click();
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 0.45');
    await page.getByRole('button', { name: 'Add cash CHF 1.00', exact: true }).click();
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 0.55');
    await page.getByRole('button', { name: 'Undo last entry', exact: false }).click();
    await expect(page.getByTestId('quick-cash-received')).toHaveText('CHF 2.00');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByTestId('quick-cash-received')).toHaveText('CHF 0.00');
    await page.getByRole('button', { name: 'Add cash CHF 5.00', exact: true }).click();
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 2.55');
    await page.screenshot({ path: 'test-results/quick-checkout-cash.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Complete transaction', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    const preview = page.getByRole('dialog', { name: 'Receipt preview', exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Print receipt', exact: true })).toBeDisabled();
    await expect(preview.locator('.receipt-paper')).toContainText('CHF 2.47');
    await expect(preview.locator('.receipt-paper')).toContainText('CHF 2.45');
    await expect(preview.locator('.receipt-paper')).toContainText('CHF 5.00');
    await expect(preview.locator('.receipt-paper')).toContainText('CHF 2.55');
    const originalReceipt = await preview.locator('.receipt-paper').textContent();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'test-results/receipt-preview-80mm.png', animations: 'disabled' });
    await preview.getByRole('button', { name: 'Do not print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 0.00');
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeEnabled();
    const sales = await page.evaluate(async () => window.cashSloth?.payments.listRecentSales({}));
    if (!sales?.ok) throw new Error('Cannot read completed sales');
    expect(sales.value).toHaveLength(1);
    expect(sales.value[0]?.payments[0]).toMatchObject({ method: 'cash', cashTenderedRappen: 500, changeRappen: 255 });
    expect(await page.evaluate(() => localStorage.getItem('cash-sloth.financial-recovery.v1'))).toBeNull();
    await page.evaluate(async () => {
      const api = window.cashSloth; if (!api) throw new Error('No desktop API');
      const product = await api.catalog.getProduct({ productId: 'product-chocolate' });
      if (!product.ok) throw new Error(product.error.message);
      const variant = product.value.variants[0]; if (!variant) throw new Error('No variant');
      const changed = await api.catalog.updateVariant({ productId: product.value.id, variantId: variant.id, expectedProductRevision: product.value.revision, expectedRevision: variant.revision, name: variant.name, unitPriceRappen: 999, sku: variant.sku, barcode: variant.barcode, active: variant.active, position: variant.position });
      if (!changed.ok) throw new Error(changed.error.message);
    });
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: 'Open sale ' + sales.value[0]?.id, exact: true }).click();
    await page.getByRole('button', { name: 'View / print receipt', exact: true }).click();
    await expect(preview.locator('.receipt-paper')).toHaveText(originalReceipt ?? '');
    await expect(preview.getByRole('button', { name: 'Print receipt', exact: true })).toBeDisabled();
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toHaveCount(0);
  } finally { await cleanup(); }
});

test('Card and TWINT record the selected exact method and immediately allow the next sale', async () => {
  const { application, cleanup } = await launchQuick();
  try {
    const page = await application.firstWindow();
    for (const method of ['Card', 'TWINT']) {
      await openCheckout(page);
      await page.getByRole('button', { name: 'Card / TWINT', exact: true }).click();
      await page.getByRole('radio', { name: method, exact: true }).check();
      await page.screenshot({ path: 'test-results/quick-checkout-digital.png', animations: 'disabled' });
      await page.getByRole('button', { name: 'Your transaction was completed successfully', exact: true }).click();
      const receipt = page.getByRole('dialog', { name: 'Receipt preview', exact: true });
      await expect(receipt).toBeVisible();
      await expect(receipt.locator('.receipt-paper')).toContainText('CHF 2.47');
      await receipt.getByRole('button', { name: 'Do not print', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toBeEnabled();
    }
    const sales = await page.evaluate(async () => window.cashSloth?.payments.listRecentSales({}));
    if (!sales?.ok) throw new Error('Cannot read sales');
    expect(sales.value).toHaveLength(2);
    expect(sales.value.map((sale) => sale.payments[0]?.method).sort()).toEqual(['card', 'twint']);
    expect(sales.value.every((sale) => sale.actualPaidRappen === 247 && sale.roundingAdjustmentRappen === 0)).toBe(true);
  } finally { await cleanup(); }
});

test('cancel unlocks the cart, while an unconfirmed reply blocks repeats and enters recovery', async () => {
  const { application, cleanup } = await launchQuick();
  try {
    const page = await application.firstWindow();
    await openCheckout(page);
    await page.getByRole('button', { name: 'Return to cart', exact: false }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'Card / TWINT', exact: true }).click();
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('payments:confirmPayment');
      ipcMain.handle('payments:confirmPayment', () => { throw new Error('Injected confirmation failure'); });
    });
    await page.getByRole('button', { name: 'Your transaction was completed successfully', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Payment outcome needs review', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Your transaction was completed successfully', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close Checkout', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Check stored result', exact: true }).click();
    await expect(page.getByText('Payment outcome needs review', { exact: true })).toBeVisible();
    const active = await page.evaluate(async () => window.cashSloth?.payments.getActiveCheckout({}));
    if (!active?.ok || !active.value) throw new Error('Expected recoverable checkout');
    expect(active.value.attempts).toHaveLength(1);
    expect(active.value.attempts[0]?.status).toBe('prepared');
    expect(active.value.sale).toBeNull();
  } finally { await cleanup(); }
});

test('cash, Card and TWINT round-up tips change the total and remain separate on the receipt', async () => {
  const { application, cleanup } = await launchQuick();
  try {
    const page = await application.firstWindow();
    await openCheckout(page); await page.getByRole('button', { name: 'Cash', exact: true }).click();
    const five = page.getByRole('button', { name: 'Round up to next CHF 5', exact: false });
    const ten = page.getByRole('button', { name: 'Round up to next CHF 10', exact: false });
    await page.getByRole('button', { name: 'Add cash CHF 5.00', exact: true }).click();
    await expect(ten).toBeDisabled(); await five.click();
    await expect(page.getByTestId('quick-tip')).toHaveText('CHF 2.55');
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 0.00');
    await page.getByRole('button', { name: 'Add cash CHF 5.00', exact: true }).click(); await ten.click();
    await expect(page.getByTestId('quick-tip')).toHaveText('CHF 7.55');
    await page.getByRole('button', { name: 'Remove tip', exact: true }).click();
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 7.55');
    await five.click(); await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 5.00');
    await page.screenshot({ path: 'test-results/checkout-tip-cash.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Complete transaction', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Receipt preview', exact: true });
    await expect(preview.locator('.receipt-paper')).toContainText('TipCHF 2.55');
    await expect(preview.locator('.receipt-paper')).toContainText('Change returnedCHF 5.00');
    await preview.getByRole('button', { name: 'Do not print', exact: true }).click();
    for (const method of ['Card', 'TWINT']) {
      await openCheckout(page); await page.getByRole('button', { name: 'Card / TWINT', exact: true }).click();
      await page.getByRole('radio', { name: method, exact: true }).check();
      await five.click(); await expect(page.getByTestId('quick-tip')).toContainText('CHF 2.53');
      await page.getByRole('button', { name: 'Your transaction was completed successfully', exact: true }).click();
      await expect(preview.locator('.receipt-paper')).toContainText('TipCHF 2.53');
      await expect(preview.locator('.receipt-paper')).toContainText('TotalCHF 5.00');
      await preview.getByRole('button', { name: 'Do not print', exact: true }).click();
    }
    const sales = await page.evaluate(async () => window.cashSloth!.payments.listRecentSales({}));
    if (!sales.ok) throw new Error(sales.error.message);
    expect(sales.value.map((sale) => sale.actualPaidRappen)).toEqual([500, 500, 500]);
    expect(sales.value.map((sale) => sale.tipRappen).sort()).toEqual([253, 253, 255]);
  } finally { await cleanup(); }
});

test('custom tips and desired totals validate input and update cash change and digital receipts', async () => {
  const { application, cleanup } = await launchQuick();
  try {
    const page = await application.firstWindow();
    await openCheckout(page); await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await page.getByRole('button', { name: 'Add cash CHF 5.00', exact: true }).click();
    await page.getByRole('button', { name: 'Round up to amount', exact: true }).click();
    const target = page.getByLabel('Desired total (CHF)', { exact: true });
    const apply = page.getByRole('button', { name: 'Apply tip', exact: true });
    await target.fill('2.00'); await expect(apply).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('lower than');
    await target.fill('4.27'); await expect(apply).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('0.05');
    await target.fill('6.00'); await expect(apply).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('exceeds');
    await target.fill('4.25'); await apply.click();
    await expect(page.getByTestId('quick-tip')).toHaveText('CHF 1.80');
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 0.75');
    await page.getByRole('button', { name: 'Custom tip', exact: true }).click();
    await page.getByLabel('Tip amount (CHF)', { exact: true }).fill('0.15'); await apply.click();
    await expect(page.getByTestId('quick-tip')).toHaveText('CHF 0.15');
    await expect(page.getByTestId('quick-cash-change')).toHaveText('CHF 2.40');
    await page.getByRole('button', { name: 'Complete transaction', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Receipt preview', exact: true });
    await expect(preview.locator('.receipt-paper')).toContainText('TipCHF 0.15');
    await expect(preview.locator('.receipt-paper')).toContainText('TotalCHF 2.60');
    await preview.getByRole('button', { name: 'Do not print', exact: true }).click();
    await openCheckout(page); await page.getByRole('button', { name: 'Card / TWINT', exact: true }).click();
    await page.getByRole('radio', { name: 'TWINT', exact: true }).check();
    await page.getByRole('button', { name: 'Custom tip', exact: true }).click();
    await page.getByLabel('Tip amount (CHF)', { exact: true }).fill('1,23'); await apply.click();
    await expect(page.getByTestId('quick-tip')).toContainText('CHF 1.23');
    await page.getByRole('button', { name: 'Round up to amount', exact: true }).click();
    await target.fill('4.27');
    await page.screenshot({ path: 'test-results/custom-tip.png', fullPage: true, animations: 'disabled' });
    await apply.click(); await expect(page.getByTestId('quick-tip')).toContainText('CHF 1.80');
    await page.getByRole('button', { name: 'Your transaction was completed successfully', exact: true }).click();
    await expect(preview.locator('.receipt-paper')).toContainText('TipCHF 1.80');
    await expect(preview.locator('.receipt-paper')).toContainText('TotalCHF 4.27');
    await preview.getByRole('button', { name: 'Do not print', exact: true }).click();
  } finally { await cleanup(); }
});
