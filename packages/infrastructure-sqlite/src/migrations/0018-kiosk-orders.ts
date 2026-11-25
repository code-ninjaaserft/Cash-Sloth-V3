export const kioskOrdersMigration={version:18,name:'0018-kiosk-orders',sql:`
CREATE TABLE kiosk_orders(id TEXT PRIMARY KEY NOT NULL,number INTEGER NOT NULL UNIQUE,cart_id TEXT UNIQUE,status TEXT NOT NULL CHECK(status IN ('waiting','register','paid','ready','collected','cancelled')),data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE order_operations(id TEXT PRIMARY KEY NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result))) STRICT;
CREATE TRIGGER kiosk_paid_financial AFTER INSERT ON financial_sales BEGIN UPDATE kiosk_orders SET status='paid' WHERE cart_id=NEW.cart_id AND status='register'; END;
CREATE TRIGGER kiosk_paid_legacy AFTER INSERT ON sales BEGIN UPDATE kiosk_orders SET status='paid' WHERE cart_id=NEW.cart_id AND status='register'; END;
CREATE TRIGGER kiosk_paid_team AFTER INSERT ON team_consumption BEGIN UPDATE kiosk_orders SET status='paid' WHERE cart_id=json_extract(NEW.data,'$.cart.id') AND status='register'; END;
CREATE TRIGGER kiosk_purged_financial AFTER DELETE ON financial_sales BEGIN UPDATE kiosk_orders SET status='cancelled' WHERE cart_id=OLD.cart_id; END;
CREATE TRIGGER kiosk_purged_legacy AFTER DELETE ON sales BEGIN UPDATE kiosk_orders SET status='cancelled' WHERE cart_id=OLD.cart_id; END;
`} as const;
