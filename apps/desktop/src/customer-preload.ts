import { contextBridge, ipcRenderer } from 'electron';
import { CUSTOMER_DISPLAY_CONTRACTS, type CustomerReadApi } from '@cash-sloth/contracts';
const api: CustomerReadApi = Object.freeze({
  async getState(input: Record<string, never>) { const contract = CUSTOMER_DISPLAY_CONTRACTS.getState; return contract.response.parse(await ipcRenderer.invoke(contract.channel, contract.request.parse(input))); },
});
contextBridge.exposeInMainWorld('cashSlothCustomer', api);
