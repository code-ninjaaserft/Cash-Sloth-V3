import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { navigateTo } from './navigation-helpers.js';

test('event presets restore prices and keep historical receipt titles across events and restart', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'sloth-event-presets-'));
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await navigateTo(page, 'Presets');
    await page.getByLabel('New event name', { exact: true }).fill('Alpine fair');
    await page.getByRole('button', { name: 'Save current catalog as preset', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Preset saved and active.');
    await page.getByLabel('New event name', { exact: true }).fill('Town festival');
    await page.getByRole('button', { name: 'Save current catalog as preset', exact: true }).click();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('Town festival');
    await navigateTo(page, 'Catalog');
    await page.evaluate(async () => {
      const api = window.cashSloth!; const result = await api.catalog.getProduct({ productId: 'product-chocolate' }); if (!result.ok) throw new Error(result.error.message);
      const product = result.value, variant = product.variants[0]!;
      const changed = await api.catalog.updateVariant({ productId: product.id, variantId: variant.id, expectedProductRevision: product.revision, expectedRevision: variant.revision, name: variant.name, unitPriceRappen: 990, active: variant.active, position: variant.position, sku: variant.sku, barcode: variant.barcode });
      if (!changed.ok) throw new Error(changed.error.message);
    });
    await navigateTo(page, 'Presets');
    await page.getByRole('button', { name: 'Save changes to active preset', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Preset saved and active.');
    await page.getByRole('button', { name: 'Load preset Alpine fair', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm load preset', exact: true }).click();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('Alpine fair');
    await page.screenshot({ path: 'test-results/event-presets.png', animations: 'disabled' });
    await navigateTo(page, 'POS');
    await expect(page.getByRole('heading', { name: 'Alpine fair', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toContainText('CHF 2.47');
    await page.getByRole('button', { name: 'Add Chocolate', exact: true }).click();
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await page.getByRole('button', { name: 'Add cash CHF 5.00', exact: true }).click();
    await page.getByRole('button', { name: 'Complete transaction', exact: true }).click();
    const receipt = page.getByRole('dialog', { name: 'Receipt preview', exact: true });
    await expect(receipt.locator('.receipt-paper header strong')).toHaveText('Alpine fair');
    await expect(receipt.locator('.receipt-paper')).toContainText('CHF 2.45');
    await receipt.getByRole('button', { name: 'Do not print', exact: true }).click();
    const sales = await page.evaluate(async () => window.cashSloth!.payments.listRecentSales({})); if (!sales.ok) throw new Error(sales.error.message); const saleId = sales.value[0]!.id;
    await navigateTo(page, 'Presets');
    await page.getByRole('button', { name: 'Load preset Town festival', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm load preset', exact: true }).click();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('Town festival');
    await navigateTo(page, 'POS'); await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toContainText('CHF 9.90');
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: 'Device history', exact: true }).click();
    await page.getByRole('button', { name: 'Open sale ' + saleId, exact: true }).click();
    await page.getByRole('button', { name: 'View / print receipt', exact: true }).click();
    await expect(receipt.locator('.receipt-paper header strong')).toHaveText('Alpine fair');
    await expect(receipt.locator('.receipt-paper')).toContainText('CHF 2.47');
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    await navigateTo(page, 'Presets');
    await page.getByLabel('New event name', { exact: true }).fill('Blank event');
    await page.getByRole('button', { name: 'Create empty preset', exact: true }).click();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('Blank event');
    await app.close(); app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Blank event', exact: true })).toBeVisible();
    await expect(page.locator('.product-card')).toHaveCount(0);
    await navigateTo(page, 'Presets'); await expect(page.locator('.preset-row')).toHaveCount(3);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
});

test('a saved preset with a lost UI acknowledgement is inspected after restart without creating a duplicate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sloth-preset-recovery-'));
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory } });
  let app = await launch();
  try {
    let page = await app.firstWindow(); await navigateTo(page, 'Presets');
    await page.evaluate(() => { const original = Storage.prototype.removeItem; let once = true; Storage.prototype.removeItem = function(key: string) { if (key === 'cash-sloth.preset-operation.v1' && once) { once = false; throw new Error('Injected acknowledgement failure'); } original.call(this, key); }; });
    await page.getByLabel('New event name', { exact: true }).fill('Saved once');
    await page.getByRole('button', { name: 'Save current catalog as preset', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check pending preset operation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save current catalog as preset', exact: true })).toBeDisabled();
    await app.close(); app = await launch(); page = await app.firstWindow(); await navigateTo(page, 'Presets');
    await expect(page.getByRole('heading', { name: 'Check pending preset operation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check stored result', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('The stored preset result was found.');
    await expect(page.locator('.preset-row')).toHaveCount(1);
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('Saved once');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
});
