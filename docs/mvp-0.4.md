# MVP 0.4 — Management & Operations

Internal operation: **OP Faultir Chrysos**. Public product: **Cash Sloth V3**.
Developer/publisher: **Faultir Softworks**. See [project identity](project-identity.md).

This development milestone adds controlled catalog population, guided CSV import,
bounded sales history and linked financial exports. Existing checkout, refund,
recovery and immutable historical records retain their previous rules.

## Swiss Development Demo Catalog

In Development, open **Development tools → Load Demo Catalog**. Inspect the
preview, explicitly confirm the plan, then acknowledge its committed result.
Loading is rejected by Application in Beta/Stable as well as hidden in their UI.
The new manifest is never loaded automatically.

| Manifest content | Count |
| --- | ---: |
| Products | 44 |
| Variants, including inactive fixtures | 71 |
| Sellable variants with active product and variant | 69 |
| Hierarchical categories | 18 |

The existing three Development startup fixtures remain separate. A fresh database
with those fixtures has 47 products and 74 variants after loading the full demo.
These totals are not a claim about an already customized user's database.

The fictional assortment covers water, soft/hot drinks, snacks, bakery, meals,
desserts and Faultir merchandise, including Sören plush sizes. It includes equal-
price variants, multiple category assignments, a four-level bakery branch,
inactive product/variant fixtures and `[TEST]` prices of CHF 2.42, 3.47 and 8.99.
`TEST-CSV3-…` barcodes are invented identifiers, not genuine retail allocations.

Stable keys and provenance prevent duplicates. Repeated loading skips matching
records. User-edited demo products are preserved and flagged; the loader does not
restore their prices, activity or metadata. Category conflicts are reported rather
than silently moving/reactivating existing data. Preview shows what is new,
matched, preserved or conflicting before any catalog mutation is applied.
There is no reset/wipe action. Existing carts and financial history are not deleted.

## Guided CSV import

Open **Import → Choose CSV file**. The native host chooser reads the selected
file; React receives validated text and a basename, never a general filesystem API.
Inspect format and source rows, map fields, request a preview, correct any errors,
then explicitly confirm the validated plan. Acknowledge the stored result before
preparing another import.

The [practical sample](../examples/catalog-import.csv) contains three products and
four variants, a quoted description/quote, fictional metadata and escaped category
separators. It can be imported directly with the suggested column mapping.

| Field | Required | Rules |
| --- | --- | --- |
| Product import key | Yes | Global stable key for that logical product |
| Product name | Yes | Nonblank normalized name, at most 200 characters |
| Description | No | At most 4000 characters; empty means none |
| Variant import key | Yes | Globally unique variant identity across imports |
| Variant name | Yes | Nonblank normalized name, at most 200 characters |
| Variant price | Yes | Exact CHF decimal text; no default price |
| SKU / barcode | No | Optional; existing global uniqueness rules apply |
| Category paths | No | Hierarchy/multiple-path grammar below |
| Product / variant active | No | Defaults active only if the column is unmapped |

Keys contain 1–64 ASCII identifier characters: start with a letter/digit, followed
by letters/digits or `. _ : -`. They identify records across files and retries,
not just within one filename. An exact existing product/variant identity can be
matched only when its supplied definition agrees. Existing data is never silently
overwritten. New variants may extend an unchanged matching product; their order
is appended after its current variant order.

All rows of one product must repeat the same normalized name, description,
product activity and category-path set. Inconsistent definitions reject the plan.
Identical repeated variant rows are explicitly reported and skipped; a reused
variant key with different data is an error. SKU is normalized/unique even for
inactive records; barcode identity remains case-sensitive. When an active-state
column is mapped, each value must be `true/false`, `1/0` or `active/inactive`
(case-insensitive); blank mapped values are errors.

### Format and prices

- UTF-8, optionally with a UTF-8 BOM. UTF-16, malformed UTF-8 and unsupported
  control characters are rejected. No silent encoding conversion is performed.
- Comma or semicolon delimiters, quoted fields, doubled quotes and CR/LF/CRLF.
  Quoted multiline content is supported; line endings inside it normalize to LF.
