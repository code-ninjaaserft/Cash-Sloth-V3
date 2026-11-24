import { navigateTo } from './navigation-helpers.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

test('React runs in a sandbox and validates IPC against the actual Electron runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-electron-'));
  const mainPath = resolve('apps/desktop/dist/main.mjs');
  const environment = { ...process.env };
  delete environment['ELECTRON_RUN_AS_NODE'];
  const application = await electron.launch({
    args: [resolve('apps/desktop')],
    env: {
      ...environment,
      CASH_SLOTH_CHANNEL: 'development',
      CASH_SLOTH_DATA_ROOT: directory,
    },
  }).catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  });
  try {
    const page = await application.firstWindow();
    await navigateTo(page, 'System status');
    await expect(page.getByRole('heading', { name: 'Cash Sloth V3' })).toBeVisible();
    await expect(page.getByTestId('system-info')).toContainText('desktop');
    await expect(page.getByTestId('system-info')).toContainText('development');
    expect((await page.evaluate(() => window.cashSloth?.system.getInfo()))?.appVersion).toBe('0.0.0');
    const logo = page.getByRole('img', { name: 'Cash Sloth V3 logo' });
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth >= 128)).toBe(true);
    const logoBounds = await logo.boundingBox();
    const sidebarBounds = await page.locator('.pos-sidebar').boundingBox();
    const triggerBounds = await page.locator('.application-nav-toggle').boundingBox();
    if (!logoBounds || !sidebarBounds || !triggerBounds) throw new Error('Branding or menu trigger is missing');
    expect(logoBounds.x).toBeGreaterThanOrEqual(triggerBounds.x + triggerBounds.width);
    expect(logoBounds.x + logoBounds.width).toBeLessThanOrEqual(sidebarBounds.x + sidebarBounds.width);
    expect(logoBounds?.y).toBeLessThan(32);
    const desktopIcon = await application.evaluate(async ({ app, nativeImage }) => {
      const path = process.getBuiltinModule('path');
      const iconPath = path.join(app.getAppPath(), 'dist/branding/generated/cash-sloth.ico');
      const pngPath = path.join(app.getAppPath(), 'dist/branding/generated/cash-sloth-256.png');
      const png = nativeImage.createFromPath(pngPath);
      const fileIcon = await app.getFileIcon(iconPath, { size: 'large' });
      return { windowPngSize: png.getSize(), windowsIcoDecodes: !fileIcon.isEmpty() };
    });
    expect(desktopIcon).toEqual({ windowPngSize: { width: 256, height: 256 }, windowsIcoDecodes: true });
    if (process.platform === 'win32') {
      const nativeBranding = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window === undefined) throw new Error('No application window');
        const sources = await desktopCapturer.getSources({
          types: ['window'], fetchWindowIcons: true, thumbnailSize: { width: 1200, height: 1000 },
        });
        const source = sources.find((entry) => entry.id === window.getMediaSourceId());
        if (source?.appIcon === null || source?.appIcon === undefined || source.appIcon.isEmpty()) {
          throw new Error('Windows did not supply an application window icon');
        }
        return { icon: source.appIcon.toPNG().toString('base64'), window: source.thumbnail.toPNG().toString('base64') };
      });
      await writeFile('test-results/branding-native-icon.png', Buffer.from(nativeBranding.icon, 'base64'));
      await writeFile('test-results/branding-native-window.png', Buffer.from(nativeBranding.window, 'base64'));
    }
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(page.getByRole('status')).toHaveText('Connected through validated IPC.');
    await page.screenshot({ path: 'test-results/foundation.png', fullPage: true });
    const rendererGlobals = await page.evaluate(() => ({
      requireType: typeof Reflect.get(window, 'require'),
      processType: typeof Reflect.get(window, 'process'),
      apiKeys: Object.keys(window.cashSloth ?? {}),
      systemKeys: Object.keys(window.cashSloth?.system ?? {}),
    }));
    expect(rendererGlobals).toEqual({
      requireType: 'undefined', processType: 'undefined',
      apiKeys: ['presets', 'system', 'pos', 'catalog', 'payments', 'management', 'history', 'files'], systemKeys: ['getInfo'],
    });
    const electronDataPaths = await application.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      crashDumps: app.getPath('crashDumps'),
      logs: app.getPath('logs'),
    }));
    for (const path of Object.values(electronDataPaths)) {
      expect(path.startsWith(join(directory, 'development'))).toBe(true);
    }
    const isolation = await application.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('No Electron window');
      const processId = window.webContents.getOSProcessId();
      const metrics = app.getAppMetrics().find((entry) => entry.pid === processId);
      // Electron exposes this diagnostic method at runtime, but not in public types.
      // Keep the optional diagnostic dependency inside the smoke harness only.
      const getPreferences: unknown = Reflect.get(window.webContents, 'getLastWebPreferences');
      if (typeof getPreferences !== 'function') throw new Error('Preferences diagnostic is unavailable');
      const preferences: unknown = Reflect.apply(getPreferences, window.webContents, []);
      if (typeof preferences !== 'object' || preferences === null) {
        throw new Error('Invalid preferences diagnostic result');
      }
      return {
        osSandboxed: metrics?.sandboxed,
        contextIsolation: Reflect.get(preferences, 'contextIsolation') as unknown,
        sandbox: Reflect.get(preferences, 'sandbox') as unknown,
        nodeIntegration: Reflect.get(preferences, 'nodeIntegration') as unknown,
        webSecurity: Reflect.get(preferences, 'webSecurity') as unknown,
      };
    });
    expect(isolation).toEqual({
      osSandboxed: true,
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
    });
    const unauthorizedResult = await application.evaluate(async ({ BrowserWindow }, preload) => {
      const original = BrowserWindow.getAllWindows()[0];
      if (original === undefined) throw new Error('No trusted Electron window');
      const unauthorized = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      try {
        await unauthorized.loadURL(original.webContents.getURL());
        return await unauthorized.webContents.executeJavaScript(
          'Promise.all([window.cashSloth.system.getInfo(), window.cashSloth.pos.getCart({}), window.cashSloth.catalog.listCategories({includeInactive:false}), window.cashSloth.payments.getActiveCheckout({}), window.cashSloth.payments.reconcile({kind:"payment",referenceId:"attempt",idempotencyKey:"action",resolution:"exclude-no-transfer",reason:"Untrusted window must be rejected",deliberateConfirmation:true}),window.cashSloth.management.previewDemoCatalog({}),window.cashSloth.history.getSaleContext({saleId:"sale-test"}),window.cashSloth.files.chooseCatalogCsv({}),window.cashSloth.presets.getState({}),window.cashSloth.presets.save({operationId:"untrusted-op",catalogVersion:"0".repeat(64),presetId:null,expectedRevision:null,name:"Untrusted event",empty:false})].map(result => result.then(() => "unexpected", () => "rejected")))',
        ) as string[];
      } finally {
        unauthorized.destroy();
      }
    }, join(dirname(mainPath), 'preload.cjs'));
    expect(unauthorizedResult).toEqual(Array.from({ length: 10 }, () => 'rejected'));
    const probe = await application.evaluate((_electronModule, input) => {
      const requireModule = process.getBuiltinModule('module').createRequire(input.mainUrl);
      const main: unknown = requireModule(input.mainPath);
      if (typeof main !== 'object' || main === null) throw new Error('Invalid main module');
      const runProbe: unknown = Reflect.get(main, 'runFoundationProbe');
      if (typeof runProbe !== 'function') throw new Error('No main-process compatibility probe');
      const result: unknown = Reflect.apply(runProbe, undefined, [input.databaseFile]);
      return { versions: process.versions, probe: result };
    }, {
      mainUrl: pathToFileURL(mainPath).href,
      mainPath,
      databaseFile: join(directory, 'electron-compatibility-probe.sqlite'),
    });
    console.log('Electron runtime compatibility:', JSON.stringify(probe));
    expect(probe.probe).toMatchObject({ checks: {
      commit: true, rollback: true, foreignKeys: true, wal: true,
      reopen: true, drizzleBinding: true, drizzleTransaction: true, drizzleRollback: true,
    } });
    const popup = await page.evaluate(() => window.open('https://untrusted.invalid/'));
    expect(popup).toBeNull();
    expect(application.windows()).toHaveLength(1);
  } finally {
    try {
      await application.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  }
});
