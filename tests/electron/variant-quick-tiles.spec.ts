import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { navigateTo } from './navigation-helpers.js';

async function seedProduct(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const catalog = window.cashSloth?.catalog;
    if (!catalog) throw new Error('No catalog bridge');
    const category = await catalog.createCategory({ name: 'Empty shelf', parentId: null, position: 0, active: true });
    if (!category.ok) throw new Error(category.error.message);
    const variant = { active: true, sku: null, barcode: null, position: 0 };
    let product = await catalog.createProduct({
      name: 'Alpine soda', active: true, description: null, imageReference: null,
      categoryIds: [], primaryCategoryId: null,
      firstVariant: { ...variant, name: 'Small', unitPriceRappen: 210 },
    });
    for (const [index, name] of ['Large', 'Family'].entries()) {
      if (!product.ok) throw new Error(product.error.message);
      product = await catalog.createVariant({
        ...variant, productId: product.value.id, expectedProductRevision: product.value.revision,
        name, position: index + 1, unitPriceRappen: 300 + index * 100,
      });
    }
    if (!product.ok) throw new Error(product.error.message);
    return product.value.id;
  });
}

async function updateVariant(page: Page, productId: string, name: string, changes: { active?: boolean; unitPriceRappen?: number }): Promise<void> {
  await page.evaluate(async ({ productId, name, changes }) => {
    const catalog = window.cashSloth?.catalog;
    if (!catalog) throw new Error('No catalog bridge');
    const product = await catalog.getProduct({ productId });
    if (!product.ok) throw new Error(product.error.message);
    const variant = product.value.variants.find((item) => item.name === name);
    if (!variant) throw new Error('Missing fixture variant');
    const result = await catalog.updateVariant({
      productId, variantId: variant.id, expectedProductRevision: product.value.revision, expectedRevision: variant.revision,
      name, active: variant.active, position: variant.position, sku: variant.sku, barcode: variant.barcode,
      unitPriceRappen: variant.unitPriceRappen, ...changes,
    });
    if (!result.ok) throw new Error(result.error.message);
  }, { productId, name, changes });
}

