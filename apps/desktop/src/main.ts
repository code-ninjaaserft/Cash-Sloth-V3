import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { createCatalogService, createHistoryService, createManagementService, createPaymentsService, createPosService, createSystemService } from '@cash-sloth/application';
import { CATALOG_IPC_CONTRACTS, FILES_IPC_CONTRACTS, HISTORY_IPC_CONTRACTS, MANAGEMENT_IPC_CONTRACTS, PAYMENTS_IPC_CONTRACTS, POS_IPC_CONTRACTS, SYSTEM_GET_INFO_CHANNEL, SystemGetInfoRequestSchema, SystemInfoSchema } from '@cash-sloth/contracts';
import { createCatalogStore, createFinanceStore, createHistoryStore, createManagementStore, createPosStore, openDatabase, probeDatabase, runMigrations, seedDevelopmentCatalog } from '@cash-sloth/infrastructure-sqlite';
import {
  deriveDataPaths,
  ensureDataDirectories,
  resolveChannel,
  resolveDefaultBaseDirectory,
} from '@cash-sloth/platform';
import { handleValidatedAsyncIpc, handleValidatedIpc, type RuntimeParser, type SenderIdentity } from './ipc-security.js';
import { createDesktopFileService } from './file-operations.js';
import branding from '../../../assets/branding/manifest.json';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const uiDirectory = resolve(moduleDirectory, '../../pos-ui/dist');
const uiUrl = pathToFileURL(join(uiDirectory, 'index.html')).href;
const uiAssetPrefix = pathToFileURL(`${uiDirectory}/`).href;
const channel = resolveChannel(process.env['CASH_SLOTH_CHANNEL']);
const applicationId = `${branding.applicationId}.${channel}`;
const windowsIconPath = join(moduleDirectory, 'branding', branding.files.windowsIcon);
const windowIconPath = process.platform === 'win32'
  ? windowsIconPath
  : join(moduleDirectory, 'branding', branding.files.windowPng);
if (process.platform === 'win32') app.setAppUserModelId(applicationId);
const dataRootOverride = process.env['CASH_SLOTH_DATA_ROOT'];
if (dataRootOverride !== undefined && channel !== 'development') {
  throw new Error('CASH_SLOTH_DATA_ROOT overrides are restricted to development');
}
const paths = deriveDataPaths(dataRootOverride ?? resolveDefaultBaseDirectory(), channel);
ensureDataDirectories(paths);
const electronDirectory = join(paths.root, 'electron');
const sessionDirectory = join(electronDirectory, 'sessions');
const crashDirectory = join(electronDirectory, 'crash-dumps');
for (const directory of [electronDirectory, sessionDirectory, crashDirectory]) {
  mkdirSync(directory, { recursive: true });
}
app.setPath('userData', electronDirectory);
app.setPath('sessionData', sessionDirectory);
app.setPath('crashDumps', crashDirectory);
app.setAppLogsPath(paths.logsDirectory);
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;
let database: ReturnType<typeof openDatabase> | null = null;
const registeredChannels = new Set<string>();

// Invoked by the Node-side Electron smoke harness, never exposed to the renderer.
export const runFoundationProbe = probeDatabase;

function identity(window: BrowserWindow): SenderIdentity {
  const frame = window.webContents.mainFrame;
  return {
    webContentsId: window.webContents.id,
    frameProcessId: frame.processId,
    frameRoutingId: frame.routingId,
    url: uiUrl,
  };
}

