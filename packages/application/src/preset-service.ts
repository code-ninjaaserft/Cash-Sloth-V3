import { PRESETS_IPC_CONTRACTS, PresetSnapshotSchema, type Preset, type PresetState, type PresetsMethod, type PresetsRequest, type PresetsResponse, type Result } from '@cash-sloth/contracts';
import { assertUniqueVariantMetadata, DomainError, nextRevision, validateCategoryForest, validateManagedProduct, type Category, type ManagedProduct } from '@cash-sloth/domain';
import { PersistenceError, type PosRuntime } from './ports.js';
import type { PresetStore } from './preset-ports.js';

export function createPresetService(store: PresetStore, runtime: PosRuntime): { [K in PresetsMethod]: (request: PresetsRequest<K>) => PresetsResponse<K> } {
  function safe<K extends PresetsMethod, T>(method: K, request: PresetsRequest<K>, action: () => T): Result<T> {
    try {
      if (!PRESETS_IPC_CONTRACTS[method].request.safeParse(request).success) throw new DomainError('INVALID_INPUT', 'Invalid preset request.');
      return { ok: true, value: store.transaction(action) };
    } catch (failure) {
      if (failure instanceof DomainError) return { ok: false, error: { code: failure.code, message: failure.message } };
      return { ok: false, error: { code: failure instanceof PersistenceError && failure.outcome === 'unknown' ? 'COMMIT_UNCERTAIN' : 'STORAGE_ERROR', message: 'The preset operation could not be confirmed. Check its stored result before continuing.' } };
    }
  }
  const state = (): PresetState => ({ active: store.active(), catalogVersion: store.catalogVersion(), presets: store.list().map(({ snapshot, ...preset }) => ({ ...preset, products: snapshot.products.filter((p) => p.active).length, variants: snapshot.products.filter((p) => p.active).reduce((sum, p) => sum + p.variants.filter((v) => v.active).length, 0), categories: snapshot.categories.filter((c) => c.active).length })) });
  const get = (id: string, revision: number): Preset => {
    const preset = store.get(id);
    if (!preset) throw new DomainError('NOT_FOUND', 'Preset not found.');
    if (preset.revision !== revision) throw new DomainError('CONFLICT', 'This preset changed. Refresh the list before continuing.');
    return preset;
  };
  function apply(preset: Preset): void {
    const snapshot = PresetSnapshotSchema.parse(preset.snapshot);
    const existingProducts = store.catalog.listProducts(), existingCategories = store.catalog.listCategories();
    const productMap = new Map(existingProducts.map((p) => [p.id, p]));
    const categoryMap = new Map(existingCategories.map((c) => [c.id, c]));
    if (new Set(snapshot.products.map((p) => p.id)).size !== snapshot.products.length || new Set(snapshot.categories.map((c) => c.id)).size !== snapshot.categories.length) throw new DomainError('INVALID_INPUT', 'Duplicate preset identities.');
    const categoryIds = new Set(snapshot.categories.map((c) => c.id));
    const categories: Category[] = snapshot.categories.map((c) => ({ ...c, revision: categoryMap.has(c.id) ? nextRevision(categoryMap.get(c.id)!.revision) : 0 }));
    categories.push(...existingCategories.filter((c) => !categoryIds.has(c.id)).map((c) => ({ ...c, active: false, revision: nextRevision(c.revision) })));
    validateCategoryForest(categories);
    const productIds = new Set(snapshot.products.map((p) => p.id));
    const products: ManagedProduct[] = snapshot.products.map((saved) => {
      const old = productMap.get(saved.id), oldVariants = new Map(old?.variants.map((v) => [v.id, v]) ?? []);
      const savedIds = new Set(saved.variants.map((v) => v.id));
      return { ...saved, createdAt: old?.createdAt ?? saved.createdAt, updatedAt: runtime.now(), revision: old ? nextRevision(old.revision) : 0,
        variants: [...saved.variants.map((v) => ({ ...v, revision: oldVariants.has(v.id) ? nextRevision(oldVariants.get(v.id)!.revision) : 0 })), ...(old?.variants.filter((v) => !savedIds.has(v.id)).map((v) => ({ ...v, sku: null, barcode: null, active: false, revision: nextRevision(v.revision) })) ?? [])] };
    });
    products.push(...existingProducts.filter((p) => !productIds.has(p.id)).map((p) => ({ ...p, active: false, updatedAt: runtime.now(), revision: nextRevision(p.revision), variants: p.variants.map((v) => ({ ...v, sku: null, barcode: null, revision: nextRevision(v.revision) })) })));
    for (const product of products) { validateManagedProduct(product); assertUniqueVariantMetadata(products, product); for (const id of product.categoryIds) if (!categories.some((c) => c.id === id)) throw new DomainError('NOT_FOUND', 'A preset category is missing.'); }
    // Insert parents before children; an existing category may be reparented later.
    const remaining = new Map(categories.map((c) => [c.id, c]));
    const written = new Set<string>();
    while (remaining.size) {
      let progress = false;
      for (const [id, category] of remaining) if (category.parentId === null || written.has(category.parentId)) {
        const old = categoryMap.get(id);
        if (old) store.catalog.updateCategory(category, old.revision); else store.catalog.insertCategory(category);
        written.add(id); remaining.delete(id); progress = true;
      }
      if (!progress) throw new DomainError('CATEGORY_CYCLE', 'Invalid preset category hierarchy.');
    }
    // Permit metadata swaps while preserving the final global uniqueness invariant.
    store.clearVariantMetadata(products.flatMap((p) => p.variants.map((v) => v.id)));
    for (const product of products) { const old = productMap.get(product.id); if (old) store.catalog.updateProduct(product, old.revision); else store.catalog.insertProduct(product); }
    store.setVisibleCatalog(snapshot.products.map((p) => p.id), snapshot.categories.map((c) => c.id), snapshot.products.flatMap((p) => p.variants.map((v) => v.id)));
    store.activate(preset);
  }
  function write<K extends 'save' | 'load' | 'copy' | 'remove' | 'update'>(method: K, request: PresetsRequest<K>, action: () => void): Result<PresetState> {
    return safe(method, request, () => {
      const canonical = JSON.stringify({ method, request });
      const previous = store.getOperation(request.operationId);
      if (previous) { if (previous.request !== canonical) throw new DomainError('CONFLICT', 'This preset operation reference belongs to another request.'); return previous.state; }
      store.assertIdle();
      if (request.catalogVersion !== store.catalogVersion()) throw new DomainError('CONFLICT', 'The catalog changed. Refresh before saving or loading a preset.');
      action(); const result = state(); store.putOperation(request.operationId, canonical, result); return result;
    });
  }
  return {
    update: (request) => write('update', request, () => {
      const old = get(request.presetId, request.expectedRevision);
      if (store.list().some((p) => p.id !== old.id && p.name.toLowerCase() === request.name.trim().toLowerCase())) throw new DomainError('DUPLICATE_NAME', 'A preset with this name already exists.');
      const updated: Preset = { ...old, name: request.name.trim(), logo: request.logo, revision: nextRevision(old.revision), updatedAt: runtime.now() };
      store.put(updated); if (store.active()?.id === old.id) store.activate(updated);
    }),
    getState: (request) => safe('getState', request, state),
    getOperation: (request) => safe('getOperation', request, () => store.getOperation(request.operationId)?.state ?? null),
    save: (request) => write('save', request, () => {
      const old = request.presetId === null ? null : get(request.presetId, request.expectedRevision ?? -1);
      if (old && request.empty) throw new DomainError('INVALID_INPUT', 'An existing preset cannot be replaced with an empty preset.');
      if (store.list().some((p) => p.id !== old?.id && p.name.toLowerCase() === request.name.trim().toLowerCase())) throw new DomainError('DUPLICATE_NAME', 'A preset with this name already exists.');
      const snapshot = PresetSnapshotSchema.parse(request.empty ? { products: [], categories: [] } : store.visibleSnapshot());
      validateCategoryForest(snapshot.categories); snapshot.products.forEach(validateManagedProduct);
      const preset: Preset = { ...(request.logo === undefined ? old?.logo === undefined ? {} : { logo: old.logo } : { logo: request.logo }), id: old?.id ?? runtime.newId(), name: request.name.trim(), revision: old ? nextRevision(old.revision) : 0, updatedAt: runtime.now(), snapshot };
      store.put(preset); if (request.empty) apply(preset); else store.activate(preset);
    }),
    copy: (request) => write('copy', request, () => {
      const source = get(request.presetId, request.expectedRevision);
      if (store.list().some((p) => p.name.toLowerCase() === request.name.trim().toLowerCase())) throw new DomainError('DUPLICATE_NAME', 'A preset with this name already exists.');
      const copied: Preset = { ...source, id: runtime.newId(), name: request.name.trim(), revision: 0, updatedAt: runtime.now() };
      store.put(copied); apply(copied);
    }),
    remove: (request) => write('remove', request, () => {
      const preset = get(request.presetId, request.expectedRevision);
      if (store.active()?.id === preset.id) apply({ ...preset, snapshot: { products: [], categories: [] } });
      store.remove(preset.id);
    }),
    load: (request) => write('load', request, () => apply(get(request.presetId, request.expectedRevision))),
  };
}
