export const ticketsMigration = {
 version: 14, name: '0014-tickets', sql: `
 CREATE TABLE product_ticket_settings (product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE, use_count INTEGER NOT NULL CHECK(use_count BETWEEN 1 AND 1000)) STRICT;
 CREATE TABLE cart_ticket_settings (cart_item_id TEXT PRIMARY KEY NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE, use_count INTEGER NOT NULL CHECK(use_count BETWEEN 1 AND 1000)) STRICT;
 CREATE TABLE sale_ticket_settings (sale_id TEXT NOT NULL, sale_item_id TEXT NOT NULL, use_count INTEGER NOT NULL CHECK(use_count BETWEEN 1 AND 1000), PRIMARY KEY(sale_id,sale_item_id), FOREIGN KEY(sale_id,sale_item_id) REFERENCES sale_items(sale_id,id) ON DELETE CASCADE) STRICT;
 CREATE TABLE tickets (code TEXT PRIMARY KEY NOT NULL, sale_id TEXT NOT NULL, sale_item_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 9999), data TEXT NOT NULL CHECK(json_valid(data)) CHECK(json_extract(data,'$.code') IS code AND json_extract(data,'$.saleId') IS sale_id AND json_extract(data,'$.saleItemId') IS sale_item_id AND json_extract(data,'$.ordinal') IS ordinal), UNIQUE(sale_id,sale_item_id,ordinal)) STRICT;
 CREATE INDEX tickets_sale ON tickets(sale_id);
 CREATE TABLE ticket_redemptions (operation_id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL REFERENCES tickets(code) ON DELETE CASCADE, expected_uses INTEGER NOT NULL CHECK(expected_uses BETWEEN 0 AND 999), redeemed_at TEXT NOT NULL, UNIQUE(code,expected_uses)) STRICT;
 CREATE TRIGGER purge_financial_sale_tickets AFTER DELETE ON financial_sales BEGIN DELETE FROM tickets WHERE sale_id=OLD.id; END;
 CREATE TRIGGER purge_legacy_sale_tickets AFTER DELETE ON sales BEGIN DELETE FROM tickets WHERE sale_id=OLD.id; END;
 `,
} as const;
