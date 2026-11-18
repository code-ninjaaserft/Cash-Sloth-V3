# MVP 0.2 completion report — Catalog & Cart

Date: 2026-11-12 (Europe/Zurich).

## Delivered scope

Products and priced variants can be created, edited and deactivated through a
dedicated responsive Catalog editor. Managed details include description, future
local image reference, timestamps, ordering, SKU/barcode and revisions. Categories
support deep hierarchy, safe moves/deactivation, multiple assignments and an
optional primary category.

The POS groups products, offers fast variant selection, descendant category counts
and global name/variant/SKU/barcode search with an explicit category restriction.
Cart lines are grouped visually without merging historical snapshots; clear-cart
confirmation, variant-aware controls, committed-add feedback and responsive panels
improve use. Existing cash checkout, receipts, idempotency, recovery, branding,
environment separation and security boundaries remain intact.

## Changed modules and migrations

| Area | Principal changes |
| --- | --- |
| Domain | `catalog.ts` and tests: aggregate invariants, normalization, iterative tree traversal, counts/search/order |
| Application | `catalog-ports.ts`, `catalog-service.ts` and tests: ten validated transactional use cases |
| Contracts | `catalog.ts` and tests; new typed `CashSlothApi.catalog` namespace |
| SQLite | `catalog-store.ts`, `migrations/0002-catalog-management.ts`, migration registration, compatible seed and integration tests |
| Electron | Main/preload register ten narrow methods using existing sender/request/response checks; catalog IPC tests |
| React | CatalogEditor, ProductBrowser, Modal, category/cart helpers, uncertain-save guard and tests; existing POS/styles updated |
| End-to-end | `tests/electron/catalog-cart.spec.ts`; preserved First Sale/Foundation tests adapted to clear confirmation/new namespace |
| Licensing | Full proposed text, review and dependency inventory under `docs/licensing/`; read-only audit script |
| Documentation | README/screenshots, setup/architecture/testing/matrix, MVP guide, ADR 0003 and this report |

Migration **0002-catalog-management** adds product metadata/timestamps/revision,
variant metadata/order/revision, categories and product-category relations with
uniqueness, foreign-key and cycle/identity safeguards. It is additive and atomic.
Migration **0001-first-sale is byte-identical**; its file SHA-256 remains:

```text
522d1998aaa6603938e91a6ef2d9806b7ac2ed9ecb2bf827afebe4f89b77d94b
```

Existing MVP 0.1 sales/drafts were migrated in isolated integration fixtures and
retrieved without rewriting names or financial snapshots. Legacy product times
come from migration 1's recorded application time, not invented creation history.
Development seed remains idempotent and edit-preserving; Beta/Stable do not seed.
No dependency/version/driver replacement was made. No original branding asset or
AGENTS.md change was needed. Existing uncommitted work was retained.

## Decisions and data guarantees

- Product aggregate revision checks protect details, variant operations and
  category assignments. Variant edits additionally check the variant revision.
- At least one variant is retained; price is mandatory safe integer Rappen.
  SKU is NFC/trim/uppercase-unique across all variants; barcode identity is trimmed
  and case-sensitive. Null metadata is allowed without manufacturing placeholders.
- Categories are moved/reordered/deactivated, not hard-deleted through the API.
  Inactive ancestor branches disappear from POS category browsing; active products
  remain globally searchable. Counts deduplicate products across assignments.
- Nonempty searches are global by default; category restriction is explicit.
- Previously saved cart snapshots remain valid after catalog deactivation. New
  adds require current active product/variant, and price changes yield separate
  lines. Existing sale/receipt/payment records remain immutable.
- Unknown catalog create/save replies require explicit read-only review before
  further mutations. Local validation remains correctable; saved writes are not
  misreported as failed merely because a later read refresh failed. Catalog
  creates are not promised financial-style exactly-once semantics.
- Ten additional IPC methods remain guarded by trusted window/frame/exact URL and
  strict request/response validation. No general SQL/filesystem/Node bridge exists.

See [ADR 0003](adr/0003-catalog-management.md) and [manual guide](mvp-0.2.md).

## Verification

The checked project runtime is **Node 24.22.1**, pnpm 11.25.0, Windows x64.
Electron remains 45.3.0 with embedded Node 24.22.2 and SQLite 3.53.4. The globally
installed Node 26.13.1 initially took precedence in PATH; early checks there were
supplementary only. Final validation uses the already bundled pinned Node 24
through a process-local PATH, without changing system settings or project engines.

Executed results from the completed check output:

