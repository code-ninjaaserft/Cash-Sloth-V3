# MVP 0.4 completion report — Management & Operations

Date: 2026-11-18 (Europe/Zurich).

Internal operation: **OP Faultir Chrysos**. Public product: **Cash Sloth V3**.
Developer/publisher: **Faultir Softworks**.

## Delivered scope

The desktop now provides explicit Swiss Development demo loading, guided CSV
catalog import, bounded searchable sales history and five linked financial CSV
exports. Existing catalog editing, cart snapshots, payments, refunds, recovery and
reconciliation remain in use rather than being replaced.

The demo manifest contains exactly **44 products, 71 variants, 69 sellable variants
and 18 hierarchical categories**. It covers fictional Swiss food/drinks, Faultir
merchandise, same-price/multi-variant products, multiple assignments, inactive
fixtures and cash-rounding edge prices. It is Development-only and explicitly
loaded after a preview. Repeated loading skips matches and preserves flagged user
edits. The original three startup fixtures remain separate: a fresh seeded
Development store reaches 47 products/74 variants after loading the full manifest.

CSV import supports native file selection, UTF-8/BOM, comma/semicolon detection,
quoted/multiline content, column mapping, normalized product grouping, exact CHF
prices, optional metadata/activity, escaped hierarchical categories, diagnostics
and explicit preview confirmation. Conflicts or invalid rows block the whole CSV
plan. The public sample is [examples/catalog-import.csv](../examples/catalog-import.csv).

History filters cover inclusive Swiss dates, payment method/Mixed, original paid
amount, refund state, sale identifier and historical product/variant information.
Stable sorting, total counts and 25/50/100-record pages keep renderer loading
bounded. Existing receipt/refund views show financial snapshots and read-only
reconciliation context. Filter state survives opening details and returning.

Exports cover all matching sales, not just one page. Native directory selection
creates a new complete bundle of `sales.csv`, `sale_items.csv`, `payments.csv`,
`refunds.csv` and `refund_items.csv`, preserving links without duplicating original
sale totals. Catalog activity badges, variant counts and category breadcrumbs
improve existing management forms without replacing them.

The internal codename is documented in README, architecture, setup/testing, the
new guide/report/ADR and `docs/project-identity.md`. A concise AGENTS rule carries
the convention into future milestone reports. No package, app ID, repository,
database path, public product name or official logo was renamed.

## Main modules and migrations

| Area | Principal additions/changes |
| --- | --- |
| Domain | `catalog-import.ts`, `history-date.ts`: CSV/category/price validation and Swiss calendar boundaries |
| Application | `management-service.ts`, `management-ports.ts`, `swiss-demo-catalog.ts`; `history-service.ts`, `history-ports.ts`, `history-export.ts` |
| Contracts | `management.ts`, `history.ts`, `files.ts` and typed API exports |
| SQLite | `management-store.ts`, `history-store.ts`, migration registration, new migration 0004/0005 and populated migration tests |
| Electron | Explicit main/preload bindings, asynchronous authorized file IPC, `file-operations.ts`, security and real-filesystem tests |
| React | `catalog-import.tsx`, `management-operation.tsx`, import recovery/mapping helpers; `sales-history.tsx`, history filters; PosApp/detail/editor/styles integration |
| End-to-end | `management-operations.spec.ts`; preserved Foundation/First Sale/Catalog/Payments scenarios |
| Documentation | Project identity, operator guide, ADR 0005, this report, sample CSV and updated README/setup/architecture/testing/matrix |

**0004-management-import** adds immutable catalog plans, operation receipts and
stable import provenance. **0005-sales-history-indexes** adds paid-total/date/ID
indexes to legacy and expanded sales. Migrations 0001–0003 remain unchanged.
Populated V3 fixtures retain a legacy cash sale, a modern mixed sale/refund, a
saved draft and catalog snapshots after upgrade; interrupted upgrades roll back.
No real user database was used or reset.

The preserved migration files were checked against the pre-task SHA-256 values:

```text
0001: 522d1998aaa6603938e91a6ef2d9806b7ac2ed9ecb2bf827afebe4f89b77d94b
0002: b31cd8a471cf0c6b9d87ab45844fc5e66d30ba7f8c46c899f63d68e8f49e3b97
0003: 2f8fbf5e73ec5db317fcd7730e7595bbebfca30dba547a22b9586725a4767a08
```

The original logo also retains its recorded SHA-256
`23d5b93e8b02f309817b3b09af98da4d33543573957bcd9c1ade06a8e01b3601`.

