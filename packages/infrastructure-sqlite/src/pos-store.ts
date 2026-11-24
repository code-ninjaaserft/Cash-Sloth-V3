import {completeBenefit} from './promotion-completion.js';
import { issueSaleTickets } from './ticket-issuance.js';
import { DomainError, addMoney, assertIdentifier, multiplyMoney, validateCart, validateCheckoutAttempt, validateSale, type Cart, type CartItem, type CatalogItem, type CheckoutAttempt, type Sale } from '@cash-sloth/domain';
import { PersistenceError, type PosStore } from '@cash-sloth/application';
import { CartSchema, CatalogItemSchema, CheckoutAttemptSchema, SaleSchema } from '@cash-sloth/contracts';
import type { DatabaseConnection } from './connection.js';

type Row = Record<string, unknown>;
function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid persisted ${field}.`);
  return value;
}
function integer(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid persisted ${field}.`);
  return value;
}
function id(row: Row, field: string): string {
  const value = text(row, field);
  assertIdentifier(value);
  return value;
}
function nullableText(row: Row, field: string): string | null {
  return row[field] === null ? null : text(row, field);
}

export interface PosStoreTestHooks {
  /** Test-only fault injection; these callbacks are never configured by hosts or IPC. */
  beforeCommit?(): void;
  afterCommit?(): void;
}

