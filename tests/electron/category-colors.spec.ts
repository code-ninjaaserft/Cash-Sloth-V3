import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { navigateTo } from './navigation-helpers.js';

test('category colors can be created in the editor and appear on assigned products after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-category-colors-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory } });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await navigateTo(page, 'Catalog');
    await page.getByRole('button', { name: 'New category', exact: true }).click();
    await page.getByLabel('Category name', { exact: true }).fill('Yellow drinks');
    await page.getByLabel('Use category color', { exact: true }).check();
    await page.getByLabel('Category color', { exact: true }).fill('#ffff00');
    await page.getByRole('button', { name: 'Save category', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(async () => {
      const api = window.cashSloth;
      if (!api) throw new Error('No desktop API');
      const categories = await api.catalog.listCategories({ includeInactive: true });
      const product = await api.catalog.getProduct({ productId: 'product-water' });
      if (!categories.ok || !product.ok) throw new Error('Could not load test catalog');
      const category = categories.value.find((entry) => entry.name === 'Yellow drinks');
      if (!category || category.color !== '#ffff00') throw new Error('Editor did not persist the selected category color');
      const assigned = await api.catalog.assignCategories({ productId: product.value.id, expectedRevision: product.value.revision, categoryIds: [category.id], primaryCategoryId: category.id });
      if (!assigned.ok) throw new Error(assigned.error.message);
    });
    await navigateTo(page, 'POS');
    const water = page.getByRole('button', { name: 'Add Mineral water', exact: true });
    await expect(water.locator('..')).toHaveAttribute('data-category-color', '#ffff00');
    await expect(water.getByText('Yellow drinks', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/category-yellow-products.png' });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Add Mineral water', exact: true }).locator('..')).toHaveAttribute('data-category-color', '#ffff00');
    await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true }).locator('..')).not.toHaveAttribute('data-category-color');
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
