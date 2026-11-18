import { assertIdentifier, DomainError } from './models.js';
import { assertRappen } from './money.js';

export interface ManagedVariant {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly unitPriceRappen: number;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly active: boolean;
  readonly position: number;
  readonly revision: number;
}
export interface ManagedProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly imageReference: string | null;
  readonly revision: number;
  readonly categoryIds: readonly string[];
  readonly primaryCategoryId: string | null;
  readonly variants: readonly ManagedVariant[];
}
export interface Category {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly active: boolean;
  readonly position: number;
  readonly revision: number;
}
export interface CategorySummary extends Category {
  readonly productCount: number;
  readonly browseable: boolean;
}
export interface CatalogQuery {
  readonly query: string;
  readonly categoryId: string | null;
  readonly restrictToCategory: boolean;
  readonly includeInactive: boolean;
}

export function assertCatalogName(value: string): void {
  // Existing MVP 0.1 names are preserved byte-for-byte. New/edit requests apply
  // stricter presentation normalization at the application contract boundary.
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) throw new DomainError('INVALID_INPUT', 'A name must contain 1 to 200 characters and cannot be blank.');
}
export function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('INVALID_INPUT', 'Invalid catalog revision.');
}
export function nextRevision(value: number): number {
  assertRevision(value);
  if (value === Number.MAX_SAFE_INTEGER) throw new DomainError('OVERFLOW', 'Catalog revision overflow.');
  return value + 1;
}
export function normalizeSku(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new DomainError('INVALID_INPUT', 'Invalid SKU.');
  const normalized = value.normalize('NFC').trim().toUpperCase();
  if (!normalized || normalized.length > 100 || /\p{Cc}/u.test(normalized)) throw new DomainError('INVALID_INPUT', 'SKU must contain 1 to 100 printable characters.');
  return normalized;
}
export function normalizeBarcode(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new DomainError('INVALID_INPUT', 'Invalid barcode.');
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || /\p{Cc}/u.test(normalized)) throw new DomainError('INVALID_INPUT', 'Barcode must contain 1 to 100 printable characters.');
  return normalized;
}
function assertPosition(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new DomainError('INVALID_INPUT', 'Display order must be an integer from 0 to 1000000.');
}
export function validateManagedVariant(variant: ManagedVariant): void {
  assertIdentifier(variant.id); assertIdentifier(variant.productId); assertCatalogName(variant.name);
  assertRappen(variant.unitPriceRappen); assertRevision(variant.revision); assertPosition(variant.position);
  if (typeof variant.active !== 'boolean') throw new DomainError('INVALID_INPUT', 'Invalid variant status.');
  if (normalizeSku(variant.sku) !== variant.sku || normalizeBarcode(variant.barcode) !== variant.barcode) throw new DomainError('INVALID_INPUT', 'Variant metadata must use its canonical form.');
}
export function validateManagedProduct(product: ManagedProduct): void {
  assertIdentifier(product.id); assertCatalogName(product.name); assertRevision(product.revision);
  if (typeof product.active !== 'boolean') throw new DomainError('INVALID_INPUT', 'Invalid product status.');
  if (product.description !== null && (typeof product.description !== 'string' || product.description.length > 4000)) throw new DomainError('INVALID_INPUT', 'Description is too long.');
  if (product.imageReference !== null && (typeof product.imageReference !== 'string' || product.imageReference.length === 0 || product.imageReference.length > 500 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(product.imageReference) || product.imageReference.split('/').includes('..'))) throw new DomainError('INVALID_INPUT', 'Image reference must be a safe relative asset identifier.');
  for (const value of [product.createdAt, product.updatedAt]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new DomainError('INVALID_INPUT', 'Invalid product timestamp.');
  }
  if (product.variants.length === 0 || new Set(product.variants.map((variant) => variant.id)).size !== product.variants.length) throw new DomainError('INVALID_INPUT', 'A product requires at least one distinct variant.');
  for (const variant of product.variants) { validateManagedVariant(variant); if (variant.productId !== product.id) throw new DomainError('INVALID_INPUT', 'Variant belongs to another product.'); }
  if (new Set(product.categoryIds).size !== product.categoryIds.length) throw new DomainError('INVALID_INPUT', 'Category assignments must be distinct.');
  for (const id of product.categoryIds) assertIdentifier(id);
  if (product.primaryCategoryId !== null && !product.categoryIds.includes(product.primaryCategoryId)) throw new DomainError('INVALID_INPUT', 'The primary category must also be assigned.');
}
export function validateCategory(category: Category): void {
  assertIdentifier(category.id); assertCatalogName(category.name); assertRevision(category.revision); assertPosition(category.position);
  if (typeof category.active !== 'boolean') throw new DomainError('INVALID_INPUT', 'Invalid category status.');
  if (category.parentId !== null) assertIdentifier(category.parentId);
  if (category.parentId === category.id) throw new DomainError('CATEGORY_CYCLE', 'A category cannot be its own parent.');
}