/** Persistence adapter; mutation methods are usable only within its transaction boundary. */
export function createPosStore(connection: DatabaseConnection, hooks: PosStoreTestHooks = {}): PosStore {
  const { sqlite } = connection;
  const hasPromotions=():boolean=>!!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='cart_discounts'").get();
  const discountMetadata=(row:Row,legacy=false):{originalUnitPriceRappen?:number;discountLabel?:string}=>{if(!hasPromotions())return {};const meta=legacy?sqlite.prepare('SELECT original_price,label FROM legacy_discounts WHERE sale_id=? AND item_id=?').get(String(row['sale_id']),String(row['id'])):sqlite.prepare('SELECT original_price,label FROM cart_discounts WHERE item_id=?').get(String(row['id']));return meta?{originalUnitPriceRappen:integer(meta,'original_price'),discountLabel:text(meta,'label')}:{};};
  const hasTickets = (): boolean => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='tickets' AND type='table'").get() !== undefined;
  // Legacy migration fixtures deliberately use this adapter before migration 3.
  // Check availability at call time so a live adapter also sees a subsequent upgrade.
  const hasFinanceJournal = (): boolean => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_sessions'").get() !== undefined;
  const unresolvedLegacyFilter = (): string => hasFinanceJournal()
    ? " AND NOT EXISTS(SELECT 1 FROM reconciliation_actions r WHERE r.kind = 'legacy' AND r.reference_id = checkout_attempts.idempotency_key)" : '';
  const requireTransaction = (): void => {
    if (!sqlite.isTransaction) throw new Error('POS writes require a transaction.');
  };
  const catalogFrom = (row: Row): CatalogItem => CatalogItemSchema.parse({
    ...(Number(row['ticket_uses'] ?? 0) > 0 ? { ticketUses: integer(row, 'ticket_uses') } : {}), productId: id(row, 'product_id'), variantId: id(row, 'variant_id'),
    productName: text(row, 'product_name'), variantName: text(row, 'variant_name'),
    unitPriceRappen: integer(row, 'unit_price_rappen'),
    productActive: row['product_active'] === 1, active: row['active'] === 1,
  });
  const catalogSelect = (): string => `SELECT p.id product_id, v.id variant_id, p.name product_name,
    v.name variant_name, v.unit_price_rappen, p.active product_active, v.active${hasTickets() ? ', COALESCE(pts.use_count,0) ticket_uses' : ''}
    FROM products p JOIN product_variants v ON v.product_id = p.id${hasTickets() ? ' LEFT JOIN product_ticket_settings pts ON pts.product_id=p.id' : ''}`;

  const itemFrom = (row: Row): CartItem => ({
    ...discountMetadata(row,true),
    ...(Number(row['ticket_uses'] ?? 0) > 0 ? { ticketUses: integer(row, 'ticket_uses') } : {}),
    id: id(row, 'id'), productId: id(row, 'product_id'), variantId: id(row, 'variant_id'),
    productName: text(row, 'product_name'), variantName: text(row, 'variant_name'),
    unitPriceRappen: integer(row, 'unit_price_rappen'), quantity: integer(row, 'quantity'),
    lineTotalRappen: integer(row, 'line_total_rappen'),
  });

  const attemptFrom = (row: Row): CheckoutAttempt => {
    const status = text(row, 'state');
    if (status !== 'prepared' && status !== 'confirmed' && status !== 'completed') throw new Error('Invalid checkout status.');
    const attempt = CheckoutAttemptSchema.parse({
      idempotencyKey: id(row, 'idempotency_key'), cartId: id(row, 'cart_id'), cartRevision: integer(row, 'cart_revision'),
      subtotalRappen: integer(row, 'subtotal_rappen'), roundingAdjustmentRappen: integer(row, 'rounding_adjustment_rappen'),
      amountDueRappen: integer(row, 'amount_due_rappen'), status,
      cashReceivedRappen: row['cash_received_rappen'] === null ? null : integer(row, 'cash_received_rappen'),
      confirmedAt: nullableText(row, 'operator_confirmed_at'), saleId: nullableText(row, 'sale_id'), createdAt: text(row, 'created_at'),
    });
    validateCheckoutAttempt(attempt);
    return attempt;
  };

  const saleFrom = (row: Row): Sale => {
    const saleId = id(row, 'id');
    const payment = sqlite.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').get(saleId);
    if (payment === undefined) throw new Error('Missing persisted sale payment.');
    if (payment['method'] !== 'cash' || payment['operator_confirmed'] !== 1) throw new Error('Invalid persisted cash confirmation.');
    const sale = SaleSchema.parse({
      id: saleId, idempotencyKey: id(row, 'idempotency_key'), cartId: id(row, 'cart_id'),
      cartRevision: integer(row, 'cart_revision'), completedAt: text(row, 'completed_at'),
      subtotalRappen: integer(row, 'subtotal_rappen'), roundingAdjustmentRappen: integer(row, 'rounding_adjustment_rappen'),
      amountDueRappen: integer(row, 'amount_due_rappen'),
      items: sqlite.prepare(hasTickets() ? 'SELECT si.*, COALESCE(sts.use_count,0) ticket_uses FROM sale_items si LEFT JOIN sale_ticket_settings sts ON sts.sale_item_id=si.id AND sts.sale_id=si.sale_id WHERE si.sale_id = ? ORDER BY position' : 'SELECT * FROM sale_items WHERE sale_id = ? ORDER BY position').all(saleId).map(itemFrom),
      payment: {
        method: 'cash', cashReceivedRappen: integer(payment, 'cash_received_rappen'),
        cashAppliedRappen: integer(payment, 'cash_applied_rappen'), changeRappen: integer(payment, 'change_rappen'),
        operatorConfirmed: true, confirmedAt: text(payment, 'operator_confirmed_at'),
      },
    });
    validateSale(sale);
    return sale;
  };

  const store: PosStore = {
    assertNoFinancialCheckout() {
      if (hasFinanceJournal() && sqlite.prepare(`SELECT 1 FROM payment_sessions WHERE state = 'open'
        UNION ALL SELECT 1 FROM refund_attempts WHERE state IN ('reported', 'uncertain') LIMIT 1`).get() !== undefined) {
        throw new DomainError('CHECKOUT_PENDING', 'An open checkout or unresolved refund requires recovery. Resume or reconcile it before changing the cart or using legacy cash checkout.');
      }
    },
    transaction<T>(operation: () => T): T {
      if (sqlite.isTransaction) throw new Error('Nested POS transactions are not supported.');
      let commitStarted = false;
      let committed = false;
      let began = false;
      try {
        sqlite.exec('BEGIN IMMEDIATE');
        began = true;
        const result = operation();
        if (typeof result === 'object' && result !== null && 'then' in result) throw new Error('Async POS transactions are not supported.');
        hooks.beforeCommit?.();
        commitStarted = true;
        sqlite.exec('COMMIT');
        committed = true;
        hooks.afterCommit?.();
        return result;
      } catch (error) {
        let rolledBack = false;
        if (sqlite.isTransaction) {
          try { sqlite.exec('ROLLBACK'); rolledBack = true; } catch { /* uncertain rollback must not be reported as known failure */ }
        }
        if (!commitStarted && error instanceof DomainError && rolledBack) throw error;
        throw new PersistenceError(committed || (began && !rolledBack) ? 'unknown' : 'rolled-back');
      }
    },
    listCatalog: () => sqlite.prepare(`${catalogSelect()} WHERE p.active = 1 AND v.active = 1 ORDER BY p.name, v.name, v.id`).all().map(catalogFrom),
    getVariant(variantId) {
      const row = sqlite.prepare(`${catalogSelect()} WHERE v.id = ?`).get(variantId);
      return row === undefined ? null : catalogFrom(row);
    },
    getDraftCart() {
      const row = sqlite.prepare("SELECT id FROM carts WHERE status = 'draft'").get();
      return row === undefined ? null : store.getCart(id(row, 'id'));
    },
    getCart(cartId) {
      const row = sqlite.prepare("SELECT * FROM carts WHERE id = ? AND status = 'draft'").get(cartId);
      if (row === undefined) return null;
      // Domain helpers populate monetary totals below; no SQL price multiplication.
      const items = sqlite.prepare(hasTickets() ? 'SELECT ci.*, COALESCE(cts.use_count,0) ticket_uses FROM cart_items ci LEFT JOIN cart_ticket_settings cts ON cts.cart_item_id=ci.id WHERE cart_id = ? ORDER BY position' : 'SELECT * FROM cart_items WHERE cart_id = ? ORDER BY position').all(cartId);
      if(hasPromotions())for(const item of items)Object.assign(item,discountMetadata(item));
      return decodeCart(id(row, 'id'), integer(row, 'revision'), items);
    },
    createCart(cart) {
      requireTransaction();
      validateCart(cart);
      sqlite.prepare("INSERT INTO carts (id, revision, status, created_at) VALUES (?, ?, 'draft', ?)")
        .run(cart.id, cart.revision, new Date().toISOString());
      writeItems(cart);
    },
    updateCart(cart, expectedRevision) {
      requireTransaction();
      store.assertNoFinancialCheckout?.();
      validateCart(cart);
      if (!Number.isSafeInteger(expectedRevision) || cart.revision !== expectedRevision + 1) throw new DomainError('CART_CONFLICT', 'Invalid cart revision transition.');
      const result = sqlite.prepare("UPDATE carts SET revision = ? WHERE id = ? AND revision = ? AND status = 'draft'")
        .run(cart.revision, cart.id, expectedRevision);
      if (result.changes !== 1) throw new DomainError('CART_CONFLICT', 'The cart changed. Reload it before retrying.');
      sqlite.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
      writeItems(cart);
      if(hasPromotions()&&!cart.items.some(item=>item.originalUnitPriceRappen!==undefined))sqlite.prepare('DELETE FROM cart_vouchers WHERE cart_id=?').run(cart.id);
    },
    getPendingCheckout(cartId) {
      const row = sqlite.prepare(`SELECT * FROM checkout_attempts WHERE cart_id = ? AND state <> 'completed'${unresolvedLegacyFilter()} ORDER BY CASE state WHEN 'confirmed' THEN 0 ELSE 1 END, created_at DESC, rowid DESC LIMIT 1`).get(cartId);
      return row === undefined ? null : attemptFrom(row);
    },
    getUnresolvedCheckout() {
      const row = sqlite.prepare(`SELECT * FROM checkout_attempts WHERE state = 'confirmed'${unresolvedLegacyFilter()} ORDER BY created_at, idempotency_key LIMIT 1`).get();
      return row === undefined ? null : attemptFrom(row);
    },
    getCheckout(key) {
      const row = sqlite.prepare('SELECT * FROM checkout_attempts WHERE idempotency_key = ?').get(key);
      return row === undefined ? null : attemptFrom(row);
    },
    putCheckout(attempt) {
      requireTransaction();
      CheckoutAttemptSchema.parse(attempt);
      validateCheckoutAttempt(attempt);
      const existing = store.getCheckout(attempt.idempotencyKey);
      if (existing !== null && (existing.cartId !== attempt.cartId || existing.cartRevision !== attempt.cartRevision ||
          existing.subtotalRappen !== attempt.subtotalRappen || existing.amountDueRappen !== attempt.amountDueRappen ||
          existing.roundingAdjustmentRappen !== attempt.roundingAdjustmentRappen || existing.createdAt !== attempt.createdAt)) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'The checkout key is already bound to another request.');
      }
      sqlite.prepare(`INSERT INTO checkout_attempts (idempotency_key, cart_id, cart_revision, state,
        subtotal_rappen, rounding_adjustment_rappen, amount_due_rappen, created_at, cash_received_rappen, operator_confirmed_at, sale_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET state=excluded.state, cash_received_rappen=excluded.cash_received_rappen,
          operator_confirmed_at=excluded.operator_confirmed_at, sale_id=excluded.sale_id`)
        .run(attempt.idempotencyKey, attempt.cartId, attempt.cartRevision, attempt.status,
          attempt.subtotalRappen, attempt.roundingAdjustmentRappen, attempt.amountDueRappen, attempt.createdAt,
          attempt.cashReceivedRappen, attempt.confirmedAt, attempt.saleId);
    },
    getSale(saleId) {
      const row = sqlite.prepare('SELECT * FROM sales WHERE id = ? AND sealed = 1').get(saleId);
      return row === undefined ? null : saleFrom(row);
    },
    getSaleByCheckoutKey(key) {
      const row = sqlite.prepare('SELECT * FROM sales WHERE idempotency_key = ? AND sealed = 1').get(key);
      return row === undefined ? null : saleFrom(row);
    },
    listRecentSales(limit) {
      return sqlite.prepare('SELECT * FROM sales WHERE sealed = 1 ORDER BY completed_at DESC, id DESC LIMIT ?').all(limit).map(saleFrom);
    },
    insertSale(sale) {
      requireTransaction();
      validateSale(sale);
      if (hasFinanceJournal() && sqlite.prepare("SELECT 1 FROM reconciliation_actions WHERE kind = 'legacy' AND reference_id = ?").get(sale.idempotencyKey) !== undefined) {
        throw new DomainError('CONFLICT', 'This legacy confirmation was administratively resolved and cannot be settled again.');
      }
      sqlite.prepare(`INSERT INTO sales (id, idempotency_key, cart_id, cart_revision, completed_at, subtotal_rappen,
        rounding_adjustment_rappen, amount_due_rappen, sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(sale.id, sale.idempotencyKey, sale.cartId, sale.cartRevision, sale.completedAt, sale.subtotalRappen, sale.roundingAdjustmentRappen, sale.amountDueRappen);
      const insertItem = sqlite.prepare(`INSERT INTO sale_items (id, sale_id, position, product_id, variant_id, product_name,
        variant_name, unit_price_rappen, quantity, line_total_rappen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const [position, item] of sale.items.entries()) {
        insertItem.run(item.id, sale.id, position, item.productId, item.variantId, item.productName, item.variantName, item.unitPriceRappen, item.quantity, item.lineTotalRappen);
        if(hasPromotions()&&item.originalUnitPriceRappen!==undefined)sqlite.prepare('INSERT INTO legacy_discounts VALUES(?,?,?,?)').run(sale.id,item.id,item.originalUnitPriceRappen,item.discountLabel!);
      if (hasTickets() && (item.ticketUses ?? 0) > 0) sqlite.prepare('INSERT INTO sale_ticket_settings VALUES(?,?,?)').run(sale.id, item.id, item.ticketUses!);
      }
      sqlite.prepare(`INSERT INTO sale_payments (sale_id, method, cash_received_rappen, cash_applied_rappen,
        change_rappen, operator_confirmed_at, operator_confirmed) VALUES (?, 'cash', ?, ?, ?, ?, 1)`)
        .run(sale.id, sale.payment.cashReceivedRappen, sale.payment.cashAppliedRappen, sale.payment.changeRappen, sale.payment.confirmedAt);
      sqlite.prepare('UPDATE sales SET sealed = 1 WHERE id = ?').run(sale.id);
      if (hasTickets()) issueSaleTickets(connection, sale);
      completeBenefit(connection,sale.cartId,sale.id,sale.completedAt);
    },
    consumeCart(cartId, expectedRevision) {
      requireTransaction();
      const result = sqlite.prepare("UPDATE carts SET status = 'consumed', consumed_at = ? WHERE id = ? AND revision = ? AND status = 'draft'")
        .run(new Date().toISOString(), cartId, expectedRevision);
      if (result.changes !== 1) throw new DomainError('CART_CONFLICT', 'The checkout cart changed.');
    },
  };

  function writeItems(cart: Cart): void {
    const statement = sqlite.prepare(`INSERT INTO cart_items (id, cart_id, position, product_id, variant_id,
      product_name, variant_name, unit_price_rappen, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [position, item] of cart.items.entries()) {
      statement.run(item.id, cart.id, position, item.productId, item.variantId, item.productName, item.variantName, item.unitPriceRappen, item.quantity);
      if(hasPromotions()&&item.originalUnitPriceRappen!==undefined)sqlite.prepare('INSERT INTO cart_discounts VALUES(?,?,?)').run(item.id,item.originalUnitPriceRappen,item.discountLabel!);
      if (hasTickets() && (item.ticketUses ?? 0) > 0) sqlite.prepare('INSERT INTO cart_ticket_settings VALUES(?,?)').run(item.id, item.ticketUses!);
    }
  }
  return store;
}

// Kept outside the adapter so every persisted value is checked before domain use.
function decodeCart(cartId: string, revision: number, rows: Row[]): Cart {
  const items = rows.map((row) => {
    const unitPriceRappen = integer(row, 'unit_price_rappen');
    const quantity = integer(row, 'quantity');
    return {
      ...(row['originalUnitPriceRappen']===undefined?{}:{originalUnitPriceRappen:integer(row,'originalUnitPriceRappen'),discountLabel:text(row,'discountLabel')}),
      ...(Number(row['ticket_uses'] ?? 0) > 0 ? { ticketUses: integer(row, 'ticket_uses') } : {}), id: id(row, 'id'), productId: id(row, 'product_id'), variantId: id(row, 'variant_id'),
      productName: text(row, 'product_name'), variantName: text(row, 'variant_name'),
      unitPriceRappen, quantity, lineTotalRappen: multiplyMoney(unitPriceRappen, quantity),
    };
  });
  const cart = CartSchema.parse({ id: cartId, revision, items, subtotalRappen: items.reduce((sum, item) => addMoney(sum, item.lineTotalRappen), 0) });
  validateCart(cart);
  return cart;
}

