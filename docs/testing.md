# Testing Cash Sloth V3

Internal operation: **OP Faultir Chrysos**; see [project identity](project-identity.md).

Install the pinned toolchain and dependencies as described in [setup](setup.md).
Run commands from the repository root.

| Command | Check |
| --- | --- |
| `pnpm install --frozen-lockfile` | Reproducible dependency and policy validation |
| `pnpm typecheck` | Strict TypeScript across source, tests and TS configs |
| `pnpm lint` | ESLint plus module dependency and cycle checks |
| `pnpm test:unit` | Contracts and IPC request/response/sender validation |
| `pnpm test:integration` | SQLite, actual HTTP host and data-directory isolation |
| `pnpm test` | Both Vitest projects |
| `pnpm build` | Vite UI and esbuild main/preload/Node host bundles |
| `pnpm test:smoke` | Actual Electron desktop followed by built Node-host process |
| `pnpm check` | Typecheck, lint, all Vitest tests, build and both smoke checks |

Smoke tests need a build first; `pnpm check` does this automatically. Electron
tests require a usable desktop session and the Electron binary; the binary may
download on first launch. No separate Playwright Chromium download is required:
the test drives Electron's own Chromium. Do not disable the sandbox to make a
test pass. Linux desktop smoke is not included in the prepared CI job.

## Coverage and fixtures

The [two-level navigation correction](navigation.md) adds focused presentation
state tests and `tests/electron/navigation.spec.ts`. These cover the animated menu
overlay, mounted category/scroll preservation, frame-by-frame layout stability,
closing click shielding, rapid reversal, reduced motion, deep category selection,
tab restoration, search/cart preservation, keyboard navigation and 1280/800/390/320px layouts. Touch target styles are checked
using explicit input mode rather than inferring it from viewport width.

The complete MVP 0.4 run includes the preserved Foundation/MVP 0.1–0.3 suite plus
demo/import, filtered history and host-mediated export checks. Final counts/results
are recorded in [MVP 0.4 results](mvp-0.4-report.md). The historical
[MVP 0.1 report](mvp-0.1-report.md) retains its original 163-test snapshot.

- Unit: 6 contract cases and 16 IPC boundary cases, including untrusted windows,
  frames/URLs, unexpected arguments and invalid responses.
- MVP unit coverage adds money bounds/formatting/rounding, snapshots and revisions,
  sale invariants, use-case failure/reconciliation behavior, POS contracts,
  33 per-operation IPC boundary checks and renderer recovery-pointer safety.
- Integration: 8 SQLite cases, 6 platform/host cases and 3 branding-asset cases.
  Branding cases verify original integrity, ICO frame dimensions/offsets and PNG variants.
  Storage/host tests use on-disk
  temporary databases and actual loopback HTTP requests, including a forged Host
  header sent through the raw HTTP transport.
- MVP integration adds 14 cases for versioned migrations, Development-only seed,
  persistent drafts, catalog changes, atomic sale persistence, revision conflicts,
  unknown commit acknowledgements, idempotency and sealed snapshot protection.
- Catalog checks cover products/variants, duplicate SKU/barcode rules, aggregate
  and variant revisions, deep categories/cycles, assignments, descendant deduplication,
  global/restricted search, exact historical snapshots and inactive checkout policy.
  Real SQLite tests migrate a V1 store containing a draft and a completed sale,
  test partial migration rollback, and verify ordering across reads/reopens.
- Editor helper tests cover request validation before invocation, uncertain-create
  save gates, read-only reconciliation before retries and preserved recovery rules.
- Electron smoke: visible React content, validated bridge, app version,
  inaccessible Node globals, channel-specific Electron directories, renderer
  sandbox, rejected second-window IPC, denied popup and a main-process SQLite
  probe. The probe never runs through a renderer-facing endpoint.
  Branding assertions additionally verify the loaded top-left logo, copied PNG,
  Windows ICO decoding and the actual Windows-supplied application window icon.
- Built Node-host smoke: launches the bundled host without Electron, requests
  runtime information over HTTP and confirms only Development data was created.
- First Sale Electron smoke: product selection, remove/clear/quantity controls,
  draft restart, insufficient cash rejection, cash rounding/change, committed
  receipt, repeated confirmation with the same key, receipt acknowledgement,
  compact drawer interaction and retrieval after another application restart.
- Catalog Electron smoke: create two category levels and a product, add a second
  priced variant, assign both categories/primary, search globally and by subtree,
  add variants, change quantity/current price, retain separate historical lines,
  complete a cash sale and restart to retrieve unchanged snapshots and metadata.
- Payment Domain checks cover rounding boundaries, exact digital and mixed
  allocations, cash tender/change, invalid/unsafe values, cumulative prefix-floor
  refunds, zero-value units and full refund equality across partial sequences.
