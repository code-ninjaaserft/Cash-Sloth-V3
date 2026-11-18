import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';

async function populateRegister(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = window.cashSloth;
    if (!api) throw new Error('Desktop register unavailable');
    const shelf = await api.catalog.createCategory({ name: 'Scroll shelf', active: true, parentId: null, position: 0 });
    if (!shelf.ok) throw new Error(shelf.error.message);
    for (let n = 1; n <= 24; n++) {
      const category = await api.catalog.createCategory({ name: `Other shelf ${n}`, active: true, parentId: null, position: n });
      if (!category.ok) throw new Error(category.error.message);
    }
    const initialCart = await api.pos.getCart({});
    if (!initialCart.ok) throw new Error(initialCart.error.message);
    let cart = initialCart.value.cart;
    const variant = { active: true, name: 'Small', unitPriceRappen: 201, sku: null, barcode: null, position: 0 };
    for (let n = 0; n < 36; n++) {
      const product = await api.catalog.createProduct({
        name: `Scroll item ${String(n).padStart(2, '0')}`, active: true, description: null, imageReference: null,
        categoryIds: [shelf.value.id], primaryCategoryId: shelf.value.id, firstVariant: variant,
      });
      if (!product.ok) throw new Error(product.error.message);
      if (n === 0) {
        const second = await api.catalog.createVariant({ ...variant, name: 'Large', position: 1, unitPriceRappen: 345,
          productId: product.value.id, expectedProductRevision: product.value.revision });
        if (!second.ok) throw new Error(second.error.message);
      }
      if (n < 16) {
        const first = product.value.variants[0];
        if (!first) throw new Error('Missing seeded variant');
        const added = await api.pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: first.id });
        if (!added.ok) throw new Error(added.error.message);
        cart = added.value;
      }
    }
  });
  await page.reload();
  await page.getByRole('button', { name: 'Scroll shelf', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose Scroll item 00', exact: true })).toBeEnabled();
}

const scrollTop = (region: Locator) => region.evaluate((element) => element.scrollTop);
const wheelOver = async (page: Page, region: Locator, delta: number) => {
  const box = await region.boundingBox();
  if (!box) throw new Error('Scroll region is hidden');
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
};

async function fixedBounds(page: Page) {
  return page.evaluate(() => [
    '.application-nav-toggle', '.pos-brand', '.pos-category-navigation', '.catalog-toolbar', '.category-context',
    '.search-options', '.product-grid', '.cart-panel-header', '.cart-lines', '.cart-summary',
  ].map((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing region ${selector}`);
    return element.getBoundingClientRect().toJSON();
  }));
}

async function verifyDesktopFrame(page: Page) {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    scrollY: window.scrollY,
  }));
  expect(overflow).toEqual({ x: 0, y: 0, scrollY: 0 });
  for (const element of [
    page.getByRole('searchbox', { name: 'Search products' }), page.getByRole('checkbox', { name: 'Restrict search to selected category' }),
    page.locator('.category-context'), page.getByRole('heading', { name: 'Current cart' }),
    page.getByTestId('cart-subtotal'), page.getByTestId('cart-payable'), page.getByRole('button', { name: 'Checkout', exact: true }),
    page.getByRole('button', { name: 'Clear cart', exact: true }),
  ]) await expect(element).toBeInViewport({ ratio: 1 });
  for (const region of [page.locator('.product-grid'), page.locator('.cart-lines')]) {
    expect(await region.evaluate((element) => element.scrollHeight > element.clientHeight && element.clientHeight > 0)).toBe(true);
  }
}

async function cartSnapshot(page: Page) {
  return page.evaluate(async () => {
    const result = await window.cashSloth?.pos.getCart({});
    if (!result?.ok) throw new Error('Cannot read cart');
    return result.value.cart;
  });
}

test('products, cart items and categories scroll independently and register controls survive resizing', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-pos-scroll-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [resolve('apps/desktop')], env: {
      ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory,
    } });
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await populateRegister(page);
    const product = page.getByRole('button', { name: 'Choose Scroll item 00', exact: true });
    const quick = page.getByRole('button', { name: 'Quick add Scroll item 00 — Small', exact: true });
    const grid = page.getByRole('region', { name: 'Product catalog', exact: true });
    const lines = page.getByRole('region', { name: 'Cart items', exact: true });
    const categories = page.locator('.pos-category-navigation > .pos-category-list');
    const checkout = page.getByRole('button', { name: 'Checkout', exact: true });
    const clear = page.getByRole('button', { name: 'Clear cart', exact: true });

    await quick.press('Enter');
    await expect(product).toHaveAccessibleDescription('2 in cart across all variants');
    await expect(quick).toHaveAccessibleDescription('2 in cart for this variant');
    await expect(checkout).toBeEnabled();
    const cart = await cartSnapshot(page);
    expect(cart.items).toHaveLength(16);
    expect(cart.subtotalRappen).toBe(17 * 201);
    await expect(page.getByTestId('cart-payable')).toHaveText('CHF 34.17');
    await expect(page.locator('.category-context')).toContainText('Scroll shelf');
    await verifyDesktopFrame(page);
    await page.screenshot({ path: 'test-results/pos-scroll-desktop.png', animations: 'disabled' });
    const before = await fixedBounds(page);

    await wheelOver(page, grid, 390);
    await expect.poll(() => scrollTop(grid)).toBeGreaterThan(0);
    expect(await scrollTop(lines)).toBe(0);
    expect(await scrollTop(categories)).toBe(0);
    expect(await fixedBounds(page)).toEqual(before);
    await grid.focus();
    const wheelOffset = await scrollTop(grid);
    await page.keyboard.press('PageDown');
    await expect.poll(() => scrollTop(grid)).toBeGreaterThan(wheelOffset);
    await grid.press('End');
    await expect.poll(() => grid.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
    const gridEnd = await scrollTop(grid);
    await wheelOver(page, grid, 1200);

    await wheelOver(page, lines, 440);
    await expect.poll(() => scrollTop(lines)).toBeGreaterThan(0);
    expect(await scrollTop(grid)).toBe(gridEnd);
    expect(await fixedBounds(page)).toEqual(before);
    await wheelOver(page, categories, 350);
    await expect.poll(() => scrollTop(categories)).toBeGreaterThan(0);
    expect(await scrollTop(grid)).toBe(gridEnd);
    const categoryOffset = await scrollTop(categories);

    // Dispatch a native touchscreen pan through Chromium's input pipeline.
    const box = await lines.boundingBox();
    if (!box) throw new Error('Missing cart item viewport');
    const start = await scrollTop(lines);
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      const x = box.x + box.width / 2;
      const y = box.y + box.height * 0.8;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - box.height * step / 12 }] });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => scrollTop(lines)).toBeGreaterThan(start);
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await session.detach();
    }
    expect(await scrollTop(categories)).toBe(categoryOffset);
    expect(await scrollTop(grid)).toBe(gridEnd);
    expect(await fixedBounds(page)).toEqual(before);
    await verifyDesktopFrame(page);

    await page.setViewportSize({ width: 1024, height: 600 });
    await verifyDesktopFrame(page);
    // The compact register opens its existing cart drawer; the operator can reach both actions.
    await page.setViewportSize({ width: 800, height: 700 });
    await page.getByRole('button', { name: /Open cart/u }).click();
    await expect(checkout).toBeInViewport({ ratio: 1 });
    await expect(clear).toBeInViewport({ ratio: 1 });
    await clear.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 640, height: 420 });
    await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport({ ratio: 1 });
    await clear.scrollIntoViewIfNeeded();
    await expect(clear).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Close cart', exact: true }).click();
    await expect(page.getByRole('button', { name: /Open cart/u })).toBeFocused();
    await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('.pos-shell').evaluate((element: HTMLElement) => { element.dataset.inputMode = 'touch'; });
    // In a short stacked layout the page can scroll to a usable product viewport.
    await grid.focus();
    await grid.scrollIntoViewIfNeeded();
    await expect(grid).toBeFocused();
    expect(await grid.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(44);
    await product.scrollIntoViewIfNeeded();
    await expect(product).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: /Open cart/u }).press('Enter');
    await expect(checkout).toBeInViewport({ ratio: 1 });
    await expect(clear).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Open cart/u })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(grid).toBeInViewport({ ratio: 1 });
    expect(await grid.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(44);
    await page.locator('.pos-shell').evaluate((element: HTMLElement) => { element.dataset.inputMode = 'standard'; });
    await page.setViewportSize({ width: 1440, height: 900 });
    await verifyDesktopFrame(page);
    await expect(quick).toHaveAccessibleDescription('2 in cart for this variant');
    expect(await cartSnapshot(page)).toEqual(cart);
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});
