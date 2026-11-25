export const orderServiceMigration={version:19,name:'0019-order-service',sql:`
DROP TRIGGER kiosk_paid_financial;DROP TRIGGER kiosk_paid_legacy;DROP TRIGGER kiosk_paid_team;DROP TRIGGER kiosk_purged_financial;DROP TRIGGER kiosk_purged_legacy;
ALTER TABLE kiosk_orders RENAME TO old_kiosk_orders;
CREATE TABLE kiosk_orders(id TEXT PRIMARY KEY NOT NULL,number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 99),cart_id TEXT,status TEXT NOT NULL CHECK(status IN ('waiting','register','paid','ready','collected','cancelled')),data TEXT NOT NULL CHECK(json_valid(data)),source TEXT NOT NULL CHECK(source IN ('kiosk','register','table')),service_label TEXT,prep_status TEXT NOT NULL CHECK(prep_status IN ('received','preparing','ready','collected','cancelled')),revision INTEGER NOT NULL CHECK(revision>=0)) STRICT;
INSERT INTO kiosk_orders SELECT id,((number-1)%99)+1,cart_id,status,json_set(data,'$.number',((number-1)%99)+1),'kiosk',NULL,CASE WHEN status IN ('ready','collected','cancelled') THEN status ELSE 'received' END,0 FROM old_kiosk_orders;
DROP TABLE old_kiosk_orders;
CREATE INDEX order_carts ON kiosk_orders(cart_id);
CREATE TABLE order_counters(event_key TEXT PRIMARY KEY NOT NULL,last_number INTEGER NOT NULL CHECK(last_number BETWEEN 1 AND 99)) STRICT;
INSERT INTO order_counters SELECT coalesce(json_extract(data,'$.eventId'),''),number FROM kiosk_orders k WHERE k.rowid=(SELECT max(k2.rowid) FROM kiosk_orders k2 WHERE coalesce(json_extract(k2.data,'$.eventId'),'')=coalesce(json_extract(k.data,'$.eventId'),''));
CREATE TABLE legacy_order_context(sale_id TEXT PRIMARY KEY NOT NULL REFERENCES sales(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TRIGGER immutable_legacy_order_context BEFORE UPDATE ON legacy_order_context BEGIN SELECT RAISE(ABORT,'Order context is immutable'); END;
UPDATE order_operations SET result=json_set(result,'$.number',((json_extract(result,'$.number')-1)%99)+1) WHERE json_type(result,'$.number')='integer';
CREATE TRIGGER kiosk_paid_financial AFTER INSERT ON financial_sales BEGIN UPDATE kiosk_orders SET status=CASE WHEN prep_status IN ('ready','collected') THEN prep_status ELSE 'paid' END WHERE cart_id=NEW.cart_id AND status='register'; END;
CREATE TRIGGER kiosk_paid_legacy AFTER INSERT ON sales BEGIN UPDATE kiosk_orders SET status=CASE WHEN prep_status IN ('ready','collected') THEN prep_status ELSE 'paid' END WHERE cart_id=NEW.cart_id AND status='register'; END;
CREATE TRIGGER kiosk_paid_team AFTER INSERT ON team_consumption BEGIN UPDATE kiosk_orders SET status=CASE WHEN prep_status IN ('ready','collected') THEN prep_status ELSE 'paid' END WHERE cart_id=json_extract(NEW.data,'$.cart.id') AND status='register'; END;
CREATE TRIGGER kiosk_purged_financial AFTER DELETE ON financial_sales BEGIN UPDATE kiosk_orders SET status='cancelled',prep_status='cancelled',revision=revision+1 WHERE cart_id=OLD.cart_id; END;
CREATE TRIGGER kiosk_purged_legacy AFTER DELETE ON sales BEGIN UPDATE kiosk_orders SET status='cancelled',prep_status='cancelled',revision=revision+1 WHERE cart_id=OLD.cart_id; END;
`} as const;
