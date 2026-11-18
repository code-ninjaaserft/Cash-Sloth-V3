import { navigateTo } from './navigation-helpers.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('managed variants and category search preserve price snapshots through a sale and restart', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-catalog-cart-'));
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
    await navigateTo(page, 'Catalog');
    await page.getByRole('button', { name: 'New category', exact: true }).click();
    await page.getByLabel('Category name', { exact: true }).fill('Drinks');
    await page.getByRole('button', { name: 'Save category', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const rootCategory = await page.evaluate(async () => {
      const result = await window.cashSloth?.catalog.listCategories({ includeInactive: true });
      if (!result?.ok) throw new Error('Cannot read created category');
      return result.value.find((category) => category.name === 'Drinks')?.id;
    });
    if (!rootCategory) throw new Error('Category creation did not persist');
    await page.getByRole('button', { name: 'New category', exact: true }).click();
    await page.getByLabel('Category name', { exact: true }).fill('Tea');
    await page.getByLabel('Parent category', { exact: true }).selectOption(rootCategory);
    await page.getByRole('button', { name: 'Save category', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'New product', exact: true }).click();
    await page.getByLabel('Product name', { exact: true }).fill('Alpine tea');
    await page.getByLabel('Description', { exact: true }).fill('Catalog and snapshot smoke fixture');
    await page.getByLabel('First variant name', { exact: true }).fill('Small');
    await page.getByLabel('Price (CHF)', { exact: true }).fill('3.33');
    await page.getByLabel('SKU', { exact: true }).fill('tea-s');
    await page.getByLabel('Barcode', { exact: true }).fill('7610000000001');
    await page.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add variant', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Assign Drinks', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Assign Drinks / Tea', exact: true }).check();
    await page.getByLabel('Primary category', { exact: true }).selectOption(rootCategory);
    await page.getByRole('button', { name: 'Save categories', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save categories', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Add variant', exact: true }).click();
    const variantDialog = page.getByRole('dialog', { name: 'Add variant', exact: true });
    await variantDialog.getByLabel('Variant name', { exact: true }).fill('Large');
    await variantDialog.getByLabel('Price (CHF)', { exact: true }).fill('5.55');
    await variantDialog.getByLabel('SKU', { exact: true }).fill('tea-l');
    await variantDialog.getByLabel('Barcode', { exact: true }).fill('7610000000002');
    await variantDialog.getByLabel('Variant order', { exact: true }).fill('1');
    await variantDialog.getByRole('button', { name: 'Save variant', exact: true }).click();
    await expect(variantDialog).toHaveCount(0);
    await page.screenshot({ path: 'test-results/mvp-0.2-catalog-editor.png', fullPage: true, animations: 'disabled' });

    await navigateTo(page, 'POS');
    const categoryNavigator = page.getByRole('navigation', { name: 'POS categories', exact: true });
    await categoryNavigator.getByRole('button', { name: 'Drinks', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose Alpine tea', exact: true })).toHaveCount(1);
    await expect(categoryNavigator.getByRole('button', { name: 'Drinks', exact: true }).locator('.pos-category-count')).toHaveText('1');
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('Coffee');
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Restrict search to selected category', exact: true }).check();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Restrict search to selected category', exact: true }).uncheck();
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('tea-s');
    await page.getByRole('button', { name: 'Choose Alpine tea', exact: true }).click();
    await page.getByRole('dialog', { name: 'Choose variant', exact: true }).press('Escape');
    await expect(page.getByRole('button', { name: 'Choose Alpine tea', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Choose Alpine tea', exact: true }).click();
    await page.getByRole('button', { name: 'Add Alpine tea — Small', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Alpine tea', exact: true }).click();
    await page.getByRole('button', { name: 'Add Alpine tea — Large', exact: true }).click();
    const smallQuantity = page.getByRole('spinbutton', { name: 'Quantity for Alpine tea — Small', exact: true });
    await smallQuantity.fill('2');
    await smallQuantity.press('Tab');
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 12.21');

    await navigateTo(page, 'Catalog');
    await page.getByRole('button', { name: 'Edit product Alpine tea', exact: true }).click();
    await page.getByRole('button', { name: 'Edit variant Small', exact: true }).click();
    const priceDialog = page.getByRole('dialog', { name: 'Edit variant', exact: true });
    await priceDialog.getByLabel('Price (CHF)', { exact: true }).fill('4.44');
    await priceDialog.getByRole('button', { name: 'Save variant', exact: true }).click();
    await expect(priceDialog).toHaveCount(0);
    await navigateTo(page, 'POS');
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('7610000000001');
    await page.getByRole('button', { name: 'Choose Alpine tea', exact: true }).click();
    await page.getByRole('button', { name: 'Add Alpine tea — Small', exact: true }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('CHF 16.65');
    const cart = await page.evaluate(async () => window.cashSloth?.pos.getCart({}));
    if (!cart?.ok) throw new Error('Cannot inspect saved cart');
    expect(cart.value.cart.items.map((line) => [line.variantName, line.unitPriceRappen, line.quantity]))
      .toEqual([['Small', 333, 2], ['Large', 555, 1], ['Small', 444, 1]]);
    await page.screenshot({ path: 'test-results/mvp-0.2-pos.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('20.00');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Sale receipt', exact: true });
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('CHF 3.35');
    const saleId = (await page.getByTestId('receipt-sale-id').textContent())?.trim();
    if (!saleId) throw new Error('No committed sale identifier');
    await page.getByRole('button', { name: 'Start new sale', exact: true }).click();
    await application.close(); application = undefined;

    application = await launch();
    page = await application.firstWindow();
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: `Open sale ${saleId}`, exact: true }).click();
    await expect(page.getByTestId('receipt-sale-id')).toHaveText(saleId);
    const persisted = await page.evaluate(async (id) => window.cashSloth?.payments.getSaleDetails({ saleId: id }), saleId);
    if (!persisted?.ok) throw new Error('Cannot retrieve sale after restart');
    expect(persisted.value.sale.items).toEqual(cart.value.cart.items);
    expect(persisted.value.sale.payments[0]?.changeRappen).toBe(335);
    await navigateTo(page, 'Catalog');
    await page.getByRole('button', { name: 'Edit product Alpine tea', exact: true }).click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Alpine tea');
    await expect(page.getByRole('checkbox', { name: 'Assign Drinks / Tea', exact: true })).toBeChecked();
    const catalog = await page.evaluate(async () => window.cashSloth?.catalog.listProducts({ query: 'Alpine tea', categoryId: null, restrictToCategory: false, includeInactive: true }));
    if (!catalog?.ok) throw new Error('Cannot retrieve catalog after restart');
    expect(catalog.value).toHaveLength(1);
    expect(catalog.value[0]?.variants.map((variant) => variant.unitPriceRappen)).toEqual([444, 555]);
    await page.setViewportSize({ width: 800, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/mvp-0.2-editor-compact.png', fullPage: true, animations: 'disabled' });
    console.log('Catalog/variant/category sale survived restart:', saleId);
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});
