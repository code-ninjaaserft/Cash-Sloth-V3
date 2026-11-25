/// <reference types="vite/client" />

import type { OrderInfoApi, KitchenApi, KioskApi, CashSlothApi, CustomerReadApi, TicketdeskApi } from '@cash-sloth/contracts';

declare global {
  interface Window {
    cashSlothOrderInfo?: OrderInfoApi;
    cashSlothKitchen?: KitchenApi;
    cashSlothKiosk?: KioskApi;
    cashSloth?: CashSlothApi;
    cashSlothTicketdesk?: TicketdeskApi;
    cashSlothCustomer?: CustomerReadApi;
  }
}
