/** Immutable migration: change future schemas through a new migration, not this SQL. */
export const firstSaleMigration = {
  version: 1,
  name: '0001-first-sale',
  sql: `
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  active INTEGER NOT NULL CHECK(active IN (0, 1))
) STRICT;
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  unit_price_rappen INTEGER NOT NULL CHECK(unit_price_rappen BETWEEN 0 AND 9007199254740991),
  active INTEGER NOT NULL CHECK(active IN (0, 1))
) STRICT;
CREATE INDEX product_variants_product ON product_variants(product_id);
CREATE TABLE carts (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('draft', 'consumed')),
  created_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;
CREATE UNIQUE INDEX carts_one_draft ON carts(status) WHERE status = 'draft';
CREATE TABLE cart_items (
  id TEXT PRIMARY KEY NOT NULL,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position >= 0),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 1 AND 200),
  variant_name TEXT NOT NULL CHECK(length(variant_name) BETWEEN 1 AND 200),
  unit_price_rappen INTEGER NOT NULL CHECK(unit_price_rappen BETWEEN 0 AND 9007199254740991),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
  UNIQUE(cart_id, position)
) STRICT;
CREATE INDEX cart_items_cart ON cart_items(cart_id);
CREATE TABLE checkout_attempts (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  cart_revision INTEGER NOT NULL CHECK(cart_revision BETWEEN 0 AND 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'confirmed', 'completed')),
  subtotal_rappen INTEGER NOT NULL CHECK(subtotal_rappen BETWEEN 0 AND 9007199254740991),
  rounding_adjustment_rappen INTEGER NOT NULL CHECK(rounding_adjustment_rappen BETWEEN -2 AND 2),
  amount_due_rappen INTEGER NOT NULL CHECK(amount_due_rappen BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  cash_received_rappen INTEGER CHECK(cash_received_rappen BETWEEN 0 AND 9007199254740991),
  operator_confirmed_at TEXT,
  sale_id TEXT UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  CHECK(amount_due_rappen = subtotal_rappen + rounding_adjustment_rappen),
  CHECK((state = 'prepared' AND cash_received_rappen IS NULL AND operator_confirmed_at IS NULL AND sale_id IS NULL)
    OR (state = 'confirmed' AND cash_received_rappen >= amount_due_rappen AND operator_confirmed_at IS NOT NULL AND sale_id IS NULL)
    OR (state = 'completed' AND cash_received_rappen >= amount_due_rappen AND operator_confirmed_at IS NOT NULL AND sale_id IS NOT NULL))
) STRICT;
CREATE INDEX checkout_attempts_cart ON checkout_attempts(cart_id, created_at);
CREATE TABLE sales (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE REFERENCES checkout_attempts(idempotency_key) ON DELETE RESTRICT,
  cart_id TEXT NOT NULL UNIQUE REFERENCES carts(id) ON DELETE RESTRICT,
  cart_revision INTEGER NOT NULL CHECK(cart_revision BETWEEN 0 AND 9007199254740991),
  completed_at TEXT NOT NULL,
  subtotal_rappen INTEGER NOT NULL CHECK(subtotal_rappen BETWEEN 0 AND 9007199254740991),
  rounding_adjustment_rappen INTEGER NOT NULL CHECK(rounding_adjustment_rappen BETWEEN -2 AND 2),
  amount_due_rappen INTEGER NOT NULL CHECK(amount_due_rappen BETWEEN 0 AND 9007199254740991),
  sealed INTEGER NOT NULL CHECK(sealed IN (0, 1)),
  CHECK(amount_due_rappen = subtotal_rappen + rounding_adjustment_rappen),
  CHECK(amount_due_rappen % 5 = 0)
) STRICT;
CREATE INDEX sales_completed_at ON sales(completed_at DESC, id DESC);
CREATE TABLE sale_items (
  id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position >= 0),
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 1 AND 200),
  variant_name TEXT NOT NULL CHECK(length(variant_name) BETWEEN 1 AND 200),
  unit_price_rappen INTEGER NOT NULL CHECK(unit_price_rappen BETWEEN 0 AND 9007199254740991),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
  line_total_rappen INTEGER NOT NULL CHECK(line_total_rappen BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(sale_id, id),
  UNIQUE(sale_id, position),
  CHECK(line_total_rappen = unit_price_rappen * quantity)
) STRICT;
CREATE INDEX sale_items_variant ON sale_items(variant_id);
CREATE TABLE sale_payments (
  sale_id TEXT PRIMARY KEY NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK(method = 'cash'),
  cash_received_rappen INTEGER NOT NULL CHECK(cash_received_rappen BETWEEN 0 AND 9007199254740991),
  cash_applied_rappen INTEGER NOT NULL CHECK(cash_applied_rappen BETWEEN 0 AND 9007199254740991),
  change_rappen INTEGER NOT NULL CHECK(change_rappen BETWEEN 0 AND 9007199254740991),
  operator_confirmed_at TEXT NOT NULL,
  operator_confirmed INTEGER NOT NULL CHECK(operator_confirmed = 1),
  CHECK(cash_received_rappen = cash_applied_rappen + change_rappen)
) STRICT;
CREATE TRIGGER sales_immutable_update BEFORE UPDATE ON sales WHEN OLD.sealed = 1
BEGIN SELECT RAISE(ABORT, 'Completed sales are immutable'); END;
CREATE TRIGGER sales_insert_unsealed BEFORE INSERT ON sales WHEN NEW.sealed <> 0
BEGIN SELECT RAISE(ABORT, 'Sales must be assembled transactionally before sealing'); END;
CREATE TRIGGER sales_validate_seal BEFORE UPDATE OF sealed ON sales WHEN OLD.sealed = 0 AND NEW.sealed = 1 AND (
  NOT EXISTS(SELECT 1 FROM sale_items WHERE sale_id = OLD.id)
  OR NOT EXISTS(SELECT 1 FROM sale_payments WHERE sale_id = OLD.id AND cash_applied_rappen = OLD.amount_due_rappen)
  OR OLD.subtotal_rappen <> (SELECT sum(line_total_rappen) FROM sale_items WHERE sale_id = OLD.id)
  OR NOT EXISTS(SELECT 1 FROM checkout_attempts WHERE idempotency_key = OLD.idempotency_key AND state = 'confirmed'
    AND cart_id = OLD.cart_id AND cart_revision = OLD.cart_revision AND amount_due_rappen = OLD.amount_due_rappen
    AND subtotal_rappen = OLD.subtotal_rappen AND rounding_adjustment_rappen = OLD.rounding_adjustment_rappen
    AND cash_received_rappen = (SELECT cash_received_rappen FROM sale_payments WHERE sale_id = OLD.id)
    AND operator_confirmed_at = (SELECT operator_confirmed_at FROM sale_payments WHERE sale_id = OLD.id)))
BEGIN SELECT RAISE(ABORT, 'Sale snapshot is incomplete or inconsistent'); END;
CREATE TRIGGER sales_immutable_delete BEFORE DELETE ON sales WHEN OLD.sealed = 1
BEGIN SELECT RAISE(ABORT, 'Completed sales are immutable'); END;
CREATE TRIGGER sale_items_immutable_insert BEFORE INSERT ON sale_items WHEN (SELECT sealed FROM sales WHERE id = NEW.sale_id) = 1
BEGIN SELECT RAISE(ABORT, 'Completed sale items are immutable'); END;
CREATE TRIGGER sale_items_immutable_update BEFORE UPDATE ON sale_items WHEN (SELECT sealed FROM sales WHERE id = OLD.sale_id) = 1 OR (SELECT sealed FROM sales WHERE id = NEW.sale_id) = 1
BEGIN SELECT RAISE(ABORT, 'Completed sale items are immutable'); END;
CREATE TRIGGER sale_items_immutable_delete BEFORE DELETE ON sale_items WHEN (SELECT sealed FROM sales WHERE id = OLD.sale_id) = 1
BEGIN SELECT RAISE(ABORT, 'Completed sale items are immutable'); END;
CREATE TRIGGER sale_payments_immutable_insert BEFORE INSERT ON sale_payments WHEN (SELECT sealed FROM sales WHERE id = NEW.sale_id) = 1
BEGIN SELECT RAISE(ABORT, 'Completed sale payments are immutable'); END;
CREATE TRIGGER sale_payments_immutable_update BEFORE UPDATE ON sale_payments WHEN (SELECT sealed FROM sales WHERE id = OLD.sale_id) = 1 OR (SELECT sealed FROM sales WHERE id = NEW.sale_id) = 1
BEGIN SELECT RAISE(ABORT, 'Completed sale payments are immutable'); END;
CREATE TRIGGER sale_payments_immutable_delete BEFORE DELETE ON sale_payments WHEN (SELECT sealed FROM sales WHERE id = OLD.sale_id) = 1
BEGIN SELECT RAISE(ABORT, 'Completed sale payments are immutable'); END;
CREATE TRIGGER checkout_confirmation_immutable BEFORE UPDATE ON checkout_attempts
WHEN OLD.state IN ('confirmed', 'completed') AND (
  NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.cart_id IS NOT OLD.cart_id OR NEW.cart_revision IS NOT OLD.cart_revision
  OR NEW.subtotal_rappen IS NOT OLD.subtotal_rappen OR NEW.amount_due_rappen IS NOT OLD.amount_due_rappen
  OR NEW.rounding_adjustment_rappen IS NOT OLD.rounding_adjustment_rappen OR NEW.created_at IS NOT OLD.created_at
  OR NEW.cash_received_rappen IS NOT OLD.cash_received_rappen OR NEW.operator_confirmed_at IS NOT OLD.operator_confirmed_at
  OR (OLD.state = 'completed' AND (NEW.state IS NOT OLD.state OR NEW.sale_id IS NOT OLD.sale_id))
  OR (OLD.state = 'confirmed' AND NEW.state NOT IN ('confirmed', 'completed')))
BEGIN SELECT RAISE(ABORT, 'Cash confirmations are immutable'); END;
CREATE TRIGGER checkout_confirmation_no_delete BEFORE DELETE ON checkout_attempts WHEN OLD.state IN ('confirmed', 'completed')
BEGIN SELECT RAISE(ABORT, 'Cash confirmations are immutable'); END;
`,
} as const;
