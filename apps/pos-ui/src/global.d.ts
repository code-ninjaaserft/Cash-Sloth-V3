/// <reference types="vite/client" />

import type { CashSlothApi, CustomerReadApi, TicketdeskApi } from '@cash-sloth/contracts';

declare global {
  interface Window {
    cashSloth?: CashSlothApi;
    cashSlothTicketdesk?: TicketdeskApi;
    cashSlothCustomer?: CustomerReadApi;
  }
}