## Import and export guarantees

- Source limits: 2 MiB UTF-8, 10,000 data rows, 64 columns, 4000 characters per
  field, at most 64 category levels and 32 paths per row. Category expansion
  stops immediately at 10,000 distinct prefixes/new categories.
- Names normalize predictably; price parsing produces safe integer Rappen without
  floating-point rounding. Repeated product definitions must agree. Duplicate
  variant definitions/SKUs/barcodes and ambiguous existing categories are diagnosed.
- Two source product keys resolving to one existing aggregate are rejected in the
  preview. No alias can produce a misleading multi-extension plan.
- Host-generated immutable plans contain the exact catalog/provenance snapshot.
  Apply revalidates it inside `BEGIN IMMEDIATE`; any intervening edit rejects the
  stale preview. Catalog writes/provenance/receipt commit together or roll back.
- Persist the operation reference before submission. Unknown replies require
  read-only lookup and acknowledgement. Same-key backend replay returns the
  original committed receipt; restart never applies automatically.
- Development demo checks apply at preview/apply/replay boundaries. CSV import can
  coexist with user data; edited records are never silently overwritten.
- History filtering/counting/pagination is SQL-side, with bounded financial model
  materialization. Refund aggregates and payment allocations are kept separate.
- Export reads one consistent snapshot. UTC timestamp columns and integer Rappen
  distinguish original totals, allocations, refunds and historical refund shares.
  Aggregate metadata uses BigInt strings when multiple sales exceed one safe integer.
- Every CSV cell is quoted/escaped. Potential formula text is apostrophe-prefixed
  after normalized-operator and leading whitespace/control/format checks. Numeric
  Rappen remain unchanged. This intentionally transforms dangerous text; it is not
  a universal guarantee after third-party spreadsheet re-saving.
- Export limits: 5000 sales, 100,000 data rows and 25 MiB UTF-8. Oversize selections
  request narrower filters before publishing; empty exports produce five headers-only
  files. Native chooser cancellation is explicit.
- The renderer supplies no arbitrary filesystem path. The host reads a bounded
  selected file or writes fixed filenames exclusively inside a fresh verified
  staging child, then publishes a new directory. Normal write/publication failure
  removes only its staging directory and leaves existing files intact.

See [ADR 0005](adr/0005-catalog-import-and-history-exports.md), including its primary
OWASP reference, and the [operator/format guide](mvp-0.4.md).

## Verification evidence

Project dependency versions, lockfile and engines are unchanged. Local checks
use bundled **Node 24.22.3 / SQLite 3.54.1**, inside the declared engine range,
with **pnpm 11.25.0**. The repository/CI still pins Node 24.22.1; that exact patch
was not available locally and was not substituted in the pin. Electron remains
**45.3.0**, embedded Node **24.22.2**, SQLite **3.53.4**, Chromium **156.0.8078.96**.
Drizzle **1.0.0-rc.5**, React **19.3.1**, TypeScript **6.0.3**, Zod **4.6.7**,
Vite **8.3.8**, Vitest **5.1.0**, Playwright **1.65.0** and ESLint **10.14.0**
were reused without dependency installation or upgrades.

| Check | Observed result |
| --- | --- |
| Preserved MVP 0.3 baseline | 446 tests retained |
| Demo/import/parser/contracts scope after final hardening | 89 tests passed across three files |
| History/export scope | 72 new tests; complete-suite run includes all cases |
| UI helpers/recovery | 67 passed across seven files, including 27 new cases |
| New operations IPC and real-file host tests | 45 passed across two files |
| Strict typecheck | Passed after final hardening |
| ESLint/module boundaries | Passed after final hardening; 11 modules |
| Final complete Vitest suite | **679 tests / 40 files passed** |
| Final UI/main/preload/Node build | Passed |
| Complete run before final category/alias hardening | 677 tests / 40 files, build, ten Electron cases and independent Node-host smoke passed |
| Final complete Electron suite | **10 passed**, approximately 7.6 minutes; no retries |
| Final independent built Node-host smoke | Passed on Windows x64, Node 24.22.3, SQLite 3.54.1 |
| Final `pnpm check` | **Passed end to end**, recorded exit code 0 |
| Documentation/scope checks | Relative links checked; original migration/logo hashes unchanged; no root LICENSE |

Scoped counts overlap; they must not be added to the complete suite. There are
233 new Vitest cases after final hardening, bringing the observed passing total to 679.

