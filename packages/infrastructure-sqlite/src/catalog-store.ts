import {
  compareCatalogOrder, DomainError, validateCategory, validateManagedProduct, validateManagedVariant,
  type Category, type ManagedProduct, type ManagedVariant,
} from '@cash-sloth/domain';
import type { CatalogStore } from '@cash-sloth/application';
import { CategorySchema, ManagedProductSchema, ManagedVariantSchema } from '@cash-sloth/contracts';
import type { DatabaseConnection } from './connection.js';
import { createPosStore } from './pos-store.js';

type Row = Record<string, unknown>;
function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw new Error(`Invalid persisted catalog ${field}.`);
  return value;
}
function nullableText(row: Row, field: string): string | null {
  return row[field] === null ? null : text(row, field);
}
function integer(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid persisted catalog ${field}.`);
  return value;
}
function active(row: Row): boolean {
  if (row['active'] !== 0 && row['active'] !== 1) throw new Error('Invalid persisted catalog status.');
  return row['active'] === 1;
}
function variantFrom(row: Row): ManagedVariant {
  const variant = ManagedVariantSchema.parse({
    id: text(row, 'id'), productId: text(row, 'product_id'), name: text(row, 'name'),
    unitPriceRappen: integer(row, 'unit_price_rappen'), sku: nullableText(row, 'sku'),
    barcode: nullableText(row, 'barcode'), active: active(row), position: integer(row, 'display_order'),
    revision: integer(row, 'revision'),
  });
  validateManagedVariant(variant);
  return variant;
}
function categoryFrom(row: Row): Category {
  const category = CategorySchema.parse({
    color: row['color'] === undefined ? null : nullableText(row, 'color'),
    id: text(row, 'id'), name: text(row, 'name'), parentId: nullableText(row, 'parent_id'),
    active: active(row), position: integer(row, 'display_order'), revision: integer(row, 'revision'),
  });
  validateCategory(category);
  return category;
}

/** Catalog aggregates share the established synchronous commit/recovery boundary. */
export function createCatalogStore(connection: DatabaseConnection, options: { includeHidden?: boolean } = {}): CatalogStore {
  const { sqlite } = connection;
  const hasTickets = (): boolean => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='tickets' AND type='table'").get();
  const readTicketUses = (id: string): number => hasTickets() ? Number(sqlite.prepare('SELECT use_count FROM product_ticket_settings WHERE product_id=?').get(id)?.['use_count'] ?? 0) : 0;
  const writeTicketUses = (id: string, uses: number): void => { if (!hasTickets()) { if (uses > 0) throw new Error('Tickets require migration 14.'); return; } if (uses === 0) sqlite.prepare('DELETE FROM product_ticket_settings WHERE product_id=?').run(id); else sqlite.prepare('INSERT INTO product_ticket_settings VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET use_count=excluded.use_count').run(id, uses); };
  const pos = createPosStore(connection); const { transaction } = pos;
  const hasVisibility = (): boolean => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hidden_catalog_products'").get());
  const hiddenProducts = (): Set<string> => new Set(hasVisibility() ? sqlite.prepare('SELECT product_id FROM hidden_catalog_products').all().map((row) => String(row['product_id'])) : []);
  const hiddenCategories = (): Set<string> => new Set(hasVisibility() ? sqlite.prepare('SELECT category_id FROM hidden_catalog_categories').all().map((row) => String(row['category_id'])) : []);
  const assertIdle = (): void => {
    if ((pos.getDraftCart()?.items.length ?? 0) > 0 || pos.getUnresolvedCheckout() || sqlite.prepare("SELECT 1 FROM payment_sessions WHERE state='open'").get() || sqlite.prepare("SELECT 1 FROM refund_attempts WHERE state IN ('prepared','reported','uncertain')").get()) throw new DomainError('CATALOG_BUSY', 'Finish the current sale or refund and empty the cart before deleting catalog entries.');
  };
  const requireTransaction = (): void => {
    if (!sqlite.isTransaction) throw new Error('Catalog writes require a transaction.');
  };
  const snapshot = <T>(operation: () => T): T => sqlite.isTransaction ? operation() : transaction(operation);

  // Three batched reads for an entire catalog; no per-product query loop.
  const readProducts = (productId?: string): readonly ManagedProduct[] => {
    const where = productId === undefined ? '' : ' WHERE id = ?';
    const relationWhere = productId === undefined ? '' : ' WHERE product_id = ?';
    const bindings = productId === undefined ? [] : [productId];
    const rows = sqlite.prepare(`SELECT * FROM products${where} ORDER BY name, id`).all(...bindings);
    const hiddenVariants = !options.includeHidden && sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='hidden_catalog_variants'").get()
      ? new Set(sqlite.prepare('SELECT variant_id FROM hidden_catalog_variants').all().map((row) => String(row['variant_id']))) : new Set<string>();
    const variants = new Map<string, ManagedVariant[]>();
    for (const row of sqlite.prepare(`SELECT * FROM product_variants${relationWhere} ORDER BY product_id, display_order, name, id`).all(...bindings)) {
      const variant = variantFrom(row);
      if (hiddenVariants.has(variant.id)) continue;
      const group = variants.get(variant.productId) ?? [];
      group.push(variant); variants.set(variant.productId, group);
    }
    const assignments = new Map<string, { ids: string[]; primary: string | null }>();
    for (const row of sqlite.prepare(`SELECT * FROM product_categories${relationWhere} ORDER BY product_id, category_id`).all(...bindings)) {
      const group = assignments.get(text(row, 'product_id')) ?? { ids: [], primary: null };
      const categoryId = text(row, 'category_id');
      group.ids.push(categoryId);
      if (row['is_primary'] === 1) group.primary = categoryId;
      else if (row['is_primary'] !== 0) throw new Error('Invalid persisted primary category status.');
      assignments.set(text(row, 'product_id'), group);
    }
    const hiddenProductIds = options.includeHidden ? new Set<string>() : hiddenProducts();
    const products = rows.filter((row) => !hiddenProductIds.has(String(row['id']))).map((row) => {
      const id = text(row, 'id');
      const assigned = assignments.get(id);
      const product = ManagedProductSchema.parse({
        ...(readTicketUses(id) > 0 ? { ticketUses: readTicketUses(id) } : {}), id, name: text(row, 'name'), description: nullableText(row, 'description'), active: active(row),
        imageReference: nullableText(row, 'image_reference'), createdAt: text(row, 'created_at'),
        updatedAt: text(row, 'updated_at'), revision: integer(row, 'revision'),
        variants: [...(variants.get(id) ?? [])].sort(compareCatalogOrder), categoryIds: assigned?.ids ?? [], primaryCategoryId: assigned?.primary ?? null,
      });
      validateManagedProduct(product);
      return product;
    });
    if (options.includeHidden) return products;
    const hidden = hiddenProducts(); return products.filter((product) => !hidden.has(product.id));
  };

  const insertVariant = sqlite.prepare(`INSERT INTO product_variants
    (id, product_id, name, unit_price_rappen, sku, barcode, active, display_order, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateVariant = sqlite.prepare(`UPDATE product_variants SET name = ?, unit_price_rappen = ?, sku = ?, barcode = ?,
    active = ?, display_order = ?, revision = ? WHERE id = ? AND product_id = ? AND revision = ?`);
  const metadataWrite = (operation: () => void): void => {
    try { operation(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('UNIQUE constraint failed: product_variants.sku')) throw new DomainError('DUPLICATE_SKU', 'This SKU is already assigned to another variant.');
      if (message.includes('UNIQUE constraint failed: product_variants.barcode')) throw new DomainError('DUPLICATE_BARCODE', 'This barcode is already assigned to another variant.');
      throw error;
    }
  };
  const writeAssignments = (product: ManagedProduct): void => {
    sqlite.prepare('DELETE FROM product_categories WHERE product_id = ?').run(product.id);
    const insert = sqlite.prepare('INSERT INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, ?)');
    for (const categoryId of product.categoryIds) insert.run(product.id, categoryId, categoryId === product.primaryCategoryId ? 1 : 0);
  };
  const writeNewVariant = (variant: ManagedVariant): void => {
    validateManagedVariant(variant);
    metadataWrite(() => { insertVariant.run(variant.id, variant.productId, variant.name, variant.unitPriceRappen,
      variant.sku, variant.barcode, variant.active ? 1 : 0, variant.position, variant.revision); });
  };

  const store: CatalogStore = {
    removeVariant(productId, variantId, productRevision, revision, updatedAt) {
      requireTransaction(); assertIdle();
      const product = store.getProduct(productId);
      if (!product || product.revision !== productRevision || product.variants.length < 2) throw new DomainError('CONFLICT', 'The product changed. Reload it before deleting.');
      const result = sqlite.prepare('UPDATE product_variants SET active=0, sku=NULL, barcode=NULL, revision=revision+1 WHERE id=? AND product_id=? AND revision=?').run(variantId, productId, revision);
      if (result.changes !== 1) throw new DomainError('CONFLICT', 'The variant changed. Reload it before deleting.');
      sqlite.prepare('UPDATE products SET revision=revision+1, updated_at=? WHERE id=? AND revision=?').run(updatedAt, productId, productRevision);
      sqlite.prepare('INSERT INTO hidden_catalog_variants VALUES(?)').run(variantId);
    },
    removeProduct(id, revision, updatedAt) {
      requireTransaction(); assertIdle();
      const result = sqlite.prepare('UPDATE products SET active=0, revision=revision+1, updated_at=? WHERE id=? AND revision=?').run(updatedAt, id, revision);
      if (result.changes !== 1) throw new DomainError('CONFLICT', 'The product changed. Reload it before deleting.');
      sqlite.prepare('UPDATE product_variants SET sku=NULL, barcode=NULL, revision=revision+1 WHERE product_id=?').run(id);
      sqlite.prepare('INSERT INTO hidden_catalog_products VALUES(?) ON CONFLICT DO NOTHING').run(id);
    },
    removeCategory(id, revision, updatedAt) {
      requireTransaction(); assertIdle(); const root = store.getCategory(id);
      if (!root || root.revision !== revision) throw new DomainError('CONFLICT', 'The category changed. Reload it before deleting.');
      const all = sqlite.prepare('SELECT id,parent_id FROM categories').all(); const ids = new Set([id]);
      let changed = true; while (changed) { changed = false; for (const row of all) if (ids.has(String(row['parent_id'])) && !ids.has(String(row['id']))) { ids.add(String(row['id'])); changed = true; } }
      const products = new Set<string>();
      for (const categoryId of ids) {
        for (const row of sqlite.prepare('SELECT product_id FROM product_categories WHERE category_id=?').all(categoryId)) products.add(String(row['product_id']));
        sqlite.prepare('DELETE FROM product_categories WHERE category_id=?').run(categoryId);
        sqlite.prepare('UPDATE categories SET active=0, revision=revision+1 WHERE id=?').run(categoryId);
        sqlite.prepare('INSERT INTO hidden_catalog_categories VALUES(?) ON CONFLICT DO NOTHING').run(categoryId);
      }
      for (const productId of products) sqlite.prepare('UPDATE products SET revision=revision+1, updated_at=? WHERE id=?').run(updatedAt, productId);
    },
    transaction,
    listProducts: () => snapshot(() => readProducts()),
    getProduct: (id) => snapshot(() => readProducts(id)[0] ?? null),
    insertProduct(product) {
      requireTransaction(); validateManagedProduct(product);
      if (product.revision !== 0 || product.variants.some((variant) => variant.revision !== 0)) throw new DomainError('CONFLICT', 'New catalog records must start at revision zero.');
      sqlite.prepare(`INSERT INTO products (id, name, description, active, image_reference, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(product.id, product.name, product.description, product.active ? 1 : 0,
        product.imageReference, product.createdAt, product.updatedAt, product.revision);
      writeTicketUses(product.id, product.ticketUses ?? 0);
      for (const variant of product.variants) writeNewVariant(variant);
      writeAssignments(product);
    },
    updateProduct(product, expectedRevision) {
      requireTransaction(); validateManagedProduct(product);
      const existing = store.getProduct(product.id);
      if (existing === null || existing.revision !== expectedRevision || product.revision !== expectedRevision + 1) throw new DomainError('CONFLICT', 'The product changed. Reload it before saving.');
      if (product.createdAt !== existing.createdAt) throw new DomainError('INVALID_INPUT', 'Product creation time is immutable.');
      if (existing.variants.some((variant) => !product.variants.some((candidate) => candidate.id === variant.id))) throw new DomainError('INVALID_INPUT', 'Variants cannot be removed; deactivate them instead.');
      const changed = sqlite.prepare(`UPDATE products SET name = ?, description = ?, active = ?, image_reference = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ?`).run(product.name, product.description, product.active ? 1 : 0, product.imageReference,
        product.updatedAt, product.revision, product.id, expectedRevision);
      writeTicketUses(product.id, product.ticketUses ?? 0);
      if (changed.changes !== 1) throw new DomainError('CONFLICT', 'The product changed. Reload it before saving.');
      for (const variant of product.variants) {
        const old = existing.variants.find((entry) => entry.id === variant.id);
        if (old === undefined) {
          if (variant.revision !== 0) throw new DomainError('CONFLICT', 'New variants must start at revision zero.');
          writeNewVariant(variant);
        } else {
          if (variant.revision !== old.revision && variant.revision !== old.revision + 1) throw new DomainError('CONFLICT', 'The variant changed. Reload it before saving.');
          const fieldsChanged = variant.name !== old.name || variant.unitPriceRappen !== old.unitPriceRappen ||
            variant.sku !== old.sku || variant.barcode !== old.barcode || variant.active !== old.active || variant.position !== old.position;
          if (fieldsChanged && variant.revision !== old.revision + 1) throw new DomainError('CONFLICT', 'Variant edits require a new revision.');
          metadataWrite(() => {
            const result = updateVariant.run(variant.name, variant.unitPriceRappen, variant.sku, variant.barcode,
              variant.active ? 1 : 0, variant.position, variant.revision, variant.id, product.id, old.revision);
            if (result.changes !== 1) throw new DomainError('CONFLICT', 'The variant changed. Reload it before saving.');
          });
        }
      }
      writeAssignments(product);
    },
    listCategories: () => { const all = sqlite.prepare('SELECT * FROM categories ORDER BY display_order, name, id').all().map(categoryFrom); if (options.includeHidden) return all; const hidden = hiddenCategories(); return all.filter((category) => !hidden.has(category.id)); },
    getCategory(id) {
      if (!options.includeHidden && hiddenCategories().has(id)) return null;
      const row = sqlite.prepare('SELECT * FROM categories WHERE id = ?').get(id);
      return row === undefined ? null : categoryFrom(row);
    },
    insertCategory(category) {
      requireTransaction(); validateCategory(category);
      if (category.revision !== 0) throw new DomainError('CONFLICT', 'New categories must start at revision zero.');
      sqlite.prepare('INSERT INTO categories (id, name, parent_id, active, display_order, revision, color) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(category.id, category.name, category.parentId, category.active ? 1 : 0, category.position, category.revision, category.color ?? null);
    },
    updateCategory(category, expectedRevision) {
      requireTransaction(); validateCategory(category);
      if (category.revision !== expectedRevision + 1) throw new DomainError('CONFLICT', 'The category changed. Reload it before saving.');
      const result = sqlite.prepare(`UPDATE categories SET name = ?, parent_id = ?, active = ?, display_order = ?, revision = ?, color = ?
        WHERE id = ? AND revision = ?`).run(category.name, category.parentId, category.active ? 1 : 0,
        category.position, category.revision, category.color ?? null, category.id, expectedRevision);
      if (result.changes !== 1) throw new DomainError('CONFLICT', 'The category changed. Reload it before saving.');
    },
  };
  return store;
}
