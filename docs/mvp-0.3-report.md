# MVP 0.3 completion report — Payments, Refunds & Recovery

Date: 2026-11-16 (Europe/Zurich).

## Implemented scope

The Windows desktop supports Cash and manually confirmed Card/TWINT payments,
multiple exact digital allocations, partial payments and final cash settlement.
Fast cash and guided checkout share the same Application settlement operation.
The interface shows original subtotal, confirmed allocations, outstanding balance,
cash rounding, tendered/applied cash, change and the actual recorded payment total.

Sale details expose immutable historical items and payment history. Refunds use
explicit original line/quantity selection, may use a different payment method,
support partial/full/multiple payouts and retain fixed historical rounding shares.
The interface shows completed refunds, pending attempts and remaining refundable
quantities/balance across restarts.

Recovery uses durable session/attempt identities and a strict local reference.
Startup reads stored outcomes; it never repeats an external transfer. Uncertain
payments/refunds have an investigation workflow. Local privileged reconciliation
requires a reason and deliberate confirmation, retains original evidence and has
a permanent audit view. It resolves the historical conflicting-cash lock without
deleting either confirmation. An unfinished digital allocation may be excluded
only after an assertion that its net amount was already compensated externally,
with no active cash attempt or completed sale. Normal settled sales use refunds.

No real payment-provider, terminal, printer, drawer, analytics, import, networking,
authentication, updater or release integration was added.

## Financial invariants and decisions

- Currency remains safe integer Rappen. Checked arithmetic and BigInt guard
  sums, multiplication and proportional allocation; no floating-point CHF math.
- Exact digital allocations never exceed the original outstanding balance.
  Unconfirmed/failed/excluded attempts do not count as applied payments.
- Cash is final when methods are mixed. Round only the nonnegative remainder
  after exact digital allocations, once, using the shared Domain rule.
- Applied allocations = final payable = actual paid. Cash tendered includes change
  and is stored separately. New cash tender/change use five-Rappen denominations.
- Payment confirmation first commits a reported operator assertion; allocation
  and final sale are separate transactional boundaries. Final sale, cart consumption
  and completed session commit atomically. Refunds use the same evidence-first rule.
- Identical request keys and confirmations return existing records. Changed key
  payloads conflict. Unknown commit acknowledgements require read-only review of
  the original attempt; no provider operation is retried automatically.
- An open checkout protects its cart through modern and legacy APIs. Pending
  refunds reserve original units against competing preparations. Quantity and
  cumulative monetary limits are checked against the original sale and prior refunds.
- The original paid amount is apportioned with cumulative integer prefix floors
  over historical item units. Persisted offsets/quantities/base/rounding shares
  make full cumulative refunds equal exactly the original actual payment.
- Non-five-Rappen partial refunds require Card/TWINT or another selection. Refunds
  are not independently rounded. Completed sales/refunds/audit records are immutable.
- A reconciliation of an uncertain refund records its investigation confirmation
  time separately from the earlier unknown-outcome report; action and accepted
  refund commit together. Original assertions/events remain available.

The additive journal, manual confirmation model, refund algorithm and controlled
compensation policy are recorded in [ADR 0004](adr/0004-payment-ledger-and-refund-allocation.md).
See the [state machine and operator guide](mvp-0.3.md) for detailed behavior.

## Changed modules and migration

| Area | Principal files and behavior |
| --- | --- |
| Domain | `finance.ts`, exports and tests: models, allocations, balance, immutable sale invariants, refund unit apportionment/history |
| Application | `finance-ports.ts`, `payments-service.ts`, exports and tests; guarded legacy `pos-service.ts`/`ports.ts` |
| Contracts | `payments.ts`, exports and tests: 17 narrow runtime-validated methods under `CashSlothApi.payments` |
| SQLite | `finance-store.ts`, migration registration, `0003-payments-refunds.ts`, guarded `pos-store.ts`, 40 new integration cases |
| Electron | Explicit main/preload bindings and 54 financial IPC security checks |
| React | `payments-checkout.tsx`, `financial-sale-details.tsx`, `reconciliation-view.tsx`, shared payment components/recovery references, PosApp/styles/Modal |
| End-to-end | Five payment/refund/reconciliation workflows; preserved Foundation/First Sale/Catalog scenarios use the expanded read model |
| Documentation | README, setup, architecture, testing, compatibility matrix, operator guide, ADR 0004 and this report |

