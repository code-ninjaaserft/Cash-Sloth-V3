import { contextBridge, ipcRenderer } from 'electron';
import { TICKETDESK_CONTRACTS, TICKETS_CONTRACTS, type TicketdeskApi } from '@cash-sloth/contracts';
interface Parser<T> { parse(value: unknown): T }
async function invoke<I,O>(contract: { channel: string; request: Parser<I>; response: Parser<O> }, input: I): Promise<O> { return contract.response.parse(await ipcRenderer.invoke(contract.channel, contract.request.parse(input))); }
const api: TicketdeskApi = Object.freeze<TicketdeskApi>({
 getState: (input) => invoke(TICKETDESK_CONTRACTS.getState,input),
 lookup: (input) => invoke(TICKETS_CONTRACTS.lookup,input),
 redeem: (input) => invoke(TICKETS_CONTRACTS.redeem,input),
});
contextBridge.exposeInMainWorld('cashSlothTicketdesk',api);
