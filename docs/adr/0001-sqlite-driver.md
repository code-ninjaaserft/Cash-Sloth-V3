# ADR 0001: Built-in Node SQLite with Drizzle's native adapter

Date: 2026-11-11

Status: Accepted for the Phase 5.0b foundation; compatibility and prerelease risk
must be re-evaluated before production financial operations.

## Context and evidence

Cash Sloth needs local SQLite in Electron main and in an independent Node host.
The application must not make the renderer depend on database or Node APIs.
The preferred driver is `node:sqlite`, with `better-sqlite3` as a fallback.

The npm registry's stable `drizzle-orm` release is `0.45.4`. Its published package
does not provide the native Node SQLite adapter. Current Drizzle documentation
instructs users to install the release-candidate channel for this integration.
The exact `1.0.0-rc.5` npm tarball was inspected: it includes `node-sqlite` driver,
session and type declarations, exposed through package subpath wildcard exports.
The implementation accepts `drizzle({ client: DatabaseSync })`; it is not a
third-party proxy adapter.

Sources:

- [Drizzle Node SQLite connection guide](https://orm.drizzle.team/docs/sqlite/connect-node-sqlite)
- [Exact Drizzle package metadata](https://registry.npmjs.org/drizzle-orm/1.0.0-rc.5)
- [Node SQLite API](https://nodejs.org/api/sqlite.html)
- [Electron release versions](https://releases.electronjs.org/)

## Decision

Use built-in `node:sqlite` and pin `drizzle-orm` to `1.0.0-rc.5` for this
foundation. Keep both behind `@cash-sloth/infrastructure-sqlite`. Do not introduce
business tables, migrations or financial operations in this milestone.

Each on-disk connection enables foreign keys, WAL, full synchronous writes,
a finite busy timeout and disables trusted schema and extension loading. Failure
to enable mandatory foreign keys or WAL aborts the connection. The host owns
environment directory selection and connection lifetime.

Drizzle transactions use synchronous callbacks. Never await external work or
payments inside them. The package types reject asynchronous transaction callbacks;
any future application transaction boundary must preserve that constraint.

The compatibility probe creates synthetic fixtures only in a new, caller-owned
temporary file. Exclusive creation rejects existing files. It checks direct SQL
commit/rollback, foreign keys, WAL, Drizzle query-builder binding, Drizzle
commit/rollback and persistence after reopening. Node integration tests and the
Electron main-process smoke execute that same probe.

## Consequences and alternatives

- Built-in SQLite avoids a separate native addon and Electron ABI rebuilds.
- Drizzle is a **release candidate**, not a stable dependency. Exact pinning and
  executable compatibility checks limit accidental changes but do not establish
  production readiness. A stable native adapter or an explicitly reviewed
  fallback decision is required before a production release.
- `better-sqlite3` remains the fallback if the built-in driver or the native
  Drizzle adapter fails required tests. It would add native binary availability
  and ABI checks for Node, Electron and Linux ARM64. It is not installed merely
  to add a second unneeded driver; its runtime compatibility is not claimed.
- Successful desktop tests do not establish Raspberry Pi ARM64 compatibility,
  power-loss safety, migration safety or backup/restore correctness.

## Executed compatibility

On Windows x64 with Node `24.22.1` and SQLite `3.53.4`:

- `pnpm exec vitest run --project integration packages/infrastructure-sqlite`:
  **8 tests passed**.
- An independently executed bundled `probeDatabase` returned all eight named
  compatibility checks as `true`, including Drizzle commit and rollback.

The actual Electron results are recorded in the phase completion report and
platform compatibility matrix after its smoke test runs. Raspberry Pi ARM64 and
`better-sqlite3` runtime tests remain unexecuted; no compatibility is inferred.