Migration **0003-payments-refunds** adds `payment_sessions`, `payment_attempts`,
`financial_sales`, `refund_attempts`, `refunds`, `financial_events` and
`reconciliation_actions`. Indexed references accompany canonical JSON aggregate
snapshots. Runtime schemas/Domain checks validate reads and writes. SQL guards
protect identities, allowed transitions, durable confirmation references, sale
totals, refund limits and append-only records. Ambiguous/noncanonical manually
edited JSON fails closed.

Historical cash sales are projected into the expanded read model, not rewritten.
Version 1/2 file hashes were checked before/after and remain:

```text
0001-first-sale.ts
522d1998aaa6603938e91a6ef2d9806b7ac2ed9ecb2bf827afebe4f89b77d94b
0002-catalog-management.ts
b31cd8a471cf0c6b9d87ab45844fc5e66d30ba7f8c46c899f63d68e8f49e3b97
```

Populated V2 migration tests use real disposable SQLite fixtures with completed
cash sales and draft snapshots. They do not modify an actual user's database.
Development/Beta/Stable isolation and Development-only seed behavior remain.

`AGENTS.md`, original branding, existing licensing documentation and dependency
pins were preserved. The original logo SHA-256 remains
`23d5b93e8b02f309817b3b09af98da4d33543573957bcd9c1ade06a8e01b3601`.
The proposed FSSL remains a draft; no root license was adopted.

## Verification

All executable checks use Windows x64, pinned **Node 24.22.1**, pnpm **11.25.0**.
The already bundled Node 24 is selected through process-local PATH because the
system installation defaults to Node 26.13.1. System configuration was not changed.

Dependencies were reused without installation/version changes: Electron **45.3.0**
(embedded Node **24.22.2**, Chromium **156.0.8078.96**, SQLite **3.53.4**),
Drizzle **1.0.0-rc.5**, React **19.3.1**, TypeScript **6.0.3**, Zod **4.6.7**,
Vite **8.3.8**, Vitest **5.1.0**, Playwright **1.65.0**, ESLint **10.14.0**.

| Check | Observed result |
| --- | --- |
| Starting suite | 257 tests passed before implementation |
| Strict typecheck | Passed |
| ESLint and architecture/cycle checks | Passed; 11 modules |
| Complete Vitest suite | **446 passed across 27 files** |
| New Domain/Application/Contracts tests | 83 passed |
| Financial IPC security tests | 54 passed |
| SQLite integration | 76 passed: 36 preserved and 40 new financial cases |
| UI helper/recovery tests | 40 passed across four files, including 12 new recovery-reference tests |
| UI/main/preload/independent Node build | Passed |
| Complete Electron suite | **8 passed**, approximately 3.2 minutes; no retries |
| Independent built Node-host smoke | Passed on Node 24.22.1, Windows x64, SQLite 3.53.4 |
| `pnpm check` | **Passed end to end** after the UI corrections |
| Documentation/scope | Relative links checked; original migration/logo hashes unchanged; no root license |

Scoped counts overlap with the complete suite; do not add them to the total.
The 189 added Vitest cases account for the increase from 257 to 446.

Financial integration tests exercise populated upgrades and partial migration
rollback, real on-disk commits/reopening, before-first-confirmation rollback,
reported evidence surviving second-stage failure, lost acknowledgements after
both confirmation stages, atomic final sale failure/retry, concurrent reservations,
immutable/raw-forgery guards, both refund commit stages, original legacy receipts,
late legacy cash confirmation during modern checkout, conflicting cash resolution,
clock rollback, and audit-bound uncertain refund timestamps. They also verify
atomic compensation/exclusion and rejection after cash preparation or completed sale.