/** Iterative parent walks accept arbitrary depth without consuming the call stack. */
export function validateCategoryForest(categories: readonly Category[]): void {
  const byId = new Map(categories.map((category) => [category.id, category]));
  if (byId.size !== categories.length) throw new DomainError('INVALID_INPUT', 'Category identities must be distinct.');
  for (const category of categories) { validateCategory(category); if (category.parentId !== null && !byId.has(category.parentId)) throw new DomainError('NOT_FOUND', 'Parent category does not exist.'); }
  const complete = new Set<string>();
  for (const category of categories) {
    const path = new Set<string>();
    let id: string | null = category.id;
    while (id !== null && !complete.has(id)) {
      if (path.has(id)) throw new DomainError('CATEGORY_CYCLE', 'Category relationships cannot form a cycle.');
      path.add(id);
      id = byId.get(id)?.parentId ?? null;
    }
    for (const visited of path) complete.add(visited);
  }
}
export function compareCatalogOrder(left: { position: number; name: string; id: string }, right: { position: number; name: string; id: string }): number {
  return left.position - right.position || left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en');
}
export function descendantsOf(categories: readonly Category[], rootId: string): ReadonlySet<string> {
  validateCategoryForest(categories);
  if (!categories.some((category) => category.id === rootId)) throw new DomainError('NOT_FOUND', 'Category does not exist.');
  const children = new Map<string, string[]>();
  for (const category of categories) if (category.parentId !== null) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category.id); children.set(category.parentId, siblings);
  }
  const ids = new Set<string>();
  const queue = [rootId];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (id === undefined) continue;
    ids.add(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return ids;
}
export function browseableCategoryIds(categories: readonly Category[]): ReadonlySet<string> {
  validateCategoryForest(categories);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const visibility = new Map<string, boolean>();
  for (const category of categories) {
    const path: Category[] = [];
    let current: Category | undefined = category;
    while (current !== undefined && !visibility.has(current.id)) {
      path.push(current);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    let visible = current === undefined ? true : visibility.get(current.id) === true;
    for (let index = path.length - 1; index >= 0; index--) {
      const entry = path[index];
      if (entry === undefined) continue;
      visible = visible && entry.active;
      visibility.set(entry.id, visible);
    }
  }
  return new Set([...visibility].filter(([, visible]) => visible).map(([id]) => id));
}
function searchable(value: string): string { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en'); }
export function searchCatalog(products: readonly ManagedProduct[], categories: readonly Category[], query: CatalogQuery): readonly ManagedProduct[] {
  const text = searchable(query.query.trim());
  if (query.query.length > 200) throw new DomainError('INVALID_INPUT', 'Search text is too long.');
  const visibleIds = browseableCategoryIds(categories);
  let scope: ReadonlySet<string> | null = null;
  if (query.categoryId !== null && (text === '' || query.restrictToCategory)) {
    const descendants = descendantsOf(categories, query.categoryId);
    scope = query.includeInactive ? descendants : new Set([...descendants].filter((id) => visibleIds.has(id)));
  }
  return products.filter((product) => {
    validateManagedProduct(product);
    const variants = query.includeInactive ? product.variants : product.variants.filter((variant) => variant.active);
    if (!query.includeInactive && (!product.active || variants.length === 0)) return false;
    if (scope !== null && !product.categoryIds.some((id) => scope.has(id))) return false;
    return text === '' || searchable(product.name).includes(text) || variants.some((variant) => searchable(variant.name).includes(text) || searchable(variant.sku ?? '').includes(text) || searchable(variant.barcode ?? '').includes(text));
  }).map((product) => ({ ...product, variants: [...product.variants].filter((variant) => query.includeInactive || variant.active).sort(compareCatalogOrder) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'));
}
export function categorySummaries(products: readonly ManagedProduct[], categories: readonly Category[], includeInactive: boolean): readonly CategorySummary[] {
  const visibleIds = browseableCategoryIds(categories);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const counts = new Map<string, number>();
  for (const product of products) {
    validateManagedProduct(product);
    if (!product.active || !product.variants.some((variant) => variant.active)) continue;
    const countedForProduct = new Set<string>();
    for (const assigned of product.categoryIds) {
      if (!visibleIds.has(assigned)) continue;
      let id: string | null = assigned;
      while (id !== null && !countedForProduct.has(id)) {
        countedForProduct.add(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        id = byId.get(id)?.parentId ?? null;
      }
    }
  }
  return [...categories].filter((category) => includeInactive || visibleIds.has(category.id)).sort(compareCatalogOrder).map((category) => ({
    ...category, browseable: visibleIds.has(category.id),
    productCount: counts.get(category.id) ?? 0,
  }));
}
export function assertUniqueVariantMetadata(products: readonly ManagedProduct[], candidate: ManagedProduct): void {
  const skus = new Set<string>(); const barcodes = new Set<string>();
  for (const product of [...products.filter((entry) => entry.id !== candidate.id), candidate]) for (const variant of product.variants) {
    if (variant.sku !== null) { const sku = normalizeSku(variant.sku); if (sku !== null && skus.has(sku)) throw new DomainError('DUPLICATE_SKU', 'This SKU is already assigned to another variant.'); if (sku !== null) skus.add(sku); }
    if (variant.barcode !== null) { const barcode = normalizeBarcode(variant.barcode); if (barcode !== null && barcodes.has(barcode)) throw new DomainError('DUPLICATE_BARCODE', 'This barcode is already assigned to another variant.'); if (barcode !== null) barcodes.add(barcode); }
  }
}
