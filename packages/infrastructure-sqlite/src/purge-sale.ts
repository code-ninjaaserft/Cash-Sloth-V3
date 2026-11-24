import { DomainError } from '@cash-sloth/domain';
import type { FinancialSale } from '@cash-sloth/domain';
import type { DatabaseConnection } from './connection.js';

/** Only called inside the validated history removal transaction. Scope never survives commit. */
export function purgeSale(connection: DatabaseConnection, sale: FinancialSale): void {
  const { sqlite } = connection;
  if (!sqlite.isTransaction) throw new Error('Sale deletion requires a transaction.');
  if (sqlite.prepare('SELECT 1 FROM sale_purge_records LIMIT 1').get()) throw new Error('Unexpected sale deletion scope.');
  const cartId = sale.cartId;
  if (sqlite.prepare('SELECT 1 FROM sales WHERE cart_id=? AND id<>? UNION ALL SELECT 1 FROM financial_sales WHERE cart_id=? AND id<>?').get(cartId,sale.id,cartId,sale.id)) throw new DomainError('CONFLICT', 'Another sale uses this cart. Resolve it before deleting.');
  if (sqlite.prepare("SELECT 1 FROM payment_sessions WHERE cart_id=? AND state='open' UNION ALL SELECT 1 FROM payment_attempts WHERE session_id IN (SELECT id FROM payment_sessions WHERE cart_id=?) AND state IN ('prepared','reported','uncertain') UNION ALL SELECT 1 FROM refund_attempts WHERE sale_id=? AND state IN ('prepared','reported','uncertain')").get(cartId,cartId,sale.id)) throw new DomainError('REFUND_PENDING', 'Resolve pending payments or refunds before deleting this sale.');
  const scope = sqlite.prepare('INSERT INTO sale_purge_records VALUES(?,?)');
  const collect = (table: string, key: string, query: string, parameters: string[]): void => {
    for (const row of sqlite.prepare(query).all(...parameters)) scope.run(table, String(row[key]));
  };
  collect('payment_sessions','id','SELECT id FROM payment_sessions WHERE cart_id=?',[cartId]);
  collect('payment_attempts','id','SELECT id FROM payment_attempts WHERE session_id IN (SELECT id FROM payment_sessions WHERE cart_id=?)',[cartId]);
  collect('checkout_attempts','idempotency_key','SELECT idempotency_key FROM checkout_attempts WHERE cart_id=?',[cartId]);
  collect('refund_attempts','id','SELECT id FROM refund_attempts WHERE sale_id=?',[sale.id]);
  collect('refunds','id','SELECT id FROM refunds WHERE sale_id=?',[sale.id]);
  collect('reconciliation_actions','id',"SELECT id FROM reconciliation_actions WHERE (kind='legacy' AND reference_id IN (SELECT record_id FROM sale_purge_records WHERE table_name='checkout_attempts')) OR (kind='payment' AND reference_id IN (SELECT record_id FROM sale_purge_records WHERE table_name='payment_attempts')) OR (kind='refund' AND reference_id IN (SELECT record_id FROM sale_purge_records WHERE table_name='refund_attempts'))",[]);
  collect('financial_events','id',"SELECT id FROM financial_events WHERE (json_extract(data,'$.kind')='session' AND reference_id IN (SELECT record_id FROM sale_purge_records WHERE table_name='payment_sessions')) OR (json_extract(data,'$.kind')='payment' AND reference_id IN (SELECT record_id FROM sale_purge_records WHERE table_name='payment_attempts')) OR (json_extract(data,'$.kind')='refund' AND reference_id IN (SELECT record_id FROM sale_purge_records WHERE table_name='refund_attempts'))",[]);
  for (const table of ['financial_sales','sales','sale_items','sale_payments']) scope.run(table,sale.id);
  // Legacy sales and checkout confirmations reference one another. Check all FKs at commit.
  sqlite.exec('PRAGMA defer_foreign_keys=ON');
  for (const table of ['refunds','refund_attempts','financial_events','reconciliation_actions','financial_sales','sale_items','sale_payments','sales','payment_attempts','payment_sessions','checkout_attempts']) {
    const key = table === 'sale_items' || table === 'sale_payments' ? 'sale_id' : table === 'checkout_attempts' ? 'idempotency_key' : 'id';
    sqlite.prepare('DELETE FROM ' + table + ' WHERE ' + key + ' IN (SELECT record_id FROM sale_purge_records WHERE table_name=?)').run(table);
  }
  sqlite.prepare('DELETE FROM cart_items WHERE cart_id=?').run(cartId);
  sqlite.prepare('DELETE FROM carts WHERE id=?').run(cartId);
  sqlite.exec('DELETE FROM sale_purge_records');
}
