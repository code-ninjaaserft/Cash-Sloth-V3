export const rejectedOrderNumbersMigration={version:21,name:'0021-rejected-order-numbers',sql:`
CREATE TABLE rejected_order_numbers(event_key TEXT NOT NULL,number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 99),PRIMARY KEY(event_key,number)) STRICT;
CREATE TRIGGER recycle_rejected_order_number AFTER UPDATE OF status ON kiosk_orders
WHEN OLD.status='waiting' AND OLD.prep_status='received' AND NEW.status='cancelled' AND OLD.number IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO rejected_order_numbers(event_key,number) VALUES(coalesce(json_extract(OLD.data,'$.eventId'),''),OLD.number);
END;
`} as const;
