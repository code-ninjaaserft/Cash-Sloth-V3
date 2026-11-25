export const combinedVouchersMigration={version:17,name:'0017-combined-vouchers',sql:`
DROP TRIGGER restore_benefits_financial;
DROP TRIGGER restore_benefits_legacy;
ALTER TABLE cart_vouchers RENAME TO old_cart_vouchers;
CREATE TABLE cart_vouchers(cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,code TEXT NOT NULL UNIQUE REFERENCES vouchers(code),reserved_at TEXT NOT NULL,PRIMARY KEY(cart_id,code)) STRICT;
INSERT INTO cart_vouchers SELECT * FROM old_cart_vouchers;
DROP TABLE old_cart_vouchers;
ALTER TABLE benefit_redemptions RENAME TO old_benefit_redemptions;
CREATE TABLE benefit_redemptions(sale_id TEXT NOT NULL,code TEXT NOT NULL REFERENCES vouchers(code),at TEXT NOT NULL,PRIMARY KEY(sale_id,code)) STRICT;
INSERT INTO benefit_redemptions SELECT * FROM old_benefit_redemptions;
DROP TABLE old_benefit_redemptions;
CREATE TRIGGER restore_benefits_financial AFTER DELETE ON financial_sales BEGIN DELETE FROM benefit_redemptions WHERE sale_id=OLD.id; DELETE FROM wallet_ledger WHERE session_id=OLD.session_id; DELETE FROM promotion_operations WHERE json_extract(request,'$.cartId')=OLD.cart_id OR json_extract(request,'$.sessionId')=OLD.session_id; END;
CREATE TRIGGER restore_benefits_legacy AFTER DELETE ON sales BEGIN DELETE FROM benefit_redemptions WHERE sale_id=OLD.id; DELETE FROM promotion_operations WHERE json_extract(request,'$.cartId')=OLD.cart_id; END;
`} as const;
