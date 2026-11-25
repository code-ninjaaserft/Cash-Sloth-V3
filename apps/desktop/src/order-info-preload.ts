import {contextBridge,ipcRenderer} from 'electron';
import {ORDERS_CONTRACTS,type OrderInfoApi} from '@cash-sloth/contracts';
const api=Object.freeze<OrderInfoApi>({
board:async input=>ORDERS_CONTRACTS.board.response.parse(await ipcRenderer.invoke(ORDERS_CONTRACTS.board.channel,ORDERS_CONTRACTS.board.request.parse(input)))
});
contextBridge.exposeInMainWorld('cashSlothOrderInfo',api);
