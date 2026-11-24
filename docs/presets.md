# Event presets

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

Open **Presets** from the application menu. All presets are stored locally in the selected Development/Beta/Stable database.

1. Enter a **New event name**, optionally choose a **Preset logo**, and choose **Create empty preset** to start from scratch. The new event contains no products or categories, including when inactive products are shown. Save existing edits before switching, then add products and categories under **Catalog**.
2. To capture the current register catalog instead, choose **Save current catalog as preset**. To reuse a saved event, choose **Copy preset**, enter a new title and confirm. The copy starts from the source's saved configuration and becomes active; subsequent edits and saves do not change the original.
3. Edit products, variants, prices, category relationships and colors in **Catalog**, then return to **Presets** and select **Save changes to active preset**. Editing its event name also changes the title for future receipts.
4. Choose **Load preset** next to a saved event and confirm the summary. Its saved configuration becomes the working catalog. Load the same preset again to discard unsaved catalog edits and restore its saved configuration.
5. **Delete preset** removes the saved event after confirmation. Deleting the active event also clears the working catalog. Deleting another event leaves the active catalog intact.

**Edit preset** beside any saved event changes its title and logo without replacing its saved products or the current working catalog. Editing an inactive event does not activate it. The active-event form can also save its logo along with current catalog changes. A copied preset retains its own copy of the logo; removing or replacing it does not change the source preset. PNG images are embedded in the existing preset JSON and validated at the IPC and persistence boundaries, so no database schema migration is required. Older presets and operation records without the optional logo field remain readable. Metadata edits use the same revision, catalog-version and idempotency/recovery checks as other preset operations.

In **Catalog**, open a product or category to delete it after confirmation. Deleting a category also removes its subcategories and assignments, while its products remain available under All products. These changes affect the working catalog; choose **Save changes to active preset** to update the saved event too. Completed sales and receipts are retained.

Create an active category before adding a product. Product creation requires a category and can include up to 100 priced variants using **Add another variant**; the product, assignments and all variants are saved in one transaction. Existing uncategorized products remain editable. Individual variants can be deleted from the product's variant list after confirmation, leaving at least one variant; delete the product to remove the final one. Deletion requires an idle register and retains historical sale details. Migration 0009 stores variant visibility so saved presets can restore their original variants without exposing deleted variants in the editor. Category action buttons use equal widths and heights for touch input.

Saving or loading requires an empty draft cart and no open payment or unresolved refund. A catalog version and preset revision reject changes made since the screen was loaded; refresh before retrying. Preset operations are transactional and idempotent. An uncertain response retains its request reference; **Check stored result** reads the operation ledger. No preset is automatically loaded or saved on startup.

Migration 0007 adds preset snapshots, active-event selection and an operation ledger. Migration 0008 adds catalog visibility and preset removal markers. Loading restores stable catalog identities and hides records outside the selected event, retaining underlying records needed by historical sales. Deleted products release their SKU/barcode identifiers. Restoring variant metadata preserves final SKU/barcode uniqueness, including swaps. Catalog deletions run transactionally and require an idle register.

The active event name is copied into each newly completed financial sale. Receipt preview and historical receipt review use that immutable title, so switching or renaming events never renames old receipts. Receipts created before event presets retain the Cash Sloth V3 fallback title. The printer button remains the existing disabled placeholder.

Checks:

- `pnpm exec vitest run packages/infrastructure-sqlite/src/presets.integration.test.ts`
- `pnpm exec playwright test tests/electron/presets.spec.ts tests/electron/lifecycle.spec.ts`

The SQLite tests cover restoration, category colors, empty events, independent copies, product/category/preset deletion, refunds after deletion, updates, restart, stale requests, duplicate names, busy carts, rollback, metadata reuse/swaps and historical receipt titles. The app tests cover save/edit/load/sale/history, empty catalogs, copy/edit/delete/restart and recovery after a saved operation's UI acknowledgement fails.
