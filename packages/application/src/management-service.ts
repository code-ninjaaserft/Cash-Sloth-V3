import { MANAGEMENT_IPC_CONTRACTS, type ImportIssue, type ImportOperation, type ImportPreview, type ImportSummary, type ManagementMethod, type ManagementRequest, type ManagementResponse } from '@cash-sloth/contracts';
import { assertUniqueVariantMetadata, catalogImportId, DomainError, formatCategoryPath, importName, mapCatalogCsv, nextRevision, parseCatalogCsv, validateCategoryForest, validateManagedProduct, type Category, type ImportSourceProduct, type ManagedProduct, type ManagedVariant } from '@cash-sloth/domain';
import type { CatalogImportPlan, ImportIdentity, ManagementStore } from './management-ports.js';
import { PersistenceError, type PosRuntime } from './ports.js';
import { SWISS_DEMO_CATEGORY_PATHS, SWISS_DEMO_COUNTS, SWISS_DEMO_PRODUCTS } from './swiss-demo-catalog.js';

export type ManagementService = { [K in ManagementMethod]: (request: ManagementRequest<K>) => ManagementResponse<K> };
const MAX_IMPORT_CATEGORIES = 10_000;
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function safe<K extends ManagementMethod>(method: K, request: ManagementRequest<K>, execute: () => unknown): ManagementResponse<K> {
  try {
    if (!MANAGEMENT_IPC_CONTRACTS[method].request.safeParse(request).success) throw new DomainError('INVALID_INPUT', 'Invalid management request.');
    return MANAGEMENT_IPC_CONTRACTS[method].response.parse({ ok: true, value: execute() }) as ManagementResponse<K>;
  } catch (error) {
    const failure = error instanceof DomainError ? { code: error.code, message: error.message.slice(0, 300) }
      : error instanceof PersistenceError && error.outcome === 'unknown' ? { code: 'COMMIT_UNCERTAIN', message: 'The commit outcome is unknown. Look up the same import operation key before continuing.' }
        : { code: 'STORAGE_ERROR', message: 'The management operation could not be confirmed. Read the saved import result before repeating an apply request.' };
    return MANAGEMENT_IPC_CONTRACTS[method].response.parse({ ok: false, error: failure }) as ManagementResponse<K>;
  }
}
function catalogSnapshot(store: ManagementStore): string {
  const products = [...store.catalog.listProducts()].sort((left, right) => left.id.localeCompare(right.id, 'en')).map((product) => ({ ...product, categoryIds: [...product.categoryIds].sort(), variants: [...product.variants].sort((left, right) => left.id.localeCompare(right.id, 'en')) }));
  const categories = [...store.catalog.listCategories()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const identities = [...store.listIdentities()].sort((left, right) => `${left.source}:${left.kind}:${left.externalKey}`.localeCompare(`${right.source}:${right.kind}:${right.externalKey}`, 'en'));
  return JSON.stringify({ products, categories, identities });
}
function withoutVariantRevision(variant: ManagedVariant): unknown { return { name: variant.name, unitPriceRappen: variant.unitPriceRappen, sku: variant.sku, barcode: variant.barcode, active: variant.active }; }
function productFields(product: Pick<ManagedProduct, 'name' | 'description' | 'active' | 'categoryIds'>): unknown { return { name: product.name, description: product.description, active: product.active, categoryIds: [...product.categoryIds].sort() }; }

/** Preview decisions are stored by the host; the renderer cannot submit arbitrary mutation plans. */
export function createManagementService(store: ManagementStore, runtime: PosRuntime, options: { readonly channel: 'development' | 'beta' | 'stable' }): ManagementService {
  const assertDemoAllowed = (): void => { if (options.channel !== 'development') throw new DomainError('DEVELOPMENT_ONLY', 'The Swiss Demo Catalog is available only in Development.'); };
  const preview = (source: 'csv' | 'demo', sourceProducts: readonly ImportSourceProduct[], sourceIssues: readonly ImportIssue[], duplicateRows: number, rowsByVariant: ReadonlyMap<string, number>, explicitPaths: readonly (readonly string[])[] = []): ImportPreview => {
    const snapshot = catalogSnapshot(store); const existingProducts = store.catalog.listProducts(); const existingCategories = store.catalog.listCategories();
    validateCategoryForest(existingCategories);
    const identityRows = store.listIdentities(); const identities: ImportIdentity[] = [];
    const identityIndex = new Map(identityRows.filter((entry) => entry.source === source).map((entry) => [JSON.stringify([entry.kind, entry.externalKey]), entry.entityId]));
    const identity = (kind: ImportIdentity['kind'], key: string): string | null => identityIndex.get(JSON.stringify([kind, key])) ?? null;
    const remember = (kind: ImportIdentity['kind'], externalKey: string, entityId: string): void => { if (!identityIndex.has(JSON.stringify([kind, externalKey]))) identities.push({ source, kind, externalKey, entityId }); };
    const issues = [...sourceIssues]; const categories: Category[] = []; const categoryPreview: ImportPreview['categories'][number][] = [];
    const newProducts: ManagedProduct[] = []; const productUpdates: { product: ManagedProduct; expectedRevision: number }[] = []; const productPreview: ImportPreview['products'][number][] = [];
    const summary: { -readonly [K in keyof ImportSummary]: ImportSummary[K] } = { newProducts: 0, newVariants: 0, newCategories: 0, existingMatches: 0, duplicateRows, skippedProducts: 0, conflictingRecords: 0, invalidRows: new Set(sourceIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.rowNumber)).size };
    const categoryByPath = new Map<string, string>();
    const categoryIds = new Set(existingCategories.map((category) => category.id));
    const childIndex = new Map<string, Category[]>();
    const childKey = (parentId: string | null, name: string): string => JSON.stringify([parentId, importName(name).toLocaleLowerCase('en')]);
    const indexCategory = (category: Category): void => {
      const key = childKey(category.parentId, category.name); const siblings = childIndex.get(key) ?? [];
      siblings.push(category); childIndex.set(key, siblings);
    };
    for (const category of existingCategories) indexCategory(category);
    const resolvePath = (path: readonly string[]): string => {
      let parentId: string | null = null; const parts: string[] = [];
      for (const rawName of path) {
        const name = importName(rawName); parts.push(name); const pathKey = JSON.stringify(parts); const known = categoryByPath.get(pathKey);
        if (known !== undefined) { parentId = known; continue; }
        // Enforce the expansion budget before resolving or allocating another
        // distinct prefix. A small CSV can expand into far more category nodes.
        if (categoryPreview.length >= MAX_IMPORT_CATEGORIES) throw new DomainError('IMPORT_LIMIT', 'Import preview exceeds 10000 distinct category paths. Narrow the CSV before previewing again.');
        const candidates: readonly Category[] = childIndex.get(childKey(parentId, name)) ?? [];
        if (candidates.length > 1) throw new DomainError('AMBIGUOUS_CATEGORY', `Category path ${formatCategoryPath(parts)} matches multiple existing categories.`);
        let resolved: Category | undefined = candidates[0];
        if (resolved !== undefined && !resolved.active) throw new DomainError('INACTIVE_CATEGORY', `Category path ${formatCategoryPath(parts)} is inactive; import will not reactivate it.`);
        if (resolved === undefined) {
          if (categories.length >= MAX_IMPORT_CATEGORIES) throw new DomainError('IMPORT_LIMIT', 'Import exceeds 10000 new categories. Narrow the CSV before previewing again.');
          const id = identity('category', pathKey) ?? catalogImportId(`${source}-c`, pathKey);
          if (categoryIds.has(id)) throw new DomainError('IDENTITY_COLLISION', 'A deterministic category identity conflicts with another path.');
          resolved = { id, name, parentId, active: true, position: categories.length, revision: 0 };
          categories.push(resolved); categoryIds.add(id); indexCategory(resolved); summary.newCategories++;
          categoryPreview.push({ path: formatCategoryPath(parts), status: 'new' });
        } else categoryPreview.push({ path: formatCategoryPath(parts), status: 'match' });
        categoryByPath.set(pathKey, resolved.id); remember('category', pathKey, resolved.id); parentId = resolved.id;
      }
      if (parentId === null) throw new DomainError('CATEGORY_PATH', 'A category path cannot be empty.');
      return parentId;
    };
    for (const path of explicitPaths) {
      try { resolvePath(path); }
      catch (error) {
        if (error instanceof DomainError && error.code === 'IMPORT_LIMIT') throw error;
        issues.push({ rowNumber: 0, field: 'categoryPaths', code: error instanceof DomainError ? error.code : 'CATEGORY_PATH', message: error instanceof Error ? error.message : 'Invalid category path.', severity: source === 'demo' ? 'warning' : 'error' }); summary.conflictingRecords++;
      }
    }
    const allVariantIds = new Map(existingProducts.flatMap((product) => product.variants.map((variant) => [variant.id, variant] as const)));
    const outputProducts = [...existingProducts];
    const resolvedProductKeys = new Map<string, string>();
    for (const input of sourceProducts) {
      const rowNumber = rowsByVariant.get(input.variants[0]?.key ?? '') ?? 0;
      const priorIdentities = identities.length;
      let conflictRow = rowNumber; let conflictField = 'catalog';
      try {
        const productId = identity('product', input.key) ?? existingProducts.find((entry) => entry.id === input.key)?.id ?? `${source}-p-${input.key}`;
        const otherKey = resolvedProductKeys.get(productId);
        if (otherKey !== undefined && otherKey !== input.key) {
          conflictField = 'productKey';
          throw new DomainError('PRODUCT_IDENTITY_ALIAS', `Product keys ${otherKey} and ${input.key} resolve to the same catalog product. Use one product key consistently across its variant rows.`);
        }
        resolvedProductKeys.set(productId, input.key);
        const existing = existingProducts.find((entry) => entry.id === productId);
        if (source === 'demo' && existing && (existing.revision !== 0 || existing.imageReference !== null || existing.variants.some((variant) => variant.revision !== 0))) throw new DomainError('DEMO_EDITED', 'This demo product has been edited and is preserved unchanged.');
        const categoryIds = [...new Set(input.paths.map(resolvePath))].sort();
        const fields = { name: input.name, description: input.description, active: input.active, categoryIds };
        if (existing && !same(productFields(existing), productFields(fields))) {
          conflictField = existing.name !== input.name ? 'productName' : existing.description !== input.description ? 'description' : existing.active !== input.active ? 'productActive' : 'categoryPaths';
          throw new DomainError('PRODUCT_CONFLICT', 'Existing product details or category assignments differ. The import will not overwrite them.');
        }
        const additions: ManagedVariant[] = [];
        const desiredVariants: ManagedVariant[] = [];
        for (const inputVariant of input.variants) {
          conflictRow = rowsByVariant.get(inputVariant.key) ?? rowNumber; conflictField = 'variantKey';
          const variantId = identity('variant', inputVariant.key) ?? allVariantIds.get(inputVariant.key)?.id ?? `${source}-v-${inputVariant.key}`;
          const prior = allVariantIds.get(variantId);
          const position = prior?.position ?? (existing ? existing.variants.reduce((maximum, entry) => Math.max(maximum, entry.position), -1) + 1 + additions.length : inputVariant.position);
          if (position > 1_000_000) throw new DomainError('IMPORT_ORDER_LIMIT', 'This product has no remaining display-order space. Reorder its variants explicitly before importing another variant.');
          const desired: ManagedVariant = { id: variantId, productId, name: inputVariant.name, unitPriceRappen: inputVariant.unitPriceRappen, sku: inputVariant.sku, barcode: inputVariant.barcode, active: inputVariant.active, position, revision: 0 };
          if (prior && (prior.productId !== productId || !same(withoutVariantRevision(prior), withoutVariantRevision(desired)))) throw new DomainError('VARIANT_CONFLICT', `Variant ${inputVariant.key} differs from its existing historical import identity. No price or metadata is overwritten.`);
          const occupiedVariants = [...outputProducts.flatMap((entry) => entry.variants), ...additions];
          if (desired.sku !== null && occupiedVariants.some((entry) => entry.id !== variantId && entry.sku === desired.sku)) { conflictField = 'sku'; throw new DomainError('DUPLICATE_SKU', `SKU ${desired.sku} is already assigned to a different variant.`); }
          if (desired.barcode !== null && occupiedVariants.some((entry) => entry.id !== variantId && entry.barcode === desired.barcode)) { conflictField = 'barcode'; throw new DomainError('DUPLICATE_BARCODE', `Barcode ${desired.barcode} is already assigned to a different variant.`); }
          if (!prior) additions.push(desired);
          desiredVariants.push(prior ?? desired); remember('variant', inputVariant.key, variantId);
        }
        if (source === 'demo' && existing && (existing.variants.length !== desiredVariants.length || existing.variants.some((variant) => !desiredVariants.some((desired) => desired.id === variant.id)))) throw new DomainError('DEMO_EDITED', 'The demo product has user-added or removed variant relationships and is preserved unchanged.');
        const now = runtime.now();
        const candidate: ManagedProduct = existing ? { ...existing, variants: [...existing.variants, ...additions], revision: additions.length ? nextRevision(existing.revision) : existing.revision, updatedAt: additions.length ? now : existing.updatedAt }
          : { id: productId, ...fields, imageReference: null, createdAt: now, updatedAt: now, revision: 0, primaryCategoryId: categoryIds[0] ?? null, variants: desiredVariants };
        validateManagedProduct(candidate); assertUniqueVariantMetadata(outputProducts, candidate);
        remember('product', input.key, productId);
        if (existing) {
          if (additions.length) { productUpdates.push({ product: candidate, expectedRevision: existing.revision }); summary.newVariants += additions.length; }
          else summary.existingMatches++;
          productPreview.push({ productKey: input.key, name: input.name, variants: input.variants.length, status: additions.length ? 'extend' : 'match' });
        } else { newProducts.push(candidate); summary.newProducts++; summary.newVariants += candidate.variants.length; productPreview.push({ productKey: input.key, name: input.name, variants: input.variants.length, status: 'new' }); }
        const index = outputProducts.findIndex((entry) => entry.id === candidate.id); if (index < 0) outputProducts.push(candidate); else outputProducts[index] = candidate;
        for (const variant of candidate.variants) allVariantIds.set(variant.id, variant);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'IMPORT_LIMIT') throw error;
        summary.conflictingRecords++; if (source === 'demo') summary.skippedProducts++;
        issues.push({ rowNumber: conflictRow, field: conflictField, code: error instanceof DomainError ? error.code : 'CATALOG_CONFLICT', message: (error instanceof Error ? error.message : 'Catalog conflict.').slice(0, 500), severity: source === 'demo' ? 'warning' : 'error' });
        productPreview.push({ productKey: input.key, name: input.name, variants: input.variants.length, status: 'skipped' });
        // CSV plans with conflicts never apply. Demo's explicit categories remain
        // available, while failed product-specific provenance is not installed.
        identities.splice(priorIdentities);
      }
    }
    if (categories.length > 10_000 || newProducts.length > 10_000 || issues.length > 10_000) throw new DomainError('IMPORT_LIMIT', 'The validated import exceeds supported catalog mutation or issue limits.');
    validateCategoryForest([...existingCategories, ...categories]);
    const result: ImportPreview = { planId: runtime.newId(), source, canApply: !issues.some((issue) => issue.severity === 'error'), summary, issues, products: productPreview, categories: categoryPreview, createdAt: runtime.now() };
    const plan: CatalogImportPlan = { preview: result, catalogSnapshot: snapshot, categories, newProducts, productUpdates, identities };
    store.insertPlan(plan); return result;
  };
  return {
    getCapabilities: (request) => safe('getCapabilities', request, () => ({ developmentDemoAllowed: options.channel === 'development', demo: SWISS_DEMO_COUNTS })),
    parseCsv: (request) => safe('parseCsv', request, () => { const parsed = parseCatalogCsv(request.text, request.delimiter); return { ...parsed, rows: parsed.rows.slice(0, 100) }; }),
    previewCsvImport: (request) => safe('previewCsvImport', request, () => store.transaction(() => { const mapped = mapCatalogCsv(parseCatalogCsv(request.text, request.delimiter), request.mapping); return preview('csv', mapped.products, mapped.issues, mapped.duplicateRows, mapped.rowsByVariant); })),
    previewDemoCatalog: (request) => safe('previewDemoCatalog', request, () => { assertDemoAllowed(); return store.transaction(() => preview('demo', SWISS_DEMO_PRODUCTS, [], 0, new Map(), SWISS_DEMO_CATEGORY_PATHS)); }),
    applyImportPlan: (request) => safe('applyImportPlan', request, () => store.transaction(() => {
      const replay = store.getOperation(request.idempotencyKey);
      if (replay) { if (replay.source === 'demo') assertDemoAllowed(); if (replay.planId !== request.planId) throw new DomainError('IDEMPOTENCY_CONFLICT', 'The import key is bound to another plan.'); return replay; }
      const prior = store.getOperationForPlan(request.planId); if (prior) throw new DomainError('PLAN_APPLIED', 'This plan was already applied. Read its original import result or create a fresh preview.');
      const plan = store.getPlan(request.planId); if (!plan) throw new DomainError('NOT_FOUND', 'Import preview not found. Create a new preview.');
      if (plan.preview.source === 'demo') assertDemoAllowed();
      if (!plan.preview.canApply) throw new DomainError('IMPORT_INVALID', 'The preview contains unresolved errors. Correct the source or mapping and create a new preview.');
      if (catalogSnapshot(store) !== plan.catalogSnapshot) throw new DomainError('STALE_PREVIEW', 'The catalog changed after this preview. Create a new preview before applying.');
      for (const category of plan.categories) store.catalog.insertCategory(category);
      for (const product of plan.newProducts) store.catalog.insertProduct(product);
      for (const update of plan.productUpdates) store.catalog.updateProduct(update.product, update.expectedRevision);
      for (const identity of plan.identities) store.insertIdentity(identity);
      const operation: ImportOperation = { idempotencyKey: request.idempotencyKey, planId: request.planId, source: plan.preview.source, completedAt: runtime.now(), summary: plan.preview.summary };
      store.insertOperation(operation); return operation;
    })),
    getImportOperation: (request) => safe('getImportOperation', request, () => store.transaction(() => { const operation = store.getOperation(request.idempotencyKey); if (operation?.source === 'demo') assertDemoAllowed(); return operation; })),
  };
}
