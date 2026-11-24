import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { createPromotionService, createTicketService, createCustomerDisplayService, createPresetService, createCatalogService, createHistoryService, createManagementService, createPaymentsService, createPosService, createSystemService } from '@cash-sloth/application';
import { PROMOTIONS_CONTRACTS, TICKETDESK_CONTRACTS, TICKETS_CONTRACTS, DEMO_CONTRACTS, CUSTOMER_DISPLAY_CONTRACTS, PRESETS_IPC_CONTRACTS, CATALOG_IPC_CONTRACTS, FILES_IPC_CONTRACTS, HISTORY_IPC_CONTRACTS, MANAGEMENT_IPC_CONTRACTS, PAYMENTS_IPC_CONTRACTS, POS_IPC_CONTRACTS, SYSTEM_GET_INFO_CHANNEL, SystemGetInfoRequestSchema, SystemInfoSchema } from '@cash-sloth/contracts';
import { createPromotionStore, createTicketStore, createPresetStore, createCatalogStore, createFinanceStore, createHistoryStore, createManagementStore, createPosStore, openDatabase, probeDatabase, runMigrations, seedDevelopmentCatalog } from '@cash-sloth/infrastructure-sqlite';
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
let customerWindow: BrowserWindow | null = null;
let ticketdeskWindow: BrowserWindow | null = null;
const ticketdeskUrl = uiUrl + '?ticketdesk=1';
const customerUrl = uiUrl + '?customer=1';
let database: ReturnType<typeof openDatabase> | null = null;
let demoMode = false;
let demoSessionId: string | null = null;
let demoDirectory: string | null = null;
let demoDatabase: ReturnType<typeof openDatabase> | null = null;
let switchingMode = false;
function removeDemoDirectory(directory: string): void {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('cash-sloth-demo-')) throw new Error('Invalid demo cleanup directory.');
  try { rmSync(target, { recursive: true, force: true }); }
  catch (failure) { console.warn('Could not remove the temporary demo directory', failure); }
}
const registeredChannels = new Set<string>();

// Invoked by the Node-side Electron smoke harness, never exposed to the renderer.
export const runFoundationProbe = probeDatabase;

function identity(window: BrowserWindow, url = uiUrl): SenderIdentity {
  const frame = window.webContents.mainFrame;
  return {
    webContentsId: window.webContents.id,
    frameProcessId: frame.processId,
    frameRoutingId: frame.routingId,
    url,
  };
}

async function createWindow(): Promise<void> {
  const isolatedSession = session.fromPartition(`persist:cash-sloth-${channel}`);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    // This shell has no network integrations. Only its own built static files load.
    callback({ cancel: !details.url.startsWith(uiAssetPrefix) && !/^data:image\/(?:png|jpeg|webp);base64,/u.test(details.url) });
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
    if (mainWindow === window) { mainWindow = null; customerWindow?.close(); ticketdeskWindow?.close(); }
  });
  await window.loadURL(uiUrl);
}

async function openCustomerWindow(): Promise<void> {
  if (customerWindow && !customerWindow.isDestroyed()) { if (customerWindow.isMinimized()) customerWindow.restore(); customerWindow.show(); customerWindow.focus(); return; }
  const window = new BrowserWindow({ title: 'Cash Sloth — Customer display', icon: windowIconPath, width: 1100, height: 760, minWidth: 640, minHeight: 480, show: false,
    webPreferences: { preload: join(moduleDirectory, 'customer-preload.cjs'), session: session.fromPartition('persist:cash-sloth-' + channel), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false } });
  customerWindow = window; window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault()); window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show()); window.on('closed', () => { if (customerWindow === window) customerWindow = null; });
  try { await window.loadURL(customerUrl); } catch (failure) { if (!window.isDestroyed()) window.close(); throw failure; }
}

