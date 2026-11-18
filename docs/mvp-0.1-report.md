# MVP 0.1 completion report — First Sale

Date: 2026-11-11 (Europe/Zurich)

## Delivered

The Windows Electron desktop now supports the first persistent cash-sale workflow:
Development test catalog, saved draft cart, quantity/remove/clear actions, integer
CHF totals and rounding, validated cash receipt, committed sale details and recent
sale retrieval after restart. The dark-green layout uses the existing official
branding and adapts the cart to a panel on narrower viewports.

This work extends the existing monorepo and preserves its driver, isolation,
runtime validation and environment separation. `AGENTS.md` and original branding
assets were not changed. No future payment methods, refunds, administration,
printing, installers, releases or automatic updates were implemented.

## Relevant changed modules and files

| Area | Principal files |
| --- | --- |
| Domain | `packages/domain/src/models.ts`, `money.ts`, `cart.ts`, `sale.ts` and tests |
| Application | `packages/application/src/ports.ts`, `pos-service.ts` and tests |
| Contracts | `packages/contracts/src/pos.ts`, existing API exports and contract tests |
| Persistence | `packages/infrastructure-sqlite/src/migrations.ts`, `migrations/0001-first-sale.ts`, `seed.ts`, `pos-store.ts`, `pos.integration.test.ts` |
| Electron | Existing `main.ts`, `preload.ts`, `ipc-security.ts`; new `pos-ipc-security.test.ts` |
| Presentation | `packages/ui/src/pos-app.tsx`, `checkout-recovery.ts`, `recovery-marker.ts` and tests; existing POS entry/styles/system-status component |
| Architecture policy | `scripts/check-boundaries.mjs`: UI may share pure Domain helpers; Node/SQLite access remains forbidden |
| Dependencies | Added internal workspace links for SQLite/UI; lockfile updated, no new external dependency or version upgrade |
| Smoke tests | `tests/electron/first-sale.spec.ts`; existing Foundation/security/branding smoke preserved and adapted to System status |
| Documentation | README/screenshots, architecture/setup/testing/matrix, `mvp-0.1.md`, ADR 0002 and this report |

All changes remain uncommitted in the existing workspace. The pre-existing
uncommitted Foundation/branding work was retained; no unrelated files were reset.

## Migration and seed

Version **1**, `0001-first-sale`, creates eight POS tables: products, variants,
carts, cart items, checkout attempts, sales, sale items and cash payments. An
additional migration ledger records version/name/SHA-256/time. Migrations run
transactionally, reject incompatible history and never recreate existing data.
Sealed financial snapshots reject later SQL mutation, including appended items.

Development-only seeding inserts stable default variants for Mineral water
(CHF 3.30), Chocolate (CHF 2.47) and Coffee (CHF 4.50). Repeated startup creates
no duplicates and does not overwrite edited catalog data. Beta/Stable do not seed.

## Important architecture decisions

- Domain owns exact Rappen arithmetic, bounds, cash rounding, cart snapshots and
  sale/attempt invariants. Identifiers use validated semantic string aliases;
  every product has a persistent sellable variant identity.
- Application exposes one `CompleteSaleUseCase` through a synchronous persistence
  port. All related final sale writes and cart consumption share one transaction.
- Explicit cash confirmation is committed separately first so evidence survives
  later rollback or stale-cart rejection. Software never claims to reverse cash.
- Same-key retries return the same sale; changed received cash conflicts. An
  uncertain result remains an error until reconciliation reads the stored key.
- Confirmed unresolved attempts lock competing work. Several stale physical
  confirmations are retained as evidence rather than silently discarded.
- SQLite uses parameterized statements on the existing connection, embedded
  versioned SQL and runtime-validated reads; the selected driver/Drizzle RC remain.
- Renderer recovery keeps only a key/received-amount pointer. Startup reconciles
  read-only, and acknowledgement can clear only the matching receipt's pointer.
- Eleven narrow POS operations retain the trusted-window/main-frame/exact-URL
  check and strict request/response validation. No general IPC/SQL/filesystem API.

See [ADR 0002](adr/0002-first-sale-transactions.md) and the
[implementation guide](mvp-0.1.md).

