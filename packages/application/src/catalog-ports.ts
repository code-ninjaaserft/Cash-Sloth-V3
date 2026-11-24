import type { Category, ManagedProduct } from '@cash-sloth/domain';
import type { PosRuntime } from './ports.js';

export type CatalogRuntime = PosRuntime;
export interface CatalogStore {
  removeVariant?(productId: string, variantId: string, expectedProductRevision: number, expectedRevision: number, updatedAt: string): void;
  removeProduct?(id: string, expectedRevision: number, updatedAt: string): void;
  removeCategory?(id: string, expectedRevision: number, updatedAt: string): void;
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
