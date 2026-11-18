/// <reference types="vite/client" />

import type { CashSlothApi } from '@cash-sloth/contracts';

declare global {
  interface Window {
    cashSloth?: CashSlothApi;
  }
}
