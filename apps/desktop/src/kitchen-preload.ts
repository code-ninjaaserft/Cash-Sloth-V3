import {contextBridge,ipcRenderer} from 'electron';
import {ORDERS_CONTRACTS,type KitchenApi} from '@cash-sloth/contracts';
const api=Object.freeze<KitchenApi>({
kitchen:async input=>ORDERS_CONTRACTS.kitchen.response.parse(await ipcRenderer.invoke(ORDERS_CONTRACTS.kitchen.channel,ORDERS_CONTRACTS.kitchen.request.parse(input))),
prepare:async input=>ORDERS_CONTRACTS.prepare.response.parse(await ipcRenderer.invoke(ORDERS_CONTRACTS.prepare.channel,ORDERS_CONTRACTS.prepare.request.parse(input)))
});
contextBridge.exposeInMainWorld('cashSlothKitchen',api);
