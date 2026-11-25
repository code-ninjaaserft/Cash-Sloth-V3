import {rejectedOrderNumbersMigration} from './migrations/0021-rejected-order-numbers.js';
import {orderOptionsMigration} from './migrations/0020-order-options.js';
import {orderServiceMigration} from './migrations/0019-order-service.js';
import { kioskOrdersMigration } from './migrations/0018-kiosk-orders.js';
import { combinedVouchersMigration } from './migrations/0017-combined-vouchers.js';
import { promotionsMigration } from './migrations/0016-promotions.js';
import { teamTicketControlsMigration } from './migrations/0015-team-ticket-controls.js';
import { ticketsMigration } from './migrations/0014-tickets.js';
import { historyBulkRemovalMigration } from './migrations/0013-history-bulk-removal.js';
import { salePurgeMigration } from './migrations/0012-explicit-sale-purge.js';
import { checkoutTipsMigration } from './migrations/0011-checkout-tips.js';
import { historyVisibilityMigration } from './migrations/0010-history-visibility.js';
import { variantLifecycleMigration } from './migrations/0009-variant-lifecycle.js';
import { catalogLifecycleMigration } from './migrations/0008-catalog-lifecycle.js';
import { eventPresetsMigration } from './migrations/0007-event-presets.js';
import { createHash } from 'node:crypto';
import type { DatabaseConnection } from './connection.js';
import { firstSaleMigration } from './migrations/0001-first-sale.js';
import { catalogManagementMigration } from './migrations/0002-catalog-management.js';
import { paymentsRefundsMigration } from './migrations/0003-payments-refunds.js';
import { managementImportMigration } from './migrations/0004-management-import.js';
import { salesHistoryIndexesMigration } from './migrations/0005-sales-history-indexes.js';

import { categoryColorsMigration } from './migrations/0006-category-colors.js';

export const migrations = [firstSaleMigration, catalogManagementMigration, paymentsRefundsMigration, managementImportMigration, salesHistoryIndexesMigration, categoryColorsMigration, eventPresetsMigration, catalogLifecycleMigration, variantLifecycleMigration, historyVisibilityMigration, checkoutTipsMigration, salePurgeMigration, historyBulkRemovalMigration, ticketsMigration, teamTicketControlsMigration, promotionsMigration, combinedVouchersMigration, kioskOrdersMigration, orderServiceMigration, orderOptionsMigration, rejectedOrderNumbersMigration] as const;

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
