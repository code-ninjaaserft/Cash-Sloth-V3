import { firstSaleMigration } from './0001-first-sale.js';
import { catalogManagementMigration } from './0002-catalog-management.js';
import { paymentsRefundsMigration } from './0003-payments-refunds.js';
import { managementImportMigration } from './0004-management-import.js';
import { salesHistoryIndexesMigration } from './0005-sales-history-indexes.js';
import { categoryColorsMigration } from './0006-category-colors.js';
import { eventPresetsMigration } from './0007-event-presets.js';
import { catalogLifecycleMigration } from './0008-catalog-lifecycle.js';
import { variantLifecycleMigration } from './0009-variant-lifecycle.js';
import { historyVisibilityMigration } from './0010-history-visibility.js';
import { checkoutTipsMigration } from './0011-checkout-tips.js';
import { salePurgeMigration } from './0012-explicit-sale-purge.js';
import { historyBulkRemovalMigration } from './0013-history-bulk-removal.js';
import { ticketsMigration } from './0014-tickets.js';
import { teamTicketControlsMigration } from './0015-team-ticket-controls.js';
const previous=[firstSaleMigration,catalogManagementMigration,paymentsRefundsMigration,managementImportMigration,salesHistoryIndexesMigration,categoryColorsMigration,eventPresetsMigration,catalogLifecycleMigration,variantLifecycleMigration,historyVisibilityMigration,checkoutTipsMigration,salePurgeMigration,historyBulkRemovalMigration,ticketsMigration,teamTicketControlsMigration];
const triggers=new Map<string,string>();
for(const migration of previous) for(const match of migration.sql.matchAll(/DROP TRIGGER ([a-z_]+);|CREATE TRIGGER ([a-z_]+)[\s\S]*?END;/gu)){if(match[1])triggers.delete(match[1]);else if(match[2])triggers.set(match[2],match[0]);}
const paymentTable=paymentsRefundsMigration.sql.match(/CREATE TABLE payment_attempts \([\s\S]*?\) STRICT;/u)?.[0];
if(!paymentTable)throw new Error('Missing payment schema');
export const promotionsMigration={version:16,name:'0016-promotions',sql:[
 ...[...triggers.keys()].map(name=>'DROP TRIGGER '+name+';'),
 paymentTable.replace('CREATE TABLE payment_attempts (','CREATE TABLE extended_payment_attempts (').replaceAll("'card', 'twint'","'card', 'twint', 'voucher'"),
 'INSERT INTO extended_payment_attempts SELECT * FROM payment_attempts; DROP TABLE payment_attempts; ALTER TABLE extended_payment_attempts RENAME TO payment_attempts;',
 "CREATE INDEX payment_attempts_session ON payment_attempts(session_id); CREATE UNIQUE INDEX payment_attempts_one_pending ON payment_attempts(session_id) WHERE state IN ('prepared','reported','uncertain'); CREATE INDEX payment_attempts_unresolved ON payment_attempts(state) WHERE state IN ('reported','uncertain');",
 ...[...triggers.values()].map(sql=>sql.replaceAll("'card', 'twint'","'card', 'twint', 'voucher'")),
 "CREATE TABLE promotion_operations(id TEXT PRIMARY KEY NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result))) STRICT;\nCREATE TABLE discount_templates(id TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL CHECK(json_valid(data))) STRICT;\nCREATE TABLE cart_discounts(item_id TEXT PRIMARY KEY NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,original_price INTEGER NOT NULL CHECK(original_price>=0),label TEXT NOT NULL) STRICT;\nCREATE TABLE legacy_discounts(sale_id TEXT NOT NULL,item_id TEXT NOT NULL,original_price INTEGER NOT NULL CHECK(original_price>=0),label TEXT NOT NULL,PRIMARY KEY(sale_id,item_id),FOREIGN KEY(sale_id,item_id) REFERENCES sale_items(sale_id,id) ON DELETE CASCADE) STRICT;\nCREATE TABLE vouchers(code TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL CHECK(json_valid(data))) STRICT;\nCREATE TABLE cart_vouchers(cart_id TEXT PRIMARY KEY NOT NULL REFERENCES carts(id) ON DELETE CASCADE,code TEXT NOT NULL UNIQUE REFERENCES vouchers(code),reserved_at TEXT NOT NULL) STRICT;\nCREATE TABLE benefit_redemptions(sale_id TEXT PRIMARY KEY NOT NULL,code TEXT NOT NULL REFERENCES vouchers(code),at TEXT NOT NULL) STRICT;\nCREATE TABLE wallet_ledger(id TEXT PRIMARY KEY NOT NULL,code TEXT NOT NULL REFERENCES vouchers(code),session_id TEXT NOT NULL,amount_rappen INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('pay','cancel','refund')),at TEXT NOT NULL) STRICT;\nCREATE INDEX wallet_ledger_code ON wallet_ledger(code);\nCREATE TRIGGER restore_benefits_financial AFTER DELETE ON financial_sales BEGIN DELETE FROM benefit_redemptions WHERE sale_id=OLD.id; DELETE FROM wallet_ledger WHERE session_id=OLD.session_id; DELETE FROM promotion_operations WHERE json_extract(request,'$.cartId')=OLD.cart_id OR json_extract(request,'$.sessionId')=OLD.session_id; END;\nCREATE TRIGGER restore_benefits_legacy AFTER DELETE ON sales BEGIN DELETE FROM benefit_redemptions WHERE sale_id=OLD.id; DELETE FROM promotion_operations WHERE json_extract(request,'$.cartId')=OLD.cart_id; END;"
].join('\n')} as const;
