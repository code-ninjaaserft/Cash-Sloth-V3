import type { DatabaseConnection } from './connection.js';

export const developmentCatalog = [
  { productId: 'product-water', variantId: 'variant-water-default', name: 'Mineral water', price: 330 },
  { productId: 'product-chocolate', variantId: 'variant-chocolate-default', name: 'Chocolate', price: 247 },
  { productId: 'product-coffee', variantId: 'variant-coffee-default', name: 'Coffee', price: 450 },
] as const;

/** Idempotent fixtures only: existing user edits are not overwritten on restart. */
export function seedDevelopmentCatalog(connection: DatabaseConnection, channel: string): void {
  if (!['development', 'beta', 'stable'].includes(channel)) throw new Error('Invalid seed channel.');
  if (channel !== 'development') return;
  const { sqlite } = connection;
  const timestamp = new Date().toISOString();
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const product of developmentCatalog) {
      sqlite.prepare('INSERT INTO products (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(id) DO NOTHING')
        .run(product.productId, product.name, timestamp, timestamp);
      sqlite.prepare('INSERT INTO product_variants (id, product_id, name, unit_price_rappen, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO NOTHING')
        .run(product.variantId, product.productId, 'Default', product.price);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    if (sqlite.isTransaction) sqlite.exec('ROLLBACK');
    throw error;
  }
}