test('cart badges and exact-variant quick adds follow persisted snapshots, filters and checkout locks', async () => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-quick-tiles-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory },
  });
  let application: ElectronApplication | undefined;
  try {
    application = await launch();
    let page = await application.firstWindow();
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const product = () => button('Choose Alpine soda');
    const quick = (variant: string) => button(`Quick add Alpine soda — ${variant}`);
    const choose = async (variant: string) => {
      await product().click();
      await page.getByRole('dialog', { name: 'Choose variant' }).getByRole('button', { name: `Add Alpine soda — ${variant}`, exact: true }).click();
    };
    const badge = (name: 'product' | 'Small' | 'Large', quantity: number) => {
      const tile = name === 'product' ? product() : quick(name);
      return expect(tile).toHaveAccessibleDescription(`${quantity} in cart ${name === 'product' ? 'across all variants' : 'for this variant'}`);
    };
    await navigateTo(page, 'Catalog');
    const productId = await seedProduct(page);
    await navigateTo(page, 'POS');
    await expect(product()).toBeEnabled();
    await expect(product().locator('.cart-quantity-badge')).toHaveCount(0);
    await expect(quick('Small')).toHaveCount(0);
    const coffee = button('Add Coffee');
    await coffee.click();
    await expect(coffee.locator('.cart-quantity-badge')).toHaveText('1');
    await expect(page.getByRole('button', { name: /^Quick add Coffee/u })).toHaveCount(0);
    await button('Remove Coffee').click();
    await expect(coffee.locator('.cart-quantity-badge')).toHaveCount(0);

    await choose('Large');
    await choose('Small');
    await badge('product', 2);
    await badge('Large', 1);
    await badge('Small', 1);
    // Catalog order stays stable even when the operator adds Large before Small.
    const quickTiles = page.getByRole('button', { name: /^Quick add Alpine soda/u });
    await expect(quickTiles).toHaveCount(2);
    await expect(quickTiles.first()).toHaveAccessibleName('Quick add Alpine soda — Small');
    await expect(quick('Family')).toHaveCount(0);
    await quick('Small').press('Enter');
    await badge('Small', 2);
    await expect(quick('Small')).toBeFocused();
    await badge('product', 3);
    await expect(page.getByRole('dialog', { name: 'Choose variant' })).toHaveCount(0);
    await expect(quick('Small').locator('.cart-quantity-badge')).toBeVisible();
    await page.screenshot({ path: 'test-results/variant-quick-tiles.png', animations: 'disabled' });
    const desktopSize = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await page.setViewportSize({ width: 320, height: 800 });
    const bounds = await quick('Small').boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize(desktopSize);

    await page.getByRole('navigation', { name: 'POS categories' }).getByRole('button', { name: 'Empty shelf', exact: true }).click();
    await expect(product()).toHaveCount(0);
    await expect(quick('Small')).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'Search products' });
    const restrict = page.getByRole('checkbox', { name: 'Restrict search to selected category' });
    await search.fill('Alpine');
    await badge('Small', 2);
    await restrict.check();
    await expect(quick('Large')).toHaveCount(0);
    await expect(product()).toHaveCount(0);
    await button('All products').click();
    await search.fill('');

    await navigateTo(page, 'Catalog');
    await updateVariant(page, productId, 'Small', { unitPriceRappen: 245 });
    await navigateTo(page, 'POS');
    await quick('Small').click();
    await badge('Small', 3);
    await badge('product', 4);
    await expect(quick('Small')).toHaveCount(1);
    const readCart = async () => page.evaluate(async () => {
      const result = await window.cashSloth?.pos.getCart({});
      if (!result?.ok) throw new Error('Cart read failed');
      return result.value.cart;
    });
    const saved = await readCart();
    expect(saved.items.map(({ variantName, unitPriceRappen, quantity }) => [variantName, unitPriceRappen, quantity]))
      .toEqual([['Large', 300, 1], ['Small', 210, 2], ['Small', 245, 1]]);

    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await badge('product', 4);
    await badge('Small', 3);
    expect(await readCart()).toEqual(saved);
    const oldLine = page.locator('article.cart-line').filter({ hasText: 'CHF 2.10 each' }).filter({ has: page.getByText('Alpine soda — Small', { exact: true }) });
    await oldLine.getByRole('button', { name: 'Decrease Alpine soda — Small', exact: true }).click();
    await badge('Small', 2);
    await oldLine.getByRole('button', { name: 'Remove Alpine soda — Small', exact: true }).click();
    await badge('Small', 1);
    await button('Remove Alpine soda — Small').click();
    await expect(quick('Small')).toHaveCount(0);
    await badge('product', 1);
    await button('Remove Alpine soda — Large').click();
    await expect(quick('Large')).toHaveCount(0);
    await expect(product().locator('.cart-quantity-badge')).toHaveCount(0);

    await choose('Small');
    await choose('Large');
    await navigateTo(page, 'Catalog');
    await updateVariant(page, productId, 'Large', { active: false });
    await navigateTo(page, 'POS');
    await badge('product', 2);
    await badge('Small', 1);
    await expect(quick('Large')).toHaveCount(0);
    await product().click();
    const dialog = page.getByRole('dialog', { name: 'Choose variant' });
    await expect(dialog.getByRole('button', { name: 'Add Alpine soda — Large' })).toHaveCount(0);
    await dialog.press('Escape');
    await expect(product()).toBeFocused();
    const lockedCart = await readCart();
    await button('Checkout').click();
    await button('More payment options').click();
    await expect(quick('Small')).toBeDisabled();
    await button('Card').click();
    await page.getByRole('textbox', { name: 'Payment amount (CHF)' }).fill('1.00');
    await button('Review payment').click();
    await page.getByText('Payment failed or result unknown?', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Payment outcome reason' }).fill('Terminal outcome requires investigation.');
    await page.getByRole('checkbox', { name: 'I verified the recorded outcome' }).check();
    await button('Report uncertain outcome').click();
    await expect(page.getByText('Payment outcome needs review', { exact: true })).toBeVisible();
    await button('Open reconciliation').click();
    await navigateTo(page, 'POS');
    await expect(product()).toBeDisabled();
    await expect(quick('Small')).toBeDisabled();
    await quick('Small').press('Enter');
    expect(await readCart()).toEqual(lockedCart);
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});
