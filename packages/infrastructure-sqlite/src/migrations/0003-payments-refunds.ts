/** Additive journal: historical cash tables and their immutable snapshots stay intact. */
export const paymentsRefundsMigration = {
  version: 3,
  name: '0003-payments-refunds',
  sql: `
CREATE TABLE payment_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('open', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.cart.id') IS cart_id
    AND json_extract(data, '$.status') IS state AND json_extract(data, '$.createdAt') IS created_at)
) STRICT;
CREATE UNIQUE INDEX payment_sessions_one_open ON payment_sessions(state) WHERE state = 'open';
CREATE INDEX payment_sessions_cart ON payment_sessions(cart_id);
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES payment_sessions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('prepared', 'reported', 'confirmed', 'uncertain', 'failed', 'excluded')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.idempotencyKey') IS idempotency_key
    AND json_extract(data, '$.sessionId') IS session_id AND json_extract(data, '$.status') IS state
    AND json_type(data, '$.intendedRappen') IS 'integer' AND json_extract(data, '$.intendedRappen') BETWEEN 0 AND 9007199254740991
    AND json_type(data, '$.appliedRappen') IS 'integer' AND json_extract(data, '$.appliedRappen') BETWEEN 0 AND 9007199254740991
    AND json_type(data, '$.changeRappen') IS 'integer' AND json_extract(data, '$.changeRappen') BETWEEN 0 AND 9007199254740991
    AND json_type(data, '$.method') IS 'text' AND json_extract(data, '$.method') IN ('cash', 'card', 'twint')
    AND json_type(data, '$.roundingAdjustmentRappen') IS 'integer' AND json_extract(data, '$.roundingAdjustmentRappen') BETWEEN -2 AND 2
    AND (json_type(data, '$.reportedAt') IS 'null' OR json_type(data, '$.reportedAt') IS 'text')
    AND (json_type(data, '$.confirmedAt') IS 'null' OR json_type(data, '$.confirmedAt') IS 'text')
    AND (state <> 'prepared' OR json_type(data, '$.reportedAt') IS 'null' AND json_type(data, '$.confirmedAt') IS 'null')
    AND (state NOT IN ('reported', 'confirmed', 'uncertain') OR json_type(data, '$.reportedAt') IS 'text')
    AND (state <> 'confirmed' OR json_type(data, '$.confirmedAt') IS 'text')
    AND ((json_extract(data, '$.method') = 'cash' AND json_type(data, '$.cashTenderedRappen') IS 'integer'
      AND json_extract(data, '$.cashTenderedRappen') IS json_extract(data, '$.intendedRappen')
      AND json_extract(data, '$.appliedRappen') % 5 = 0 AND json_extract(data, '$.cashTenderedRappen') % 5 = 0
      AND json_extract(data, '$.appliedRappen') + json_extract(data, '$.changeRappen') = json_extract(data, '$.cashTenderedRappen'))
    OR (json_extract(data, '$.method') IN ('card', 'twint') AND json_type(data, '$.cashTenderedRappen') IS 'null'
      AND json_extract(data, '$.changeRappen') = 0 AND json_extract(data, '$.roundingAdjustmentRappen') = 0
      AND json_extract(data, '$.appliedRappen') IS json_extract(data, '$.intendedRappen') AND json_extract(data, '$.intendedRappen') > 0)))
) STRICT;
CREATE INDEX payment_attempts_session ON payment_attempts(session_id);
CREATE UNIQUE INDEX payment_attempts_one_pending ON payment_attempts(session_id) WHERE state IN ('prepared', 'reported', 'uncertain');
CREATE INDEX payment_attempts_unresolved ON payment_attempts(state) WHERE state IN ('reported', 'uncertain');
CREATE TABLE financial_sales (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES payment_sessions(id) ON DELETE RESTRICT,
  cart_id TEXT NOT NULL UNIQUE REFERENCES carts(id) ON DELETE RESTRICT,
  completed_at TEXT NOT NULL,
  actual_paid_rappen INTEGER NOT NULL CHECK(actual_paid_rappen BETWEEN 0 AND 9007199254740991),
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.checkoutSessionId') IS session_id
    AND json_extract(data, '$.cartId') IS cart_id AND json_extract(data, '$.completedAt') IS completed_at
    AND json_extract(data, '$.actualPaidRappen') IS actual_paid_rappen AND json_extract(data, '$.source') IS 'payments'
    AND json_type(data, '$.subtotalRappen') IS 'integer' AND json_extract(data, '$.subtotalRappen') BETWEEN 0 AND 9007199254740991
    AND json_type(data, '$.amountDueRappen') IS 'integer' AND json_extract(data, '$.amountDueRappen') IS actual_paid_rappen
    AND json_type(data, '$.roundingAdjustmentRappen') IS 'integer' AND json_extract(data, '$.roundingAdjustmentRappen') BETWEEN -2 AND 2
    AND json_extract(data, '$.subtotalRappen') + json_extract(data, '$.roundingAdjustmentRappen') = actual_paid_rappen
    AND json_type(data, '$.items') IS 'array' AND json_array_length(data, '$.items') BETWEEN 1 AND 1000
    AND json_type(data, '$.payments') IS 'array' AND json_array_length(data, '$.payments') BETWEEN 1 AND 1000)
) STRICT;
CREATE INDEX financial_sales_completed ON financial_sales(completed_at DESC, id DESC);
CREATE TABLE refund_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared', 'reported', 'completed', 'uncertain', 'failed', 'excluded')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.idempotencyKey') IS idempotency_key
    AND json_extract(data, '$.saleId') IS sale_id AND json_extract(data, '$.status') IS state
    AND json_type(data, '$.amountRappen') IS 'integer' AND json_extract(data, '$.amountRappen') BETWEEN 0 AND 9007199254740991
    AND json_type(data, '$.items') IS 'array' AND json_array_length(data, '$.items') BETWEEN 1 AND 1000)
) STRICT;
CREATE INDEX refund_attempts_sale ON refund_attempts(sale_id);
CREATE UNIQUE INDEX refund_attempts_one_pending ON refund_attempts(sale_id) WHERE state IN ('prepared', 'reported', 'uncertain');
CREATE TABLE refunds (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES refund_attempts(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL,
  amount_rappen INTEGER NOT NULL CHECK(amount_rappen BETWEEN 0 AND 9007199254740991),
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.idempotencyKey') IS idempotency_key
    AND json_extract(data, '$.attemptId') IS attempt_id AND json_extract(data, '$.saleId') IS sale_id
    AND json_extract(data, '$.amountRappen') IS amount_rappen
    AND json_type(data, '$.items') IS 'array' AND json_array_length(data, '$.items') BETWEEN 1 AND 1000)
) STRICT;
CREATE INDEX refunds_sale ON refunds(sale_id);
CREATE TABLE financial_events (
  id TEXT PRIMARY KEY NOT NULL,
  reference_id TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.referenceId') IS reference_id)
) STRICT;
CREATE INDEX financial_events_reference ON financial_events(reference_id);
CREATE TABLE reconciliation_actions (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('payment', 'refund', 'legacy')),
  reference_id TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK(resolution IN ('confirm-recorded', 'exclude-no-transfer', 'exclude-compensated')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  CHECK(json_type(data) IS 'object' AND json_extract(data, '$.id') IS id AND json_extract(data, '$.idempotencyKey') IS idempotency_key
    AND json_extract(data, '$.kind') IS kind AND json_extract(data, '$.referenceId') IS reference_id
    AND json_extract(data, '$.resolution') IS resolution)
) STRICT;
CREATE INDEX reconciliation_actions_reference ON reconciliation_actions(kind, reference_id);

CREATE TRIGGER financial_sales_unique_cart BEFORE INSERT ON financial_sales
WHEN EXISTS(SELECT 1 FROM sales WHERE cart_id = NEW.cart_id OR id = NEW.id OR idempotency_key = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'This cart or settlement identity already has a historical sale'); END;
CREATE TRIGGER legacy_sales_unique_cart BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM financial_sales WHERE cart_id = NEW.cart_id OR id = NEW.id OR session_id = NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'This cart or settlement identity already has a payment-journal sale'); END;
CREATE TRIGGER legacy_sales_resolved_confirmation BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM reconciliation_actions WHERE kind = 'legacy' AND reference_id = NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'Administratively resolved confirmations cannot be settled again'); END;
CREATE TRIGGER financial_sales_validate BEFORE INSERT ON financial_sales
WHEN NOT EXISTS(SELECT 1 FROM payment_sessions s JOIN carts c ON c.id = s.cart_id
    WHERE s.id = NEW.session_id AND s.state = 'open' AND s.cart_id = NEW.cart_id AND c.status = 'draft'
      AND c.revision = json_extract(s.data, '$.cart.revision')
      AND json_extract(s.data, '$.cart.revision') IS json_extract(NEW.data, '$.cartRevision')
      AND json_extract(s.data, '$.cart.subtotalRappen') IS json_extract(NEW.data, '$.subtotalRappen')
      AND json_extract(s.data, '$.cart.items') IS json_extract(NEW.data, '$.items'))
  OR EXISTS(SELECT 1 FROM payment_attempts WHERE session_id = NEW.session_id AND state IN ('prepared', 'reported', 'uncertain'))
  OR json_array_length(NEW.data, '$.payments') <> (SELECT count(*) FROM payment_attempts WHERE session_id = NEW.session_id AND state = 'confirmed')
  OR EXISTS(SELECT 1 FROM json_each(NEW.data, '$.payments') p WHERE NOT EXISTS(
    SELECT 1 FROM payment_attempts a WHERE a.session_id = NEW.session_id AND a.state = 'confirmed'
      AND a.id IS json_extract(p.value, '$.attemptId')
      AND json_extract(a.data, '$.method') IS json_extract(p.value, '$.method')
      AND json_extract(a.data, '$.appliedRappen') IS json_extract(p.value, '$.amountRappen')
      AND json_extract(a.data, '$.cashTenderedRappen') IS json_extract(p.value, '$.cashTenderedRappen')
      AND json_extract(a.data, '$.changeRappen') IS json_extract(p.value, '$.changeRappen')
      AND json_extract(a.data, '$.confirmedAt') IS json_extract(p.value, '$.confirmedAt')
      AND json_type(a.data, '$.confirmedAt') IS 'text' AND json_type(a.data, '$.reportedAt') IS 'text'
      AND json_extract(p.value, '$.operatorConfirmed') IS 1))
  OR (SELECT count(DISTINCT json_extract(value, '$.attemptId')) FROM json_each(NEW.data, '$.payments')) <> json_array_length(NEW.data, '$.payments')
  OR coalesce((SELECT sum(json_extract(value, '$.amountRappen')) FROM json_each(NEW.data, '$.payments')), -1) <> NEW.actual_paid_rappen
  OR EXISTS(SELECT 1 FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') = 'cash' AND key <> json_array_length(NEW.data, '$.payments') - 1)
  OR (SELECT count(*) FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') = 'cash') > 1
  OR coalesce((SELECT sum(json_extract(value, '$.amountRappen')) FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') <> 'cash'), 0) > json_extract(NEW.data, '$.subtotalRappen')
  OR (NOT EXISTS(SELECT 1 FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') = 'cash') AND json_extract(NEW.data, '$.roundingAdjustmentRappen') <> 0)
BEGIN SELECT RAISE(ABORT, 'Sale requires a matching open snapshot and durable, balanced payment confirmations'); END;
CREATE TRIGGER financial_sales_cash_rounding BEFORE INSERT ON financial_sales
WHEN EXISTS(SELECT 1 FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') = 'cash')
  AND NEW.actual_paid_rappen IS NOT (
    coalesce((SELECT sum(json_extract(value, '$.amountRappen')) FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') <> 'cash'), 0)
    + ((json_extract(NEW.data, '$.subtotalRappen')
      - coalesce((SELECT sum(json_extract(value, '$.amountRappen')) FROM json_each(NEW.data, '$.payments') WHERE json_extract(value, '$.method') <> 'cash'), 0) + 2) / 5) * 5)
BEGIN SELECT RAISE(ABORT, 'Only the remaining cash portion may be rounded'); END;
CREATE TRIGGER payment_sessions_insert_open BEFORE INSERT ON payment_sessions WHEN NEW.state <> 'open'
BEGIN SELECT RAISE(ABORT, 'New checkout sessions must be open'); END;
CREATE TRIGGER payment_attempts_insert_prepared BEFORE INSERT ON payment_attempts
WHEN NEW.state <> 'prepared' OR NOT EXISTS(SELECT 1 FROM payment_sessions WHERE id = NEW.session_id AND state = 'open')
BEGIN SELECT RAISE(ABORT, 'Payment attempts must be prepared for an open checkout'); END;
CREATE TRIGGER refund_attempts_insert_prepared BEFORE INSERT ON refund_attempts
WHEN NEW.state <> 'prepared' OR NOT EXISTS(SELECT 1 FROM sales WHERE id = NEW.sale_id AND sealed = 1)
  AND NOT EXISTS(SELECT 1 FROM financial_sales WHERE id = NEW.sale_id)
BEGIN SELECT RAISE(ABORT, 'Refund attempts must be prepared for an original sale'); END;
CREATE TRIGGER payment_sessions_validate_close BEFORE UPDATE ON payment_sessions
WHEN (NEW.state = 'completed' AND NOT EXISTS(SELECT 1 FROM financial_sales WHERE session_id = OLD.id AND id IS json_extract(NEW.data, '$.saleId')))
  OR (NEW.state = 'cancelled' AND EXISTS(SELECT 1 FROM payment_attempts WHERE session_id = OLD.id AND state NOT IN ('failed', 'excluded')))
BEGIN SELECT RAISE(ABORT, 'Checkout cannot close with inconsistent settlement evidence'); END;
CREATE TRIGGER payment_attempts_transitions BEFORE UPDATE OF state ON payment_attempts
WHEN NEW.state <> OLD.state AND NOT (
  OLD.state = 'prepared' AND NEW.state IN ('reported', 'uncertain', 'failed', 'excluded')
  OR OLD.state = 'reported' AND NEW.state IN ('confirmed', 'uncertain', 'excluded')
  OR OLD.state = 'uncertain' AND NEW.state IN ('confirmed', 'excluded')
  OR OLD.state = 'confirmed' AND NEW.state = 'excluded' AND json_extract(OLD.data, '$.method') IN ('card', 'twint')
    AND EXISTS(SELECT 1 FROM payment_sessions WHERE id = OLD.session_id AND state = 'open')
    AND NOT EXISTS(SELECT 1 FROM financial_sales WHERE session_id = OLD.session_id)
    AND NOT EXISTS(SELECT 1 FROM payment_attempts c WHERE c.session_id = OLD.session_id AND c.state NOT IN ('failed', 'excluded') AND json_extract(c.data, '$.method') = 'cash')
    AND EXISTS(SELECT 1 FROM reconciliation_actions a WHERE a.kind = 'payment' AND a.reference_id = OLD.id AND a.resolution = 'exclude-compensated'
      AND json_extract(a.data, '$.reason') IS json_extract(NEW.data, '$.note')))
BEGIN SELECT RAISE(ABORT, 'Invalid payment status transition'); END;
CREATE TRIGGER refund_attempts_transitions BEFORE UPDATE OF state ON refund_attempts
WHEN NEW.state <> OLD.state AND NOT (
  OLD.state = 'prepared' AND NEW.state IN ('reported', 'uncertain', 'failed', 'excluded')
  OR OLD.state = 'reported' AND NEW.state IN ('completed', 'uncertain', 'excluded')
  OR OLD.state = 'uncertain' AND NEW.state IN ('completed', 'excluded'))
BEGIN SELECT RAISE(ABORT, 'Invalid refund status transition'); END;
CREATE TRIGGER refund_attempts_validate_completion BEFORE UPDATE ON refund_attempts
WHEN NEW.state = 'completed' AND NOT EXISTS(SELECT 1 FROM refunds WHERE attempt_id = OLD.id
  AND id IS json_extract(NEW.data, '$.refundId') AND sale_id = OLD.sale_id)
BEGIN SELECT RAISE(ABORT, 'Refund completion requires the immutable refund record'); END;
CREATE TRIGGER payment_sessions_snapshot_immutable BEFORE UPDATE ON payment_sessions
WHEN NEW.id IS NOT OLD.id OR NEW.cart_id IS NOT OLD.cart_id OR NEW.created_at IS NOT OLD.created_at
  OR json_remove(NEW.data, '$.status', '$.saleId') IS NOT json_remove(OLD.data, '$.status', '$.saleId')
  OR (OLD.state <> 'open' AND NEW.data IS NOT OLD.data)
BEGIN SELECT RAISE(ABORT, 'Checkout snapshots and closed sessions are immutable'); END;
CREATE TRIGGER payment_sessions_no_delete BEFORE DELETE ON payment_sessions
BEGIN SELECT RAISE(ABORT, 'Checkout history cannot be deleted'); END;
CREATE TRIGGER payment_attempts_evidence_immutable BEFORE UPDATE ON payment_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.session_id IS NOT OLD.session_id
  OR json_remove(NEW.data, '$.status', '$.reportedAt', '$.confirmedAt', '$.note') IS NOT json_remove(OLD.data, '$.status', '$.reportedAt', '$.confirmedAt', '$.note')
  OR (json_extract(OLD.data, '$.reportedAt') IS NOT NULL AND json_extract(NEW.data, '$.reportedAt') IS NOT json_extract(OLD.data, '$.reportedAt'))
  OR (json_extract(OLD.data, '$.confirmedAt') IS NOT NULL AND json_extract(NEW.data, '$.confirmedAt') IS NOT json_extract(OLD.data, '$.confirmedAt'))
  OR (OLD.state IN ('failed', 'excluded') AND NEW.data IS NOT OLD.data)
  OR (OLD.state = 'confirmed' AND NEW.data IS NOT OLD.data AND NOT (
    NEW.state = 'excluded' AND json_extract(OLD.data, '$.method') IN ('card', 'twint')
    AND EXISTS(SELECT 1 FROM payment_sessions WHERE id = OLD.session_id AND state = 'open')
    AND NOT EXISTS(SELECT 1 FROM financial_sales WHERE session_id = OLD.session_id)
    AND NOT EXISTS(SELECT 1 FROM payment_attempts c WHERE c.session_id = OLD.session_id AND c.state NOT IN ('failed', 'excluded') AND json_extract(c.data, '$.method') = 'cash')
    AND EXISTS(SELECT 1 FROM reconciliation_actions a WHERE a.kind = 'payment' AND a.reference_id = OLD.id AND a.resolution = 'exclude-compensated'
      AND json_extract(a.data, '$.reason') IS json_extract(NEW.data, '$.note'))))
BEGIN SELECT RAISE(ABORT, 'Payment request and confirmation evidence are immutable'); END;
CREATE TRIGGER payment_attempts_no_delete BEFORE DELETE ON payment_attempts
BEGIN SELECT RAISE(ABORT, 'Payment evidence cannot be deleted'); END;
CREATE TRIGGER refund_attempts_evidence_immutable BEFORE UPDATE ON refund_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.sale_id IS NOT OLD.sale_id
  OR json_remove(NEW.data, '$.status', '$.reportedAt', '$.refundId', '$.note') IS NOT json_remove(OLD.data, '$.status', '$.reportedAt', '$.refundId', '$.note')
  OR (json_extract(OLD.data, '$.reportedAt') IS NOT NULL AND json_extract(NEW.data, '$.reportedAt') IS NOT json_extract(OLD.data, '$.reportedAt'))
  OR (OLD.state IN ('completed', 'failed', 'excluded') AND NEW.data IS NOT OLD.data)
BEGIN SELECT RAISE(ABORT, 'Refund request and confirmation evidence are immutable'); END;
CREATE TRIGGER refund_attempts_no_delete BEFORE DELETE ON refund_attempts
BEGIN SELECT RAISE(ABORT, 'Refund evidence cannot be deleted'); END;
CREATE TRIGGER refunds_limit BEFORE INSERT ON refunds
WHEN NOT EXISTS(SELECT 1 FROM sales WHERE id = NEW.sale_id AND sealed = 1)
  AND NOT EXISTS(SELECT 1 FROM financial_sales WHERE id = NEW.sale_id)
  OR NEW.amount_rappen + coalesce((SELECT sum(amount_rappen) FROM refunds WHERE sale_id = NEW.sale_id), 0)
    > coalesce((SELECT actual_paid_rappen FROM financial_sales WHERE id = NEW.sale_id),
      (SELECT amount_due_rappen FROM sales WHERE id = NEW.sale_id AND sealed = 1), -1)
BEGIN SELECT RAISE(ABORT, 'Refund exceeds the recorded original payment'); END;
CREATE TRIGGER refunds_attempt_matches BEFORE INSERT ON refunds
WHEN NOT EXISTS(SELECT 1 FROM refund_attempts WHERE id = NEW.attempt_id AND sale_id = NEW.sale_id AND state IN ('reported', 'uncertain')
  AND idempotency_key = NEW.idempotency_key AND json_extract(data, '$.amountRappen') = NEW.amount_rappen
  AND json_extract(data, '$.items') = json_extract(NEW.data, '$.items') AND json_extract(data, '$.method') = json_extract(NEW.data, '$.method')
  AND (state = 'reported' AND json_extract(data, '$.reportedAt') = json_extract(NEW.data, '$.confirmedAt')
    OR state = 'uncertain' AND EXISTS(SELECT 1 FROM reconciliation_actions a WHERE a.kind = 'refund'
      AND a.reference_id = NEW.attempt_id AND a.resolution = 'confirm-recorded'
      AND json_extract(a.data, '$.at') IS json_extract(NEW.data, '$.confirmedAt'))))
BEGIN SELECT RAISE(ABORT, 'Refund must match durable operator evidence'); END;
CREATE TRIGGER refunds_quantities BEFORE INSERT ON refunds
WHEN EXISTS(SELECT 1 FROM json_each(NEW.data, '$.items') i WHERE
  json_type(i.value, '$.quantity') IS NOT 'integer' OR json_extract(i.value, '$.quantity') NOT BETWEEN 1 AND 9999
  OR json_type(i.value, '$.unitOffset') IS NOT 'integer' OR json_extract(i.value, '$.unitOffset') NOT BETWEEN 0 AND 9999
  OR json_type(i.value, '$.baseRappen') IS NOT 'integer' OR json_extract(i.value, '$.baseRappen') NOT BETWEEN 0 AND 9007199254740991
  OR json_type(i.value, '$.amountRappen') IS NOT 'integer' OR json_extract(i.value, '$.amountRappen') NOT BETWEEN 0 AND 9007199254740991
  OR json_type(i.value, '$.roundingAllocationRappen') IS NOT 'integer' OR json_extract(i.value, '$.roundingAllocationRappen') NOT BETWEEN -2 AND 2
  OR json_extract(i.value, '$.baseRappen') IS NOT json_extract(i.value, '$.unitPriceRappen') * json_extract(i.value, '$.quantity')
  OR json_extract(i.value, '$.amountRappen') IS NOT json_extract(i.value, '$.baseRappen') + json_extract(i.value, '$.roundingAllocationRappen')
  OR NOT EXISTS(
    SELECT 1 FROM (
      SELECT id, quantity, unit_price_rappen FROM sale_items WHERE sale_id = NEW.sale_id
      UNION ALL SELECT json_extract(value, '$.id'), json_extract(value, '$.quantity'), json_extract(value, '$.unitPriceRappen')
        FROM financial_sales f, json_each(f.data, '$.items') WHERE f.id = NEW.sale_id
    ) original WHERE original.id IS json_extract(i.value, '$.saleItemId')
      AND original.unit_price_rappen IS json_extract(i.value, '$.unitPriceRappen')
      AND json_extract(i.value, '$.unitOffset') + json_extract(i.value, '$.quantity') <= original.quantity)
  OR json_extract(i.value, '$.unitOffset') <> coalesce((
    SELECT sum(json_extract(prior.value, '$.quantity')) FROM refunds r, json_each(r.data, '$.items') prior
      WHERE r.sale_id = NEW.sale_id AND json_extract(prior.value, '$.saleItemId') IS json_extract(i.value, '$.saleItemId')), 0))
  OR (SELECT count(DISTINCT json_extract(value, '$.saleItemId')) FROM json_each(NEW.data, '$.items')) <> json_array_length(NEW.data, '$.items')
  OR (SELECT sum(json_extract(value, '$.amountRappen')) FROM json_each(NEW.data, '$.items')) IS NOT NEW.amount_rappen
BEGIN SELECT RAISE(ABORT, 'Refund units must be distinct, historically priced and not previously refunded'); END;
CREATE TRIGGER financial_sales_no_update BEFORE UPDATE ON financial_sales BEGIN SELECT RAISE(ABORT, 'Completed sales are immutable'); END;
CREATE TRIGGER financial_sales_no_delete BEFORE DELETE ON financial_sales BEGIN SELECT RAISE(ABORT, 'Completed sales are immutable'); END;
CREATE TRIGGER refunds_no_update BEFORE UPDATE ON refunds BEGIN SELECT RAISE(ABORT, 'Refunds are immutable'); END;
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds BEGIN SELECT RAISE(ABORT, 'Refunds are immutable'); END;
CREATE TRIGGER financial_events_no_update BEFORE UPDATE ON financial_events BEGIN SELECT RAISE(ABORT, 'Financial events are immutable'); END;
CREATE TRIGGER financial_events_no_delete BEFORE DELETE ON financial_events BEGIN SELECT RAISE(ABORT, 'Financial events are immutable'); END;
CREATE TRIGGER reconciliation_actions_no_update BEFORE UPDATE ON reconciliation_actions BEGIN SELECT RAISE(ABORT, 'Reconciliation actions are immutable'); END;
CREATE TRIGGER reconciliation_actions_no_delete BEFORE DELETE ON reconciliation_actions BEGIN SELECT RAISE(ABORT, 'Reconciliation actions are immutable'); END;
`,
} as const;
