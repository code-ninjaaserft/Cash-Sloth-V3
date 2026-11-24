/** Visibility markers remove catalog entries from the working event without erasing sale references. */
export const catalogLifecycleMigration = {
  version: 8, name: 'catalog-lifecycle',
  sql: `
CREATE TABLE hidden_catalog_products(product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id)) STRICT;
CREATE TABLE hidden_catalog_categories(category_id TEXT PRIMARY KEY NOT NULL REFERENCES categories(id)) STRICT;
CREATE TABLE removed_event_presets(preset_id TEXT PRIMARY KEY NOT NULL REFERENCES event_presets(id)) STRICT;
`,
} as const;
