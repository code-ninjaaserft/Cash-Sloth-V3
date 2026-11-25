export const purgeSaleOrdersMigration={version:22,name:'0022-purge-sale-orders',sql:`
CREATE TABLE purged_order_operations(id TEXT PRIMARY KEY NOT NULL) STRICT;
CREATE TRIGGER purge_order_recovery BEFORE DELETE ON kiosk_orders BEGIN
 INSERT OR IGNORE INTO purged_order_operations VALUES(OLD.id);
 INSERT OR IGNORE INTO purged_order_operations SELECT id FROM order_operations WHERE id=OLD.id OR json_extract(request,'$.orderId')=OLD.id OR (json_type(result,'$.items')='array' AND json_extract(result,'$.id')=OLD.cart_id);
 DELETE FROM order_operations WHERE id=OLD.id OR json_extract(request,'$.orderId')=OLD.id OR (json_type(result,'$.items')='array' AND json_extract(result,'$.id')=OLD.cart_id);
END;
DROP TRIGGER kiosk_purged_financial;
DROP TRIGGER kiosk_purged_legacy;
CREATE TRIGGER kiosk_purged_financial AFTER DELETE ON financial_sales BEGIN DELETE FROM kiosk_orders WHERE cart_id=OLD.cart_id; END;
CREATE TRIGGER kiosk_purged_legacy AFTER DELETE ON sales BEGIN DELETE FROM kiosk_orders WHERE cart_id=OLD.cart_id; END;
-- Earlier versions retained cancelled order snapshots after purging their sale/cart.
-- Only remove those proven orphans; unbound, unpaid and team orders are retained.
DELETE FROM kiosk_orders WHERE status='cancelled' AND prep_status='cancelled' AND cart_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM carts c WHERE c.id=kiosk_orders.cart_id)
 AND NOT EXISTS(SELECT 1 FROM financial_sales f WHERE f.cart_id=kiosk_orders.cart_id)
 AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.cart_id=kiosk_orders.cart_id)
 AND NOT EXISTS(SELECT 1 FROM team_consumption t WHERE json_extract(t.data,'$.cart.id')=kiosk_orders.cart_id);
`} as const;
