export const teamTicketControlsMigration = { version:15,name:'0015-team-ticket-controls',sql: `
ALTER TABLE product_ticket_settings RENAME TO old_product_ticket_settings;
CREATE TABLE product_ticket_settings(product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE,use_count INTEGER NOT NULL CHECK(use_count BETWEEN 1 AND 1000 OR use_count=2147483647)) STRICT;
INSERT INTO product_ticket_settings SELECT * FROM old_product_ticket_settings; DROP TABLE old_product_ticket_settings;
ALTER TABLE cart_ticket_settings RENAME TO old_cart_ticket_settings;
CREATE TABLE cart_ticket_settings(cart_item_id TEXT PRIMARY KEY NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,use_count INTEGER NOT NULL CHECK(use_count BETWEEN 1 AND 1000 OR use_count=2147483647)) STRICT;
INSERT INTO cart_ticket_settings SELECT * FROM old_cart_ticket_settings; DROP TABLE old_cart_ticket_settings;
ALTER TABLE sale_ticket_settings RENAME TO old_sale_ticket_settings;
CREATE TABLE sale_ticket_settings(sale_id TEXT NOT NULL,sale_item_id TEXT NOT NULL,use_count INTEGER NOT NULL CHECK(use_count BETWEEN 1 AND 1000 OR use_count=2147483647),PRIMARY KEY(sale_id,sale_item_id),FOREIGN KEY(sale_id,sale_item_id) REFERENCES sale_items(sale_id,id) ON DELETE CASCADE) STRICT;
INSERT INTO sale_ticket_settings SELECT * FROM old_sale_ticket_settings; DROP TABLE old_sale_ticket_settings;
CREATE TABLE team_consumption(session_id TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE ticket_controls(code TEXT PRIMARY KEY NOT NULL REFERENCES tickets(code) ON DELETE CASCADE,expires_at TEXT,revoked_at TEXT) STRICT;
ALTER TABLE ticket_redemptions RENAME TO old_ticket_redemptions;
CREATE TABLE ticket_redemptions(operation_id TEXT PRIMARY KEY NOT NULL,code TEXT NOT NULL REFERENCES tickets(code) ON DELETE CASCADE,expected_uses INTEGER NOT NULL CHECK(expected_uses>=0),redeemed_at TEXT NOT NULL,UNIQUE(code,expected_uses)) STRICT;
INSERT INTO ticket_redemptions SELECT * FROM old_ticket_redemptions;
DROP TABLE old_ticket_redemptions;
` } as const;
