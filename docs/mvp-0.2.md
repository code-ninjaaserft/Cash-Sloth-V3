# MVP 0.2 — Catalog & Cart

## Managed products and variants

Use **Catalog** in the POS navigation to create and edit products. Every creation
includes a first named, priced variant. Product details include description,
active status and a nullable local image reference reserved for future image
support. Images are not loaded from references or the network.

Add variants with their own names, CHF prices, SKU, barcode, active flags and
display positions. Prices are parsed through the existing integer-Rappen Domain
helpers; invalid/missing prices cannot be saved or sold. Variant IDs and product
parents are immutable. Product and variant revisions reject stale saves, with
explicit reload actions in the editor.

SKU values are trimmed, NFC-normalized and uppercased for global uniqueness.
Barcodes are trimmed and uniquely identified case-sensitively. Inactive variants
still reserve their metadata. Empty fields become null; multiple nulls are valid.
Display ordering is position, name and ID, consistent after restart.

Product creation/modification timestamps are recorded. For products migrated from
MVP 0.1, initial timestamps are backfilled from migration 1's recorded application
time because original product creation times were not stored then. Subsequent
edits record their actual host timestamp. Existing names and financial snapshots
are preserved rather than normalized by migration.

## Categories and POS search

Create categories, select a parent, set their order, and activate/deactivate them.
Move a category by editing its parent; direct and indirect cycles are rejected.
Traversal is iterative and has no configured depth cap. Products may be assigned
to multiple categories, with an optional primary category chosen from those
assignments. Parent browsing includes descendant products exactly once.

Category counts represent active products with at least one active variant in
the browsable subtree. An inactive ancestor hides its branch from normal POS
browsing, while active products remain available through global search or All
products. Management includes inactive entries when requested. There is no
destructive delete API; deactivation and safe moves preserve assignments/history.

The POS browser groups variants under their product. One active variant adds
directly; several open **Choose variant**. Search covers product/variant names,
SKU and barcode. A nonempty query is global by default even when a category is
selected. **Restrict search to selected category** explicitly scopes it to that
category and descendants. Scanner hardware workflows are not implemented.

Each product tile shows the total number of units in the saved cart. For a
product with several active variants, **Quick add** appears beneath the tile
for each active variant already in the cart. Its badge counts only that variant.
Press a quick tile to add one more unit at the current catalog price. The main
tile still opens the variant chooser. Removing the last unit clears that
variant's shortcut. Only the displayed counts combine quantities across prices.

## Cart and payment invariants

Cart lines are visually grouped by product but remain separate historical
snapshots. Variant names are visible. Direct quantity edits retain the original
unit price; adding the same variant after its price changes uses the new price
on a separate line. Removing works per line; clearing requires confirmation.
Successful adds produce feedback only after the saved cart response.

Deactivating a product/variant already in the cart **does not change/remove the
saved line or prohibit its snapshot checkout**. New adds are rejected. This
explicit policy preserves the existing cash confirmation/recovery behavior.
Confirmed or finalized payments still prevent unauthorized cart changes.

Money, Swiss rounding, atomic sale completion, idempotent retries, immutable
receipts and recovery pointers remain the existing First Sale mechanisms. No
card/TWINT/split/refund workflow was added.

## Persistence, application and IPC

New migration `0002-catalog-management` adds product details/timestamps/revisions,
variant SKU/barcode/order/revisions, `categories` and `product_categories`, indexes
and identity/relationship safeguards. Migration 1 and its ledger checksum are
preserved. Migration errors roll back; existing sales and carts are not reset.

`createCatalogService()` uses `CatalogStore`; the SQLite adapter reuses the existing
synchronous commit boundary. The new `window.cashSloth.catalog` namespace exposes
ten strict request/response operations: list/read/create/update products,
create/update variants, assign categories and list/create/update categories.
The same window/frame/URL authorization applies. React has no database or generic
filesystem/SQL privileges.

An unknown catalog commit or transport outcome is not shown as a confirmed save.
Read the saved product/category lists before retrying. The editor gates repeated
mutations until **Reload catalog and review** confirms reads and resets the stale
create form. Catalog creates are not promised exactly-once semantics; do not
blindly submit the same create again after losing its response.

## Manual workflow

1. Run `pnpm dev` with the pinned Node 24 toolchain and stay in Development.
2. Open Catalog. Create a top-level category and a child using Parent category.
3. Create a product with its first variant and price. Add a second variant.
4. Select multiple category checkboxes, optionally a primary, then Save categories.
5. Return to POS. Browse the parent and verify the product appears once. Search
   a SKU globally, then try the category restriction option.
6. Choose both variants and edit quantities. Change one current price in Catalog,
   then add it again; the old cart price must remain on its separate line.
7. Complete a cash sale, acknowledge the receipt, restart and retrieve it under
   Recent sales. Catalog edits and historical sale details remain stored.

Cancel discards unsaved form edits. A revision conflict requires an explicit
reload; it never silently wins over another editor. Category deletion is replaced
by deactivation/moving, not by cascading removal.

## UI and performance changes

Catalog editor, product browser and reusable dialogs are separate components.
Controls have explicit accessible labels, focus containment/restoration, clear
save/error/empty states, responsive grids/panels, hover/focus states and subtle
transitions that respect reduced motion. Search uses a short debounce, preserves
the last list while reading and rejects stale responses. Mutation confirmation
is distinct from later read-refresh failure.

Catalog loading uses three aggregate queries, not N+1 product reads. Domain
category counting avoids a full catalog search for every category. No external
UI library, theme editor, Akzuwos code/assets or new external dependency was added.
No large-catalog latency or multi-device performance guarantee is claimed.

## Licensing and remaining limits

The [FSSL-1.0 proposal](licensing/LICENSE-FSSL-1.0.proposed.md) and
[preliminary review](licensing/review.md) are owner-review documents only. There
is no adopted root LICENSE or FSSL package declaration. Independent third-party
terms remain intact. The review records the existing initial README commit and
the limits of what local Git evidence proves.

Linux/ARM64, GitHub CI execution, production approval, hardware failure testing,
administrative cash-conflict resolution and release packaging remain separate
gates. The Node host remains diagnostic-only. Search currently works against the
loaded local catalog rather than a dedicated full-text index/paginated service;
very large catalogs have not been benchmarked. The UI remains English only.