- Ambiguous automatic delimiter detection requires an explicit selection. An
  unclosed quote, extra characters after a closing quote or inconsistent widths
  is an error. Headers must be nonempty and distinct.
- Input is bounded to 2 MiB of UTF-8, 10,000 data rows, 64 columns and 4000
  characters per field. Source preview is bounded; validation still reads all rows.
- Prices accept `2.42`, `2,42`, `2.4`, `2` and complete Swiss apostrophe groups
  such as `1'234.50` or `1’234,50`. Comma decimals in comma CSV must be quoted.
- Reject currency symbols, negatives, three decimal places, incomplete grouping,
  mixed ambiguous dot/comma grouping, missing prices and unsafe numeric bounds.
  Parsing uses exact integer Rappen, never floating-point currency rounding.

### Category-path grammar

```text
Drinks > Water
Food > Bakery > Sweet | Desserts
Merchandise > Signs \| Labels > Limited \> Edition
Backslash \\ Collection
```

Unescaped `>` separates levels; unescaped `|` separates assignments. Backslash
escapes only `\`, `>` or `|`. A dangling/unknown escape and an empty level are
errors. The last two examples contain literal separators/backslashes in names.
Normalize Unicode to NFC, trim/collapse name whitespace and deduplicate paths.
Reuse an unambiguous matching active category under the same parent. Ambiguous,
inactive or conflicting existing paths are flagged instead of being guessed or
reactivated. Import paths support at most 64 levels and 32 assignments per row.
Existing general catalog traversal remains independent of those CSV input limits.
Expansion stops immediately at 10,000 distinct category prefixes/new categories;
a short CSV cannot bypass that budget by requesting many deep paths. Two source
product keys resolving to the same existing product are rejected during preview.

### Preview, conflicts and recovery

The preview distinguishes new products/variants/categories, matches, duplicate
rows, conflicts, invalid rows and warnings. Product/issue tables are paginated;
only a bounded category/source preview is rendered. CSV errors/conflicts prevent
the whole plan from applying. Correct the source or mapping and preview again;
there is no silent overwrite/conflict-winning policy.

The host stores an immutable plan with an exact catalog/provenance snapshot.
Apply revalidates that snapshot inside the write transaction. Any intervening
catalog edit requires a fresh preview, including edits made in another connection.
All category/product/variant/provenance/result writes commit together or roll back.

The renderer saves an operation key before applying. After a failed or lost reply,
**Check stored import result** reads that same key. Startup never applies an import
automatically. A stored receipt proves commit; no receipt is not reported as
success. Acknowledge the inspected outcome and obtain a fresh preview before a
new operation. Backend same-key replay returns the original receipt. A plan cannot
be applied a second time under a replacement key.

## Sales history and details

**Sales history** (previously **Recent sales**) opens the history view. Filters include Swiss calendar-day range,
Cash/Card/TWINT/Mixed, original amount actually paid, refund state, full/partial
sale identifier and historical product/variant information. **Apply history
filters** makes edited fields effective; export stays disabled while unapplied
edits exist. **Clear history filters** restores the unfiltered view.

Dates cover complete inclusive days in `Europe/Zurich`; their UTC boundaries
account for daylight-saving changes. Supported date inputs are 1900-01-01 through
9998-12-31. Sorting supports date or original paid total, with deterministic ID
ties. Pages contain 25, 50 or 100 records and show the total matching count.
Filtering/counting/pagination run in SQLite; history is not loaded unbounded into
React. Filters, sorting and page are retained while opening a receipt and returning.

Mixed means more than one distinct recorded payment method; multiple Card
allocations alone remain Card. Refund status uses returned historical quantities,
including zero-value units, rather than treating every zero balance as a full
return. Original sale totals remain distinct from subsequent refunds.

Open a sale to reuse its existing receipt/refund interface: snapshot names/prices,
quantities, subtotal, cash adjustment, paid allocations, tender/change, linked
refunds and remaining refundable units/amount. Read-only reconciliation context
shows relevant counts/status without exposing investigation reasons. Operator
payment confirmations remain assertions, not verified provider settlements.

## Filtered CSV export

Choose **Export filtered history**, then select a parent folder in the native
dialog. Export covers all matching records, not only the visible page. The host
publishes a complete new uniquely named `cash-sloth-export-…` subfolder. It does
not overwrite existing files. Normal write/publication failure cleans its private
staging directory; power-loss/filesystem guarantees are not claimed.

| File | One data row per | Important linkage |
| --- | --- | --- |
| `sales.csv` | Original sale | `sale_id`, checkout identity, original/refunded/refundable totals |
| `sale_items.csv` | Historical sale line | `sale_id`, `sale_item_id`, original product/variant snapshots |
| `payments.csv` | Confirmed payment allocation | `sale_id`, payment attempt, applied/tender/change amounts |
| `refunds.csv` | Completed refund | `sale_id`, refund/attempt/request identities, payout method |
| `refund_items.csv` | Refunded sale line interval | `sale_id`, `refund_id`, original line, unit offset/quantity/rounding share |

All files share one database snapshot. Original sale totals appear once in
`sales.csv`; adding payment/refund row counts must not duplicate them. Timestamp
columns use UTC ISO strings, monetary columns use integer Rappen and explicitly
named signed rounding adjustments. All CSV cells are quoted with doubled quotes
and CRLF row endings. No locale-dependent currency conversion is required.

Potential spreadsheet formulas in text are neutralized with an apostrophe prefix,
including leading formatting/control characters and full-width operators. This
intentionally changes dangerous exported text; identifiers and financial numbers
retain their values. Do not assume that third-party spreadsheet re-saving keeps
this protection: see the [decision and primary reference](adr/0005-catalog-import-and-history-exports.md).

Limits are 5000 matching sales, 100,000 data rows across the five files and 25 MiB
UTF-8. Exceeding a limit requests narrower filters and writes no export bundle.
An empty selection produces the same five files with headers only. Cancellation
returns an explicit cancelled result and writes nothing.

## Manual regression workflow

1. Run `pnpm dev` with the supported Node 24 toolchain in Development. Load the
   demo, inspect counts/categories/variants, acknowledge, then load again: no duplicates.
2. Edit a demo price in Catalog and load again. Verify the edit is preserved and
   flagged. Verify inactive fixtures do not become newly sellable.
3. Import `examples/catalog-import.csv`, inspect BOM/delimiter/mapping, then confirm.
   Reimport unchanged and inspect matches. Change an existing price in the file:
   the conflicting preview must block all catalog writes.
4. Prepare a preview, edit a product through Catalog, then apply the old preview.
   Expect a stale-preview error and create a new preview.
5. Sell an imported variant. For a rounding case, sell two `[TEST]` CHF 2.42 units,
   record TWINT CHF 2.00 and settle cash CHF 2.85: paid CHF 4.85. Refund one unit
   digitally for CHF 2.42 and inspect the CHF 2.43 remaining allocation.
6. Filter history by Mixed/Partial refund/paid CHF 4.85 and the historical name.
   Open details, return to the retained filters, then export. Check one sale row,
   two allocation rows and one refund row with linked IDs.
7. Restart and inspect catalog/history/refunds. After an uncertain import response,
   inspect its original operation key; never assume partial success or apply on startup.

## Persistence and limits

Migration 0004 adds import plans, immutable operation receipts and provenance.
Migration 0005 adds history query indexes. Migrations 0001–0003 and historical
financial records stay unchanged. Development/Beta/Stable paths remain isolated.
No dependencies or external integrations are added. FSSL stays a draft.

Import previews compare complete catalog snapshots, which favors safety over
large-catalog memory/storage efficiency. Plans/receipts remain persisted; cleanup
and source-version update policies are not introduced here. Bounded history has
indexed queries but still performs per-page detail/context reads. Synthetic tests
do not establish production-scale latency, arbitrary power-loss safety, external
provider settlement, authentication, Linux/ARM64 or installer readiness. See the
[completion report](mvp-0.4-report.md) for executed results and open checks.
