import type { CatalogImportPlan, ImportIdentity, ManagementStore } from '@cash-sloth/application';
import { DomainError, validateCategory, validateManagedProduct } from '@cash-sloth/domain';
import { CategorySchema, ImportOperationSchema, ImportPreviewSchema, ManagedProductSchema, type ImportOperation } from '@cash-sloth/contracts';
import { createCatalogStore } from './catalog-store.js';
import type { DatabaseConnection } from './connection.js';
import { createPosStore, type PosStoreTestHooks } from './pos-store.js';

type Row = Record<string, unknown>;
function parseData(row: Row): unknown {
  if (typeof row['data'] !== 'string') throw new Error('Missing import record.');
  const parsed: unknown = JSON.parse(row['data']);
  if (JSON.stringify(parsed) !== row['data']) throw new Error('Import record is ambiguous or noncanonical.');
  return parsed;
}
function decodePlan(value: unknown): CatalogImportPlan {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid persisted import plan.');
  const object = value as Record<string, unknown>;
  if (Object.keys(object).sort().join(',') !== 'catalogSnapshot,categories,identities,newProducts,preview,productUpdates') throw new Error('Unexpected persisted import plan fields.');
  if (typeof object['catalogSnapshot'] !== 'string' || !Array.isArray(object['categories']) || !Array.isArray(object['newProducts']) || !Array.isArray(object['productUpdates']) || !Array.isArray(object['identities'])) throw new Error('Invalid persisted import plan structure.');
  const preview = ImportPreviewSchema.parse(object['preview']);
  const categories = object['categories'].map((entry) => { const category = CategorySchema.parse(entry); validateCategory(category); return category; });
  const newProducts = object['newProducts'].map((entry) => { const product = ManagedProductSchema.parse(entry); validateManagedProduct(product); return product; });
  const productUpdates = object['productUpdates'].map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Object.keys(entry).sort().join(',') !== 'expectedRevision,product') throw new Error('Invalid persisted product extension.');
    const update = entry as Record<string, unknown>;
    const product = ManagedProductSchema.parse(update['product']); validateManagedProduct(product);
    const expectedRevision = update['expectedRevision'];
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || product.revision !== expectedRevision + 1) throw new Error('Invalid persisted import revision.');
    return { product, expectedRevision };
  });
  const identities = object['identities'].map((entry: unknown) => validateIdentity(entry));
  return { preview, catalogSnapshot: object['catalogSnapshot'], categories, newProducts, productUpdates, identities };
}
function validateIdentity(input: unknown): ImportIdentity {
  if (typeof input !== 'object' || input === null || Object.keys(input).sort().join(',') !== 'entityId,externalKey,kind,source') throw new Error('Invalid import identity.');
  const item = input as Record<string, unknown>;
  if (!['csv', 'demo'].includes(String(item['source'])) || !['product', 'variant', 'category'].includes(String(item['kind'])) || typeof item['externalKey'] !== 'string' || item['externalKey'].length < 1 || item['externalKey'].length > 16000 || typeof item['entityId'] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(item['entityId'])) throw new Error('Invalid persisted import identity.');
  return item as unknown as ImportIdentity;
}
export function createManagementStore(connection: DatabaseConnection, hooks: PosStoreTestHooks = {}): ManagementStore {
  const { sqlite } = connection; const catalog = createCatalogStore(connection); const { transaction } = createPosStore(connection, hooks);
  const requireTransaction = (): void => { if (!sqlite.isTransaction) throw new Error('Import mutations require a transaction.'); };
  const store: ManagementStore = {
    catalog, transaction,
    listIdentities() { return sqlite.prepare('SELECT source, kind, external_key, entity_id FROM catalog_import_identities ORDER BY source, kind, external_key').all().map((row) => validateIdentity({ source: row['source'], kind: row['kind'], externalKey: row['external_key'], entityId: row['entity_id'] })); },
    insertIdentity(input) {
      requireTransaction(); const identity = validateIdentity(input);
      const existing = sqlite.prepare('SELECT entity_id FROM catalog_import_identities WHERE source = ? AND kind = ? AND external_key = ?').get(identity.source, identity.kind, identity.externalKey);
      if (existing) { if (existing['entity_id'] !== identity.entityId) throw new DomainError('IDENTITY_CONFLICT', 'The import identity belongs to another record.'); return; }
      const table = identity.kind === 'product' ? 'products' : identity.kind === 'variant' ? 'product_variants' : 'categories';
      if (!sqlite.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(identity.entityId)) throw new DomainError('IDENTITY_CONFLICT', 'The imported identity has no catalog record.');
      sqlite.prepare('INSERT INTO catalog_import_identities (source, kind, external_key, entity_id) VALUES (?, ?, ?, ?)').run(identity.source, identity.kind, identity.externalKey, identity.entityId);
    },
    getPlan(id) {
      const row = sqlite.prepare('SELECT data FROM catalog_import_plans WHERE id = ?').get(id);
      return row ? decodePlan(parseData(row)) : null;
    },
    insertPlan(input) {
      requireTransaction(); const plan = decodePlan(input);
      sqlite.prepare('INSERT INTO catalog_import_plans (id, source, created_at, data) VALUES (?, ?, ?, ?)').run(plan.preview.planId, plan.preview.source, plan.preview.createdAt, JSON.stringify(plan));
    },
    getOperation(key) { const row = sqlite.prepare('SELECT data FROM catalog_import_operations WHERE idempotency_key = ?').get(key); return row ? ImportOperationSchema.parse(parseData(row)) : null; },
    getOperationForPlan(id) { const row = sqlite.prepare('SELECT data FROM catalog_import_operations WHERE plan_id = ?').get(id); return row ? ImportOperationSchema.parse(parseData(row)) : null; },
    insertOperation(input: ImportOperation) {
      requireTransaction(); const operation = ImportOperationSchema.parse(input); const plan = store.getPlan(operation.planId);
      if (!plan || !plan.preview.canApply || plan.preview.source !== operation.source || JSON.stringify(plan.preview.summary) !== JSON.stringify(operation.summary)) throw new DomainError('IMPORT_INVALID', 'Import result does not match its validated plan.');
      sqlite.prepare('INSERT INTO catalog_import_operations (idempotency_key, plan_id, data) VALUES (?, ?, ?)').run(operation.idempotencyKey, operation.planId, JSON.stringify(operation));
    },
  };
  return store;
}