- Financial SQLite checks cover populated V2 upgrades, unchanged legacy history,
  payment/refund idempotency, reservations, cross-API cart locks, before/after
  commit faults, reopening, immutable evidence and explicit reconciliation audits.
- Every payment/refund/reconciliation IPC operation has sender, envelope and
  response checks. Consequential requests require literal confirmations; malformed
  amounts and arbitrary operations are rejected before executing use cases.
- Modern renderer recovery tests exercise strict reference validation,
  persist-before-send, lost replies, matching acknowledgement and read-only restart.
- Payment/refund Electron workflows cover Card-only, TWINT-only, mixed final cash,
  historical partial/full refunds, persisted details and interrupted recovery.
  All external events are manual assertions in isolated synthetic scenarios;
  no real provider transfer is performed.

All data fixtures are under disposable temporary roots; real development, Beta
and Stable stores are not used. The SQLite probe refuses existing files before
creating synthetic test tables. Tests do not exercise production POS data.

MVP 0.4 adds strict CSV/price/category grammar and deterministic demo tests,
populated V3 upgrade fixtures, stale-preview rejection, whole-import rollback and
lost-commit receipt lookup. History tests cover Swiss DST day boundaries, all
filters, stable pages, zero-value quantity refunds, linked export totals,
spreadsheet text escaping and explicit sale/row/UTF-8 byte limits. A 1000-sale
fixture checks correctness; it is not a production latency benchmark.

Desktop file tests use real temporary files/directories, reject malformed/oversized
input and renderer paths, and inject write/publication failures to verify no partial
export is published. Native dialog selections in the new Electron scenarios are
substituted by the privileged test harness; actual IPC/read/write/import/export
code runs. Interactive OS-dialog keyboard behavior is not established by that test.
The two new workflows cover the eleven requested management scenarios, including
demo repetition, quoted/BOM CSV variants, conflicts, imported-product sale,
mixed rounding/refund, history filters, export validation and restart persistence.
Reviewed screenshots are `docs/assets/mvp-0.4-demo.png`, `mvp-0.4-import.png` and
`mvp-0.4-history.png`, linked from the README. The final import tests also reject
category expansion beyond its budget before storing any plan, and reject aliases
that resolve two source keys to one product aggregate.

Playwright writes ignored results to `test-results/`, including the latest
`foundation.png` screenshot and `electron-results.json`. The README contains a
reviewed screenshot copy under `docs/assets/`; update it deliberately after UI
changes, not automatically on every test run.
On Windows the smoke also saves `branding-native-icon.png` and
`branding-native-window.png`, obtained from the exact application window via
Electron's desktop capturer. No full-desktop capture is saved.
First Sale screenshots are `mvp-0.1-pos.png`, `mvp-0.1-receipt.png` and
`mvp-0.1-compact.png`; reviewed POS/receipt copies are included in the README.
Catalog screenshots use `mvp-0.2-pos.png`, `mvp-0.2-catalog-editor.png` and
`mvp-0.2-editor-compact.png`. Screenshot capture disables finite animations so
the saved image shows the settled UI, not a fade-in frame.
Payment/refund smoke captures use `mvp-0.3-checkout.png`,
`mvp-0.3-mixed-sale.png` and `mvp-0.3-refunds.png`; reviewed copies are under
`docs/assets/`. Refund tests check both Tab directions across closed-details
controls, Escape focus restoration and an 800-pixel receipt layout. Legacy
reconciliation tests resolve two conflicting cash confirmations with reloads and
restarts. A privileged harness-only IPC read fault verifies that failed audit
lookup leaves a submitted recovery reference locked without automatic confirmation.

License metadata inspection is separate from executable tests:
`node scripts/audit-licenses.mjs 2026-11-12` reads installed package metadata and
notice hashes. It does not adopt FSSL, certify legal compatibility or publish data.

The smoke harness runtime-validates Electron's untyped `getLastWebPreferences`
diagnostic method and checks the public app-process metrics for OS sandboxing.
Only the test depends on that diagnostic; a future Electron update may require
adjusting the harness. Production code uses no such method.

## CI and limits

`.github/workflows/foundation.yml` prepares PR/manual checks on Windows and
Ubuntu with pinned action commits and a frozen lockfile. Both run typecheck,
lint, Vitest and build; Windows additionally runs the Electron and built-host
smokes. The workflow has read-only repository permissions. It has not been
executed on GitHub in this task; no branch protection rules were changed.

Successful tests establish the development behaviors recorded in the latest
report, including manual payment allocation and historical refund limits. They
do not verify actual provider settlement, backups, Pi hardware, release packaging,
operator identity or real hardware power-loss safety. Fault injection covers
selected rollback and lost-acknowledgement boundaries, not every filesystem or
hardware failure. No production data is used. For a manual walkthrough and local
administration limits see [MVP 0.3](mvp-0.3.md#manual-workflow).
