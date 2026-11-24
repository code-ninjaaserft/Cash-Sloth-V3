import { navigateTo } from './navigation-helpers.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('cash sale survives draft restart, duplicate confirmation and application restart', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-first-sale-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  const launch = async (): Promise<ElectronApplication> => electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory },
  });
  try {
    application = await launch();
    let page = await application.firstWindow();
    await page.getByRole('button', { name: 'Add Coffee', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Coffee', exact: true }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 0.00');
    await page.getByRole('button', { name: 'Add Mineral water', exact: true }).click();
    await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm clear cart', exact: true }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 0.00');
    await page.getByRole('button', { name: 'Add Chocolate', exact: true }).click();
    const quantity = page.getByRole('spinbutton', { name: 'Quantity for Chocolate' });
    await expect(quantity).toHaveValue('1');
    await quantity.fill('2');
    await quantity.press('Tab');
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 4.94');
    await quantity.fill('1');
    await quantity.press('Tab');
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 2.47');
    await application.close();
    application = undefined;

    application = await launch();
    page = await application.firstWindow();
    await expect(page.getByRole('spinbutton', { name: 'Quantity for Chocolate' })).toHaveValue('1');
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 2.47');
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'More payment options', exact: true }).click();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('2.00');
    await expect(page.getByTestId('cash-change')).toContainText('CHF 0.45');
    await expect(page.getByRole('button', { name: 'Complete sale', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('5.00');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Sale receipt' });
    await expect(receipt).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sale completed', exact: true })).toBeVisible();
    for (const amount of ['CHF 2.47', 'CHF 2.45', 'CHF 5.00', 'CHF 2.55']) {
      await expect(receipt).toContainText(amount);
    }
    const saleId = (await page.getByTestId('receipt-sale-id').textContent())?.trim();
    expect(saleId).toBeTruthy();
    if (!saleId) throw new Error('The completed receipt must identify the committed sale');
    const retry = await page.evaluate(async (id) => {
      const api = window.cashSloth;
      if (!api) throw new Error('No host bridge');
      const original = await api.payments.getSaleDetails({ saleId: id });
      if (!original.ok) throw new Error(original.error.message);
      return api.payments.completeCheckout({ sessionId: original.value.sale.checkoutSessionId });
    }, saleId);
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error(retry.error.message);
    expect(retry.value.id).toBe(saleId);
    await page.screenshot({ path: 'test-results/mvp-0.1-receipt.png', fullPage: true });
    await page.getByRole('button', { name: 'Start new sale', exact: true }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 0.00');
    await page.screenshot({ path: 'test-results/mvp-0.1-pos.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 800 });
    await page.getByRole('button', { name: /^Open cart/u }).click();
    await expect(page.getByRole('complementary', { name: 'Shopping cart', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/mvp-0.1-compact.png', fullPage: true });
    await page.getByRole('button', { name: 'Close cart', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Shopping cart', exact: true })).toBeHidden();
    await application.close();
    application = undefined;

    application = await launch();
    page = await application.firstWindow();
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: `Open sale ${saleId}`, exact: true }).click();
    await expect(page.getByTestId('receipt-sale-id')).toHaveText(saleId);
    await expect(page.getByRole('region', { name: 'Sale receipt' })).toContainText('CHF 2.55');
    const sales = await page.evaluate(async () => window.cashSloth?.payments.listRecentSales({}));
    expect(sales?.ok).toBe(true);
    if (!sales?.ok) throw new Error('Unable to retrieve completed sales after restart');
    expect(sales.value).toHaveLength(1);
    console.log('First sale persisted across Electron restarts:', saleId);
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});
