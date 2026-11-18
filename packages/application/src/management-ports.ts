import type { Category, ManagedProduct } from '@cash-sloth/domain';
import type { ImportOperation, ImportPreview } from '@cash-sloth/contracts';
import type { CatalogStore } from './catalog-ports.js';

export interface ImportIdentity { readonly source: 'csv' | 'demo'; readonly kind: 'product' | 'variant' | 'category'; readonly externalKey: string; readonly entityId: string }
export interface CatalogImportPlan {
  readonly preview: ImportPreview;
  readonly catalogSnapshot: string;
  readonly categories: readonly Category[];
  readonly newProducts: readonly ManagedProduct[];
  readonly productUpdates: readonly { readonly product: ManagedProduct; readonly expectedRevision: number }[];
  readonly identities: readonly ImportIdentity[];
}
export interface ManagementStore {
  readonly catalog: CatalogStore;
  transaction<T>(operation: () => T): T;
  listIdentities(): readonly ImportIdentity[];
  insertIdentity(identity: ImportIdentity): void;
  getPlan(id: string): CatalogImportPlan | null;
  insertPlan(plan: CatalogImportPlan): void;
  getOperation(key: string): ImportOperation | null;
  getOperationForPlan(planId: string): ImportOperation | null;
  insertOperation(operation: ImportOperation): void;
}
