import { navigateTo } from './navigation-helpers.js';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

function environment(directory: string): Record<string, string> {
  const variables: NodeJS.ProcessEnv = { ...process.env, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory };
  delete variables.ELECTRON_RUN_AS_NODE;
  return Object.fromEntries(Object.entries(variables).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
async function choosePath(application: ElectronApplication, path: string): Promise<void> {
  // Only the privileged test harness substitutes the native chooser's selection.
  // Renderer requests still use the real validated IPC and host filesystem code.
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path);
}
async function acknowledgeImport(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Catalog import completed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge import result', exact: true }).click();
}
async function parsedExport(page: Page, content: string): Promise<Record<string, string>[]> {
  const result = await page.evaluate(async (text) => window.cashSloth?.management.parseCsv({ text, delimiter: ',' }), content);
  if (!result?.ok) throw new Error('The exported CSV must parse as a valid quoted CSV document');
  return result.value.rows.map((row) => Object.fromEntries(result.value.headers.map((header, index) => [header, row.values[index] ?? ''])));
}

test('explicit Swiss demo load, mixed rounding sale, partial refund and filtered export survive restart', async () => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-demo-operations-'));
  const exportParent = join(directory, 'exports'); await mkdir(exportParent);
  let application: ElectronApplication | undefined;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
  try {
    application = await launch(); let page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeEnabled();
    const initial = await page.evaluate(async () => window.cashSloth?.catalog.listProducts({ query: '', categoryId: null, restrictToCategory: false, includeInactive: true }));
    if (!initial?.ok) throw new Error('Cannot inspect isolated starting catalog');
    expect(initial.value).toHaveLength(3);
    await navigateTo(page, 'Development tools');
    await page.getByRole('button', { name: 'Load Demo Catalog', exact: true }).click();
    await expect(page.getByTestId('import-summary-newProducts')).toHaveText('44');
    await expect(page.getByTestId('import-summary-newVariants')).toHaveText('71');
    await expect(page.getByTestId('import-summary-newCategories')).toHaveText('18');
    await expect(page.getByRole('button', { name: 'Confirm demo catalog load', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'test-results/mvp-0.4-demo.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('checkbox', { name: 'I reviewed this catalog plan', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm demo catalog load', exact: true }).click();
    await acknowledgeImport(page);
    await page.getByRole('button', { name: 'Load Demo Catalog', exact: true }).click();
    await expect(page.getByTestId('import-summary-newProducts')).toHaveText('0');
    await expect(page.getByTestId('import-summary-existingMatches')).toHaveText('44');
    await page.getByRole('checkbox', { name: 'I reviewed this catalog plan', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm demo catalog load', exact: true }).click();
    await acknowledgeImport(page);
    const loaded = await page.evaluate(async () => {
      const api = window.cashSloth; if (!api) throw new Error('No register API');
      return { products: await api.catalog.listProducts({ query: '', categoryId: null, restrictToCategory: false, includeInactive: true }), categories: await api.catalog.listCategories({ includeInactive: true }) };
    });
    if (!loaded.products.ok || !loaded.categories.ok) throw new Error('Cannot inspect loaded demo');
    expect(loaded.products.value).toHaveLength(47);
    expect(loaded.products.value.reduce((count, product) => count + product.variants.length, 0)).toBe(74);
    expect(loaded.categories.value).toHaveLength(18);
    expect(loaded.products.value.some((product) => !product.active)).toBe(true);
    expect(loaded.products.value.some((product) => product.variants.some((variant) => !variant.active))).toBe(true);
    const tea = loaded.products.value.find((product) => product.name === 'Iced Tea');
    expect(tea?.variants.map((variant) => variant.unitPriceRappen)).toEqual([300, 300]);

    await navigateTo(page, 'POS');
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('Iced Tea');
    await page.getByRole('button', { name: 'Choose Iced Tea', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add Iced Tea — Lemon', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Iced Tea — Peach', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: 'Choose variant', exact: true }).press('Escape');
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('[TEST] Rounding CHF 2.42');
    await page.getByRole('button', { name: 'Add [TEST] Rounding CHF 2.42', exact: true }).click();
    const quantity = page.getByRole('spinbutton', { name: 'Quantity for [TEST] Rounding CHF 2.42', exact: true });
    await quantity.fill('2'); await quantity.press('Tab');
    await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 4.84');
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'More payment options', exact: true }).click();
    await page.getByRole('button', { name: 'TWINT', exact: true }).click();
    await page.getByRole('textbox', { name: 'Payment amount (CHF)', exact: true }).fill('2.00');
    await page.getByRole('button', { name: 'Review payment', exact: true }).click();
    await page.getByRole('checkbox', { name: 'I confirm the external payment succeeded', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('5.00');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Sale receipt', exact: true })).toContainText('CHF 4.85');
    const saleId = (await page.getByTestId('receipt-sale-id').textContent())?.trim();
    if (!saleId) throw new Error('Missing mixed demo sale identity');
    await page.getByRole('button', { name: 'Refund sale', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Refund quantity for [TEST] Rounding CHF 2.42 — Default', exact: true }).fill('1');
    await page.getByRole('combobox', { name: 'Refund method', exact: true }).selectOption('card');
    await page.getByRole('button', { name: 'Prepare refund', exact: true }).click();
    await page.getByRole('checkbox', { name: 'I confirm the refund was paid', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm refund', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('refundable-balance')).toHaveText('CHF 2.43');
    await navigateTo(page, 'Sales history');
    await page.getByRole('combobox', { name: 'Payment method filter', exact: true }).selectOption('mixed');
    await page.getByRole('combobox', { name: 'Refund status filter', exact: true }).selectOption('partial');
    await page.getByRole('textbox', { name: 'Minimum total (CHF)', exact: true }).fill('4.85');
    await page.getByRole('textbox', { name: 'Maximum total (CHF)', exact: true }).fill('4.85');
    await page.getByRole('searchbox', { name: 'Product or variant', exact: true }).fill('Rounding');
    await page.getByRole('button', { name: 'Apply history filters', exact: true }).click();
    await expect(page.getByTestId('history-result-count')).toHaveText('1 matching sales');
    await expect(page.getByRole('button', { name: `Open sale ${saleId}`, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 800, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/mvp-0.4-history.png', fullPage: true, animations: 'disabled' });
    await choosePath(application, exportParent);
    await page.getByRole('button', { name: 'Export filtered history', exact: true }).click();
    await expect(page.getByText(/^Exported 1 sales to /u)).toBeVisible();
    const exports = await readdir(exportParent); expect(exports).toHaveLength(1);
    const bundle = join(exportParent, exports[0] ?? 'missing');
    expect((await readdir(bundle)).sort()).toEqual(['payments.csv', 'refund_items.csv', 'refunds.csv', 'sale_items.csv', 'sales.csv']);
    const sales = await parsedExport(page, await readFile(join(bundle, 'sales.csv'), 'utf8'));
    const payments = await parsedExport(page, await readFile(join(bundle, 'payments.csv'), 'utf8'));
    const refunds = await parsedExport(page, await readFile(join(bundle, 'refunds.csv'), 'utf8'));
    const refundItems = await parsedExport(page, await readFile(join(bundle, 'refund_items.csv'), 'utf8'));
    expect(sales).toHaveLength(1); expect(sales[0]).toMatchObject({ sale_id: saleId, paid_rappen: '485', refunded_rappen: '242', remaining_refundable_rappen: '243', payment_method: 'mixed', refund_status: 'partial' });
    expect(payments.map((payment) => [payment.sale_id, payment.method, payment.applied_rappen])).toEqual([[saleId, 'twint', '200'], [saleId, 'cash', '285']]);
    expect(refunds).toHaveLength(1); expect(refunds[0]).toMatchObject({ sale_id: saleId, method: 'card', amount_rappen: '242' });
    expect(refundItems[0]).toMatchObject({ sale_id: saleId, quantity: '1', unit_offset: '0', amount_rappen: '242' });
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: `Open sale ${saleId}`, exact: true }).click();
    await expect(page.getByTestId('refundable-balance')).toHaveText('CHF 2.43');
    const preserved = await page.evaluate(async () => window.cashSloth?.catalog.listProducts({ query: '', categoryId: null, restrictToCategory: false, includeInactive: true }));
    if (!preserved?.ok) throw new Error('Cannot inspect demo catalog after restart');
    expect(preserved.value).toHaveLength(47);
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

test('native CSV selection, mapped variants and rejected conflicts preserve imported products and sales', async () => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-csv-operations-'));
  const source = await readFile(resolve('examples/catalog-import.csv'), 'utf8');
  const csvPath = join(directory, 'catalog.csv'); const conflictPath = join(directory, 'conflict.csv');
  await writeFile(csvPath, `\uFEFF${source}`, 'utf8'); await writeFile(conflictPath, source.replace(';4.00;', ';4.10;'), 'utf8');
  let application: ElectronApplication | undefined;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
  try {
    application = await launch(); let page = await application.firstWindow();
    await choosePath(application, csvPath);
    await navigateTo(page, 'Import');
    await page.getByRole('button', { name: 'Choose CSV file', exact: true }).click();
    await expect(page.getByTestId('csv-detection')).toContainText('UTF-8 BOM');
    await expect(page.getByTestId('csv-detection')).toContainText('Semicolon');
    await page.getByRole('button', { name: 'Preview catalog import', exact: true }).click();
    await expect(page.getByTestId('import-summary-newProducts')).toHaveText('3');
    await expect(page.getByTestId('import-summary-newVariants')).toHaveText('4');
    await page.screenshot({ path: 'test-results/mvp-0.4-import.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('checkbox', { name: 'I reviewed this catalog plan', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm catalog import', exact: true }).click();
    await acknowledgeImport(page);
    await choosePath(application, conflictPath);
    await page.getByRole('button', { name: 'Choose CSV file', exact: true }).click();
    await page.getByRole('button', { name: 'Preview catalog import', exact: true }).click();
    await expect(page.getByTestId('import-summary-conflictingRecords')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Confirm catalog import', exact: true })).toBeDisabled();
    const catalog = await page.evaluate(async () => {
      const api = window.cashSloth; if (!api) throw new Error('No API');
      return { products: await api.catalog.listProducts({ query: 'CSV Demo Coffee', categoryId: null, restrictToCategory: false, includeInactive: true }), categories: await api.catalog.listCategories({ includeInactive: true }) };
    });
    if (!catalog.products.ok || !catalog.categories.ok) throw new Error('Cannot inspect imported catalog');
    expect(catalog.products.value[0]?.variants.map((variant) => variant.unitPriceRappen)).toEqual([400, 550]);
    expect(catalog.categories.value.some((category) => category.name === 'Signs | Labels')).toBe(true);
    expect(catalog.categories.value.some((category) => category.name === 'Limited > Edition')).toBe(true);
    await navigateTo(page, 'POS');
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('CSV Demo Coffee');
    await page.getByRole('button', { name: 'Choose CSV Demo Coffee', exact: true }).click();
    await page.getByRole('button', { name: 'Add CSV Demo Coffee — Large', exact: true }).click();
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'More payment options', exact: true }).click();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('10.00');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Sale receipt', exact: true })).toContainText('CHF 5.50');
    const saleId = (await page.getByTestId('receipt-sale-id').textContent())?.trim();
    if (!saleId) throw new Error('No imported-product sale identity');
    await page.getByRole('button', { name: 'Start new sale', exact: true }).click();
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await navigateTo(page, 'Sales history');
    await page.getByRole('searchbox', { name: 'Product or variant', exact: true }).fill('CSV Demo Coffee');
    await page.getByRole('button', { name: 'Apply history filters', exact: true }).click();
    await expect(page.getByTestId('history-result-count')).toHaveText('1 matching sales');
    await page.getByRole('button', { name: `Open sale ${saleId}`, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Sale receipt', exact: true })).toContainText('CSV Demo Coffee');
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});
