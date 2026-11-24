import { contextBridge, ipcRenderer } from 'electron';
import {
  PROMOTIONS_CONTRACTS,
  type PromotionsApi,
  TICKETDESK_CONTRACTS,
  TICKETS_CONTRACTS,
  type TicketsApi,
  DEMO_CONTRACTS,
  CUSTOMER_DISPLAY_CONTRACTS,
  SYSTEM_GET_INFO_CHANNEL,
  SystemGetInfoRequestSchema,
  SystemInfoSchema,
  POS_IPC_CONTRACTS,
  CATALOG_IPC_CONTRACTS,
  PAYMENTS_IPC_CONTRACTS,
  MANAGEMENT_IPC_CONTRACTS,
  HISTORY_IPC_CONTRACTS,
  PRESETS_IPC_CONTRACTS,
  type PresetsApi,
  FILES_IPC_CONTRACTS,
  type CashSlothApi,
  type CustomerPaymentPreview,
  type PosApi,
  type CatalogApi,
  type PaymentsApi,
  type ManagementApi,
  type HistoryApi,
  type FilesApi,
} from '@cash-sloth/contracts';

interface RuntimeParser<T> { parse(value: unknown): T }
async function invoke<TRequest, TResponse>(
  contract: { channel: string; request: RuntimeParser<TRequest>; response: RuntimeParser<TResponse> },
  input: TRequest,
): Promise<TResponse> {
  const request = contract.request.parse(input);
  return contract.response.parse(await ipcRenderer.invoke(contract.channel, request));
}

const pos: PosApi = Object.freeze({
  listCatalog: (input) => invoke(POS_IPC_CONTRACTS.listCatalog, input),
  getCart: (input) => invoke(POS_IPC_CONTRACTS.getCart, input),
  addItem: (input) => invoke(POS_IPC_CONTRACTS.addItem, input),
  setQuantity: (input) => invoke(POS_IPC_CONTRACTS.setQuantity, input),
  removeItem: (input) => invoke(POS_IPC_CONTRACTS.removeItem, input),
  clearCart: (input) => invoke(POS_IPC_CONTRACTS.clearCart, input),
  prepareCheckout: (input) => invoke(POS_IPC_CONTRACTS.prepareCheckout, input),
  completeSale: (input) => invoke(POS_IPC_CONTRACTS.completeSale, input),
  reconcileCheckout: (input) => invoke(POS_IPC_CONTRACTS.reconcileCheckout, input),
  getSale: (input) => invoke(POS_IPC_CONTRACTS.getSale, input),
  listRecentSales: (input) => invoke(POS_IPC_CONTRACTS.listRecentSales, input),
});

const catalog: CatalogApi = Object.freeze({
  removeVariant: (input) => invoke(CATALOG_IPC_CONTRACTS.removeVariant, input),
  removeProduct: (input) => invoke(CATALOG_IPC_CONTRACTS.removeProduct, input),
  removeCategory: (input) => invoke(CATALOG_IPC_CONTRACTS.removeCategory, input),
  listProducts: (input) => invoke(CATALOG_IPC_CONTRACTS.listProducts, input),
  getProduct: (input) => invoke(CATALOG_IPC_CONTRACTS.getProduct, input),
  createProduct: (input) => invoke(CATALOG_IPC_CONTRACTS.createProduct, input),
  updateProduct: (input) => invoke(CATALOG_IPC_CONTRACTS.updateProduct, input),
  createVariant: (input) => invoke(CATALOG_IPC_CONTRACTS.createVariant, input),
  updateVariant: (input) => invoke(CATALOG_IPC_CONTRACTS.updateVariant, input),
  assignCategories: (input) => invoke(CATALOG_IPC_CONTRACTS.assignCategories, input),
  listCategories: (input) => invoke(CATALOG_IPC_CONTRACTS.listCategories, input),
  createCategory: (input) => invoke(CATALOG_IPC_CONTRACTS.createCategory, input),
  updateCategory: (input) => invoke(CATALOG_IPC_CONTRACTS.updateCategory, input),
});

const payments: PaymentsApi = Object.freeze({
 completeTeam: input=>invoke(PAYMENTS_IPC_CONTRACTS.completeTeam,input),
 listTeam: input=>invoke(PAYMENTS_IPC_CONTRACTS.listTeam,input),
  setTip: (input) => invoke(PAYMENTS_IPC_CONTRACTS.setTip, input),
  startCheckout: (input) => invoke(PAYMENTS_IPC_CONTRACTS.startCheckout, input),
  getCheckout: (input) => invoke(PAYMENTS_IPC_CONTRACTS.getCheckout, input),
  getActiveCheckout: (input) => invoke(PAYMENTS_IPC_CONTRACTS.getActiveCheckout, input),
  cancelCheckout: (input) => invoke(PAYMENTS_IPC_CONTRACTS.cancelCheckout, input),
  preparePayment: (input) => invoke(PAYMENTS_IPC_CONTRACTS.preparePayment, input),
  confirmPayment: (input) => invoke(PAYMENTS_IPC_CONTRACTS.confirmPayment, input),
  reportPaymentOutcome: (input) => invoke(PAYMENTS_IPC_CONTRACTS.reportPaymentOutcome, input),
  completeCheckout: (input) => invoke(PAYMENTS_IPC_CONTRACTS.completeCheckout, input),
  getSaleDetails: (input) => invoke(PAYMENTS_IPC_CONTRACTS.getSaleDetails, input),
  listRecentSales: (input) => invoke(PAYMENTS_IPC_CONTRACTS.listRecentSales, input),
  prepareRefund: (input) => invoke(PAYMENTS_IPC_CONTRACTS.prepareRefund, input),
  getRefundAttempt: (input) => invoke(PAYMENTS_IPC_CONTRACTS.getRefundAttempt, input),
  confirmRefund: (input) => invoke(PAYMENTS_IPC_CONTRACTS.confirmRefund, input),
  reportRefundOutcome: (input) => invoke(PAYMENTS_IPC_CONTRACTS.reportRefundOutcome, input),
  listReconciliationCases: (input) => invoke(PAYMENTS_IPC_CONTRACTS.listReconciliationCases, input),
  listReconciliationHistory: (input) => invoke(PAYMENTS_IPC_CONTRACTS.listReconciliationHistory, input),
  reconcile: (input) => invoke(PAYMENTS_IPC_CONTRACTS.reconcile, input),
});

