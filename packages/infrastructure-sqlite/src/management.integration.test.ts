import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogService, createManagementService, createPaymentsService, createPosService, SWISS_DEMO_COUNTS, type ManagementService } from '@cash-sloth/application';
import type { CsvMapping, ImportPreview, Result } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { migrations, runMigrations } from './migrations.js';
import { createCatalogStore } from './catalog-store.js';
import { createFinanceStore } from './finance-store.js';
import { createManagementStore } from './management-store.js';
import type { PosStoreTestHooks } from './pos-store.js';
import { createPosStore } from './pos-store.js';

const mapping: CsvMapping = { productKey: 0, productName: 1, variantKey: 2, variantName: 3, price: 4, categoryPaths: 5, description: null, sku: null, barcode: null, productActive: null, variantActive: null };
const header = 'product_key;product_name;variant_key;variant_name;price;categories';
const example = `${header}\nwater;CSV Water;water-s;Small;2.42;Drinks > Water\nwater;CSV Water;water-l;Large;3.47;Drinks > Water`;
function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`); return result.value; }

describe('transactional demo and CSV management', () => {
  let directory: string; let databaseFile: string; let connection: DatabaseConnection; let service: ManagementService; let sequence: number;
  const runtime = { newId: () => `management-${++sequence}`, now: () => '2026-11-18T12:00:00.000Z' };
  const otherConnections: DatabaseConnection[] = [];
  beforeEach(() => { sequence = 0; directory = mkdtempSync(join(tmpdir(), 'cash-sloth-management-')); databaseFile = join(directory, 'management.sqlite'); connection = openDatabase(databaseFile); runMigrations(connection); bind(); });
  afterEach(() => { for (const other of otherConnections.splice(0)) other.close(); connection.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  function bind(hooks: PosStoreTestHooks = {}): void { service = createManagementService(createManagementStore(connection, hooks), runtime, { channel: 'development' }); }
  function reopen(): void { connection.close(); connection = openDatabase(databaseFile); runMigrations(connection); bind(); }
  function apply(preview: ImportPreview, key = `import-key-${++sequence}`) { return value(service.applyImportPlan({ planId: preview.planId, idempotencyKey: key, operatorConfirmed: true })); }
  function csv(text = example) { return value(service.previewCsvImport({ text, delimiter: ';', mapping })); }
  function demo() { return value(service.previewDemoCatalog({})); }
  const count = (table: string): number => { const row = connection.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get(); if (typeof row?.['n'] !== 'number') throw new Error('Invalid count'); return row['n']; };

  it('previews the exact 44/71/69/18 fictional manifest without changing catalog data', () => {
    expect(SWISS_DEMO_COUNTS).toEqual({ products: 44, variants: 71, activeVariants: 69, categories: 18, version: 'swiss-development-v1' });
    const preview = demo(); expect(preview.canApply).toBe(true);
    expect(preview.summary).toMatchObject({ newProducts: 44, newVariants: 71, newCategories: 18, conflictingRecords: 0 });
    expect(count('products')).toBe(0); expect(count('categories')).toBe(0); expect(count('catalog_import_plans')).toBe(1);
  });
  it('loads explicitly and repeats without duplicates or overwritten records', () => {
    apply(demo()); const before = createCatalogStore(connection).listProducts();
    const repeated = demo(); expect(repeated.summary).toMatchObject({ newProducts: 0, newVariants: 0, newCategories: 0, existingMatches: 44 });
    apply(repeated); expect(createCatalogStore(connection).listProducts()).toEqual(before);
    expect(count('products')).toBe(44); expect(count('product_variants')).toBe(71); expect(count('categories')).toBe(18);
  });
  it.each(['beta', 'stable'] as const)('rejects preview and applying an existing Development demo plan in %s', (channel) => {
    const preview = demo(); const other = createManagementService(createManagementStore(connection), runtime, { channel });
    expect(value(other.getCapabilities({})).developmentDemoAllowed).toBe(false);
    expect(other.previewDemoCatalog({})).toMatchObject({ ok: false, error: { code: 'DEVELOPMENT_ONLY' } });
    expect(other.applyImportPlan({ planId: preview.planId, idempotencyKey: 'forbidden', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'DEVELOPMENT_ONLY' } });
    expect(count('products')).toBe(0);
  });
  it('preserves user-edited seed products and flags them as skipped', () => {
    apply(demo());
    const catalog = createCatalogStore(connection); const product = catalog.getProduct('demo-p-mineral-water'); if (!product) throw new Error('Missing demo fixture');
    catalog.transaction(() => catalog.updateProduct({ ...product, name: 'My own water', revision: 1, updatedAt: runtime.now() }, 0));
    const preview = demo(); expect(preview.canApply).toBe(true); expect(preview.summary.skippedProducts).toBe(1); expect(preview.issues[0]?.severity).toBe('warning');
    apply(preview); expect(catalog.getProduct(product.id)?.name).toBe('My own water'); expect(count('products')).toBe(44);
  });
  it('coexists with ordinary user-created products and preserves optional metadata and inactive fixtures', () => {
    const catalog = createCatalogService(createCatalogStore(connection), runtime);
    const own = value(catalog.createProduct({ name: 'Own product', description: 'Do not overwrite', active: true, imageReference: null, categoryIds: [], primaryCategoryId: null, firstVariant: { name: 'Default', unitPriceRappen: 999, sku: null, barcode: null, active: true, position: 0 } }));
    apply(demo()); expect(count('products')).toBe(45); expect(value(catalog.getProduct({ productId: own.id }))).toEqual(own);
    const all = createCatalogStore(connection).listProducts(); expect(all.find((entry) => entry.id === 'demo-p-inactive-product')?.active).toBe(false);
    expect(all.find((entry) => entry.id === 'demo-p-variant-availability')?.variants.map((entry) => entry.active)).toEqual([true, false]);
    expect(all.some((entry) => entry.categoryIds.length > 1)).toBe(true); expect(all.flatMap((entry) => entry.variants).some((entry) => entry.sku === null && entry.barcode === null)).toBe(true);
    expect(createCatalogStore(connection).listCategories().filter((entry) => entry.parentId !== null)).toHaveLength(13);
  });
  it('loads categories at four levels with deterministic identities across isolated databases', () => {
    const first = demo(); apply(first); const original = createCatalogStore(connection).listCategories();
    const other = openDatabase(join(directory, 'other.sqlite')); otherConnections.push(other); runMigrations(other);
    const independent = createManagementService(createManagementStore(other), runtime, { channel: 'development' });
    const preview = value(independent.previewDemoCatalog({})); value(independent.applyImportPlan({ planId: preview.planId, idempotencyKey: 'independent', operatorConfirmed: true }));
    expect(createCatalogStore(other).listCategories()).toEqual(original);
    const alpine = original.find((entry) => entry.name === 'Alpine'); const sweet = original.find((entry) => entry.id === alpine?.parentId); expect(sweet?.name).toBe('Sweet');
  });
  it('imports grouped variants/categories atomically and safely matches a repeated source', () => {
    const preview = csv(); expect(preview.summary).toMatchObject({ newProducts: 1, newVariants: 2, newCategories: 2 }); apply(preview);
    const catalog = createCatalogStore(connection); const imported = catalog.listProducts()[0]; expect(imported?.variants.map((entry) => entry.unitPriceRappen)).toEqual([242, 347]);
    const repeated = csv(); expect(repeated.summary).toMatchObject({ newProducts: 0, newVariants: 0, existingMatches: 1 }); apply(repeated);
    expect(catalog.listProducts()).toEqual([imported]); expect(count('product_variants')).toBe(2);
  });
  it('adds a new variant only when the repeated existing product fields remain unchanged', () => {
    apply(csv()); const preview = csv(`${header}\nwater;CSV Water;water-xl;XL;5.00;Drinks > Water`); expect(preview.summary).toMatchObject({ newProducts: 0, newVariants: 1 }); apply(preview);
    expect(createCatalogStore(connection).getProduct('csv-p-water')?.variants).toHaveLength(3);
    expect(createCatalogStore(connection).getProduct('csv-p-water')?.revision).toBe(1);
  });
  it('reuses existing category paths safely and preserves escaped literal separators', () => {
    const catalog = createCatalogService(createCatalogStore(connection), runtime); const food = value(catalog.createCategory({ name: 'Food', parentId: null, active: true, position: 10 }));
    const preview = csv(`${header}\na;CSV Snack;a-v;Default;2.42;Food > Salt\\|Sweet | Drinks > Still\\>Water`); apply(preview);
    const categories = createCatalogStore(connection).listCategories(); expect(categories.filter((entry) => entry.name === 'Food')).toEqual([food]);
    expect(categories.some((entry) => entry.name === 'Salt|Sweet')).toBe(true); expect(categories.some((entry) => entry.name === 'Still>Water')).toBe(true);
    expect(createCatalogStore(connection).getProduct('csv-p-a')?.categoryIds).toHaveLength(2);
  });
  it('rejects ambiguous existing categories instead of selecting one', () => {
    const catalog = createCatalogService(createCatalogStore(connection), runtime);
    value(catalog.createCategory({ name: 'Drinks', parentId: null, active: true, position: 0 })); value(catalog.createCategory({ name: 'Drinks', parentId: null, active: true, position: 1 }));
    const preview = csv(); expect(preview.canApply).toBe(false); expect(preview.issues[0]?.code).toBe('AMBIGUOUS_CATEGORY');
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'invalid', operatorConfirmed: true }).ok).toBe(false); expect(count('products')).toBe(0);
  });
  it.each(['name', 'price', 'categories'] as const)('flags conflicting existing %s and applies no partial data', (field) => {
    apply(csv()); const text = field === 'name' ? example.replaceAll('CSV Water', 'Overwritten') : field === 'price' ? example.replace('2.42', '9.99') : example.replaceAll('Drinks > Water', 'Different');
    const preview = csv(`${text}\nfresh;Fresh;fresh-v;Default;1.00;Food`); expect(preview.canApply).toBe(false); const before = createCatalogStore(connection).listProducts();
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'conflict', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'IMPORT_INVALID' } }); expect(createCatalogStore(connection).listProducts()).toEqual(before);
  });
  it('validates duplicate SKUs/barcodes against all existing variants', () => {
    const base = 'pk;pn;vk;vn;price;category;sku;barcode\na;First;a-v;Default;1.00;Food;TEST-SKU;TEST-BARCODE';
    const fields = { ...mapping, sku: 6, barcode: 7 };
    const first = value(service.previewCsvImport({ text: base, delimiter: ';', mapping: fields })); apply(first);
    for (const text of [base.replaceAll('a;', 'b;').replaceAll('First', 'Second').replaceAll('a-v', 'b-v').replace('TEST-BARCODE', 'OTHER-BARCODE'), base.replaceAll('a;', 'c;').replaceAll('First', 'Third').replaceAll('a-v', 'c-v').replace('TEST-SKU', 'OTHER-SKU')]) {
      const preview = value(service.previewCsvImport({ text, delimiter: ';', mapping: fields })); expect(preview.canApply).toBe(false); expect(preview.summary.conflictingRecords).toBe(1);
    }
  });
  it('points a duplicate metadata conflict to the actual later variant row and field', () => {
    const text = 'pk;pn;vk;vn;price;category;sku;barcode\na;First;a-small;Small;1.00;Food;DUP;BAR-ONE\na;First;a-large;Large;2.00;Food;DUP;BAR-TWO';
    const preview = value(service.previewCsvImport({ text, delimiter: ';', mapping: { ...mapping, sku: 6, barcode: 7 } }));
    expect(preview.canApply).toBe(false); expect(preview.issues).toMatchObject([{ rowNumber: 3, field: 'sku', code: 'DUPLICATE_SKU' }]);
  });
  it('appends imported variants after sparse existing display positions without changing old variants', () => {
    apply(csv()); const catalog = createCatalogStore(connection); const product = catalog.getProduct('csv-p-water'); if (!product) throw new Error('Missing fixture');
    const first = product.variants[0]; if (!first) throw new Error('Missing variant');
    catalog.transaction(() => catalog.updateProduct({ ...product, revision: 1, updatedAt: runtime.now(), variants: product.variants.map((entry) => entry.id === first.id ? { ...entry, position: 500, revision: 1 } : entry) }, 0));
    apply(csv(`${header}\nwater;CSV Water;water-xl;XL;5.00;Drinks > Water`));
    const after = catalog.getProduct(product.id); expect(after?.variants.find((entry) => entry.id === first.id)?.position).toBe(500); expect(after?.variants.at(-1)?.position).toBe(501);
  });
  it('detects stale previews after another connection changes the catalog', () => {
    const preview = csv(); const other = openDatabase(databaseFile); otherConnections.push(other);
    const catalog = createCatalogService(createCatalogStore(other), runtime); value(catalog.createCategory({ name: 'Concurrent', parentId: null, active: true, position: 0 }));
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'stale', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'STALE_PREVIEW' } }); expect(count('products')).toBe(0);
  });
  it('makes same-key retries idempotent after database reopening and rejects changed plan bindings', () => {
    const preview = csv(); const receipt = apply(preview, 'stable-request'); reopen();
    expect(value(service.getImportOperation({ idempotencyKey: 'stable-request' }))).toEqual(receipt);
    expect(apply(preview, 'stable-request')).toEqual(receipt); expect(count('products')).toBe(1);
    const other = csv(); expect(service.applyImportPlan({ planId: other.planId, idempotencyKey: 'stable-request', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'different-key', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'PLAN_APPLIED' } });
  });
  it('rolls back categories, products, variants, provenance and receipt when final commit fails', () => {
    const preview = csv(); let fail = true; bind({ beforeCommit: () => { if (fail) throw new Error('Injected import rollback'); } });
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'rollback', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    for (const table of ['products', 'product_variants', 'categories', 'catalog_import_identities', 'catalog_import_operations']) expect(count(table)).toBe(0);
    fail = false; apply(preview, 'rollback'); expect(count('products')).toBe(1);
  });
  it('recovers a lost commit acknowledgement by reading the same receipt without duplicate mutation', () => {
    const preview = csv(); let fail = true; bind({ afterCommit: () => { if (fail) { fail = false; throw new Error('Injected lost import acknowledgement'); } } });
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'unknown', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'COMMIT_UNCERTAIN' } });
    reopen(); expect(value(service.getImportOperation({ idempotencyKey: 'unknown' }))?.summary.newProducts).toBe(1);
    apply(preview, 'unknown'); expect(count('products')).toBe(1); expect(count('catalog_import_operations')).toBe(1);
  });
  it('keeps immutable plans, receipts and source identity provenance append-only', () => {
    const preview = csv(); apply(preview);
    for (const table of ['catalog_import_plans', 'catalog_import_operations', 'catalog_import_identities']) {
      expect(() => connection.sqlite.prepare(`DELETE FROM ${table}`).run()).toThrow();
      const column = table === 'catalog_import_identities' ? 'entity_id' : 'data'; expect(() => connection.sqlite.prepare(`UPDATE ${table} SET ${column} = ${column}`).run()).toThrow();
    }
  });
  it('preserves cart snapshots and completed payment/refund records while loading demo data', () => {
    apply(csv()); const pos = createPosService(createPosStore(connection), runtime); const payments = createPaymentsService(createFinanceStore(connection), runtime);
    const draft = value(pos.getCart({})).cart; const cart = value(pos.addItem({ cartId: draft.id, expectedRevision: draft.revision, variantId: 'csv-v-water-s' }));
    const session = value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision })); const attempt = value(payments.preparePayment({ sessionId: session.session.id, idempotencyKey: 'payment', method: 'card', intendedRappen: 242 }));
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })); const sale = value(payments.completeCheckout({ sessionId: session.session.id }));
    const refund = value(payments.prepareRefund({ saleId: sale.id, idempotencyKey: 'refund', method: 'twint', items: [{ saleItemId: sale.items[0]?.id ?? '', quantity: 1 }] })); value(payments.confirmRefund({ attemptId: refund.id, operatorConfirmed: true }));
    const before = value(payments.getSaleDetails({ saleId: sale.id })); apply(demo()); reopen();
    expect(value(createPaymentsService(createFinanceStore(connection), runtime).getSaleDetails({ saleId: sale.id }))).toEqual(before);
  });
  it('runtime-validates mappings and explicit apply confirmation at the application boundary', () => {
    const preview = csv(); expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'not-confirmed', operatorConfirmed: false as true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(service.previewCsvImport({ text: example, delimiter: ';', mapping: { ...mapping, price: -1 } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } }); expect(count('products')).toBe(0);
  });
  it('imports the practical public sample with quoting, multiple variants and escaped category separators', () => {
    const text = readFileSync('examples/catalog-import.csv', 'utf8');
    const parsed = value(service.parseCsv({ text, delimiter: 'auto' })); expect(parsed.totalRows).toBe(4); expect(parsed.delimiter).toBe(';');
    const columns: CsvMapping = { productKey: 0, productName: 1, description: 2, variantKey: 3, variantName: 4, price: 5, sku: 6, barcode: 7, categoryPaths: 8, productActive: 9, variantActive: 10 };
    const preview = value(service.previewCsvImport({ text, delimiter: 'auto', mapping: columns }));
    expect(preview.canApply).toBe(true); expect(preview.summary).toMatchObject({ newProducts: 3, newVariants: 4 }); apply(preview);
    const catalog = createCatalogStore(connection); expect(catalog.getProduct('csv-p-sample-coffee')?.variants).toHaveLength(2);
    expect(catalog.getProduct('csv-p-sample-sign')?.name).toBe('CSV Demo Sign "Chrysos"');
    expect(catalog.listCategories().some((entry) => entry.name === 'Signs | Labels')).toBe(true); expect(catalog.listCategories().some((entry) => entry.name === 'Limited > Edition')).toBe(true);
  });
  it('rejects Development demo receipts on non-Development replay and recovery requests', () => {
    const preview = demo(); apply(preview, 'demo-receipt');
    const beta = createManagementService(createManagementStore(connection), runtime, { channel: 'beta' });
    expect(beta.applyImportPlan({ planId: preview.planId, idempotencyKey: 'demo-receipt', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'DEVELOPMENT_ONLY' } });
    expect(beta.getImportOperation({ idempotencyKey: 'demo-receipt' })).toMatchObject({ ok: false, error: { code: 'DEVELOPMENT_ONLY' } });
  });
  it('upgrades a populated real V3 database while preserving legacy sales, mixed payments, refunds and draft snapshots', () => {
    const historical = openDatabase(join(directory, 'populated-v3.sqlite')); otherConnections.push(historical);
    historical.sqlite.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL,name TEXT NOT NULL UNIQUE,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
    for (const migration of migrations.filter((entry) => entry.version <= 3)) {
      historical.sqlite.exec(migration.sql);
      historical.sqlite.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'), runtime.now());
    }
    const catalog = createCatalogService(createCatalogStore(historical), runtime);
    const product = value(catalog.createProduct({ name: 'Existing V3 Product', description: 'Keep original', active: true, imageReference: null, categoryIds: [], primaryCategoryId: null, firstVariant: { name: 'Original', unitPriceRappen: 347, sku: 'EXISTING-V3', barcode: 'TEST-V3', active: true, position: 0 } }));
    const variantId = product.variants[0]?.id ?? '';
    const pos = createPosService(createPosStore(historical), runtime); const payments = createPaymentsService(createFinanceStore(historical), runtime);
    const add = () => { const cart = value(pos.getCart({})).cart; return value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId })); };
    const firstCart = add(); const oldAttempt = value(pos.prepareCheckout({ cartId: firstCart.id, expectedRevision: firstCart.revision }));
    const oldSale = value(pos.completeSale({ idempotencyKey: oldAttempt.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true }));
    const nextCart = add(); const session = value(payments.startCheckout({ cartId: nextCart.id, expectedRevision: nextCart.revision }));
    const card = value(payments.preparePayment({ sessionId: session.session.id, idempotencyKey: 'v3-card', method: 'card', intendedRappen: 100 })); value(payments.confirmPayment({ attemptId: card.id, operatorConfirmed: true }));
    const cash = value(payments.preparePayment({ sessionId: session.session.id, idempotencyKey: 'v3-cash', method: 'cash', intendedRappen: 500 })); value(payments.confirmPayment({ attemptId: cash.id, operatorConfirmed: true }));
    const mixed = value(payments.completeCheckout({ sessionId: session.session.id }));
    const refund = value(payments.prepareRefund({ saleId: mixed.id, idempotencyKey: 'v3-refund', method: 'twint', items: [{ saleItemId: mixed.items[0]?.id ?? '', quantity: 1 }] })); value(payments.confirmRefund({ attemptId: refund.id, operatorConfirmed: true }));
    const mixedBefore = value(payments.getSaleDetails({ saleId: mixed.id })); const draft = add();
    runMigrations(historical);
    const management = createManagementService(createManagementStore(historical), runtime, { channel: 'development' });
    const preview = value(management.previewDemoCatalog({})); value(management.applyImportPlan({ planId: preview.planId, idempotencyKey: 'upgrade-demo', operatorConfirmed: true }));
    expect(value(pos.getSale({ saleId: oldSale.id }))).toEqual(oldSale);
    expect(value(payments.getSaleDetails({ saleId: mixed.id }))).toEqual(mixedBefore);
    expect(value(pos.getCart({})).cart).toEqual(draft);
    expect(value(catalog.getProduct({ productId: product.id }))).toEqual(product);
    expect(historical.sqlite.prepare('SELECT count(*) n FROM schema_migrations WHERE version <= 3').get()?.['n']).toBe(3);
  });
  it('rolls back an interrupted management schema upgrade without replacing existing catalog records', () => {
    const historical = openDatabase(join(directory, 'blocked-v3.sqlite')); otherConnections.push(historical);
    historical.sqlite.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL,name TEXT NOT NULL UNIQUE,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
    for (const migration of migrations.filter((entry) => entry.version <= 3)) {
      historical.sqlite.exec(migration.sql); historical.sqlite.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'), runtime.now());
    }
    historical.sqlite.exec("CREATE TABLE catalog_import_operations(conflict TEXT) STRICT; INSERT INTO products(id,name,active) VALUES('keep','Keep this product',1); INSERT INTO product_variants(id,product_id,name,unit_price_rappen,active) VALUES('keep-variant','keep','Default',100,1)");
    expect(() => runMigrations(historical)).toThrow();
    expect(historical.sqlite.prepare("SELECT name FROM products WHERE id = 'keep'").get()?.['name']).toBe('Keep this product');
    expect(historical.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'catalog_import_plans'").get()).toBeUndefined();
    expect(historical.sqlite.prepare('SELECT max(version) n FROM schema_migrations').get()?.['n']).toBe(3);
  });
  it('rejects small CSV category explosions at the expansion budget before committing any preview or catalog data', () => {
    const rows = Array.from({ length: 11 }, (_, row) => {
      const paths = Array.from({ length: 16 }, (_, path) => [`r${row.toString(36)}p${path.toString(36)}`, ...Array.from({ length: 63 }, () => 'a')].join('>')).join('|');
      expect(paths.length).toBeLessThan(4000);
      return `budget-${row};Budget ${row};budget-v${row};Default;1.00;${paths}`;
    });
    const text = `${header}\n${rows.join('\n')}`;
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2 * 1024 * 1024);
    expect(value(service.parseCsv({ text, delimiter: ';' })).totalRows).toBe(11);
    expect(service.previewCsvImport({ text, delimiter: ';', mapping })).toMatchObject({ ok: false, error: { code: 'IMPORT_LIMIT' } });
    for (const table of ['catalog_import_plans', 'catalog_import_operations', 'catalog_import_identities', 'products', 'product_variants', 'categories']) expect(count(table)).toBe(0);
  });
  it('rejects two source product aliases resolving to one existing aggregate during preview', () => {
    apply(csv());
    const catalog = createCatalogStore(connection); const before = catalog.getProduct('csv-p-water');
    const text = `${header}\nwater;CSV Water;water-xl;XL;5.00;Drinks > Water\ncsv-p-water;CSV Water;water-xxl;XXL;6.00;Drinks > Water`;
    const preview = csv(text);
    expect(preview.canApply).toBe(false);
    expect(preview.issues).toMatchObject([{ rowNumber: 3, field: 'productKey', code: 'PRODUCT_IDENTITY_ALIAS', severity: 'error' }]);
    expect(service.applyImportPlan({ planId: preview.planId, idempotencyKey: 'alias-conflict', operatorConfirmed: true })).toMatchObject({ ok: false, error: { code: 'IMPORT_INVALID' } });
    expect(catalog.getProduct('csv-p-water')).toEqual(before); expect(count('catalog_import_operations')).toBe(1);
  });
});
