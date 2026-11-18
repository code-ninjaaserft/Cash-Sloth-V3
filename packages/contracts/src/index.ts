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
