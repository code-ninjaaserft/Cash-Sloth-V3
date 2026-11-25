import {orderServiceMigration} from './0019-order-service.js';
const triggers=[...orderServiceMigration.sql.matchAll(/CREATE TRIGGER [a-z_]+[\s\S]*?END;/gu)].map(m=>m[0]).filter(s=>s.startsWith('CREATE TRIGGER kiosk_'));
export const orderOptionsMigration={version:20,name:'0020-order-options',sql:[
 'DROP TRIGGER kiosk_paid_financial;DROP TRIGGER kiosk_paid_legacy;DROP TRIGGER kiosk_paid_team;DROP TRIGGER kiosk_purged_financial;DROP TRIGGER kiosk_purged_legacy;',
 'ALTER TABLE kiosk_orders RENAME TO old_kiosk_orders;',
 "CREATE TABLE kiosk_orders(id TEXT PRIMARY KEY NOT NULL,number INTEGER CHECK(number BETWEEN 1 AND 99),cart_id TEXT,status TEXT NOT NULL CHECK(status IN ('waiting','register','paid','ready','collected','cancelled')),data TEXT NOT NULL CHECK(json_valid(data)),source TEXT NOT NULL CHECK(source IN ('kiosk','register','table')),service_label TEXT,prep_status TEXT NOT NULL CHECK(prep_status IN ('received','preparing','ready','collected','cancelled')),revision INTEGER NOT NULL CHECK(revision>=0),CHECK((source='table' AND number IS NULL) OR (source!='table' AND number IS NOT NULL))) STRICT;",
 "INSERT INTO kiosk_orders SELECT id,CASE WHEN source='table' THEN NULL ELSE number END,cart_id,status,CASE WHEN source='table' THEN json_set(data,'$.number',NULL) ELSE data END,source,service_label,prep_status,revision FROM old_kiosk_orders;",
 'DROP TABLE old_kiosk_orders;CREATE INDEX order_carts ON kiosk_orders(cart_id);',...triggers,
 "CREATE TABLE order_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1),data TEXT NOT NULL CHECK(json_valid(data))) STRICT;",
 `INSERT INTO order_settings VALUES(1,'{"kiosk":true,"tableService":true,"infoDisplay":true,"kitchen":true,"registerOrders":true,"revision":0}');`,
 "CREATE TABLE receipt_codes(sale_id TEXT PRIMARY KEY NOT NULL,code TEXT NOT NULL UNIQUE CHECK(length(code)=16 AND substr(code,1,2) IN ('CC','DC'))) STRICT;",
 "CREATE TRIGGER immutable_receipt_code BEFORE UPDATE ON receipt_codes BEGIN SELECT RAISE(ABORT,'Receipt code is immutable'); END;",
 "CREATE TRIGGER purge_receipt_financial AFTER DELETE ON financial_sales BEGIN DELETE FROM receipt_codes WHERE sale_id=OLD.id; END;",
 "CREATE TRIGGER purge_receipt_legacy AFTER DELETE ON sales BEGIN DELETE FROM receipt_codes WHERE sale_id=OLD.id; END;"
].join('\n')} as const;