async function openTicketdeskWindow(): Promise<void> {
 if (ticketdeskWindow && !ticketdeskWindow.isDestroyed()) { if (ticketdeskWindow.isMinimized()) ticketdeskWindow.restore(); ticketdeskWindow.show(); ticketdeskWindow.focus(); return; }
 const window = new BrowserWindow({ title: 'Cash Sloth — Ticketdesk', icon: windowIconPath, width: 1000, height: 800, minWidth: 640, minHeight: 480, show: false,
  webPreferences: { preload: join(moduleDirectory,'ticketdesk-preload.cjs'), session: session.fromPartition('persist:cash-sloth-' + channel), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false } });
 ticketdeskWindow=window; window.setMenu(null);
 window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
 window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-attach-webview', event => event.preventDefault());
 window.once('ready-to-show', () => window.show()); window.on('closed', () => { if (ticketdeskWindow === window) ticketdeskWindow=null; });
 try { await window.loadURL(ticketdeskUrl); } catch (failure) { if (!window.isDestroyed()) window.close(); throw failure; }
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
    allowTicketdesk = false,
  ): void {
    ipcMain.handle(contract.channel, (event, ...args: unknown[]) => {
      const fromTicketdesk = allowTicketdesk && ticketdeskWindow !== null && !ticketdeskWindow.isDestroyed() && event.sender.id === ticketdeskWindow.webContents.id;
      const window = fromTicketdesk ? ticketdeskWindow : mainWindow;
      if (window === null || window.isDestroyed()) throw new Error('No active register window');
      const frame = event.senderFrame;
      const sender: SenderIdentity | null = frame === null ? null : {
        webContentsId: event.sender.id,
        frameProcessId: frame.processId,
        frameRoutingId: frame.routingId,
        url: frame.url,
      };
      return handleValidatedIpc(sender, identity(window, fromTicketdesk ? ticketdeskUrl : uiUrl), args, contract, (input) => {
        if (switchingMode) throw new Error('Mode switch in progress.');
        if (demoMode && ['history:removeSale', 'history:removeHistory', 'payments:prepareRefund', 'payments:confirmRefund', 'payments:reconcile'].includes(contract.channel)) throw new Error('Unavailable in demo mode.');
        return execute(input);
      });
    });
    registeredChannels.add(contract.channel);
  }
  registerOperation({ channel: SYSTEM_GET_INFO_CHANNEL, request: SystemGetInfoRequestSchema, response: SystemInfoSchema }, () => service.getInfo());
  let pos = createPosService(createPosStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
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
  registerOperation(POS_IPC_CONTRACTS.listRecentSales, (input) => live.pos.listRecentSales(input));
  let presets = createPresetService(createPresetStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(PRESETS_IPC_CONTRACTS.update, (input) => presets.update(input));
  registerOperation(PRESETS_IPC_CONTRACTS.getState, (input) => presets.getState(input));
  registerOperation(PRESETS_IPC_CONTRACTS.copy, (input) => presets.copy(input));
  registerOperation(PRESETS_IPC_CONTRACTS.remove, (input) => presets.remove(input));
  registerOperation(PRESETS_IPC_CONTRACTS.save, (input) => presets.save(input));
  registerOperation(PRESETS_IPC_CONTRACTS.load, (input) => presets.load(input));
  registerOperation(PRESETS_IPC_CONTRACTS.getOperation, (input) => presets.getOperation(input));
  let catalog = createCatalogService(createCatalogStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(CATALOG_IPC_CONTRACTS.listProducts, (input) => catalog.listProducts(input));
  registerOperation(CATALOG_IPC_CONTRACTS.getProduct, (input) => catalog.getProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.removeVariant, (input) => catalog.removeVariant(input));
  registerOperation(CATALOG_IPC_CONTRACTS.removeProduct, (input) => catalog.removeProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.removeCategory, (input) => catalog.removeCategory(input));
  registerOperation(CATALOG_IPC_CONTRACTS.createProduct, (input) => catalog.createProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.updateProduct, (input) => catalog.updateProduct(input));
  registerOperation(CATALOG_IPC_CONTRACTS.createVariant, (input) => catalog.createVariant(input));
  registerOperation(CATALOG_IPC_CONTRACTS.updateVariant, (input) => catalog.updateVariant(input));
  registerOperation(CATALOG_IPC_CONTRACTS.assignCategories, (input) => catalog.assignCategories(input));
  registerOperation(CATALOG_IPC_CONTRACTS.listCategories, (input) => catalog.listCategories(input));
  registerOperation(CATALOG_IPC_CONTRACTS.createCategory, (input) => catalog.createCategory(input));
  registerOperation(CATALOG_IPC_CONTRACTS.updateCategory, (input) => catalog.updateCategory(input));
  let payments = createPaymentsService(createFinanceStore(database), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(PAYMENTS_IPC_CONTRACTS.completeTeam,input=>payments.completeTeam(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listTeam,input=>payments.listTeam(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.setTip, (input) => payments.setTip(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.startCheckout, (input) => payments.startCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getCheckout, (input) => payments.getCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getActiveCheckout, (input) => payments.getActiveCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.cancelCheckout, (input) => payments.cancelCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.preparePayment, (input) => payments.preparePayment(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.confirmPayment, (input) => payments.confirmPayment(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.reportPaymentOutcome, (input) => payments.reportPaymentOutcome(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.completeCheckout, (input) => payments.completeCheckout(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getSaleDetails, (input) => payments.getSaleDetails(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listRecentSales, (input) => live.payments.listRecentSales(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.prepareRefund, (input) => payments.prepareRefund(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.getRefundAttempt, (input) => payments.getRefundAttempt(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.confirmRefund, (input) => payments.confirmRefund(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.reportRefundOutcome, (input) => payments.reportRefundOutcome(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listReconciliationCases, (input) => payments.listReconciliationCases(input));
  registerOperation(PAYMENTS_IPC_CONTRACTS.listReconciliationHistory, (input) => payments.listReconciliationHistory(input));
  // Consequential local administration remains a separate, explicit operation.
  // Sender checks protect the register boundary; this MVP has no user authentication.
  registerOperation(PAYMENTS_IPC_CONTRACTS.reconcile, (input) => payments.reconcile(input));
  let management = createManagementService(createManagementStore(database), { newId: randomUUID, now: () => new Date().toISOString() }, { channel });
  registerOperation(MANAGEMENT_IPC_CONTRACTS.getCapabilities, (input) => management.getCapabilities(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.parseCsv, (input) => management.parseCsv(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.previewCsvImport, (input) => management.previewCsvImport(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.previewDemoCatalog, (input) => management.previewDemoCatalog(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.applyImportPlan, (input) => management.applyImportPlan(input));
  registerOperation(MANAGEMENT_IPC_CONTRACTS.getImportOperation, (input) => management.getImportOperation(input));
  const history = createHistoryService(createHistoryStore(database), { now: () => new Date().toISOString() });
  registerOperation(HISTORY_IPC_CONTRACTS.previewRemoval, (input) => history.previewRemoval(input));
  registerOperation(HISTORY_IPC_CONTRACTS.removeHistory, (input) => history.removeHistory(input));
  registerOperation(HISTORY_IPC_CONTRACTS.getEvents, (input) => history.getEvents(input));
  registerOperation(HISTORY_IPC_CONTRACTS.removeSale, (input) => history.removeSale(input));
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
  let displayCartStore = createPosStore(database);
  let displayFinanceStore = createFinanceStore(database);
  let displayPresetStore = createPresetStore(database);
  let display = createCustomerDisplayService({ transaction: displayCartStore.transaction, getCart: () => displayCartStore.getDraftCart(), getCheckout: () => { const current = displayFinanceStore.getOpenSession(); return current ? { session: current, attempts: displayFinanceStore.listPaymentAttempts(current.id) } : null; }, getEventLogo: () => displayPresetStore.active()?.logo ?? null, getEventTitle: () => displayFinanceStore.getEventTitle?.() ?? null });
  let tickets = createTicketService(createTicketStore(database!), { newId: randomUUID, now: () => new Date().toISOString() });
  registerOperation(TICKETS_CONTRACTS.listForSale, (input) => tickets.listForSale(input));
  registerOperation(TICKETS_CONTRACTS.invalidate,input=>tickets.invalidate(input));
  registerOperation(TICKETS_CONTRACTS.setExpiry,input=>tickets.setExpiry(input));
  registerOperation(TICKETS_CONTRACTS.lookup, (input) => tickets.lookup(input), true);
  registerOperation(TICKETS_CONTRACTS.redeem, (input) => tickets.redeem(input), true);
  registerOperation(TICKETDESK_CONTRACTS.getState, () => ({ enabled: demoMode, sessionId: demoSessionId }), true);
  registerFileOperation(TICKETDESK_CONTRACTS.open, async () => { await openTicketdeskWindow(); return { ok: true as const, value: { opened: true as const } }; });
  const promotionRuntime={newId:randomUUID,now:()=>new Date().toISOString(),newVoucherCode:(mode:'normal'|'demo')=>(mode==='demo'?'AD':'AC')+randomUUID().replaceAll('-','').slice(0,14).toUpperCase()};
  let promotions=createPromotionService(createPromotionStore(database!),promotionRuntime);
  registerOperation(PROMOTIONS_CONTRACTS.getState,input=>promotions.getState(input));
  registerOperation(PROMOTIONS_CONTRACTS.saveTemplate,input=>promotions.saveTemplate(input));
  registerOperation(PROMOTIONS_CONTRACTS.removeTemplate,input=>promotions.removeTemplate(input));
  registerOperation(PROMOTIONS_CONTRACTS.issue,input=>promotions.issue(input));
  registerOperation(PROMOTIONS_CONTRACTS.control,input=>promotions.control(input));
  registerOperation(PROMOTIONS_CONTRACTS.apply,input=>promotions.apply(input));
  registerOperation(PROMOTIONS_CONTRACTS.clear,input=>promotions.clear(input));
  registerOperation(PROMOTIONS_CONTRACTS.walletPay,input=>promotions.walletPay(input));
  registerOperation(PROMOTIONS_CONTRACTS.walletCancel,input=>promotions.walletCancel(input));
  const live = { promotions,tickets, pos, presets, catalog, payments, management, displayCartStore, displayFinanceStore, displayPresetStore, display };
  registerOperation(DEMO_CONTRACTS.getState, () => ({ enabled: demoMode, sessionId: demoSessionId }));
  registerFileOperation(DEMO_CONTRACTS.setMode, async ({ enabled }) => {
    if (switchingMode) return { ok: false as const, error: 'Please wait for the mode switch.' };
    if (enabled === demoMode) return { ok: true as const, value: { enabled: demoMode, sessionId: demoSessionId } };
    let nextDirectory: string | null = null;
    let nextDatabase: ReturnType<typeof openDatabase> | null = null;
    try {
      createPresetStore(demoDatabase ?? database!).assertIdle();
      switchingMode = true;
      if (enabled) {
        nextDirectory = mkdtempSync(join(tmpdir(), 'cash-sloth-demo-'));
        const file = join(nextDirectory, 'demo.sqlite');
        database!.sqlite.prepare('VACUUM INTO ?').run(file);
        nextDatabase = openDatabase(file, { ticketMode: 'demo' });
        const clock = { newId: randomUUID, now: () => new Date().toISOString() };
        promotions=createPromotionService(createPromotionStore(nextDatabase),promotionRuntime);
        tickets = createTicketService(createTicketStore(nextDatabase), clock);
        pos = createPosService(createPosStore(nextDatabase), clock);
        presets = createPresetService(createPresetStore(nextDatabase), clock);
        catalog = createCatalogService(createCatalogStore(nextDatabase), clock);
        payments = createPaymentsService(createFinanceStore(nextDatabase), clock);
        management = createManagementService(createManagementStore(nextDatabase), clock, { channel });
        displayCartStore = createPosStore(nextDatabase); displayFinanceStore = createFinanceStore(nextDatabase); displayPresetStore = createPresetStore(nextDatabase);
        display = createCustomerDisplayService({ transaction: displayCartStore.transaction, getCart: () => displayCartStore.getDraftCart(), getCheckout: () => { const current = displayFinanceStore.getOpenSession(); return current ? { session: current, attempts: displayFinanceStore.listPaymentAttempts(current.id) } : null; }, getEventLogo: () => displayPresetStore.active()?.logo ?? null, getEventTitle: () => displayFinanceStore.getEventTitle?.() ?? null });
        demoDatabase = nextDatabase; demoDirectory = nextDirectory; demoSessionId = randomUUID();
      } else {
        ({ promotions,tickets, pos, presets, catalog, payments, management, displayCartStore, displayFinanceStore, displayPresetStore, display } = live);
        demoDatabase?.close(); demoDatabase = null;
        if (demoDirectory) removeDemoDirectory(demoDirectory);
        demoDirectory = null; demoSessionId = null;
      }
      demoMode = enabled;
      // A ticketdesk must be explicitly reopened for the new ledger/mode.
      ticketdeskWindow?.close();
      return { ok: true as const, value: { enabled: demoMode, sessionId: demoSessionId } };
    } catch {
      if (enabled) {
        ({ promotions,tickets, pos, presets, catalog, payments, management, displayCartStore, displayFinanceStore, displayPresetStore, display } = live);
        nextDatabase?.close();
        if (nextDirectory) removeDemoDirectory(nextDirectory);
      }
      return { ok: false as const, error: 'Empty the cart and finish any payment or refund before switching modes.' };
    } finally { switchingMode = false; }
  });
  registerOperation(CUSTOMER_DISPLAY_CONTRACTS.preview, (input) => display.preview(input));
  registerFileOperation(CUSTOMER_DISPLAY_CONTRACTS.open, async () => { await openCustomerWindow(); return { ok: true as const, value: { opened: true as const } }; });
  ipcMain.handle(CUSTOMER_DISPLAY_CONTRACTS.getState.channel, (event, ...args: unknown[]) => {
    const window = customerWindow; if (!window || window.isDestroyed()) throw new Error('No customer window');
    const frame = event.senderFrame; const sender = frame ? { webContentsId: event.sender.id, frameProcessId: frame.processId, frameRoutingId: frame.routingId, url: frame.url } : null;
    return handleValidatedIpc(sender, identity(window, customerUrl), args, CUSTOMER_DISPLAY_CONTRACTS.getState, () => { const result = display.getState(); return result.ok ? { ok: true as const, value: { ...result.value, demoMode } } : result; });
  });
  registeredChannels.add(CUSTOMER_DISPLAY_CONTRACTS.getState.channel);
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
  demoDatabase?.close();
  if (demoDirectory) removeDemoDirectory(demoDirectory);
  database?.close();
  database = null;
});
