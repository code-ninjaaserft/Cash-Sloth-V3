/** Additive import plans/receipts/provenance; financial records are not changed. */
export const managementImportMigration = {
  version: 4,
  name: '0004-management-import',
  sql: `
CREATE TABLE catalog_import_plans (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('csv', 'demo')),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
  CHECK(json_extract(data, '$.preview.planId') IS id AND json_extract(data, '$.preview.source') IS source
    AND json_extract(data, '$.preview.createdAt') IS created_at)
) STRICT;
CREATE TABLE catalog_import_operations (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  plan_id TEXT NOT NULL UNIQUE REFERENCES catalog_import_plans(id) ON DELETE RESTRICT,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
  CHECK(json_extract(data, '$.idempotencyKey') IS idempotency_key AND json_extract(data, '$.planId') IS plan_id)
) STRICT;
CREATE TABLE catalog_import_identities (
  source TEXT NOT NULL CHECK(source IN ('csv', 'demo')),
  kind TEXT NOT NULL CHECK(kind IN ('product', 'variant', 'category')),
  external_key TEXT NOT NULL CHECK(length(external_key) BETWEEN 1 AND 16000),
  entity_id TEXT NOT NULL CHECK(length(entity_id) BETWEEN 1 AND 128),
  PRIMARY KEY(source, kind, external_key)
) STRICT;
CREATE INDEX catalog_import_identities_entity ON catalog_import_identities(kind, entity_id);
CREATE TRIGGER catalog_import_plans_no_update BEFORE UPDATE ON catalog_import_plans BEGIN SELECT RAISE(ABORT, 'Import plans are immutable'); END;
CREATE TRIGGER catalog_import_plans_no_delete BEFORE DELETE ON catalog_import_plans BEGIN SELECT RAISE(ABORT, 'Import plans cannot be deleted'); END;
CREATE TRIGGER catalog_import_operations_no_update BEFORE UPDATE ON catalog_import_operations BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END;
CREATE TRIGGER catalog_import_operations_no_delete BEFORE DELETE ON catalog_import_operations BEGIN SELECT RAISE(ABORT, 'Import receipts cannot be deleted'); END;
CREATE TRIGGER catalog_import_identities_no_update BEFORE UPDATE ON catalog_import_identities BEGIN SELECT RAISE(ABORT, 'Import identities are immutable'); END;
CREATE TRIGGER catalog_import_identities_no_delete BEFORE DELETE ON catalog_import_identities BEGIN SELECT RAISE(ABORT, 'Import identities cannot be deleted'); END;
`,
} as const;
