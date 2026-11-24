import { createHash } from 'node:crypto';
import { DomainError } from '@cash-sloth/domain';
import { PresetSchema, PresetStateSchema, type Preset } from '@cash-sloth/contracts';
import type { PresetStore } from '@cash-sloth/application';
import { createCatalogStore } from './catalog-store.js';
import { createPosStore } from './pos-store.js';
import type { DatabaseConnection } from './connection.js';
export function createPresetStore(connection: DatabaseConnection): PresetStore {
  const { sqlite } = connection, catalog = createCatalogStore(connection, { includeHidden: true }), pos = createPosStore(connection);
  const read = (data: unknown): Preset => {
    if (typeof data !== 'string') throw new Error('Missing preset snapshot.');
    return PresetSchema.parse(JSON.parse(data) as unknown);
  };
  const writable = (): void => { if (!sqlite.isTransaction) throw new Error('Preset writes require a transaction.'); };
  const store: PresetStore = {
    catalog, transaction: pos.transaction,
    visibleSnapshot() { const visible = createCatalogStore(connection); return { products: visible.listProducts(), categories: visible.listCategories() }; },
    setVisibleCatalog(products, categories, variants) {
      writable(); sqlite.exec('INSERT INTO hidden_catalog_variants SELECT id FROM product_variants WHERE true ON CONFLICT DO NOTHING');
      for (const id of variants) sqlite.prepare('DELETE FROM hidden_catalog_variants WHERE variant_id=?').run(id);
      sqlite.exec('INSERT INTO hidden_catalog_products SELECT id FROM products WHERE true ON CONFLICT DO NOTHING; INSERT INTO hidden_catalog_categories SELECT id FROM categories WHERE true ON CONFLICT DO NOTHING;');
      const showProduct = sqlite.prepare('DELETE FROM hidden_catalog_products WHERE product_id=?'), showCategory = sqlite.prepare('DELETE FROM hidden_catalog_categories WHERE category_id=?');
      for (const id of products) showProduct.run(id); for (const id of categories) showCategory.run(id);
    },
    remove(id) { writable(); sqlite.prepare('DELETE FROM active_event_preset WHERE preset_id=?').run(id); sqlite.prepare('INSERT INTO removed_event_presets VALUES(?) ON CONFLICT DO NOTHING').run(id); },
    list: () => sqlite.prepare('SELECT data FROM event_presets WHERE id NOT IN (SELECT preset_id FROM removed_event_presets) ORDER BY id').all().map((row) => read(row['data'])),
    get(id) { const row = sqlite.prepare('SELECT data FROM event_presets WHERE id = ? AND id NOT IN (SELECT preset_id FROM removed_event_presets)').get(id); return row ? read(row['data']) : null; },
    put(input) { writable(); const preset = PresetSchema.parse(input); sqlite.prepare('INSERT INTO event_presets(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(preset.id, JSON.stringify(preset)); },
    active() { const row = sqlite.prepare('SELECT p.data FROM active_event_preset a JOIN event_presets p ON p.id=a.preset_id WHERE a.singleton=1').get(); if (!row) return null; const { id, name, logo } = read(row['data']); return { id, name, ...(logo === undefined ? {} : { logo }) }; },
    activate(preset) { writable(); sqlite.prepare('INSERT INTO active_event_preset VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET preset_id=excluded.preset_id').run(preset.id); },
    catalogVersion() { return createHash('sha256').update(JSON.stringify({ products: catalog.listProducts(), categories: catalog.listCategories() })).digest('hex'); },
    assertIdle() {
      if ((pos.getDraftCart()?.items.length ?? 0) > 0 || pos.getUnresolvedCheckout() !== null || sqlite.prepare("SELECT 1 FROM payment_sessions WHERE state='open'").get() || sqlite.prepare("SELECT 1 FROM refund_attempts WHERE state IN ('prepared','reported','uncertain')").get()) throw new DomainError('PRESET_BUSY', 'Finish the current sale or refund and empty the cart before switching or saving presets.');
    },
    clearVariantMetadata(ids) { writable(); const clear = sqlite.prepare('UPDATE product_variants SET sku=NULL, barcode=NULL WHERE id=?'); for (const id of ids) clear.run(id); },
    getOperation(id) {
      const row = sqlite.prepare('SELECT request,state FROM preset_operations WHERE id=?').get(id);
      if (!row) return null;
      if (typeof row['request'] !== 'string' || typeof row['state'] !== 'string') throw new Error('Invalid stored preset operation.');
      return { request: row['request'], state: PresetStateSchema.parse(JSON.parse(row['state']) as unknown) };
    },
    putOperation(id, request, state) { writable(); sqlite.prepare('INSERT INTO preset_operations VALUES(?,?,?)').run(id, request, JSON.stringify(PresetStateSchema.parse(state))); },
  };
  return store;
}
