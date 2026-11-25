import type {OrderSettings,Order,KioskCatalog} from '@cash-sloth/contracts';
import type {PosStore} from './ports.js';
export interface OrderStore {
 settings():OrderSettings; saveSettings(settings:OrderSettings):void; resetCounter():void;
 pos:PosStore; catalog():KioskCatalog; nextNumber():number; list():readonly Order[]; get(id:string):Order|null; put(order:Order):void;
 operation(id:string):{request:string;result:string}|null; saveOperation(id:string,request:string,result:string):void;
}
