# Cash Sloth V3 architecture

Internal operation: **OP Faultir Chrysos**. The public product remains
**Cash Sloth V3**, developed and published by **Faultir Softworks**.
See [project identity](project-identity.md) for naming conventions.

The workspace has four application boundaries and seven shared package boundaries.
MVP 0.4 adds reviewed demo/CSV catalog population, bounded history queries and
linked financial CSV exports to the existing payment/refund foundation. Real
payment providers remain outside the current scope.

## Layers and dependency direction

| Module | Responsibility | Current workspace dependencies |
| --- | --- | --- |
| `domain` | Integer money, payment/refund invariants, cart snapshots and catalog rules | None |
| `application` | Host-independent system/POS/catalog/payment use cases and persistence ports | `domain`, `contracts` |
| `contracts` | Strict Zod request/response schemas and TypeScript API types | None |
| `infrastructure-sqlite` | Connection policy, additive migrations, financial journal, POS/catalog stores and probe | `domain`, `application`, `contracts` |
| `platform` | Channel validation and OS data directories | `contracts` |
| `ui` | POS/catalog, guided payments, refunds, recovery/reconciliation and system status | `domain`, `contracts`, `i18n` |
| `i18n` | English foundation messages; no localization engine yet | None |
| `desktop` | Electron composition root, main-process IPC and preload | `application`, `contracts`, `infrastructure-sqlite`, `platform` |
| `pos-ui` | React entry point and Vite assets | `contracts`, `ui`, `i18n` |
| `pi-host` | Independent Node composition root and loopback diagnostic API | `application`, `contracts`, `infrastructure-sqlite`, `platform` |
| `customer-display` | Reserved package and scope note only | None |

Management uses `ManagementStore` around the existing catalog aggregate and
transaction boundary. Strict CSV/category/price rules remain pure Domain logic;
Application creates immutable plans and revalidates complete catalog snapshots
before atomic apply. `HistoryStore` performs SQL filtering/counting/pagination
over legacy and modern sales. The export formatter creates five linked tables
from a single financial snapshot without repeating original sale totals.

The `files` namespace exposes only choose-catalog-CSV and export-filtered-history.
Asynchronous IPC validates the trusted sender and request before opening a native
dialog. The desktop file adapter reads the chosen bounded UTF-8 file or publishes
a new export directory; React cannot supply arbitrary filesystem paths. Dialogs
and file writes run outside SQLite transactions. Core import/export logic remains
host independent; the Pi host still exposes diagnostics only.

Migrations 0004/0005 add import plans/receipts/provenance and query indexes.
They preserve migrations 0001–0003 and immutable financial records. See
[ADR 0005](adr/0005-catalog-import-and-history-exports.md) and
[management operations](mvp-0.4.md).

Application accepts a `SystemInfoProvider` port. Each host supplies runtime facts
and SQLite version; the use case has no database or host imports. Technical wire
models live in contracts rather than being placed in the business domain. This
diagnostic use case remains separate from financial operations. `createPaymentsService`
coordinates payment sessions, durable transfer assertions, settlement and refunds
through `FinanceStore`, sharing the existing synchronous `PosStore` transaction
boundary. The original `CompleteSaleUseCase` remains a guarded legacy cash boundary.

`scripts/check-boundaries.mjs` checks workspace dependency direction and cycles,
cross-package relative imports, declared external imports and framework/driver
placement. ESLint also blocks Node globals in portable modules and browser/network
globals in inner layers. Tests may import Node tooling for fixtures; production
source rules remain separate. Update the dependency policy deliberately when a
new architecture requirement is approved.

## Desktop communication and trust boundary

The UI uses separate application-view and POS-category navigation components and
state. An absolute application-menu overlay covers the mounted POS categories;
opening and closing it leaves sidebar, product and cart dimensions fixed. Category
controls remain inert until closing finishes. See [two-level navigation](navigation.md) for behavior,
accessibility, responsive layout and the explicit future touch-mode seam.

```text
React -> window.cashSloth.system.getInfo()
      -> isolated, bundled CommonJS preload
      -> system:getInfo IPC with strict {} envelope
      -> main: window + top-level frame + exact file URL authorization
      -> request validation -> application service -> response validation
  -> preload response validation -> React
```

The renderer receives a single narrow API, never `ipcRenderer` or generic
channel selection. Main rejects wrong argument counts, malformed envelopes,
unexpected fields, other windows, subframes and untrusted URLs before use-case
execution. Both request and response validation run at runtime.

Main explicitly enables sandboxing, context isolation and web security; Node
integration, webviews, permissions, navigation and new windows are disabled.
The session permits only the built UI's local asset prefix. CSP denies network
connections, frames, forms and other unneeded content. There are no remote assets
or external shell-opening operations. Sandboxed preload is bundled CommonJS,
consistent with Electron's [preload limitations](https://www.electronjs.org/docs/latest/tutorial/esm).

## Node host and storage

Catalog operations use a separate narrow `window.cashSloth.catalog` namespace.
`createCatalogService` depends on `CatalogStore`; SQLite implements revision-aware
aggregate writes and batched product reads. Catalog editor and product browser
remain separate presentation components. Existing POS operations still add a
specific active variant. Normal and fast checkout now share the payments API;
legacy cash records and contracts remain compatible.
See [ADR 0003](adr/0003-catalog-management.md) for category/search/deactivation policy.

`window.cashSloth.payments` exposes strict preparation, confirmation, settlement,
refund, read-only recovery and explicit reconciliation contracts. It exposes no
generic database or provider operation. An open payment session guards legacy
cart edits and settlement as well as modern operations. Reconciliation requires
a reason and literal deliberate confirmation. Trusted local-window authorization
does not authenticate an administrator; this MVP has no accounts or roles.

Migration 0003 adds indexed runtime-validated JSON financial snapshots and an
append-only event/action journal. Historical cash tables are projected into the
expanded read model without rewriting migrations 0001/0002 or completed sales.
See [ADR 0004](adr/0004-payment-ledger-and-refund-allocation.md) and the
[financial state/rounding guide](mvp-0.3.md).

The Node host serves only `GET /api/system/info` from literal `127.0.0.1`, checks
Host/Origin, rejects request bodies and unknown methods/routes, and validates its
response. There is no LAN service or pairing mechanism.

Both hosts select a channel data directory, open an on-disk database and query
SQLite's version. Connection setup itself creates no application tables. Desktop
composition subsequently applies additive financial/catalog migrations and seeds Development.
The Pi diagnostic host does not expose POS operations. WAL, foreign
keys, FULL synchronous writes, bounded lock waiting and disabled extensions are
shared infrastructure policy. See [ADR 0001](adr/0001-sqlite-driver.md) and
[ADR 0002](adr/0002-first-sale-transactions.md). The UI may import pure Domain money
helpers; it still cannot import Application, Infrastructure or host APIs.

Workspace package exports point to TypeScript source for internal consumption.
Vite bundles the browser app; esbuild bundles each host and the preload. Packages
are private and are not independently published libraries. Desktop distribution,
installers and update packaging are outside this phase.