async function createWindow(): Promise<void> {
  const isolatedSession = session.fromPartition(`persist:cash-sloth-${channel}`);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    // This shell has no network integrations. Only its own built static files load.
    callback({ cancel: !details.url.startsWith(uiAssetPrefix) });
  });
  const window = new BrowserWindow({
    title: branding.productName,
    icon: windowIconPath,
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    webPreferences: {
      preload: join(moduleDirectory, 'preload.cjs'),
      session: isolatedSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  if (process.platform === 'win32') {
    window.setAppDetails({ appId: applicationId, appIconPath: windowsIconPath, appIconIndex: 0 });
  }
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  await window.loadURL(uiUrl);
}

app.whenReady().then(async () => {
  database = openDatabase(paths.databaseFile);
  runMigrations(database);
  seedDevelopmentCatalog(database, channel);
  const row = database.sqlite.prepare('SELECT sqlite_version() AS version').get();
  if (typeof row?.['version'] !== 'string') throw new Error('SQLite version is unavailable');
  const sqliteVersion = row['version'];
  const service = createSystemService({
    getInfo: () => ({
      appVersion: app.getVersion(),
      channel,
      host: 'desktop',
      versions: { node: process.versions.node, electron: process.versions.electron },
      platform: process.platform,
      arch: process.arch,
      sqliteVersion,
    }),
  });
  function registerOperation<TRequest, TResponse>(
    contract: { channel: string; request: RuntimeParser<TRequest>; response: RuntimeParser<TResponse> },
    execute: (input: TRequest) => TResponse,
  ): void {
    ipcMain.handle(contract.channel, (event, ...args: unknown[]) => {
      const window = mainWindow;
      if (window === null || window.isDestroyed()) throw new Error('No active register window');
      const frame = event.senderFrame;
      const sender: SenderIdentity | null = frame === null ? null : {
        webContentsId: event.sender.id,
        frameProcessId: frame.processId,
        frameRoutingId: frame.routingId,
        url: frame.url,
      };
      return handleValidatedIpc(sender, identity(window), args, contract, execute);
    });
    registeredChannels.add(contract.channel);
  }
  registerOperation({ channel: SYSTEM_GET_INFO_CHANNEL, request: SystemGetInfoRequestSchema, response: SystemInfoSchema }, () => service.getInfo());
  const pos = createPosService(createPosStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(POS_IPC_CONTRACTS.listCatalog, (input) => pos.listCatalog(input));
  registerOperation(POS_IPC_CONTRACTS.getCart, (input) => pos.getCart(input));
  registerOperation(POS_IPC_CONTRACTS.addItem, (input) => pos.addItem(input));
  registerOperation(POS_IPC_CONTRACTS.setQuantity, (input) => pos.setQuantity(input));
  registerOperation(POS_IPC_CONTRACTS.removeItem, (input) => pos.removeItem(input));
  registerOperation(POS_IPC_CONTRACTS.clearCart, (input) => pos.clearCart(input));
  registerOperation(POS_IPC_CONTRACTS.prepareCheckout, (input) => pos.prepareCheckout(input));
  registerOperation(POS_IPC_CONTRACTS.completeSale, (input) => pos.completeSale(input));
  registerOperation(POS_IPC_CONTRACTS.reconcileCheckout, (input) => pos.reconcileCheckout(input));
  registerOperation(POS_IPC_CONTRACTS.getSale, (input) => pos.getSale(input));
  registerOperation(POS_IPC_CONTRACTS.listRecentSales, (input) => pos.listRecentSales(input));
  const catalog = createCatalogService(createCatalogStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(CATALOG_IPC_CONTRACTS.listProducts, (input) => catalog.listProducts(input));
  registerOperation(CATALOG_IPC_CONTRACTS.getProduct, (input) => catalog.getProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.createProduct, (input) => catalog.createProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.updateProduct, (input) => catalog.updateProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.createVariant, (input) => catalog.createVariant(input));
  registerOperation(CATALOG_IPC_CONTRACTS.updateVariant, (input) => catalog.updateVariant(input));
  registerOperation(CATALOG_IPC_CONTRACTS.assignCategories, (input) => catalog.assignCategories(input));
  registerOperation(CATALOG_IPC_CONTRACTS.listCategories, (input) => catalog.listCategories(input));
  registerOperation(CATALOG_IPC_CONTRACTS.createCategory, (input) => catalog.createCategory(input));
  registerOperation(CATALOG_IPC_CONTRACTS.updateCategory, (input) => catalog.updateCategory(input));
  const payments = createPaymentsService(createFinanceStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(PAYMENTS_IPC_CONTRACTS.startCheckout, (input) => payments.startCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getCheckout, (input) => payments.getCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getActiveCheckout, (input) => payments.getActiveCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.cancelCheckout, (input) => payments.cancelCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.preparePayment, (input) => payments.preparePayment(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.confirmPayment, (input) => payments.confirmPayment(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.reportPaymentOutcome, (input) => payments.reportPaymentOutcome(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.completeCheckout, (input) => payments.completeCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getSaleDetails, (input) => payments.getSaleDetails(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listRecentSales, (input) => payments.listRecentSales(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.prepareRefund, (input) => payments.prepareRefund(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getRefundAttempt, (input) => payments.getRefundAttempt(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.confirmRefund, (input) => payments.confirmRefund(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.reportRefundOutcome, (input) => payments.reportRefundOutcome(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listReconciliationCases, (input) => payments.listReconciliationCases(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listReconciliationHistory, (input) => payments.listReconciliationHistory(input));
  // Consequential local administration remains a separate, explicit operation.
  // Sender checks protect the register boundary; this MVP has no user authentication.
  registerOperation(PAYMENTS_IPC_CONTRACTS.reconcile, (input) => payments.reconcile(input));
  const management = createManagementService(createManagementStore(database), { newId: randomUUID, now: () => new Date().toISOString() }, { channel });
  registerOperation(MANAGEMENT_IPC_CONTRACTS.getCapabilities, (input) => management.getCapabilities(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.parseCsv, (input) => management.parseCsv(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.previewCsvImport, (input) => management.previewCsvImport(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.previewDemoCatalog, (input) => management.previewDemoCatalog(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.applyImportPlan, (input) => management.applyImportPlan(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.getImportOperation, (input) => management.getImportOperation(input));
  const history = createHistoryService(createHistoryStore(database), { now: () => new Date().toISOString() });
  registerOperation(HISTORY_IPC_CONTRACTS.search, (input) => history.search(input));
  registerOperation(HISTORY_IPC_CONTRACTS.getSaleContext, (input) => history.getSaleContext(input));
  const files = createDesktopFileService({
    chooseCatalogCsv: async () => {
      const window = mainWindow; if (!window || window.isDestroyed()) throw new Error('No active register window');
      const selected = await dialog.showOpenDialog(window, { title: 'Choose UTF-8 catalog CSV', properties: ['openFile'], filters: [{ name: 'CSV text files', extensions: ['csv', 'txt'] }] });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    },
    chooseExportDirectory: async () => {
      const window = mainWindow; if (!window || window.isDestroyed()) throw new Error('No active register window');
      const selected = await dialog.showOpenDialog(window, { title: 'Choose parent folder for a new sales export', properties: ['openDirectory', 'createDirectory'] });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    },
  }, (input) => history.prepareExport(input));
  function registerFileOperation<TRequest, TResponse>(
    contract: { channel: string; request: RuntimeParser<TRequest>; response: RuntimeParser<TResponse> },
    execute: (input: TRequest) => Promise<TResponse>,
  ): void {
    ipcMain.handle(contract.channel, async (event, ...args: unknown[]) => {
      const window = mainWindow; if (!window || window.isDestroyed()) throw new Error('No active register window');
      const frame = event.senderFrame;
      const sender: SenderIdentity | null = frame === null ? null : { webContentsId: event.sender.id, frameProcessId: frame.processId, frameRoutingId: frame.routingId, url: frame.url };
      return handleValidatedAsyncIpc(sender, identity(window), args, contract, execute);
    });
    registeredChannels.add(contract.channel);
  }
  registerFileOperation(FILES_IPC_CONTRACTS.chooseCatalogCsv, (input) => files.chooseCatalogCsv(input));
  registerFileOperation(FILES_IPC_CONTRACTS.exportSalesHistory, (input) => files.exportSalesHistory(input));
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error: unknown) => {
        console.error('Could not create the register window', error);
        app.quit();
      });
    }
  });
}).catch((error: unknown) => {
  console.error('Register startup failed', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  for (const ipcChannel of registeredChannels) ipcMain.removeHandler(ipcChannel);
  database?.close();
  database = null;
});