The first full attempt hit one transient Windows `EBUSY` read lock in an unchanged
Zod dependency: 670 tests ran successfully, one seven-test suite did not load.
That suite immediately passed in isolation, and the subsequent complete 677-test
run passed without changing dependencies or weakening tests. Independent review
then identified late category expansion limiting and duplicate resolved-product
aliases; both received focused real SQLite regressions before final verification.

The targeted new Electron run passed both workflows (about 1.5 minutes). The
complete run before final hardening also passed all ten scenarios (about 6.9
minutes), preserving the prior eight Foundation/payment/refund/recovery cases.
The two new workflows exercise all eleven requested management scenarios:

1. Explicitly load the Development demo after reviewing 44/71/18 planned counts.
2. Verify categories, inactive records and equal-priced variant selection.
3. Re-run the loader with zero new products and 44 existing matches.
4. Select/import the UTF-8 BOM/semicolon sample with three products/four variants.
5. Reject a changed-price conflict and preserve existing catalog data.
6. Complete a cash sale using an imported variant and reopen it after restart.
7. Complete a mixed rounding sale: subtotal 484, TWINT 200 + cash applied 285,
   actual paid 485, tendered 500 and change 215 Rappen.
8. Refund one historical unit for 242, leaving 243 Rappen refundable.
9. Find that sale with Mixed/Partial/amount/historical-text filters.
10. Export five files and verify exact sale/payment/refund IDs and amounts from disk.
11. Restart and inspect persistent demo/imported catalog and financial details.

The final post-hardening run passed the same ten Electron scenarios and built
Node-host smoke after all 679 Vitest tests, strict compilation, lint/boundary
checks and builds. The full recorded command ended with `PNPM_CHECK_EXIT=0` in
the ignored local evidence log `test-results/mvp-0.4-check.log`. No failed test is
being represented as passed. Reviewed demo/import/history screenshot copies are
under `docs/assets/` and linked in the README.

Native chooser selections are substituted only by the privileged test harness.
The real validated IPC, decoding, database transactions, file writes and export
publication run. These tests do not establish manual OS-dialog keyboard behavior.
An 800-pixel history layout is checked for horizontal overflow. Screenshots are
captured from actual Electron views with finite animations disabled.

The 1000-sale fixture verifies filter/pagination correctness, not a production
latency target. Import failure tests preserve financial snapshots and cover stale
connections, rollback and lost commit acknowledgement/reopening. Financial
regressions continue to exercise rounding, split payments, refund limits,
idempotency, recovery, reconciliation and historical migration compatibility.

## Manual usage, limitations and MVP 0.5

Run `pnpm dev`, load the demo under Development tools, review and confirm, then
repeat to inspect matches. Import the [sample CSV](../examples/catalog-import.csv),
review mappings/conflicts and acknowledge the result. Sell an imported variant,
then use Recent sales for filters, details/refunds and filtered export. Follow the
[manual scenarios](mvp-0.4.md#manual-regression-workflow) for stale previews,
rounding, partial refund and restart checks.

Remaining limits/open checks:

- No arbitrary-large source/export support. Complete catalog snapshot plans use
  memory/storage and are retained; cleanup/version-update policies are deferred.
- History counts/text/refund filters still scan/aggregate growing SQL contents;
  page detail/context reads remain bounded but include per-record queries. No
  production-scale latency or sustained-contention benchmark is established.
- Native dialog interaction, spreadsheet-application re-save behavior, filesystem
  crash/power loss, disk exhaustion, backup/restore and production packaging were
  not manually tested here. Normal simulated write failures are covered.
- Exact Node 24.22.1 re-execution, Linux/ARM64/Pi and GitHub Actions remain open for
  this milestone. The Pi host still exposes only loopback diagnostics.
- Operator assertions are not provider verification. There are no authentication
  roles or remote administration. Existing production-release/Drizzle RC gates remain.
- FSSL remains a draft; nonprofit/event/public-fork policy and legal review remain
  owner decisions. Existing third-party notices/licensing documents are preserved.

MVP 0.4 meets its requested local Windows development acceptance criteria.
**Ready as a development foundation for MVP 0.5**, under its explicit scope.
Production readiness still requires the outstanding
operational/security/platform gates; no future milestone was implemented early.

No commit, push, merge, publication, release, branch-protection change, database
reset or production-data operation was performed. Existing uncommitted work was
retained. Only disposable Development fixtures were used for executable checks.
