import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogService, createPaymentsService, createPosService, createPresetService } from '@cash-sloth/application';
import type { Result, PresetsRequest } from '@cash-sloth/contracts';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { runMigrations } from './migrations.js';
import { seedDevelopmentCatalog } from './seed.js';
import { createPresetStore } from './preset-store.js';
import { createCatalogStore } from './catalog-store.js';
import { createFinanceStore } from './finance-store.js';
import { createPosStore } from './pos-store.js';
function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message); return result.value; }

describe('event preset snapshots on SQLite', () => {
  let directory: string, db: DatabaseConnection, sequence: number;
  const runtime = { now: () => '2026-11-22T12:00:00.000Z', newId: () => `preset-test-${++sequence}` };
  const presets = () => createPresetService(createPresetStore(db), runtime);
  const catalog = () => createCatalogService(createCatalogStore(db), runtime);
  const state = () => value(presets().getState({}));
  const saveRequest = (name: string, empty = false, id: string | null = null): PresetsRequest<'save'> => ({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, name, presetId: id, expectedRevision: id ? state().presets.find((p) => p.id === id)?.revision ?? null : null, empty });
  const loadRequest = (id: string): PresetsRequest<'load'> => ({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: id, expectedRevision: state().presets.find((p) => p.id === id)?.revision ?? 0 });
  const chocolate = () => value(catalog().getProduct({ productId: 'product-chocolate' }));
  const price = (amount: number) => { const product = chocolate(), variant = product.variants[0]!; return value(catalog().updateVariant({ productId: product.id, variantId: variant.id, expectedProductRevision: product.revision, expectedRevision: variant.revision, name: variant.name, active: true, position: variant.position, sku: variant.sku, barcode: variant.barcode, unitPriceRappen: amount })); };
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sloth-presets-')); db = openDatabase(join(directory, 'test.sqlite')); sequence = 0; runMigrations(db); seedDevelopmentCatalog(db, 'development'); });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });

  it('edits inactive and active preset names/logos without overwriting catalog snapshots', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7XkAAAAASUVORK5CYII=';
    const logo = { name: 'summer.png', dataUrl }, otherLogo = { name: 'winter.png', dataUrl };
    const a = value(presets().save({ ...saveRequest('Summer'), logo })).active!.id;
    price(999); const b = value(presets().save({ ...saveRequest('Winter'), logo: otherLogo })).active!.id;
    price(888);
    const request: PresetsRequest<'update'> = { operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: a, expectedRevision: state().presets.find((p) => p.id === a)!.revision, name: 'Summer renamed', logo: otherLogo };
    const result = value(presets().update(request)); expect(result.active?.id).toBe(b);
    expect(chocolate().variants[0]?.unitPriceRappen).toBe(888);
    expect(createPresetStore(db).get(a)?.snapshot.products.find((p) => p.id === 'product-chocolate')?.variants[0]?.unitPriceRappen).toBe(247);
    expect(value(presets().update(request))).toEqual(result);
    expect(presets().update({ ...request, operationId: runtime.newId() })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    value(presets().load(loadRequest(a))); expect(state().active).toMatchObject({ name: 'Summer renamed', logo: otherLogo });
    expect(chocolate().variants[0]?.unitPriceRappen).toBe(247);
    value(presets().save(saveRequest('Summer renamed', false, a))); expect(state().active?.logo).toEqual(otherLogo);
    const source = state().presets.find((p) => p.id === a)!;
    const copied = value(presets().copy({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: a, expectedRevision: source.revision, name: 'Copy' })).active!.id;
    const update = { operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: copied, expectedRevision: state().presets.find((p) => p.id === copied)!.revision, name: 'Copy renamed', logo: null };
    value(presets().update(update)); expect(state().active?.logo).toBeNull(); expect(createPresetStore(db).get(a)?.logo).toEqual(otherLogo);
    expect(presets().update({ ...update, operationId: runtime.newId(), expectedRevision: state().presets.find((p) => p.id === copied)!.revision, name: 'Winter' })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_NAME' } });
    expect(presets().update({ ...update, operationId: runtime.newId(), logo: { name: 'bad.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }).ok).toBe(false);
    db.close(); db = openDatabase(join(directory, 'test.sqlite')); runMigrations(db);
    value(presets().load(loadRequest(a))); expect(state().active?.logo).toEqual(otherLogo);
  });

  it('saves, updates and loads prices, variant/category properties without duplicating records', () => {
    const category = value(catalog().createCategory({ name: 'Drinks', parentId: null, position: 0, active: true, color: '#ffff00' }));
    const product = chocolate(); value(catalog().assignCategories({ productId: product.id, expectedRevision: product.revision, categoryIds: [category.id], primaryCategoryId: category.id }));
    const a = value(presets().save(saveRequest('Event A'))).active!.id;
    price(999); value(catalog().updateCategory({ categoryId: category.id, expectedRevision: category.revision, name: 'Renamed', parentId: null, position: 0, active: true, color: '#ff0000' }));
    const b = value(presets().save(saveRequest('Event B'))).active!.id;
    const request = loadRequest(a); const restored = value(presets().load(request));
    expect(chocolate().variants[0]?.unitPriceRappen).toBe(247);
    expect(chocolate().primaryCategoryId).toBe(category.id);
    expect(value(catalog().listCategories({ includeInactive: true }))[0]).toMatchObject({ name: 'Drinks', color: '#ffff00' });
    expect(value(presets().load(request))).toEqual(restored);
    expect(value(presets().getOperation({ operationId: request.operationId }))).toEqual(restored);
    expect(state().catalogVersion).toBe(restored.catalogVersion);
    expect(createCatalogStore(db).listProducts()).toHaveLength(3);
    value(presets().load(loadRequest(b))); expect(chocolate().variants[0]?.unitPriceRappen).toBe(999);
    price(875); value(presets().save(saveRequest('Event B updated', false, b)));
    value(presets().load(loadRequest(a))); value(presets().load(loadRequest(b))); expect(chocolate().variants[0]?.unitPriceRappen).toBe(875);
    expect(state().active?.name).toBe('Event B updated');
    db.close(); db = openDatabase(join(directory, 'test.sqlite')); runMigrations(db);
    expect(state().active?.id).toBe(b); expect(chocolate().variants[0]?.unitPriceRappen).toBe(875);
  });

  it('starts empty events and restores old events without deleting products', () => {
    const old = value(presets().save(saveRequest('Original'))).active!.id;
    const empty = value(presets().save(saveRequest('Blank event', true))).active!.id;
    expect(createCatalogStore(db).listProducts().filter((p) => p.active)).toHaveLength(0);
    const added = value(catalog().createProduct({ name: 'Event special', active: true, description: null, imageReference: null, categoryIds: [value(catalog().createCategory({ name: 'Event category', parentId: null, active: true, position: 0 })).id], primaryCategoryId: null, firstVariant: { name: 'Default', unitPriceRappen: 550, sku: null, barcode: null, active: true, position: 0 } }));
    value(presets().save(saveRequest('Blank event', false, empty)));
    value(presets().load(loadRequest(old))); expect(createCatalogStore(db).listProducts().filter((p) => p.active)).toHaveLength(3);
    expect(catalog().getProduct({ productId: added.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(createCatalogStore(db, { includeHidden: true }).getProduct(added.id)?.active).toBe(false);
    value(presets().load(loadRequest(empty))); expect(createCatalogStore(db).listProducts().filter((p) => p.active).map((p) => p.id)).toEqual([added.id]);
  });

  it('blocks stale requests, duplicate names and switches during a cart or payment', () => {
    const first = saveRequest('Event A'); const a = value(presets().save(first)).active!.id;
    expect(presets().save(saveRequest('event a'))).toMatchObject({ ok: false, error: { code: 'DUPLICATE_NAME' } });
    const stale = loadRequest(a); price(500);
    expect(presets().load(stale)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(chocolate().variants[0]?.unitPriceRappen).toBe(500);
    expect(presets().save({ ...first, name: 'Other name' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const pos = createPosService(createPosStore(db), runtime); let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    expect(presets().load(loadRequest(a))).toMatchObject({ ok: false, error: { code: 'PRESET_BUSY' } });
    const payments = createPaymentsService(createFinanceStore(db), runtime); value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    expect(presets().save(saveRequest('Blocked'))).toMatchObject({ ok: false, error: { code: 'PRESET_BUSY' } });
  });

  it('rolls back an interrupted catalog restore, including active event and operation log', () => {
    const a = value(presets().save(saveRequest('Event A'))).active!.id; price(700); value(presets().save(saveRequest('Event B')));
    const before = JSON.stringify(createCatalogStore(db).listProducts()), active = state().active;
    const store = createPresetStore(db), original = store.catalog.updateProduct; let writes = 0;
    store.catalog.updateProduct = (product, revision) => { original(product, revision); if (++writes === 2) throw new Error('Injected failure'); };
    const request = loadRequest(a);
    expect(createPresetService(store, runtime).load(request).ok).toBe(false);
    expect(JSON.stringify(createCatalogStore(db).listProducts())).toBe(before); expect(state().active).toEqual(active);
    expect(value(presets().getOperation({ operationId: request.operationId }))).toBeNull();
    value(presets().load(request)); expect(chocolate().variants[0]?.unitPriceRappen).toBe(247);
  });

  it('preserves the event title and original price on completed receipts after changing events', () => {
    value(presets().save(saveRequest('Alpine market')));
    const pos = createPosService(createPosStore(db), runtime), payments = createPaymentsService(createFinanceStore(db), runtime);
    let cart = value(pos.getCart({})).cart; cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    const checkout = value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    const attempt = value(payments.preparePayment({ sessionId: checkout.session.id, idempotencyKey: runtime.newId(), method: 'card', intendedRappen: 247 }));
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })); const sale = value(payments.completeCheckout({ sessionId: checkout.session.id }));
    expect(sale.eventTitle).toBe('Alpine market');
    price(999); value(presets().save(saveRequest('Winter party')));
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale).toEqual(sale);
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale.items[0]?.unitPriceRappen).toBe(247);
  });

  it('supports restoring SKU swaps atomically', () => {
    db.sqlite.prepare('UPDATE product_variants SET sku=? WHERE id=?').run('ONE', 'variant-chocolate-default');
    db.sqlite.prepare('UPDATE product_variants SET sku=? WHERE id=?').run('TWO', 'variant-water-default');
    const a = value(presets().save(saveRequest('Metadata A'))).active!.id;
    db.sqlite.exec('BEGIN IMMEDIATE'); db.sqlite.prepare('UPDATE product_variants SET sku=NULL').run();
    db.sqlite.prepare('UPDATE product_variants SET sku=? WHERE id=?').run('TWO', 'variant-chocolate-default');
    db.sqlite.prepare('UPDATE product_variants SET sku=? WHERE id=?').run('ONE', 'variant-water-default'); db.sqlite.exec('COMMIT');
    value(presets().load(loadRequest(a))); expect(chocolate().variants[0]?.sku).toBe('ONE');
    expect(value(catalog().getProduct({ productId: 'product-water' })).variants[0]?.sku).toBe('TWO');
  });

  it('copies saved presets independently, removes active or inactive presets and replays deletion safely', () => {
    const original = value(presets().save(saveRequest('Original event'))).active!.id;
    const source = state().presets.find((p) => p.id === original)!;
    const copied = value(presets().copy({ operationId: runtime.newId(), catalogVersion: state().catalogVersion, presetId: original, expectedRevision: source.revision, name: 'Similar event' })).active!.id;
    expect(copied).not.toBe(original); price(875); value(presets().save(saveRequest('Similar event', false, copied)));
    value(presets().load(loadRequest(original))); expect(chocolate().variants[0]?.unitPriceRappen).toBe(247);
    value(presets().load(loadRequest(copied))); expect(chocolate().variants[0]?.unitPriceRappen).toBe(875);
    value(presets().remove(loadRequest(original))); expect(state().active?.id).toBe(copied); expect(state().presets).toHaveLength(1);
    const request = loadRequest(copied); const removed = value(presets().remove(request)); expect(removed.active).toBeNull(); expect(removed.presets).toHaveLength(0);
    expect(createCatalogStore(db).listProducts()).toHaveLength(0); expect(createCatalogStore(db).listCategories()).toHaveLength(0);
    expect(value(presets().remove(request))).toEqual(removed);
    expect(presets().load({ ...request, operationId: runtime.newId(), catalogVersion: state().catalogVersion })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(createCatalogStore(db, { includeHidden: true }).listProducts()).toHaveLength(3);
  });

  it('allows a new event to reuse a SKU while keeping the original preset restorable', () => {
    db.sqlite.prepare('UPDATE product_variants SET sku=? WHERE id=?').run('SHARED', 'variant-chocolate-default');
    const a = value(presets().save(saveRequest('A'))).active!.id;
    const b = value(presets().save(saveRequest('B', true))).active!.id;
    expect(value(catalog().listProducts({ query: '', categoryId: null, restrictToCategory: false, includeInactive: true }))).toHaveLength(0);
    const added = value(catalog().createProduct({ name: 'New event item', description: null, active: true, imageReference: null, categoryIds: [value(catalog().createCategory({ name: 'Event category', parentId: null, active: true, position: 0 })).id], primaryCategoryId: null, firstVariant: { name: 'Default', unitPriceRappen: 1000, active: true, position: 0, sku: 'SHARED', barcode: null } }));
    value(presets().save(saveRequest('B', false, b)));
    value(presets().load(loadRequest(a))); expect(chocolate().variants[0]?.sku).toBe('SHARED');
    value(presets().load(loadRequest(b))); expect(value(catalog().getProduct({ productId: added.id })).variants[0]?.sku).toBe('SHARED');
    expect(catalog().getProduct({ productId: 'product-chocolate' }).ok).toBe(false);
  });

  it('deletes products and category subtrees from the event while retaining sales, refunds and saved templates', () => {
    const root = value(catalog().createCategory({ name: 'Food', parentId: null, position: 0, active: true }));
    const child = value(catalog().createCategory({ name: 'Snacks', parentId: root.id, position: 0, active: true }));
    let product = chocolate(); value(catalog().assignCategories({ productId: product.id, expectedRevision: product.revision, categoryIds: [child.id], primaryCategoryId: child.id }));
    const water = value(catalog().getProduct({ productId: 'product-water' })); value(catalog().assignCategories({ productId: water.id, expectedRevision: water.revision, categoryIds: [child.id], primaryCategoryId: child.id }));
    const saved = value(presets().save(saveRequest('Sale event'))).active!.id;
    const pos = createPosService(createPosStore(db), runtime), payments = createPaymentsService(createFinanceStore(db), runtime);
    let cart = value(pos.getCart({})).cart; cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: 'variant-chocolate-default' }));
    product = chocolate(); expect(catalog().removeProduct({ productId: product.id, expectedRevision: product.revision })).toMatchObject({ ok: false, error: { code: 'CATALOG_BUSY' } });
    const checkout = value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision })); const attempt = value(payments.preparePayment({ sessionId: checkout.session.id, idempotencyKey: runtime.newId(), method: 'card', intendedRappen: 247 }));
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true })); const sale = value(payments.completeCheckout({ sessionId: checkout.session.id }));
    value(catalog().removeProduct({ productId: product.id, expectedRevision: product.revision }));
    expect(catalog().getProduct({ productId: product.id }).ok).toBe(false);
    value(catalog().removeCategory({ categoryId: root.id, expectedRevision: root.revision }));
    expect(value(catalog().listCategories({ includeInactive: true }))).toHaveLength(0);
    expect(value(catalog().getProduct({ productId: water.id })).categoryIds).toEqual([]);
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale).toEqual(sale);
    const refund = value(payments.prepareRefund({ saleId: sale.id, idempotencyKey: runtime.newId(), method: 'card', items: [{ saleItemId: sale.items[0]!.id, quantity: 1 }] }));
    value(payments.confirmRefund({ attemptId: refund.id, operatorConfirmed: true }));
    expect(value(payments.getSaleDetails({ saleId: sale.id })).refundedRappen).toBe(247);
    value(presets().load(loadRequest(saved))); expect(chocolate().active).toBe(true); expect(value(catalog().listCategories({ includeInactive: true }))).toHaveLength(2);
  });

  it('creates multiple variants atomically and requires an existing active category', () => {
    const category = value(catalog().createCategory({ name: 'Food', parentId: null, active: true, position: 0 }));
    const variant = { name: 'Small', unitPriceRappen: 100, active: true, position: 0, sku: 'SMALL', barcode: null };
    const request = { name: 'Sizes', description: null, active: true, imageReference: null, categoryIds: [category.id], primaryCategoryId: category.id, firstVariant: variant, additionalVariants: [{ ...variant, name: 'Large', sku: 'LARGE', unitPriceRappen: 200, position: 1 }] };
    expect(catalog().createProduct({ ...request, categoryIds: [] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(catalog().createProduct({ ...request, categoryIds: ['missing'] })).toMatchObject({ ok: false, error: { code: 'CATEGORY_REQUIRED' } });
    const before = createCatalogStore(db).listProducts();
    expect(catalog().createProduct({ ...request, additionalVariants: [{ ...variant }] }).ok).toBe(false);
    expect(createCatalogStore(db).listProducts()).toEqual(before);
    const product = value(catalog().createProduct(request));
    expect(product.variants.map((v) => v.name)).toEqual(['Small', 'Large']);
    expect(value(catalog().getProduct({ productId: product.id }))).toEqual(product);
    value(catalog().updateCategory({ name: category.name, parentId: category.parentId, position: category.position, categoryId: category.id, expectedRevision: category.revision, active: false }));
    expect(catalog().createProduct(request)).toMatchObject({ ok: false, error: { code: 'CATEGORY_REQUIRED' } });
  });

  it('removes sold variants while preserving history and restores their saved preset state', () => {
    let product = chocolate();
    product = value(catalog().createVariant({ productId: product.id, expectedProductRevision: product.revision, name: 'Large', unitPriceRappen: 500, active: true, position: 1, sku: 'LARGE', barcode: null }));
    const saved = value(presets().save(saveRequest('Original variants'))).active!.id;
    const variant = product.variants.find((v) => v.id === 'variant-chocolate-default')!;
    const request = { productId: product.id, variantId: variant.id, expectedProductRevision: product.revision, expectedRevision: variant.revision };
    const pos = createPosService(createPosStore(db), runtime), payments = createPaymentsService(createFinanceStore(db), runtime);
    let cart = value(pos.getCart({})).cart;
    cart = value(pos.addItem({ cartId: cart.id, expectedRevision: cart.revision, variantId: variant.id }));
    expect(catalog().removeVariant(request)).toMatchObject({ ok: false, error: { code: 'CATALOG_BUSY' } });
    const checkout = value(payments.startCheckout({ cartId: cart.id, expectedRevision: cart.revision }));
    const attempt = value(payments.preparePayment({ sessionId: checkout.session.id, idempotencyKey: runtime.newId(), method: 'card', intendedRappen: 247 }));
    value(payments.confirmPayment({ attemptId: attempt.id, operatorConfirmed: true }));
    const sale = value(payments.completeCheckout({ sessionId: checkout.session.id }));
    db.sqlite.exec("CREATE TEMP TRIGGER fail_variant_hide BEFORE INSERT ON hidden_catalog_variants BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
    expect(catalog().removeVariant(request).ok).toBe(false); expect(chocolate()).toEqual(product);
    db.sqlite.exec('DROP TRIGGER fail_variant_hide');
    product = value(catalog().removeVariant(request));
    expect(product.variants.map((v) => v.name)).toEqual(['Large']);
    expect(catalog().removeVariant(request)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const last = product.variants[0]!;
    expect(catalog().removeVariant({ productId: product.id, variantId: last.id, expectedProductRevision: product.revision, expectedRevision: last.revision })).toMatchObject({ ok: false, error: { code: 'LAST_VARIANT' } });
    expect(value(payments.getSaleDetails({ saleId: sale.id })).sale).toEqual(sale);
    const edited = value(presets().save(saveRequest('Edited variants'))).active!.id;
    value(presets().load(loadRequest(saved))); expect(chocolate().variants).toHaveLength(2);
    value(presets().load(loadRequest(edited))); expect(chocolate().variants.map((v) => v.name)).toEqual(['Large']);
    db.close(); db = openDatabase(join(directory, 'test.sqlite')); runMigrations(db);
    expect(chocolate().variants.map((v) => v.name)).toEqual(['Large']);
  });

  it('rolls back category deletion if any visibility write fails', () => {
    const root = value(catalog().createCategory({ name: 'Food', parentId: null, position: 0, active: true })); const product = chocolate();
    value(catalog().assignCategories({ productId: product.id, expectedRevision: product.revision, categoryIds: [root.id], primaryCategoryId: root.id }));
    const before = chocolate(); db.sqlite.exec("CREATE TEMP TRIGGER fail_hide BEFORE INSERT ON hidden_catalog_categories BEGIN SELECT RAISE(ABORT, 'Injected failure'); END");
    expect(catalog().removeCategory({ categoryId: root.id, expectedRevision: root.revision }).ok).toBe(false);
    expect(chocolate()).toEqual(before); expect(value(catalog().listCategories({ includeInactive: true }))[0]?.id).toBe(root.id);
  });
});
