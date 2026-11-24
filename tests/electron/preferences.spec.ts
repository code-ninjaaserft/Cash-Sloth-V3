import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { navigateTo } from './navigation-helpers.js';

test('appearance and language update immediately and survive an app restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-preferences-'));
  const environment: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory };
  delete environment['ELECTRON_RUN_AS_NODE'];
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: environment });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await navigateTo(page, 'Settings');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: 'test-results/settings-light.png' });
    const greenBackground = await page.locator('.settings-card').first().evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.getByRole('button', { name: 'Blue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.locator('.settings-card').first().evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(greenBackground);
    await page.getByLabel('Custom color', { exact: true }).fill('#b64788');
    await page.getByLabel('Color name', { exact: true }).fill('Fabios Farbe');
    await page.getByRole('button', { name: 'Save color', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fabios Farbe', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/settings-dark-custom.png' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('Language', { exact: true }).selectOption('de');
    await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.getByRole('button', { name: 'Hell', exact: true }).click();
    await page.screenshot({ path: 'test-results/settings-german.png' });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByText('Wähle ein Produkt, um einen Verkauf zu beginnen.')).toBeVisible();
    await page.locator('.application-nav-toggle').click();
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await expect(page.getByLabel('Eigene Farbe', { exact: true })).toHaveValue('#b64788');
    await expect(page.getByRole('button', { name: 'Fabios Farbe', exact: true })).toBeVisible();
    await page.getByLabel('Sprache', { exact: true }).selectOption('en');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await navigateTo(page, 'POS');
    await page.getByRole('button', { name: 'Add Chocolate', exact: true }).click();
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'More payment options', exact: true }).click();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('5.00');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    await expect(page.locator('.receipt')).toBeVisible();
    for (const mode of ['Light', 'Dark']) {
      await navigateTo(page, 'Settings');
      await page.getByRole('button', { name: mode, exact: true }).click();
      await navigateTo(page, 'POS');
      const contrast = await page.locator('.receipt').evaluate((element) => {
        const rgb = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) * (color.startsWith('color(srgb') ? 255 : 1));
        const luminance = (color: string): number => rgb(color).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
        const style = getComputedStyle(element);
        const foreground = luminance(style.color), background = luminance(style.backgroundColor);
        const parent = getComputedStyle(element.closest('main') ?? element).backgroundColor;
        // The document background is inherited visually through transparent main content.
        const surrounding = parent === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : parent;
        const channels = rgb(surrounding), receipt = rgb(style.backgroundColor);
        return { ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), difference: Math.max(...channels.map((v, i) => Math.abs(v - (receipt[i] ?? 0)))) };
      });
      expect(contrast.ratio).toBeGreaterThan(4.5);
      expect(contrast.difference).toBeLessThan(25);
      await page.screenshot({ path: 'test-results/receipt-subtle-' + mode.toLowerCase() + '.png', fullPage: true });
    }
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('theme color reaches products, categories, menu and controls in both appearance modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-accent-ui-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ args: [resolve('apps/desktop')], env: { ...environment, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory } });
  try {
    const page = await application.firstWindow();
    for (const mode of ['Light', 'Dark']) {
      let previous: string[] | undefined;
      for (const color of ['Blue', 'Red', 'Yellow']) {
        await navigateTo(page, 'Settings');
        await page.getByRole('button', { name: mode, exact: true }).click();
        await page.getByRole('button', { name: color, exact: true }).click();
        await expect(page.getByLabel('Custom color', { exact: true })).toHaveValue(({ Blue: '#0000ff', Red: '#ff0000', Yellow: '#ffff00' } as Record<string, string>)[color] ?? '');
        await navigateTo(page, 'POS');
        await expect(page.locator('.product-card').first()).toBeVisible();
        const surfaces = await page.evaluate(() => {
          const selectors = ['.pos-sidebar', '.product-card', '.pos-category-select[aria-current="true"]', '.application-nav-toggle', '.primary-button'];
          return selectors.map((selector) => {
            const element = document.querySelector(selector);
            if (!element) throw new Error('Missing themed element: ' + selector);
            const style = getComputedStyle(element);
            const rgb = (value: string): number[] => {
              const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
              const context = canvas.getContext('2d')!; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
              return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
            };
            const luminance = (value: string): number => rgb(value).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
            const bg = luminance(style.backgroundColor), fg = luminance(style.color);
            return { background: style.backgroundColor, channels: rgb(style.backgroundColor), contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) };
          });
        });
        for (const [index, surface] of surfaces.entries()) expect(surface.contrast, `${mode} ${color} surface ${index}: ${surface.background}`).toBeGreaterThan(4.5);
        if (color === 'Blue') for (const surface of surfaces.slice(0, 4)) {
          const [red, green, blue] = surface.channels as [number, number, number];
          expect(blue).toBeGreaterThan(green); expect(green).toBeGreaterThan(red);
        }
        const backgrounds = surfaces.map((surface) => surface.background);
        if (previous) backgrounds.forEach((value, index) => expect(value).not.toBe(previous?.[index]));
        previous = backgrounds;
        expect(backgrounds[0]).not.toBe(backgrounds[1]);
        expect(backgrounds[1]).not.toBe(backgrounds[2]);
        if (color === 'Blue' || color === 'Yellow') await page.screenshot({ path: 'test-results/pos-' + color.toLowerCase() + '-' + mode.toLowerCase() + '.png' });
        await page.locator('.application-nav-toggle').click();
        await expect(page.getByRole('navigation', { name: 'Application navigation', exact: true })).toHaveCSS('opacity', '1');
        const menu = await page.locator('.application-nav-surface').evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(menu).not.toBe(backgrounds[0]);
        if (color === 'Blue') await page.screenshot({ path: 'test-results/menu-blue-' + mode.toLowerCase() + '.png' });
        await page.locator('.application-nav-toggle').click();
        await expect(page.locator('.application-navigation')).toHaveAttribute('data-phase', 'closed');
      }
    }
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
