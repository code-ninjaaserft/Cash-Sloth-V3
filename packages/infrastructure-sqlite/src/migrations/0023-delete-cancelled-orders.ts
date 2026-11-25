export const deleteCancelledOrdersMigration={version:23,name:'0023-delete-cancelled-orders',sql:`
DROP TRIGGER recycle_rejected_order_number;
CREATE TRIGGER delete_cancelled_order AFTER UPDATE OF status ON kiosk_orders WHEN NEW.status='cancelled' BEGIN
 INSERT OR IGNORE INTO rejected_order_numbers(event_key,number)
 SELECT coalesce(json_extract(OLD.data,'$.eventId'),''),OLD.number WHERE OLD.number IS NOT NULL;
 DELETE FROM kiosk_orders WHERE id=NEW.id;
END;
-- Existing cancelled orders are already free; retain any pending number returns.
DELETE FROM kiosk_orders WHERE status='cancelled';
`} as const;
