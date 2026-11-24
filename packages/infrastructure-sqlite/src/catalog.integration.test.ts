import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogService, createPosService, type CatalogService, type PosService } from '@cash-sloth/application';
import type { Category, ManagedProduct, Result, Sale } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { createCatalogStore } from './catalog-store.js';
import { createPosStore } from './pos-store.js';
import { migrations, runMigrations } from './migrations.js';
import { firstSaleMigration } from './migrations/0001-first-sale.js';
import { seedDevelopmentCatalog } from './seed.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const visibleQuery = { query: '', categoryId: null, restrictToCategory: false, includeInactive: false } as const;
const firstVariant = { name: 'Small', unitPriceRappen: 247, sku: null, barcode: null, active: true, position: 0 } as const;

describe('catalog management on real SQLite storage', () => {
  let directory: string;
  let databaseFile: string;
  let connection: DatabaseConnection;
  let catalog: CatalogService;
  let pos: PosService;
  let sequence: number;
  const extraConnections: DatabaseConnection[] = [];
  const runtime = { newId: () => `catalog-test-${++sequence}`, now: () => '2026-11-12T12:00:00.000Z' };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cash-sloth-catalog-'));
    databaseFile = join(directory, 'catalog.sqlite');
    sequence = 0;
    connection = openDatabase(databaseFile);
  });
  afterEach(() => {
    for (const opened of extraConnections.splice(0)) opened.close();
    connection.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const bind = (): void => {
    catalog = createCatalogService(createCatalogStore(connection), runtime);
    pos = createPosService(createPosStore(connection), runtime);
  };
  const initialize = (): void => { runMigrations(connection); bind(); };
  const reopen = (): void => { connection.close(); connection = openDatabase(databaseFile); runMigrations(connection); bind(); };
  const create = (name = 'Managed chocolate', sku: string | null = null, barcode: string | null = null): ManagedProduct => value(catalog.createProduct({
    name, description: 'Catalog test product', imageReference: null, active: true,
    categoryIds: [category('Creation category').id], primaryCategoryId: null, firstVariant: { ...firstVariant, sku, barcode },
  }));
  const category = (name: string, parentId: string | null = null): Category => value(catalog.createCategory({ name, parentId, active: true, position: 0 }));

  function legacyDatabase(): void {
    const { sqlite } = connection;
    sqlite.exec(`BEGIN IMMEDIATE;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
      ${firstSaleMigration.sql}`);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(1, firstSaleMigration.name,
      createHash('sha256').update(firstSaleMigration.sql).digest('hex'), '2026-11-11T12:00:00.000Z');
    sqlite.prepare('INSERT INTO products VALUES (?, ?, ?)').run('legacy-product', ' Legacy chocolate ', 1);
    sqlite.prepare('INSERT INTO product_variants VALUES (?, ?, ?, ?, ?)').run('legacy-variant', 'legacy-product', ' Default ', 247, 1);
    sqlite.exec('COMMIT');
  }

  it('migrates an actual version-one sale and draft without changing historical or current snapshot bytes', () => {
    legacyDatabase();
    const legacy = createPosService(createPosStore(connection), runtime);
    const empty = value(legacy.getCart({})).cart;
    const cart = value(legacy.addItem({ cartId: empty.id, expectedRevision: empty.revision, variantId: 'legacy-variant' }));
    const attempt = value(legacy.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    const sale = value(legacy.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
    const next = value(legacy.getCart({})).cart;
    const draft = value(legacy.addItem({ cartId: next.id, expectedRevision: next.revision, variantId: 'legacy-variant' }));
    const originalLedger = connection.sqlite.prepare('SELECT * FROM schema_migrations WHERE version = 1').get();

    initialize();
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(value(pos.getCart({})).cart).toEqual(draft);
    expect(connection.sqlite.prepare('SELECT * FROM schema_migrations WHERE version = 1').get()).toEqual(originalLedger);
    expect(value(catalog.getProduct({ productId: 'legacy-product' }))).toMatchObject({
      name: ' Legacy chocolate ', revision: 0, description: null, imageReference: null,
      createdAt: '2026-11-11T12:00:00.000Z', updatedAt: '2026-11-11T12:00:00.000Z',
    });
    runMigrations(connection);
    expect(connection.sqlite.prepare('SELECT count(*) n FROM schema_migrations').get()?.['n']).toBe(migrations.length);
    reopen();
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(value(pos.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }))).toEqual(sale);
  });

  it('rolls back partially executed migration two rather than deleting a conflicting existing table or schema', () => {
    legacyDatabase();
    connection.sqlite.exec("CREATE TABLE categories (private_note TEXT); INSERT INTO categories VALUES ('keep existing data')");
    expect(() => runMigrations(connection)).toThrow();
    expect(connection.sqlite.prepare("SELECT name FROM pragma_table_info('products')").all().map((row) => row['name'])).toEqual(['id', 'name', 'active']);
    expect(connection.sqlite.prepare('SELECT private_note FROM categories').get()?.['private_note']).toBe('keep existing data');
    expect(connection.sqlite.prepare('SELECT count(*) n FROM schema_migrations').get()?.['n']).toBe(1);
    expect(connection.sqlite.prepare('SELECT name FROM products').get()?.['name']).toBe(' Legacy chocolate ');
  });

  it('creates, edits and reopens product details and independently priced/revisioned variants', () => {
    initialize();
    const product = create('Tea');
    const variant = product.variants[0];
    if (!variant) throw new Error('Missing first variant');
    const withLarge = value(catalog.createVariant({
      productId: product.id, expectedProductRevision: product.revision, name: 'Large', unitPriceRappen: 410,
      sku: ' tea-large ', barcode: '76400001', active: true, position: 1,
    }));
    const large = withLarge.variants.find((entry) => entry.name === 'Large');
    if (!large) throw new Error('Missing added variant');
    expect(large).toMatchObject({ sku: 'TEA-LARGE', unitPriceRappen: 410, revision: 0 });
    const renamed = value(catalog.updateProduct({
      productId: product.id, expectedRevision: withLarge.revision, name: 'Mountain tea', description: 'Local tea',
      imageReference: 'catalog/tea.png', active: true,
    }));
    const edited = value(catalog.updateVariant({
      productId: product.id, expectedProductRevision: renamed.revision, variantId: large.id, expectedRevision: large.revision,
      name: 'Large pot', unitPriceRappen: 450, sku: large.sku, barcode: large.barcode, active: true, position: 0,
    }));
    expect(edited.variants.find((entry) => entry.id === large.id)).toMatchObject({ revision: 1, unitPriceRappen: 450 });
    expect(edited.variants.find((entry) => entry.id === variant.id)?.revision).toBe(0);
    reopen();
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(edited);
  });

  it('rejects duplicate canonical SKUs and exact barcodes atomically while allowing null metadata', () => {
    initialize();
    create('First', ' sku-a ', 'ABC');
    expect(catalog.createProduct({
      name: 'Duplicate SKU', description: null, active: true, imageReference: null, categoryIds: [category('Creation category').id], primaryCategoryId: null,
      firstVariant: { ...firstVariant, sku: 'sKu-A' },
    })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_SKU' } });
    expect(catalog.createProduct({
      name: 'Duplicate barcode', description: null, active: true, imageReference: null, categoryIds: [category('Creation category').id], primaryCategoryId: null,
      firstVariant: { ...firstVariant, barcode: ' ABC ' },
    })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_BARCODE' } });
    create('Lowercase barcode', null, 'abc');
    const withoutMetadata = create('No metadata one'); create('No metadata two');
    expect(value(catalog.listProducts({ ...visibleQuery, includeInactive: true }))).toHaveLength(4);
    expect(() => connection.sqlite.prepare('UPDATE product_variants SET sku = ? WHERE product_id = ?').run('sku-a', withoutMetadata.id)).toThrow();
    expect(connection.sqlite.prepare('SELECT count(*) n FROM products').get()?.['n']).toBe(4);
  });

  it('keeps equal-position variant order identical across save, read and reopen for mixed-case and Unicode names', () => {
    initialize();
    let product = value(catalog.createProduct({
      name: 'Ordered variants', description: null, imageReference: null, active: true,
      categoryIds: [category('Creation category').id], primaryCategoryId: null, firstVariant: { ...firstVariant, name: 'a' },
    }));
    for (const name of ['B', 'Á']) product = value(catalog.createVariant({
      productId: product.id, expectedProductRevision: product.revision, ...firstVariant, name,
    }));
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(product);
    reopen();
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(product);
    const variant = product.variants.find((entry) => entry.name === 'B');
    if (!variant) throw new Error('Missing ordered variant');
    const updated = value(catalog.updateVariant({
      productId: product.id, expectedProductRevision: product.revision, variantId: variant.id,
      expectedRevision: variant.revision, ...firstVariant, name: 'é',
    }));
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(updated);
    reopen();
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(updated);
  });

  it('detects product, variant and category editor conflicts across independent connections', () => {
    initialize();
    const original = create();
    const variant = original.variants[0];
    if (!variant) throw new Error('Missing first variant');
    const originalCategory = category('Original category');
    const secondConnection = openDatabase(databaseFile); extraConnections.push(secondConnection);
    const second = createCatalogService(createCatalogStore(secondConnection), runtime);
    const updated = value(second.updateProduct({ productId: original.id, expectedRevision: 0, name: 'Second editor', description: null, active: true, imageReference: null }));
    expect(catalog.updateProduct({ productId: original.id, expectedRevision: 0, name: 'Stale editor', description: null, active: true, imageReference: null }))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const changed = value(second.updateVariant({ productId: updated.id, expectedProductRevision: updated.revision, variantId: variant.id, expectedRevision: variant.revision,
      name: 'Changed', unitPriceRappen: 300, sku: null, barcode: null, active: true, position: 0 }));
    expect(catalog.updateVariant({ productId: changed.id, expectedProductRevision: changed.revision, variantId: variant.id, expectedRevision: variant.revision,
      name: 'Stale variant', unitPriceRappen: 900, sku: null, barcode: null, active: true, position: 0 }))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    value(second.updateCategory({ categoryId: originalCategory.id, expectedRevision: 0, name: 'Renamed category', parentId: null, active: true, position: 2 }));
    expect(catalog.updateCategory({ categoryId: originalCategory.id, expectedRevision: 0, name: 'Stale category', parentId: null, active: true, position: 0 }))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(value(catalog.getProduct({ productId: changed.id }))).toEqual(changed);
  });

  it('stores deep hierarchies without a depth cap and rejects cycle moves at both use-case and database boundaries', () => {
    initialize();
    const store = createCatalogStore(connection);
    store.transaction(() => {
      for (let index = 0; index < 1200; index++) store.insertCategory({
        id: `deep-${index}`, name: `Depth ${index}`, parentId: index === 0 ? null : `deep-${index - 1}`, active: true, position: 0, revision: 0,
      });
    });
    const product = create('Deep product');
    value(catalog.assignCategories({ productId: product.id, expectedRevision: product.revision, categoryIds: ['deep-1199'], primaryCategoryId: 'deep-1199' }));
    expect(value(catalog.listProducts({ ...visibleQuery, categoryId: 'deep-0' }))).toHaveLength(1);
    expect(value(catalog.listCategories({ includeInactive: false })).find((entry) => entry.id === 'deep-0')?.productCount).toBe(1);
    expect(catalog.updateCategory({ categoryId: 'deep-0', expectedRevision: 0, name: 'Depth zero', parentId: 'deep-1199', active: true, position: 0 }))
      .toMatchObject({ ok: false, error: { code: 'CATEGORY_CYCLE' } });
    expect(() => connection.sqlite.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run('deep-1199', 'deep-0')).toThrow(/cycle/u);
    expect(() => connection.sqlite.prepare('DELETE FROM categories WHERE id = ?').run('deep-0')).toThrow();
  });

  it('deduplicates descendants and counts across multiple assignments, moves categories and deactivates browsing safely', () => {
    initialize();
    const root = category('Food'); const child = category('Chocolate', root.id); const other = category('Gifts');
    const product = create('Gift chocolate');
    const assigned = value(catalog.assignCategories({ productId: product.id, expectedRevision: 0,
      categoryIds: [root.id, child.id, other.id].sort(), primaryCategoryId: child.id }));
    const childOnly = create('Child only');
    value(catalog.assignCategories({ productId: childOnly.id, expectedRevision: 0, categoryIds: [child.id], primaryCategoryId: null }));
    expect(value(catalog.listProducts({ ...visibleQuery, categoryId: root.id })).map((entry) => entry.id).sort()).toEqual([product.id, childOnly.id].sort());
    expect(value(catalog.listCategories({ includeInactive: false })).find((entry) => entry.id === root.id)?.productCount).toBe(2);
    value(catalog.updateCategory({ categoryId: child.id, expectedRevision: child.revision, name: child.name, parentId: other.id, active: true, position: 3 }));
    expect(value(catalog.listCategories({ includeInactive: false })).find((entry) => entry.id === root.id)?.productCount).toBe(1);
    expect(value(catalog.listCategories({ includeInactive: false })).find((entry) => entry.id === other.id)?.productCount).toBe(2);
    value(catalog.updateCategory({ categoryId: other.id, expectedRevision: other.revision, name: other.name, parentId: null, active: false, position: 0 }));
    expect(value(catalog.listCategories({ includeInactive: false })).some((entry) => entry.id === child.id)).toBe(false);
    expect(value(catalog.listProducts({ ...visibleQuery, categoryId: other.id }))).toHaveLength(0);
    expect(value(catalog.listProducts(visibleQuery))).toHaveLength(2);
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(assigned);
    expect(() => connection.sqlite.prepare('DELETE FROM categories WHERE id = ?').run(child.id)).toThrow();
    expect(() => connection.sqlite.prepare('INSERT INTO product_categories VALUES (?, ?, 1)').run(product.id, 'missing-category')).toThrow();
  });

  it('searches globally by default and restricts scope only explicitly, including variant, SKU and barcode fields', () => {
    initialize();
    const food = category('Food'); const drinks = category('Drinks');
    const chocolate = create('Chocolate', 'CHOC-ONE', '76412345');
    value(catalog.assignCategories({ productId: chocolate.id, expectedRevision: 0, categoryIds: [food.id], primaryCategoryId: food.id }));
    const tea = create('Tea');
    value(catalog.assignCategories({ productId: tea.id, expectedRevision: 0, categoryIds: [drinks.id], primaryCategoryId: drinks.id }));
    for (const query of ['Chocolate', 'small', 'choc-one', '76412345']) {
      expect(value(catalog.listProducts({ ...visibleQuery, query, categoryId: drinks.id })).some((entry) => entry.id === chocolate.id)).toBe(true);
    }
    expect(value(catalog.listProducts({ ...visibleQuery, query: 'choc-one', categoryId: drinks.id, restrictToCategory: true }))).toHaveLength(0);
    expect(value(catalog.listProducts({ ...visibleQuery, categoryId: food.id })).map((entry) => entry.id)).toEqual([chocolate.id]);
  });

  it('honours inactive historical cart snapshots while blocking new lines and preserves old prices through a completed sale', () => {
    initialize();
    const product = create('Original chocolate');
    const variant = product.variants[0];
    if (!variant) throw new Error('Missing variant');
    const empty = value(pos.getCart({})).cart;
    const original = value(pos.addItem({ cartId: empty.id, expectedRevision: empty.revision, variantId: variant.id }));
    const line = original.items[0]; if (!line) throw new Error('Missing cart line');
    const updated = value(catalog.updateVariant({ productId: product.id, expectedProductRevision: 0, variantId: variant.id, expectedRevision: 0,
      ...firstVariant, name: 'New package', unitPriceRappen: 299 }));
    const changed = value(pos.addItem({ cartId: original.id, expectedRevision: original.revision, variantId: variant.id }));
    expect(changed.items.map((item) => item.unitPriceRappen)).toEqual([247, 299]);
    const increased = value(pos.setQuantity({ cartId: changed.id, expectedRevision: changed.revision, lineId: line.id, quantity: 2 }));
    const currentVariant = updated.variants.find((entry) => entry.id === variant.id);
    if (!currentVariant) throw new Error('Missing current variant');
    const deactivated = value(catalog.updateVariant({ productId: product.id, expectedProductRevision: updated.revision, variantId: variant.id, expectedRevision: currentVariant.revision,
      name: currentVariant.name, unitPriceRappen: currentVariant.unitPriceRappen, sku: null, barcode: null, active: false, position: currentVariant.position }));
    value(catalog.updateProduct({ productId: product.id, expectedRevision: deactivated.revision, name: 'Now inactive', description: null, imageReference: null, active: false }));
    expect(value(catalog.listProducts(visibleQuery))).toHaveLength(0);
    expect(pos.addItem({ cartId: increased.id, expectedRevision: increased.revision, variantId: variant.id }).ok).toBe(false);
    const attempt = value(pos.prepareCheckout({ cartId: increased.id, expectedRevision: increased.revision }));
    const sale: Sale = value(pos.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true }));
    expect(sale.items).toEqual(increased.items);
    expect(sale.subtotalRappen).toBe(793);
    reopen();
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(() => connection.sqlite.prepare('UPDATE sale_items SET unit_price_rappen = 0 WHERE sale_id = ?').run(sale.id)).toThrow(/immutable/u);
  });

  it('retains required variant identity and prevents removing the last variant even through direct SQL', () => {
    initialize();
    const product = create();
    const variant = product.variants[0]; if (!variant) throw new Error('Missing variant');
    expect(() => connection.sqlite.prepare('DELETE FROM product_variants WHERE id = ?').run(variant.id)).toThrow(/at least one/u);
    expect(() => connection.sqlite.prepare('UPDATE product_variants SET product_id = ? WHERE id = ?').run('different-product', variant.id)).toThrow(/immutable/u);
    expect(() => connection.sqlite.prepare('UPDATE products SET id = ? WHERE id = ?').run('new-id', product.id)).toThrow(/immutable/u);
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(product);
  });

  it('keeps confirmed payment locks and original snapshots intact while catalog records are edited', () => {
    initialize();
    const product = create('Confirmed original');
    const variant = product.variants[0]; if (!variant) throw new Error('Missing variant');
    const empty = value(pos.getCart({})).cart;
    const cart = value(pos.addItem({ cartId: empty.id, expectedRevision: empty.revision, variantId: variant.id }));
    const attempt = value(pos.prepareCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    let commit = 0;
    const failing = createPosService(createPosStore(connection, { beforeCommit: () => { if (++commit === 2) throw new Error('Injected sale rollback'); } }), runtime);
    expect(failing.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }).ok).toBe(false);
    expect(value(pos.getCart({})).pendingCheckout?.status).toBe('confirmed');

    const changed = value(catalog.updateVariant({ productId: product.id, expectedProductRevision: 0,
      variantId: variant.id, expectedRevision: 0, name: 'New catalog package', unitPriceRappen: 999,
      sku: null, barcode: null, active: false, position: 0 }));
    value(catalog.updateProduct({ productId: product.id, expectedRevision: changed.revision, name: 'New catalog name', description: null, imageReference: null, active: false }));
    const firstLine = cart.items[0]; if (!firstLine) throw new Error('Missing cart line');
    expect(pos.setQuantity({ cartId: cart.id, expectedRevision: cart.revision, lineId: firstLine.id, quantity: 2 }))
      .toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    expect(pos.clearCart({ cartId: cart.id, expectedRevision: cart.revision }))
      .toMatchObject({ ok: false, error: { code: 'CHECKOUT_PENDING' } });
    const sale = value(pos.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
    expect(sale.items).toEqual(cart.items);
    expect(sale.amountDueRappen).toBe(245);
    reopen();
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
    const now = value(catalog.getProduct({ productId: product.id }));
    value(catalog.updateProduct({ productId: product.id, expectedRevision: now.revision, name: 'Edited after completed sale', description: null, imageReference: null, active: true }));
    expect(value(pos.getSale({ saleId: sale.id }))).toEqual(sale);
    expect(value(pos.completeSale({ idempotencyKey: attempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }))).toEqual(sale);
  });

  it('validates category assignments atomically and enforces one optional primary category', () => {
    initialize();
    const one = category('One'); const two = category('Two');
    const product = create();
    expect(catalog.assignCategories({ productId: product.id, expectedRevision: 0, categoryIds: [one.id], primaryCategoryId: two.id }).ok).toBe(false);
    expect(catalog.assignCategories({ productId: product.id, expectedRevision: 0, categoryIds: ['missing-category'], primaryCategoryId: null }).ok).toBe(false);
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(product);
    const assigned = value(catalog.assignCategories({ productId: product.id, expectedRevision: 0, categoryIds: [one.id, two.id].sort(), primaryCategoryId: one.id }));
    expect(() => connection.sqlite.prepare('UPDATE product_categories SET is_primary = 1 WHERE product_id = ?').run(product.id)).toThrow();
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(assigned);
    const cleared = value(catalog.assignCategories({ productId: product.id, expectedRevision: assigned.revision, categoryIds: [one.id, two.id].sort(), primaryCategoryId: null }));
    reopen();
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(cleared);
  });

  it('keeps Development seed idempotent after management changes without leaking fixtures into other channels', () => {
    initialize(); seedDevelopmentCatalog(connection, 'development');
    const water = value(catalog.getProduct({ productId: 'product-water' }));
    const edited = value(catalog.updateProduct({ productId: water.id, expectedRevision: water.revision, name: 'Local water', description: 'Keep edits', imageReference: null, active: false }));
    seedDevelopmentCatalog(connection, 'development');
    expect(value(catalog.getProduct({ productId: water.id }))).toEqual(edited);
    for (const channel of ['beta', 'stable']) {
      const isolated = openDatabase(join(directory, `${channel}.sqlite`));
      try { runMigrations(isolated); seedDevelopmentCatalog(isolated, channel); expect(createCatalogStore(isolated).listProducts()).toHaveLength(0); }
      finally { isolated.close(); }
    }
    expect(createCatalogStore(connection).listProducts()).toHaveLength(3);
  });

  it('upgrades existing categories additively and keeps chosen colors across restarts and revisions', () => {
    connection.sqlite.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    for (const migration of migrations.slice(0, 5)) {
      connection.sqlite.exec(migration.sql);
      connection.sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'), runtime.now());
    }
    connection.sqlite.prepare('INSERT INTO categories VALUES (?, ?, ?, ?, ?, ?)').run('old-category', 'Existing category', null, 1, 0, 0);
    runMigrations(connection); bind();
    expect(value(catalog.listCategories({ includeInactive: true }))[0]).toMatchObject({ id: 'old-category', color: null });
    const colored = value(catalog.createCategory({ name: 'Yellow products', parentId: null, active: true, position: 1, color: '#ffff00' }));
    const product = create();
    value(catalog.assignCategories({ productId: product.id, expectedRevision: product.revision, categoryIds: [colored.id], primaryCategoryId: colored.id }));
    reopen();
    expect(value(catalog.listCategories({ includeInactive: true })).find((entry) => entry.id === colored.id)?.color).toBe('#ffff00');
    const changed = value(catalog.updateCategory({ categoryId: colored.id, expectedRevision: 0, name: colored.name, parentId: null, active: true, position: 1, color: '#ff0000' }));
    expect(changed.color).toBe('#ff0000');
    expect(catalog.updateCategory({ categoryId: colored.id, expectedRevision: 0, name: colored.name, parentId: null, active: true, position: 1, color: '#0000ff' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(catalog.createCategory({ name: 'Invalid', parentId: null, active: true, position: 1, color: 'red' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(() => connection.sqlite.prepare('UPDATE categories SET color = ? WHERE id = ?').run('#oops!!', colored.id)).toThrow();
    expect(value(catalog.getProduct({ productId: product.id })).primaryCategoryId).toBe(colored.id);
  });
});