Earlier targeted Electron runs passed Cash, Card, TWINT, mixed allocations,
successive refunds and recovery. The complete run then exposed two UI regressions:
an asynchronous draft-sync race during fast quantity edits and Tab trapping of
closed-details controls. Both were fixed in presentation code and their targeted
tests passed before the final complete successful rerun. Tests were not weakened
to hide these failures. Legacy-case reload/restart behavior was also checked so
remaining old confirmations do not reopen a blocking modal over reconciliation.

The final eight Electron cases cover:

1. Preserved catalog/variants/categories, historical cart prices and sale restart.
2. Preserved cash sale, rapid quantity changes, duplicate completion and restarts.
3. Foundation security, branding, sandbox, unauthorized financial/admin window
   rejection and all eight native SQLite/Drizzle compatibility probes.
4. Card-only and TWINT-only sales plus a full cash refund of a digital sale.
5. Mixed TWINT 500 + Card 500 + Cash 685 on subtotal 1684, paid 1685, tendered
   1000/change 315; historical refunds 842 + 843 across restarts. A non-nickel
   cash refund is rejected before the exact digital alternative is recorded.
6. An uncertain digital attempt retained unchanged after restart, explicit
   reasoned reconciliation, final cash completion and persistent audit history.
7. Two conflicting legacy cash confirmations, separately audited compensation,
   reloads/restart, intact evidence and restored access to the original cart.
8. A failed audit lookup during startup leaves an already-submitted legacy
   reference locked, keeps its pointer and never confirms or creates a sale.

The desktop tests also verify Escape/focus return, both Tab directions around
closed details, an 800-pixel receipt without horizontal overflow, and actual
payment/refund screenshots. Reviewed copies are in `docs/assets/` and the README.
Only the known inherited `NO_COLOR`/`FORCE_COLOR` warning was emitted; it did not
affect results. All test stores used disposable Development directories.

## Manual check and readiness

Run `pnpm dev` on the pinned toolchain in Development. Add Chocolate, cash tender
`5.00`, confirm receipt and complete; expect 245 paid and 255 change. Repeat Coffee
with manually confirmed Card and TWINT. Create an 842-Rappen fixture, split digital
500 plus cash 340, and verify 840 actual paid. Open a sale, select refund units,
choose a method, prepare and explicitly confirm a separately checked payout.
Restart and inspect the original payments/refunds. Prepare an attempt, report an
unknown outcome, restart and use reasoned Reconciliation without transferring
money again. The [full walkthrough](mvp-0.3.md#manual-workflow) includes limits.

Remaining production gates and unverified behavior:

- Manual assertions do not verify providers. There is no atomic transaction with
  cash or external transfers, and no recovery guarantee against every disk failure.
- Local trusted-window IPC is not operator/admin authentication. Anyone controlling
  the register can assert consequential actions; no remote administrative API exists.
- One active checkout per database; no multi-register production concurrency model.
  Historical arbitrary database damage/manual edits require investigation rather
  than invented automatic settlement. Keep the original attempt reference.
- Real providers, hardware power loss, disk exhaustion, backup/restore, sustained
  contention and large-volume history performance are untested.
- Separate Electron scenarios for cancelling a compensated confirmed partial
  checkout and reconciling an uncertain refund were not executed. Their financial
  transitions, audit atomicity and restart behavior are covered by SQLite tests;
  these additional UI walkthroughs remain manual checks.
- Linux/ARM64/Pi execution, browser-to-Pi payment transport, GitHub Actions execution,
  installer identities and production packaging remain open. The Node host is diagnostic.
- Drizzle remains an RC and release gates from ADR 0001 still apply. FSSL/private
  nonprofit/event/public-fork policy remains pending owner/legal review.

MVP 0.3 meets the requested local Windows development acceptance criteria. The
financial invariants, historical data preservation, recovery and complete existing
and new checks passed. **Ready as a development foundation for MVP 0.4**, subject
to its explicit specification and the production gates above.

This is not a production payment or release approval. No commit, push, merge,
publication, release, branch-protection change or production-data operation was performed.
