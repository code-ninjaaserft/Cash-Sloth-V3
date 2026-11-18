# ADR 0003: Managed catalog, category hierarchy and snapshot policy

Date: 2026-11-12

Status: Accepted for MVP 0.2 development.

## Decision

Extend the existing model with managed product aggregates, priced variants,
categories and assignments. Keep the First Sale catalog projection and POS API
compatible. Use the existing persistence transaction boundary and driver; introduce
no external dependencies, network image loading or new payment operation.

Products have immutable IDs, nullable description/image reference, active state,
timestamps and an aggregate revision. Variants have immutable IDs/parent product,
required safe integer price, nullable SKU/barcode, ordering and a revision.
Every product retains at least one variant; an inactive variant is retained rather
than deleted. Updating a variant checks both its revision and its parent product
revision, incrementing the aggregate revision atomically. Assignment changes also
use the product revision. Identity and original creation time cannot be rewritten.

SKU values are NFC-normalized, trimmed and uppercased; canonical values are unique
across all variants, including inactive records. Barcodes are trimmed, otherwise
case-sensitive, and independently unique. Null metadata is allowed multiple times;
blank metadata is not a valid identifier. Search is more permissive than identity:
it folds case/accents for product, variant, SKU and barcode lookup.

## Categories and search

Categories use parent references, active state, display position and revisions.
Domain traversal is iterative, with no artificial depth limit; SQL additionally
rejects cycles. Ordering uses position, English name comparison and ID. Variant
reads and mutation responses use the same Domain comparator rather than mixing
SQLite's binary collation with JavaScript display ordering.

Products may have any distinct set of category relationships and at most one
optional primary category, which must belong to that set. The primary marker
does not narrow additional relationships. Parent views include descendant matches
and count each eligible product once regardless of multiple assignments/variants.

An inactive category or ancestor hides that branch from normal browsing. It does
not deactivate products or delete assignments. Active products with active variants
remain globally searchable/sellable. Management can include inactive records.
There is no hard-delete operation: move, reorder or deactivate categories instead.
SQL foreign keys restrict deleting a category with children or assignments.

With an empty search, a selected category scopes browsing. A nonempty query is
global by default even if a category is selected. The explicit restriction option
applies the selected subtree to the search. Names, variant names, SKU and barcode
are searched; scanner-specific workflows are absent.

## Historical cart and checkout policy

Adding always reads the current active variant and snapshots its price/names.
Increasing an existing line keeps that line's snapshot. Adding after a price
change creates a separate line when snapshots differ. Grouped rendering does not
merge stored lines. Completed sales remain immutable and do not join live catalog
details for their receipt contents.

**Honour saved snapshots:** deactivating a product/variant does not remove or
reprice an existing cart line and does not invalidate that line at checkout.
Only new adds are prohibited. This is the explicit existing First Sale policy,
now documented and tested. Do not add a late catalog availability check after
physical cash has been confirmed; payment recovery and same-key retries stay intact.

## Additive persistence and UI behavior

Migration `0002-catalog-management` extends the first schema and adds category
relations/indexes/triggers. `0001-first-sale` remains byte-identical. Existing
catalog timestamps use migration 1's `applied_at` as a migration provenance value,
not a claim of true historical creation time. Seed remains Development-only and
does not overwrite edits. New products/variants, assignments and revision updates
are written atomically.

The catalog adapter reads products, variants and assignments in three batched
queries rather than a query loop per product. Category counts use one catalog
pass and per-product ancestor deduplication. Search input is debounced and stale
responses are ignored. Background reads do not globally disable the POS.

Catalog creates are not financial checkout attempts and are not promised to be
idempotent. An uncertain save or lost response requires explicit read-only review
before repeating a create; no create is retried automatically. Revision conflicts
require reloading saved data, not silently overwriting another editor.

## Validation and limits

Tests cover a 12,000-level Domain hierarchy and 1,200-level SQLite hierarchy,
cycles, counts, metadata uniqueness, two-connection conflicts, partial migration
rollback, real MVP 0.1 data upgrade, preserved cart/sale snapshots and the unchanged
payment recovery rules. Very large-catalog UI/memory benchmarks and cross-platform
performance are not established by these tests. See [MVP 0.2](../mvp-0.2.md).
