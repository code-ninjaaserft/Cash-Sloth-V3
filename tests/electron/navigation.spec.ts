import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { navigateTo, openApplicationNavigation } from './navigation-helpers.js';

async function seedNavigationCatalog(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = window.cashSloth?.catalog;
    if (!api) throw new Error('Catalog bridge unavailable');
    const category = async (name: string, parentId: string | null): Promise<string> => {
      const result = await api.createCategory({ name, parentId, active: true, position: 0 });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.id;
    };
    const root = await category('Navigation drinks', null);
    const child = await category('Herbal', root);
    const grandchild = await category('Alpine', child);
    const leaf = await category('Mint', grandchild);
    for (let index = 0; index < 14; index += 1) await category(`Scroll category ${index.toString().padStart(2, '0')}`, null);
    for (const [name, categoryIds] of [
      ['Navigation mint', [root, child, grandchild, leaf]],
      ['Navigation ginger', [child]],
    ] as const) {
      const result = await api.createProduct({
        name, description: null, active: true, imageReference: null,
        categoryIds, primaryCategoryId: categoryIds[0],
        firstVariant: { name: 'Default', unitPriceRappen: 333, sku: null, barcode: null, active: true, position: 0 },
      });
      if (!result.ok) throw new Error(result.error.message);
    }
  });
  // Re-entering POS reloads catalog data while keeping its independent browse state.
  await navigateTo(page, 'Catalog');
  await navigateTo(page, 'POS');
}

async function layoutSample(page: Page): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() => Object.fromEntries(['.pos-category-navigation', '.catalog-toolbar', '.product-grid', '.cart-panel', '.cart-drawer-toggle'].map((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing layout region ${selector}`);
    const rect = element.getBoundingClientRect();
    return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  })));
}

async function sampleTransitionLayout(page: Page): Promise<Awaited<ReturnType<typeof layoutSample>>[]> {
  return page.evaluate(async () => {
    const frames: Record<string, { x: number; y: number; width: number; height: number }>[] = [];
    const start = performance.now();
    do {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      frames.push(Object.fromEntries(['.pos-category-navigation', '.catalog-toolbar', '.product-grid', '.cart-panel', '.cart-drawer-toggle'].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing layout region ${selector}`);
        const rect = element.getBoundingClientRect();
        return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
      })));
    } while (performance.now() - start < 310);
    return frames;
  });
}

