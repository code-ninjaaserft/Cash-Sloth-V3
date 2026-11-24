export const categoryColorsMigration = {
  version: 6,
  name: 'category-colors',
  sql: `ALTER TABLE categories ADD COLUMN color TEXT CHECK (color IS NULL OR (length(color) = 7 AND substr(color, 1, 1) = '#' AND substr(color, 2) NOT GLOB '*[^0-9a-fA-F]*'));`,
} as const;