const management: ManagementApi = Object.freeze({
  getCapabilities: (input) => invoke(MANAGEMENT_IPC_CONTRACTS.getCapabilities, input),
  parseCsv: (input) => invoke(MANAGEMENT_IPC_CONTRACTS.parseCsv, input),
  previewCsvImport: (input) => invoke(MANAGEMENT_IPC_CONTRACTS.previewCsvImport, input),
  previewDemoCatalog: (input) => invoke(MANAGEMENT_IPC_CONTRACTS.previewDemoCatalog, input),
  applyImportPlan: (input) => invoke(MANAGEMENT_IPC_CONTRACTS.applyImportPlan, input),
  getImportOperation: (input) => invoke(MANAGEMENT_IPC_CONTRACTS.getImportOperation, input),
});
const history: HistoryApi = Object.freeze({
  previewRemoval: (input) => invoke(HISTORY_IPC_CONTRACTS.previewRemoval, input),
  removeHistory: (input) => invoke(HISTORY_IPC_CONTRACTS.removeHistory, input),
  getEvents: (input) => invoke(HISTORY_IPC_CONTRACTS.getEvents, input),
  removeSale: (input) => invoke(HISTORY_IPC_CONTRACTS.removeSale, input),
  search: (input) => invoke(HISTORY_IPC_CONTRACTS.search, input),
  getSaleContext: (input) => invoke(HISTORY_IPC_CONTRACTS.getSaleContext, input),
});
const files: FilesApi = Object.freeze({
  chooseCatalogCsv: (input) => invoke(FILES_IPC_CONTRACTS.chooseCatalogCsv, input),
  exportSalesHistory: (input) => invoke(FILES_IPC_CONTRACTS.exportSalesHistory, input),
});

const presets: PresetsApi = Object.freeze({
  copy: (input) => invoke(PRESETS_IPC_CONTRACTS.copy, input),
  remove: (input) => invoke(PRESETS_IPC_CONTRACTS.remove, input),
  update: (input) => invoke(PRESETS_IPC_CONTRACTS.update, input),
  getState: (input) => invoke(PRESETS_IPC_CONTRACTS.getState, input),
  save: (input) => invoke(PRESETS_IPC_CONTRACTS.save, input),
  load: (input) => invoke(PRESETS_IPC_CONTRACTS.load, input),
  getOperation: (input) => invoke(PRESETS_IPC_CONTRACTS.getOperation, input),
});
const tickets: TicketsApi = Object.freeze({ invalidate: input=>invoke(TICKETS_CONTRACTS.invalidate,input),setExpiry:input=>invoke(TICKETS_CONTRACTS.setExpiry,input), listForSale: (input) => invoke(TICKETS_CONTRACTS.listForSale, input), lookup: (input) => invoke(TICKETS_CONTRACTS.lookup, input), redeem: (input) => invoke(TICKETS_CONTRACTS.redeem, input) });
const promotions=Object.freeze<PromotionsApi>({getState:input=>invoke(PROMOTIONS_CONTRACTS.getState,input),saveTemplate:input=>invoke(PROMOTIONS_CONTRACTS.saveTemplate,input),removeTemplate:input=>invoke(PROMOTIONS_CONTRACTS.removeTemplate,input),issue:input=>invoke(PROMOTIONS_CONTRACTS.issue,input),control:input=>invoke(PROMOTIONS_CONTRACTS.control,input),apply:input=>invoke(PROMOTIONS_CONTRACTS.apply,input),clear:input=>invoke(PROMOTIONS_CONTRACTS.clear,input),walletPay:input=>invoke(PROMOTIONS_CONTRACTS.walletPay,input),walletCancel:input=>invoke(PROMOTIONS_CONTRACTS.walletCancel,input)});
const api: CashSlothApi = Object.freeze({
 promotions,
  ticketdesk: Object.freeze({ open: (input: Record<string, never>) => invoke(TICKETDESK_CONTRACTS.open, input) }),
  tickets,
  demo: Object.freeze({ getState: (input: Record<string, never>) => invoke(DEMO_CONTRACTS.getState, input), setMode: (input: { enabled: boolean }) => invoke(DEMO_CONTRACTS.setMode, input) }),
  customerDisplay: Object.freeze({ open: (input: Record<string, never>) => invoke(CUSTOMER_DISPLAY_CONTRACTS.open, input), preview: (input: CustomerPaymentPreview) => invoke(CUSTOMER_DISPLAY_CONTRACTS.preview, input) }),
  presets,
  system: Object.freeze({
    getInfo: () => invoke({ channel: SYSTEM_GET_INFO_CHANNEL, request: SystemGetInfoRequestSchema, response: SystemInfoSchema }, {}),
  }),
  pos,
  catalog,
  payments,
  management,
  history,
  files,
});

contextBridge.exposeInMainWorld('cashSloth', api);
