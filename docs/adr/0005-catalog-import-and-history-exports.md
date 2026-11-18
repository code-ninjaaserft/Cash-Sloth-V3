# ADR 0005: Reviewed catalog imports and linked financial exports

Date: 2026-11-18

Internal operation: **OP Faultir Chrysos** — Cash Sloth V3, Faultir Softworks.

Status: Accepted for MVP 0.4 development.

## Decisions

Reuse the catalog aggregate/store, financial read model, synchronous transaction
boundary and secure Electron bridge. New management/history namespaces add narrow
operations; file operations are native-host mediated and asynchronous. They never
accept a renderer-supplied file path. Public application/package identities and
channel data directories are unchanged.

The substantial Swiss demo manifest is explicit and Development-only, sharing the
reviewed import machinery. Existing three-item Development startup fixtures remain
separate for compatibility. Deterministic identities/provenance coexist with user
records. Matching data is skipped; modified demo records are preserved and flagged.

CSV parsing is strict/bounded UTF-8, with deliberate comma/semicolon selection
when ambiguous. Prices are decimal text parsed to integer Rappen; hierarchy uses
documented backslash escapes for `>`/`|`. Repeated product definitions must agree.
No conflict policy may silently overwrite user data or invent a missing price.

Persist immutable host-generated plans with the exact catalog/provenance snapshot.
The renderer submits a plan ID and stable operation key, not arbitrary mutations.
Inside `BEGIN IMMEDIATE`, compare the snapshot, apply all writes and commit the
operation receipt atomically. Same-key replay returns the receipt; changed keys
cannot reapply the same plan. Recovery reads the original operation. Durable
preview storage is justified by restart/retry safety; automatic retention cleanup
and large-source optimizations remain outside this milestone.

History filters/counts/pages run in SQLite across legacy and modern immutable
sales. Refund aggregates remain separate to avoid payment/refund join multiplication.
Date filters are inclusive Swiss calendar days converted with `Europe/Zurich` rules;
export timestamps remain UTC. Retain one authoritative financial detail interface.

Export five linked CSV tables rather than repeating sale totals on every payment
or refund. Read a consistent database snapshot and enforce explicit sale/row/byte
limits before publishing a complete new folder. Existing files are not overwritten;
normal publication failures clean only the export's own staging directory. Native
chooser cancellation is explicit. Filesystem power-loss durability is not implied.

## Spreadsheet text protection

Quote every cell and double embedded quotes. Prefix potentially executable text
with an apostrophe after checking normalized operators and leading whitespace,
controls and formatting characters. Financial numbers remain numeric values;
the signed rounding column is not treated as untrusted free text. Stable identifiers
link the exported tables without relying on display names.

This policy protects the generated representation and deliberately transforms
dangerous text. It does not certify every spreadsheet application's import or
re-save behavior. OWASP documents both the usual escaping approach and limitations
when a spreadsheet rewrites a CSV, and notes that no universal sanitization policy
fits all applications/consumers. [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).

## Consequences

Migrations 0004/0005 add import bookkeeping and read indexes without rewriting
0001–0003 or financial records. Existing runtime validation, isolation, local trust
and manual provider-confirmation limits remain. Catalog snapshot plans consume
storage, history still performs bounded detail/context lookups, and neither the
synthetic scale tests nor a clean Windows run establishes production readiness.