## Executed verification

All results below were executed locally on Windows x64 using development Node
24.22.1, pnpm 11.25.0, Electron 45.3.0 (embedded Node 24.22.2), SQLite 3.53.4 and
the unchanged Drizzle 1.0.0-rc.5 dependency.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed, all 12 workspace projects |
| `pnpm typecheck` | Passed, strict source/test/config checks |
| `pnpm lint` | Passed, ESLint and 11-module boundary/cycle checks |
| `pnpm test` | **163 passed across 14 files** |
| Core scoped unit verification | 69 passed across six Domain/Application/Contracts files |
| SQLite scoped integration | 22 passed: eight preserved Foundation and 14 MVP cases |
| Renderer recovery scoped tests | 14 passed |
| IPC boundary tests | 49 passed: 16 original and 33 new per-operation checks |
| `pnpm build` | Passed, UI/main/preload/independent Node bundles |
| Actual First Sale Electron smoke | **Passed**, including two real close/relaunch cycles |
| Existing Electron Foundation smoke | **Passed**, security, isolation, branding and SQLite probes retained |
| Built standalone Node-host smoke | Passed, unchanged loopback diagnostic behavior |
| `pnpm check` | **Passed end to end** |

Scoped counts overlap with the complete Vitest count and must not be added to it.
Both Electron tests passed in the final smoke run (about 51 seconds total).
The completed-sale example was CHF 2.47 subtotal, −CHF 0.02 rounding, CHF 2.45
due, CHF 5.00 received/applied CHF 2.45, and CHF 2.55 change. After duplicate-key
retry and a further restart there was still exactly one sale.

The final smoke also verified item removal, cart clearing, direct quantity edits,
persisted unfinished drafts, disabled completion for insufficient cash, matching
receipt acknowledgement, compact cart opening/closing and recent-sale retrieval.
POS, receipt and compact screenshots were visually inspected. Foundation tests
still verify sandbox/context isolation, unavailable renderer Node globals,
unauthorized window rejection, channel paths and actual Electron SQLite behavior.

Real database fault tests exercised rollback of all final-sale writes, durable
cash evidence after that rollback, lost acknowledgement after confirmation and
sale commits, exact-key reconciliation after reopening, and two stale concurrent
checkout keys preserving both confirmations without duplicate sales.

## Known limitations and unverified behavior

- Stale/conflicting cash confirmations deliberately block the register for
  investigation. No administrative resolution/void UI exists in MVP 0.1; use a
  single operator session and never erase evidence or take cash again to recover.
- Browser-storage corruption or removal can disrupt the renderer recovery
  pointer. Confirmed database evidence remains; invalid pointers block checkout.
- Recent sales are limited to 20, with no search, export or analytics.
- UI language remains English; no user accounts, tax breakdown or physical receipt.
- Drizzle is still a release candidate. The original production-release gate is
  unchanged; these development tests do not establish production readiness.
- Linux/ARM64 hardware, the Pi browser transport, GitHub Actions execution,
  installed shortcut/installer checks, real power loss, disk failure, backups and
  restoration were not tested here.
- The desktop smoke requires a usable desktop session. It emitted the previously
  observed harmless inherited `NO_COLOR`/`FORCE_COLOR` warning.

No unresolved local test failure is being described as passing. There were no
commits, pushes, releases, branch-protection changes or production-data operations.
All automated sale/cart data was confined to disposable Development roots.

## Manual first sale and next milestone

Run `pnpm dev` in Development. Add Chocolate, choose Checkout, enter `5.00`,
confirm cash receipt and complete. Inspect the receipt and CHF 2.55 change, select
Start new sale, restart, then reopen the sale under Recent sales. The
[manual walkthrough](mvp-0.1.md#manual-first-sale) includes cart/recovery details.

MVP 0.1 meets the requested Windows development acceptance criteria. Recommended
MVP 0.2 work is the approved catalog/cart expansion (variants, categories and
search), retaining the same snapshot, revision and completion contracts. Define
an auditable operator-resolution path for conflicting cash confirmations before
supporting concurrent operators or real-world production use. No MVP 0.2 work
has been started.
