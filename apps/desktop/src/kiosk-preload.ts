import {contextBridge,ipcRenderer} from 'electron';
import {ORDERS_CONTRACTS,type KioskApi} from '@cash-sloth/contracts';
const api=Object.freeze<KioskApi>({
 catalog:async input=>ORDERS_CONTRACTS.catalog.response.parse(await ipcRenderer.invoke(ORDERS_CONTRACTS.catalog.channel,ORDERS_CONTRACTS.catalog.request.parse(input))),
 submit:async input=>ORDERS_CONTRACTS.submit.response.parse(await ipcRenderer.invoke(ORDERS_CONTRACTS.submit.channel,ORDERS_CONTRACTS.submit.request.parse(input))),
});
contextBridge.exposeInMainWorld('cashSlothKiosk',api);
