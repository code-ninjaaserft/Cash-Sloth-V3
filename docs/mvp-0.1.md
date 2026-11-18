# MVP 0.1 — First Sale

## Working scope

The desktop now provides a persistent Development catalog, draft cart, all-cash
checkout, on-screen sale receipt and the most recent 20 completed sales. The
existing official branding, sandbox, narrow IPC and separated channel paths remain.
There are no card/TWINT/split payments, refunds, product administration, printing,
customer-display pairing, theme editor or new localization implementation.

## Domain and application

`packages/domain/src/models.ts` defines semantic identifier types, Product,
ProductVariant, catalog entries, Cart/CartItem, CheckoutAttempt and Sale/Item/Payment.
Identifiers are validated serialized strings, not nominally branded wire types.
Every sellable product has a stable default variant ID. Domain validation checks
safe integer Rappen, positive quantities up to 9999, at most 1000 cart lines,
revision overflow and coherent financial snapshots.

Money helpers use integer/BigInt arithmetic for summation, multiplication,
decimal input parsing and formatting. Values must stay between zero and
`Number.MAX_SAFE_INTEGER` Rappen. Swiss cash rounding is independent: round the
cash portion to the nearest five Rappen. This MVP passes the full subtotal;
future split payments must first subtract exact digital payments. An operation
whose rounded result exceeds the integer bound is rejected.

Example: Chocolate costs 247 Rappen. One item gives an unrounded CHF 2.47 subtotal,
a −2 Rappen adjustment and CHF 2.45 due. Receiving CHF 5.00 applies CHF 2.45 and
returns CHF 2.55. Received cash, applied cash, change and rounding are separate fields.

Adding snapshots product/variant IDs, names and price. Quantity changes preserve
that snapshot. A later add merges only with a line having the same identity,
price and display-name snapshot; a changed price produces another line. Inactive
products/variants cannot be newly added. Existing snapshots are preserved when
catalog entries change. Completed sales never read current catalog prices.

`createPosService()` implements catalog/cart/quote/receipt use cases through
`PosStore`. `CompleteSaleUseCase` is the sole finalization operation; alternative
checkout layouts must reuse it. Clock and ID creation are injected by the host.

## Database and migration

Startup order in Electron is: open the selected channel database, apply migrations,
seed only Development, construct the store/services, register IPC, load the UI.
The independent Pi diagnostic host remains unchanged and exposes no sale API.

`packages/infrastructure-sqlite/src/migrations/0001-first-sale.ts` creates:

| Table | Purpose and main protections |
| --- | --- |
| `products` | Stable product ID, name and active flag |
| `product_variants` | Stable variant ID, product foreign key, integer price, active flag |
| `carts` | Draft/consumed lifecycle, revision, one open draft |
| `cart_items` | Ordered product/variant/name/price snapshots and positive quantities |
| `checkout_attempts` | Durable quote/key, confirmation evidence and completed sale reference |
| `sales` | Unique checkout key and cart, immutable totals/time, internal sealing flag |
| `sale_items` | Immutable ordered line snapshots, integer totals and historical identities |
| `sale_payments` | Single cash confirmation, received/applied/change and confirmation time |

The migration ledger `schema_migrations` stores version, name, SHA-256 and applied
time. Repeated startup is idempotent; mismatched/newer history fails without
dropping tables or replacing files. Foreign keys, indexes, CHECK constraints and
sealed-sale triggers supplement Domain validation. Sale-item catalog identities
are historical snapshot fields rather than live catalog joins.

No CLI that edits arbitrary databases is introduced. Normal startup migrates its
own selected store. Development and automated tests must not point to real Beta
or Stable data. Future changes append migrations; do not rewrite applied SQL.

## Development seed

The idempotent seed inserts only missing deterministic entries and does not
overwrite later catalog edits:

| Product | Default variant | Unit price |
| --- | --- | --- |
| Mineral water | `variant-water-default` | CHF 3.30 |
| Chocolate | `variant-chocolate-default` | CHF 2.47 |
| Coffee | `variant-coffee-default` | CHF 4.50 |

Beta and Stable do not seed automatically. With no active catalog their UI shows
an empty catalog; this milestone provides no product administration screen.

## IPC and recovery

`window.cashSloth.system.getInfo()` remains available. The new `pos` API exposes
only `listCatalog`, `getCart`, `addItem`, `setQuantity`, `removeItem`, `clearCart`,
`prepareCheckout`, `completeSale`, `reconcileCheckout`, `getSale` and
`listRecentSales`. Every call takes one strict object envelope; mutations include
cart ID and expected revision. Requests/responses are runtime validated in both
the bundled preload and main boundary. Sender authorization still requires the
trusted window, top-level frame and exact local UI URL.

Business responses are `{ok:true,value}` or `{ok:false,error:{code,message}}`.
Malformed or unauthorized transport calls reject before executing a use case.
There is no generic IPC invocation, arbitrary SQL, filesystem or Node bridge.

An unresolved confirmation locks new cart operations. A response that cannot
confirm commit shows recovery, never a success receipt. Startup checks any saved
key read-only. Use **Check stored result**; if no completed sale exists and the
same cart/quote is valid, **Retry same confirmation** reuses its original amount
and key without taking cash again. A different received amount conflicts.
See [ADR 0002](adr/0002-first-sale-transactions.md) for the transaction sequence.

## Manual first sale

From the repository root with the pinned Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. Stay in Development. Select **Chocolate** in POS.
2. Change quantity using the direct input or +/−; removing and clearing are available.
3. Select **Checkout**. Check subtotal CHF 2.47 and cash due CHF 2.45 for quantity one.
4. Enter `5.00` in **Cash received (CHF)**. Verify CHF 2.55 change.
5. Explicitly confirm that cash was received, then select **Complete sale**.
6. Inspect the committed receipt, unique ID, timestamp, line snapshots and cash fields.
7. Select **Start new sale** to acknowledge that receipt.
8. Close/reopen the app, choose **Recent sales**, and reopen the same sale.

An unfinished draft also reappears after restart. At narrower widths use **Open
cart** / **Close cart**. **System status** retains the Foundation diagnostic view.
Automated workflows always use a disposable Development root; normal manual use
persists in the existing channel-specific data directory described in [setup](setup.md).

## Verification and limitations

Run `pnpm check` for strict TypeScript, lint/boundaries, unit/integration tests,
build and actual Electron/Node smoke checks. The First Sale smoke also changes
quantities, removes/clears items, rejects insufficient cash, restores a draft,
replays a checkout key, acknowledges the receipt, tests the compact cart drawer
and retrieves the sale after another restart. Results are recorded in the
[completion report](mvp-0.1-report.md).

Known limits:

- Windows x64 is the verified runtime; Linux/ARM64 and GitHub CI execution are
  unverified unless separately reported. The Pi host still serves diagnostics only.
- Drizzle remains the pinned RC documented in ADR 0001; this is a development MVP,
  not a production release or approval to use real financial data.
- Concurrent stale cash confirmations are preserved and can deliberately lock the
  register for investigation. No automatic undo, cash verification or administrative
  resolution UI is provided. Use a single operator session.
- Clearing/corrupting browser storage can lose the renderer recovery pointer.
  Confirmed database attempts remain authoritative; unreadable pointers block new
  checkout rather than being discarded silently.
- There are no accounts, tax breakdowns, physical receipts, hardware integration,
  backups/restoration workflows or update/installer changes in this milestone.
- Fault tests cover known rollback and lost commit acknowledgements, not physical
  power loss, full-disk hardware failures or every filesystem failure mode.
