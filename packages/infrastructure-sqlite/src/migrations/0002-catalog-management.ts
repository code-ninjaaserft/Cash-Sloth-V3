/** Additive migration. The First Sale schema and financial snapshots are unchanged. */
export const catalogManagementMigration = {
  version: 2,
  name: '0002-catalog-management',
  sql: `
ALTER TABLE products ADD COLUMN description TEXT CHECK(description IS NULL OR length(description) <= 4000);
ALTER TABLE products ADD COLUMN image_reference TEXT CHECK(image_reference IS NULL OR length(image_reference) BETWEEN 1 AND 500);
ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE products ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE products ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991);
UPDATE products SET
  created_at = coalesce((SELECT applied_at FROM schema_migrations WHERE version = 1), '1970-01-01T00:00:00.000Z'),
  updated_at = coalesce((SELECT applied_at FROM schema_migrations WHERE version = 1), '1970-01-01T00:00:00.000Z');

ALTER TABLE product_variants ADD COLUMN sku TEXT CHECK(sku IS NULL OR length(sku) BETWEEN 1 AND 100);
ALTER TABLE product_variants ADD COLUMN barcode TEXT CHECK(barcode IS NULL OR length(barcode) BETWEEN 1 AND 100);
ALTER TABLE product_variants ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order BETWEEN 0 AND 1000000);
ALTER TABLE product_variants ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991);
CREATE UNIQUE INDEX product_variants_sku ON product_variants(sku COLLATE NOCASE) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX product_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX product_variants_order ON product_variants(product_id, display_order, name, id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  display_order INTEGER NOT NULL CHECK(display_order BETWEEN 0 AND 1000000),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  CHECK(parent_id IS NULL OR parent_id <> id)
) STRICT;
CREATE INDEX categories_parent_order ON categories(parent_id, display_order, name, id);
CREATE TABLE product_categories (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
  PRIMARY KEY(product_id, category_id)
) STRICT;
CREATE INDEX product_categories_category ON product_categories(category_id, product_id);
CREATE UNIQUE INDEX product_categories_one_primary ON product_categories(product_id) WHERE is_primary = 1;

CREATE TRIGGER products_identity_immutable BEFORE UPDATE OF id ON products WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT, 'Product identity is immutable'); END;
CREATE TRIGGER product_variants_identity_immutable BEFORE UPDATE OF id, product_id ON product_variants
WHEN NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id
BEGIN SELECT RAISE(ABORT, 'Variant identity and parent are immutable'); END;
CREATE TRIGGER product_variants_keep_one BEFORE DELETE ON product_variants
WHEN (SELECT count(*) FROM product_variants WHERE product_id = OLD.product_id) <= 1
BEGIN SELECT RAISE(ABORT, 'A product must retain at least one variant'); END;
CREATE TRIGGER categories_identity_immutable BEFORE UPDATE OF id ON categories WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT, 'Category identity is immutable'); END;
CREATE TRIGGER categories_cycle_insert BEFORE INSERT ON categories WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Category relationship would create a cycle') WHERE NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id UNION SELECT c.parent_id FROM categories c JOIN ancestors a ON c.id = a.id WHERE c.parent_id IS NOT NULL
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  );
END;
CREATE TRIGGER categories_cycle_update BEFORE UPDATE OF parent_id ON categories WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Category relationship would create a cycle') WHERE NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id UNION SELECT c.parent_id FROM categories c JOIN ancestors a ON c.id = a.id WHERE c.parent_id IS NOT NULL
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  );
END;
`,
} as const;
