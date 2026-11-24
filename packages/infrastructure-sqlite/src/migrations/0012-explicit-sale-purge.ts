import { firstSaleMigration } from './0001-first-sale.js';
import { paymentsRefundsMigration } from './0003-payments-refunds.js';

const deletionTriggers = [...(firstSaleMigration.sql + paymentsRefundsMigration.sql).matchAll(/CREATE TRIGGER ([a-z_]+) BEFORE DELETE ON ([a-z_]+)([\s\S]*?)BEGIN([\s\S]*?)END;/gu)];
const keys: Record<string, string> = { sale_items: 'sale_id', sale_payments: 'sale_id', checkout_attempts: 'idempotency_key' };
export const salePurgeMigration = {
  version: 12,
  name: '0012-explicit-sale-purge',
  sql: ['CREATE TABLE sale_purge_records (table_name TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(table_name,record_id)) STRICT;',
    ...deletionTriggers.map(([, name, table, clause, body]) => {
      const condition = clause?.trim().replace(/^WHEN\s+/u, '');
      const guard = "NOT EXISTS(SELECT 1 FROM sale_purge_records WHERE table_name='" + table + "' AND record_id=OLD." + (keys[table!] ?? 'id') + ')';
      return 'DROP TRIGGER ' + name + ';\nCREATE TRIGGER ' + name + ' BEFORE DELETE ON ' + table + ' WHEN ' + (condition ? '(' + condition + ') AND ' : '') + guard + ' BEGIN' + body + 'END;';
    }),
  ].join('\n'),
} as const;
