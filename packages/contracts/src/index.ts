import type {OrdersApi} from './orders.js';
export * from './orders.js';
import type {PromotionsApi} from './promotions.js';
export * from './promotions.js';
import type { TicketdeskControlApi } from './ticketdesk.js';
export * from './ticketdesk.js';
import type { TicketsApi } from './tickets.js';
export * from './tickets.js';
import type { DemoApi } from './demo.js';
export * from './demo.js';
import type { CustomerDisplayApi } from './customer-display.js';
export * from './customer-display.js';
import type { PresetsApi } from './presets.js';
export * from './presets.js';
import { z } from 'zod';
import type { PosApi } from './pos.js';
import type { CatalogApi } from './catalog.js';
import type { PaymentsApi } from './payments.js';
import type { ManagementApi } from './management.js';
import type { HistoryApi } from './history.js';
import type { FilesApi } from './files.js';
export * from './pos.js';
export * from './catalog.js';
export * from './payments.js';
export * from './management.js';
export * from './history.js';
export * from './files.js';

export const ChannelSchema = z.enum(['development', 'beta', 'stable']);
export type Channel = z.infer<typeof ChannelSchema>;
export type HostKind = 'desktop' | 'pi';

export const SYSTEM_GET_INFO_CHANNEL = 'system:getInfo';
export const SystemGetInfoRequestSchema = z.strictObject({});
export const SystemInfoSchema = z.strictObject({
  appVersion: z.string().min(1).max(100),
  channel: ChannelSchema,
  host: z.enum(['desktop', 'pi']),
  versions: z.strictObject({
    node: z.string().min(1).max(100),
    electron: z.string().min(1).max(100).optional(),
  }),
  platform: z.string().min(1).max(100),
  arch: z.string().min(1).max(100),
  sqliteVersion: z.string().min(1).max(100),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export interface CashSlothApi {
 readonly orders?:OrdersApi;
 readonly promotions?:PromotionsApi;
  readonly ticketdesk?: TicketdeskControlApi;
  readonly tickets?: TicketsApi;
  readonly demo?: DemoApi;
  readonly customerDisplay?: CustomerDisplayApi;
  readonly presets: PresetsApi;
  readonly management: ManagementApi;
  readonly history: HistoryApi;
  readonly files: FilesApi;
  readonly payments: PaymentsApi;
  readonly catalog: CatalogApi;
  readonly pos: PosApi;
  readonly system: {
    getInfo(): Promise<SystemInfo>;
  };
}
