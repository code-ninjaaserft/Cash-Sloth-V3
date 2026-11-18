import { contextBridge, ipcRenderer } from 'electron';
import {
  SYSTEM_GET_INFO_CHANNEL,
  SystemGetInfoRequestSchema,
  SystemInfoSchema,
  POS_IPC_CONTRACTS,
  CATALOG_IPC_CONTRACTS,
  PAYMENTS_IPC_CONTRACTS,
  MANAGEMENT_IPC_CONTRACTS,
  HISTORY_IPC_CONTRACTS,
  FILES_IPC_CONTRACTS,
  type CashSlothApi,
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
  search: (input) => invoke(HISTORY_IPC_CONTRACTS.search, input),
  getSaleContext: (input) => invoke(HISTORY_IPC_CONTRACTS.getSaleContext, input),
});
const files: FilesApi = Object.freeze({
  chooseCatalogCsv: (input) => invoke(FILES_IPC_CONTRACTS.chooseCatalogCsv, input),
  exportSalesHistory: (input) => invoke(FILES_IPC_CONTRACTS.exportSalesHistory, input),
});

const api: CashSlothApi = Object.freeze({
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