| Check | Result |
| --- | --- |
| Frozen lockfile install | Passed, 12 workspace projects, no dependency changes |
| Typecheck | Passed, strict source/test/config checks |
| Lint and boundaries | Passed, ESLint and 11-module architecture checks |
| Complete Vitest suite | **257 tests passed across 21 files** |
| New catalog core tests | 36 passed, including a 12,000-level iterative hierarchy |
| SQLite integration suite | 36 passed: 22 preserved and 14 catalog cases, including a 1,200-level SQL hierarchy |
| UI helper/recovery tests | 28 passed across three files |
| IPC boundary tests | 79 passed: 49 preserved and 30 catalog checks |
| Build | UI, main/preload and independent Node host built successfully |
| Catalog Electron workflow | Passed, including product/variant/category creation, price changes, sale and restart |
| First Sale/Foundation Electron workflows | Both passed, preserving prior cash/recovery/isolation behavior |
| Complete Electron smoke suite | **3 passed**, approximately 74 seconds |
| Built Node-host smoke | Passed after the Electron suite |
| `pnpm check` | **Passed end to end** on Node 24.22.1 |

Scoped counts overlap with the full suite; do not add them to the total. The
catalog workflow creates categories/product/variants, assigns both categories
with a primary, tests global versus restricted search, selects both variants,
changes a quantity and current price, and confirms that CHF 3.33 historical and
CHF 4.44 current-price lines remain separate. Cash subtotal/due CHF 16.65 with
CHF 20.00 received produces CHF 3.35 change. Restart retrieves the same sale and
unchanged line snapshots alongside persisted current catalog data.

Intermediate editor-select label mismatches were corrected using explicit
accessible labels. Final review corrected mixed-case/Unicode variant tie-order
differences after reload and prevented blind repeat creates after lost replies.
These changes have focused tests. Screenshots are captured from the real desktop
and inspected; animation suppression avoids saving a transient fade-in frame.
An additional targeted catalog workflow passed after adding Escape/focus-return
and 800-pixel editor no-horizontal-overflow assertions; strict typecheck and lint
were also repeated for that final test refinement.

## UI and performance changes

- Three batched product/variant/assignment queries avoid per-product N+1 reads.
- Counts walk validated ancestors with per-product deduplication rather than
  re-searching the full catalog separately for every category.
- Search uses a short debounce and stale-response guards. Background reads keep
  the previous list usable and do not globally disable the POS.
- Separate browser/editor/modal components, clear state feedback, consistent
  controls, focus handling and reduced-motion styles improve interaction.
- No new external UI library or copied Akzuwos assets/code were introduced.

These are implementation improvements, not a benchmarked large-catalog latency
or hardware-performance guarantee.

## Licensing proposal and owner decisions

The complete [proposed FSSL-1.0 text](licensing/LICENSE-FSSL-1.0.proposed.md) is
prepared for owner review, with [findings/questions](licensing/review.md) and an
[installed dependency inventory](licensing/third-party-inventory.json). It names
the intended holder Armon Flurin Elvedi, operating as Faultir Softworks. It remains
a draft: no root LICENSE, FSSL package declaration, legal validation or publication.

Local evidence shows one initial README commit and local origin refs, not a
license notice in that inspected history. It does not prove that nothing was ever
public or shared elsewhere. Dependency MIT terms do not license the original app.
The inventory covers 150 installed package versions plus Electron runtime notice
hashes. Seven packages lack top-level notices in the installed snapshot; exact
notice/distribution obligations remain a release-stage review. No vendor notice
was removed or reinterpreted as FSSL.

The intended restrictions make this Source Available, not OSI-approved Open Source.
Key owner/legal decisions are private-use scope for clubs/events, public-hosting
fork rights, written permission procedures, brand provenance and incidental build
rights, contribution/ownership issues, and enforceability/jurisdiction/warranty
wording. Approval of a precise final text is required before adoption.

## Limits, manual checks and next milestone

- No hard-delete editor action, loaded product images, scanner integration, CSV,
  additional payment method, refund, analytics, theme editor or localization was added.
- Large-catalog UI/memory benchmarks, cross-platform/ARM64 execution, real hardware
  failure and GitHub workflow execution are unverified. The Node host remains diagnostic.
- Existing unresolved cash-conflict investigation and production-release gates
  remain; there is still no administrative resolution UI for conflicting cash evidence.
- Catalog creates need manual saved-list review after an uncertain result; no
  general exactly-once catalog mutation protocol is claimed.
- Third-party redistribution clearance and FSSL adoption remain open. No release,
  commit, push, branch-protection change or production-data operation was performed.

For manual testing run `pnpm dev` on the pinned Node 24 toolchain, open Catalog,
create categories/product/two priced variants, assign categories, search in POS,
add variants and edit quantities. Change a current price and add again to inspect
separate snapshots. Complete a cash sale, restart and retrieve it. Follow the
[full walkthrough](mvp-0.2.md#manual-workflow) for policies and recovery behavior.

Recommended MVP 0.3 is the planned payment workflow expansion, reusing existing
Domain money and CompleteSaleUseCase. Specify external confirmations, reconciliation
and operator resolution before expanding payment methods. No MVP 0.3 feature was
implemented here.
