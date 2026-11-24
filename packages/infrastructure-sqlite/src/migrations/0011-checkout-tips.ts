import { paymentsRefundsMigration } from './0003-payments-refunds.js';

// Extend the existing ledger constraints while copying every historical payload unchanged.
const original = paymentsRefundsMigration.sql;
const table = original.match(/CREATE TABLE financial_sales \([\s\S]*?\) STRICT;/u)?.[0];
if (!table) throw new Error('Missing financial sale table definition.');
const triggers = [...original.matchAll(/CREATE TRIGGER ([a-z_]+)[\s\S]*?END;/gu)].filter(([sql, name]) => sql.includes('financial_sales') || name === 'payment_sessions_snapshot_immutable');
const tip = "coalesce(json_extract(NEW.data, '$.tipRappen'), 0)";
const total = "(json_extract(NEW.data, '$.subtotalRappen') + " + tip + ')';
const updatedTriggers = triggers.map(([sql, name]) => {
  if (name === 'payment_sessions_snapshot_immutable') return sql.replaceAll("'$.status', '$.saleId'", "'$.status', '$.saleId', '$.tipRappen'");
  if (name === 'financial_sales_validate') return sql.replace("> json_extract(NEW.data, '$.subtotalRappen')", '> ' + total);
  if (name === 'financial_sales_cash_rounding') return sql.replace("json_extract(NEW.data, '$.subtotalRappen')", total);
  if (name === 'refunds_limit') return sql.replace('SELECT actual_paid_rappen FROM financial_sales', "SELECT actual_paid_rappen - coalesce(json_extract(data, '$.tipRappen'), 0) FROM financial_sales");
  return sql;
});
export const checkoutTipsMigration = {
  version: 11,
  name: '0011-checkout-tips',
  sql: [
    ...triggers.map(([, name]) => 'DROP TRIGGER ' + name + ';'),
    table.replace('CREATE TABLE financial_sales (', 'CREATE TABLE financial_sales_with_tips (')
      .replace("json_extract(data, '$.subtotalRappen') + json_extract(data, '$.roundingAdjustmentRappen') = actual_paid_rappen", "coalesce(json_type(data, '$.tipRappen'), 'integer') IS 'integer' AND coalesce(json_extract(data, '$.tipRappen'), 0) BETWEEN 0 AND 9007199254740991 AND json_extract(data, '$.subtotalRappen') + coalesce(json_extract(data, '$.tipRappen'), 0) + json_extract(data, '$.roundingAdjustmentRappen') = actual_paid_rappen"),
    'INSERT INTO financial_sales_with_tips SELECT * FROM financial_sales;',
    'DROP TABLE financial_sales;',
    'ALTER TABLE financial_sales_with_tips RENAME TO financial_sales;',
    'CREATE INDEX financial_sales_completed ON financial_sales(completed_at DESC, id DESC);',
    'CREATE INDEX financial_sales_history_total ON financial_sales(actual_paid_rappen, completed_at, id);',
    ...updatedTriggers,
    `CREATE TRIGGER payment_sessions_tip_guard BEFORE UPDATE ON payment_sessions
      WHEN coalesce(json_type(NEW.data, '$.tipRappen'), 'integer') IS NOT 'integer'
        OR coalesce(json_extract(NEW.data, '$.tipRappen'), 0) NOT BETWEEN 0 AND 9007199254740991
        OR (coalesce(json_extract(NEW.data, '$.tipRappen'), 0) <> coalesce(json_extract(OLD.data, '$.tipRappen'), 0)
          AND EXISTS(SELECT 1 FROM payment_attempts WHERE session_id=OLD.id AND state NOT IN ('failed','excluded')))
      BEGIN SELECT RAISE(ABORT, 'Tip requires integer Rappen and no prepared payment'); END;`,
    `CREATE TRIGGER financial_sales_tip_matches BEFORE INSERT ON financial_sales
      WHEN coalesce(json_extract(NEW.data, '$.tipRappen'), 0) <> coalesce((SELECT json_extract(data, '$.tipRappen') FROM payment_sessions WHERE id=NEW.session_id),0)
      BEGIN SELECT RAISE(ABORT, 'Sale tip must match checkout'); END;`,
  ].join('\n'),
} as const;
