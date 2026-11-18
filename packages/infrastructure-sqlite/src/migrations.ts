import { createHash } from 'node:crypto';
import type { DatabaseConnection } from './connection.js';
import { firstSaleMigration } from './migrations/0001-first-sale.js';
import { catalogManagementMigration } from './migrations/0002-catalog-management.js';
import { paymentsRefundsMigration } from './migrations/0003-payments-refunds.js';
import { managementImportMigration } from './migrations/0004-management-import.js';
import { salesHistoryIndexesMigration } from './migrations/0005-sales-history-indexes.js';

export const migrations = [firstSaleMigration, catalogManagementMigration, paymentsRefundsMigration, managementImportMigration, salesHistoryIndexesMigration] as const;

/** Additive, versioned migration ledger. Never infer a schema by deleting data. */
export function runMigrations(connection: DatabaseConnection): void {
  const { sqlite } = connection;
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    const applied = sqlite.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    for (const [index, row] of applied.entries()) {
      const expected = migrations[index];
      if (expected === undefined || row['version'] !== expected.version || row['name'] !== expected.name ||
          row['checksum'] !== createHash('sha256').update(expected.sql).digest('hex')) {
        throw new Error('Database migration history is newer, altered or incomplete; manual review is required.');
      }
    }
    for (const migration of migrations.slice(applied.length)) {
      sqlite.exec(migration.sql);
      sqlite.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, createHash('sha256').update(migration.sql).digest('hex'), new Date().toISOString());
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    if (sqlite.isTransaction) sqlite.exec('ROLLBACK');
    throw error;
  }
}
