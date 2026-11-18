import type { Category, ManagedProduct } from '@cash-sloth/domain';
import type { PosRuntime } from './ports.js';

export type CatalogRuntime = PosRuntime;
export interface CatalogStore {
  transaction<T>(operation: () => T): T;
  listProducts(): readonly ManagedProduct[];
  getProduct(productId: string): ManagedProduct | null;
  insertProduct(product: ManagedProduct): void;
  updateProduct(product: ManagedProduct, expectedRevision: number): void;
  listCategories(): readonly Category[];
  getCategory(categoryId: string): Category | null;
  insertCategory(category: Category): void;
  updateCategory(category: Category, expectedRevision: number): void;
}
