export const variantLifecycleMigration = {
  version: 9,
  name: 'variant-lifecycle',
  sql: 'CREATE TABLE hidden_catalog_variants (variant_id TEXT PRIMARY KEY NOT NULL REFERENCES product_variants(id)) STRICT;',
} as const;
