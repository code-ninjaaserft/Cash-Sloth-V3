import type { SystemInfo } from '@cash-sloth/contracts';
export * from './ports.js';
export * from './pos-service.js';
export * from './catalog-ports.js';
export * from './catalog-service.js';
export * from './finance-ports.js';
export * from './payments-service.js';
export * from './management-ports.js';
export * from './management-service.js';
export * from './swiss-demo-catalog.js';
export * from './history-ports.js';
export * from './history-service.js';

export interface SystemInfoProvider {
  getInfo(): SystemInfo;
}

/** The host supplies technical facts; the use case has no host or DB imports. */
export function createSystemService(provider: SystemInfoProvider) {
  return { getInfo: (): SystemInfo => provider.getInfo() };
}

export * from './preset-ports.js';
export * from './preset-service.js';

export * from './customer-display-service.js';

export { createTicketService } from './ticket-service.js';
export type { TicketStore, TicketRedemption } from './ticket-ports.js';

export {createPromotionService} from './promotion-service.js';
export type {PromotionStore,PromotionRuntime} from './promotion-ports.js';