test('animated menu overlays mounted categories and preserves filtering, focus and cart state', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-navigation-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory },
  }).catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeEnabled();
    await seedNavigationCatalog(page);
    const categories = page.getByRole('navigation', { name: 'POS categories', exact: true });
    const global = page.getByRole('navigation', { name: 'Application navigation', exact: true });
    const root = 'Navigation drinks';
    const child = `${root} / Herbal`;
    const grandchild = `${child} / Alpine`;
    const leaf = `${grandchild} / Mint`;
    const search = page.getByRole('searchbox', { name: 'Search products', exact: true });
    const restrict = page.getByRole('checkbox', { name: 'Restrict search to selected category', exact: true });

    await expect(categories.getByRole('button', { name: 'All products', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(categories.getByRole('button', { name: child, exact: true })).toBeHidden();
    await categories.getByRole('button', { name: root, exact: true }).click();
    // The mint product is assigned to every ancestor: the parent view must still show it once.
    await expect(page.getByRole('button', { name: 'Add Navigation mint', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Add Navigation ginger', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toHaveCount(0);

    const expandRoot = categories.getByRole('button', { name: `Expand ${root}`, exact: true });
    await expandRoot.focus();
    await expandRoot.press('Space');
    await expect(categories.getByRole('button', { name: `Collapse ${root}`, exact: true })).toHaveAttribute('aria-expanded', 'true');
    await categories.getByRole('button', { name: `Expand ${child}`, exact: true }).press('Enter');
    await categories.getByRole('button', { name: `Expand ${grandchild}`, exact: true }).click();
    await categories.getByRole('button', { name: leaf, exact: true }).press('Enter');
    await expect(categories.getByRole('button', { name: leaf, exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: 'Add Navigation ginger', exact: true })).toHaveCount(0);
    await categories.getByRole('button', { name: `Collapse ${grandchild}`, exact: true }).press('Space');
    await expect(categories.getByRole('button', { name: leaf, exact: true })).toBeHidden();
    await expect(categories.getByRole('button', { name: `Expand ${grandchild}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
    await categories.getByRole('button', { name: `Expand ${grandchild}`, exact: true }).press('Enter');
    await expect(categories.getByRole('button', { name: leaf, exact: true })).toHaveAttribute('aria-current', 'true');

    await search.fill('Coffee');
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeVisible();
    await restrict.check();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toHaveCount(0);
    await search.fill('Navigation mint');
    await expect(page.getByRole('button', { name: 'Add Navigation mint', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Add Navigation mint', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Quantity for Navigation mint', exact: true })).toHaveValue('1');
    const cartBefore = await page.evaluate(async () => window.cashSloth?.pos.getCart({}));
    if (!cartBefore?.ok) throw new Error('Cannot read saved cart');
    expect(cartBefore.value.cart.items).toHaveLength(1);

    await expect(page.getByRole('button', { name: 'Checkout', exact: true })).toBeEnabled();
    const layer = page.locator('.pos-category-layer');
    const categoryNode = await page.locator('.pos-category-navigation').elementHandle();
    if (!categoryNode) throw new Error('Category navigator not mounted');
    const scroll = page.locator('.pos-category-navigation > .pos-category-list');
    await scroll.evaluate((element) => { element.scrollTop = 120; });
    const scrollTop = await scroll.evaluate((element) => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    const savedCategoryMarkup = await page.locator('.pos-category-navigation').innerHTML();
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await layoutSample(page);
    const expand = page.getByRole('button', { name: 'Expand application navigation', exact: true });
    const controlledId = await expand.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    await expect(global).toBeHidden();
    await expect(page.locator('.application-navigation')).toHaveAttribute('data-phase', 'closed');
    const durations = await page.locator('.application-nav-surface').evaluate((element) => getComputedStyle(element).transitionDuration.split(',').map((duration) => Number.parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000)));
    expect(Math.max(...durations)).toBeGreaterThanOrEqual(220);
    expect(Math.max(...durations)).toBeLessThanOrEqual(300);
    await expect(page.locator('.hamburger-line')).toHaveCount(3);
    await expand.press('Enter');
    await page.keyboard.press('Tab');
    for (const sample of await sampleTransitionLayout(page)) expect(sample).toEqual(before);
    await expect(global).toHaveCSS('opacity', '1');
    await expect(global.getByRole('button', { name: 'POS', exact: true })).toBeFocused();
    await expect(layer).toHaveAttribute('inert', '');
    await expect(layer).toHaveAttribute('aria-hidden', 'true');
    await expect(categories).toHaveCount(0);
    expect(await categoryNode.evaluate((element) => element.isConnected && element === document.querySelector('.pos-category-navigation'))).toBe(true);
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(scrollTop);
    expect(await page.locator('.pos-category-navigation').innerHTML()).toBe(savedCategoryMarkup);
    await expect(page.locator('.application-nav-surface')).toHaveCSS('background-color', /^(?:rgb\(|color\(srgb )[^/]*\)$/u);
    expect(await page.locator('.hamburger-line').first().evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');
    await page.locator('.application-nav-toggle').focus();
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press('Tab');
      expect(await layer.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    }
    await global.getByRole('button', { name: 'Catalog', exact: true }).press('Escape');
    await expect(page.getByRole('button', { name: 'Expand application navigation', exact: true })).toBeFocused();
    await expect(page.locator('.application-navigation')).toHaveAttribute('data-phase', 'closed');
    expect(await layoutSample(page)).toEqual(before);
    await expect(global).toBeHidden();
    await expect(categories).toBeVisible();
    expect(await categoryNode.evaluate((element) => element.isConnected && element === document.querySelector('.pos-category-navigation'))).toBe(true);
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(scrollTop);
    await expect(search).toHaveValue('Navigation mint');
    await page.getByRole('button', { name: 'Expand application navigation', exact: true }).focus();
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate((id) => document.getElementById(id ?? '')?.contains(document.activeElement), controlledId)).toBe(false);
    }
    await navigateTo(page, 'Catalog');
    await expect(categories).toBeHidden();
    await navigateTo(page, 'POS');
    await expect(categories.getByRole('button', { name: leaf, exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(categories.getByRole('button', { name: `Collapse ${grandchild}`, exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toHaveValue('Navigation mint');
    await expect(restrict).toBeChecked();
    expect(await page.evaluate(async () => window.cashSloth?.pos.getCart({}))).toEqual(cartBefore);

    await openApplicationNavigation(page);
    await page.screenshot({ path: 'test-results/navigation-overlay-open.png', fullPage: true });
    const closingHit = await page.evaluate(async () => {
      const all = document.querySelector('.pos-category-navigation > button');
      const toggle = document.querySelector<HTMLButtonElement>('.application-nav-toggle');
      if (!all || !toggle) throw new Error('Missing overlay hit target');
      const rect = all.getBoundingClientRect();
      toggle.click();
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const snapshot = {
        phase: document.querySelector<HTMLElement>('.application-navigation')?.dataset.phase,
        blocked: document.querySelector<HTMLElement>('.pos-category-layer')?.inert,
        shielded: Boolean(hit?.closest('.application-navigation')),
      };
      hit?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return snapshot;
    });
    expect(closingHit).toEqual({ phase: 'closing', blocked: true, shielded: true });
    await expect(page.locator('.application-navigation')).toHaveAttribute('data-phase', 'closed');
    await expect(categories.getByRole('button', { name: leaf, exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(restrict).toBeChecked();
    expect(await page.evaluate(async () => window.cashSloth?.pos.getCart({}))).toEqual(cartBefore);
    await page.screenshot({ path: 'test-results/navigation-overlay-closed.png', fullPage: true });
    await categories.getByRole('button', { name: 'All products', exact: true }).press('Enter');
    await expect(restrict).not.toBeChecked();
    await expect(restrict).toBeDisabled();
    await search.fill('');
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeVisible();
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('overlay layout is stable across widths, rapid reversals, explicit touch mode and reduced motion', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-navigation-responsive-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory },
  }).catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeEnabled();
    await seedNavigationCatalog(page);
    const global = page.getByRole('navigation', { name: 'Application navigation', exact: true });
    const categories = page.getByRole('navigation', { name: 'POS categories', exact: true });
    const layer = page.locator('.pos-category-layer');
    const overlay = page.locator('.application-navigation');
    for (const path of ['Navigation drinks', 'Navigation drinks / Herbal', 'Navigation drinks / Herbal / Alpine']) {
      await categories.getByRole('button', { name: `Expand ${path}`, exact: true }).click();
    }
    await categories.getByRole('button', { name: 'Navigation drinks', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toHaveCount(0);
    for (const width of [1280, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      await expect(page.locator('.pos-shell')).toHaveAttribute('data-input-mode', 'standard');
      await expect(categories).toBeVisible();
      const before = await layoutSample(page);
      await page.getByRole('button', { name: 'Expand application navigation', exact: true }).press('Space');
      for (const sample of await sampleTransitionLayout(page)) expect(sample).toEqual(before);
      await expect(global).toHaveCSS('opacity', '1');
      await expect(layer).toHaveAttribute('inert', '');
      for (const name of ['POS', 'Catalog', 'Import', 'Sales history', 'Reconciliation', 'System status', 'Development tools', 'Settings']) {
        const button = global.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds).not.toBeNull();
        if (bounds) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        }
      }
      await expect(global.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (width === 1280) {
        // Reverse a real closing transition before its completion callback/timer.
        await page.evaluate(async () => {
          const toggle = document.querySelector<HTMLButtonElement>('.application-nav-toggle');
          if (!toggle) throw new Error('Missing menu trigger');
          toggle.click();
          await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
          toggle.click();
        });
        for (const sample of await sampleTransitionLayout(page)) expect(sample).toEqual(before);
        await expect(overlay).toHaveAttribute('data-phase', 'open');
        await expect(layer).toHaveAttribute('inert', '');
        await expect(global).toHaveCSS('opacity', '1');
        // A late resize retargets the closing transform; its original timer must not release the shield.
        await page.evaluate(async () => {
          document.querySelector<HTMLButtonElement>('.application-nav-toggle')?.click();
          const start = performance.now();
          while (performance.now() - start < 180) await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        });
        await page.setViewportSize({ width, height: 780 });
        const closeSamples = await page.evaluate(async () => {
          const samples: { blocked: boolean; phase: string | undefined; compactError: number }[] = [];
          const start = performance.now();
          do {
            await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
            const root = document.querySelector<HTMLElement>('.application-navigation');
            const surface = document.querySelector('.application-nav-surface');
            const trigger = document.querySelector('.application-nav-toggle');
            const layer = document.querySelector<HTMLElement>('.pos-category-layer');
            if (!root || !surface || !trigger || !layer) throw new Error('Missing closing-overlay region');
            const matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
            const rootRect = root.getBoundingClientRect();
            const triggerRect = trigger.getBoundingClientRect();
            samples.push({ blocked: layer.inert, phase: root.dataset.phase, compactError: Math.max(Math.abs(matrix.a - triggerRect.width / rootRect.width), Math.abs(matrix.d - triggerRect.height / rootRect.height)) });
            if (root.dataset.phase === 'closed') return samples;
          } while (performance.now() - start < 1000);
          throw new Error('Resized closing transition did not complete');
        });
        expect(closeSamples.some((sample) => sample.blocked)).toBe(true);
        for (const sample of closeSamples.filter((sample) => !sample.blocked)) {
          expect(sample.phase).toBe('closed');
          expect(sample.compactError).toBeLessThan(0.001);
        }
        await page.setViewportSize({ width, height: 1000 });
        await openApplicationNavigation(page);
      }
      await page.getByRole('button', { name: 'Collapse application navigation', exact: true }).press('Enter');
      for (const sample of await sampleTransitionLayout(page)) expect(sample).toEqual(before);
      await expect(overlay).toHaveAttribute('data-phase', 'closed');
      await expect(categories).toBeVisible();
      await expect(layer).not.toHaveAttribute('inert', '');
      await expect(categories.getByRole('button', { name: 'Navigation drinks', exact: true })).toHaveAttribute('aria-current', 'true');
      await navigateTo(page, 'System status');
      await expect(categories).toBeHidden();
      await expect(page.getByTestId('system-info')).toBeVisible();
      await navigateTo(page, 'POS');
      await expect(categories.getByRole('button', { name: 'Navigation drinks', exact: true })).toHaveAttribute('aria-current', 'true');
      if (width === 390) await page.screenshot({ path: 'test-results/navigation-overlay-narrow.png', fullPage: true });
      if (width === 1280 || width === 390) {
        const allProducts = page.locator('.pos-category-navigation > button');
        expect(await allProducts.evaluate((element) => getComputedStyle(element).minHeight)).toBe('44px');
        // Exercise the explicit presentation hook; viewport width never enables touch mode.
        await page.locator('.pos-shell').evaluate((element: HTMLElement) => { element.dataset.inputMode = 'touch'; });
        await expect(page.locator('.application-nav-toggle')).toHaveCSS('min-height', '56px');
        await openApplicationNavigation(page);
        for (const target of [page.locator('.application-nav-toggle'), global.getByRole('button', { name: 'POS', exact: true }), allProducts, page.locator('.pos-category-toggle').first()]) {
          const bounds = await target.boundingBox();
          expect(bounds?.height).toBeGreaterThanOrEqual(56);
        }
        await page.getByRole('button', { name: 'Collapse application navigation', exact: true }).click();
        await expect(overlay).toHaveAttribute('data-phase', 'closed');
        await expect(categories.getByRole('button', { name: 'Navigation drinks', exact: true })).toHaveAttribute('aria-current', 'true');
        await page.locator('.pos-shell').evaluate((element: HTMLElement) => { element.dataset.inputMode = 'standard'; });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motionDurations = await page.locator('.application-nav-surface').evaluate((element) => getComputedStyle(element).transitionDuration.split(',').map((duration) => Number.parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000)));
    expect(Math.max(...motionDurations)).toBeLessThanOrEqual(1);
    await openApplicationNavigation(page);
    await global.getByRole('button', { name: 'POS', exact: true }).press('Escape');
    await expect(overlay).toHaveAttribute('data-phase', 'closed');
    await expect(page.getByRole('button', { name: 'Expand application navigation', exact: true })).toBeFocused();
    await expect(categories.getByRole('button', { name: 'Navigation drinks', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(layer).not.toHaveAttribute('inert', '');
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
