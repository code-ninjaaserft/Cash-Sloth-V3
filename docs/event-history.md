# Event and device sales history

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

Open **Sales history** and choose **Event history** or **Device history**. Event history initially selects the active preset. Its event selector also includes past events with recorded sales, even after their preset is deleted. Device history covers all events and unassigned sales. Both views retain the existing date, payment, amount, refund and product filters.

New payment sales snapshot both the active preset's stable ID and its title when checkout completes. Renaming an event preserves its sales grouping and each original receipt title. Copies and later events with reused names have independent IDs. Older sales that contain only a title cannot be assigned reliably; they remain under **Without event / older sales** and in device history. No historical financial payload is rewritten.

**Delete sale** asks for confirmation and a reason, then permanently removes an incorrect sale, its receipt, cart snapshot, related payments, tips, refunds and reconciliation records. It disappears from event/device totals, recent sales and every export, including when older hidden entries are included. This records the operator's correction that the transaction did not occur; it does not transfer money. Actual repayments still use the refund workflow. Pending payments or refunds must be resolved first. Previously hidden sales can also be permanently removed.

Migration 0012 adds a transaction-only scope for deleting exact related records. Deletion guards still reject ordinary deletes outside that scope. Legacy circular sale/checkout foreign keys are checked at commit; a failure rolls the whole operation back. Only the deleted sale ID, deletion time and reason remain in the retry marker, without amounts, products or receipt content, so a repeated request cannot affect another sale. No old hidden sale is automatically purged during upgrade.

History exports apply the same event and visibility filters as the screen. `sales.csv` additionally contains `event_id`, `event_title`, `removed_from_history_at` and `removal_reason`. The remaining four linked CSV files and integer-Rappen accounting remain unchanged.

**Clear event history** in the event view removes every sale for the selected event (or the selected unassigned/older-sales group). **Clear entire device history** in the device view removes all sales across every event, including older hidden entries. Both ignore pagination and search filters. A confirmation shows the target and unfiltered count, requires a reason and explicit acknowledgement, and preserves products, categories and presets.

Bulk deletion reuses the single-sale purge inside one transaction. A pending transfer/refund or storage failure rolls the whole batch back. The confirmed sale-ID snapshot must still match when deletion starts. Migration 0013 stores an operation reference, canonical request and deleted count; replay returns that result without deleting sales created later. No receipt payload or financial amount is stored in this operation ledger.

Validation covers event renames/copies/removal, unassigned historical records, retained receipt/refund integrity, idempotent removal, pending refunds, rollback, filtering, exports and app restart. The app workflow is exercised in `tests/electron/event-history.spec.ts`.
