# Platform compatibility

Evidence accumulated from 2026-11-11. "Verified" means executed locally, not inferred
from documentation, compilation or the availability of an architecture target.

On 2026-11-18, **OP Faultir Chrysos / MVP 0.4** adds Windows checks for demo/CSV
population, paginated history and linked exports. Development checks use bundled
Node **24.22.3**, within the declared engine range; the repository and CI pin
**24.22.1** is unchanged. New MVP 0.4 behavior has not been re-executed on 24.22.1
or GitHub Actions. See [MVP 0.4 results](mvp-0.4-report.md).

On 2026-11-16, MVP 0.3 additionally exercises manual Card/TWINT and mixed cash
payments, historical refunds, populated V2 migration fixtures and investigated
recovery on Windows x64. Runtime/dependency pins are unchanged. See the
[MVP 0.3 report](mvp-0.3-report.md) for exact completed checks and limitations.

On 2026-11-12, MVP 0.2 additionally exercises managed products/variants/categories,
price changes and receipt retrieval through actual Windows Electron restarts.
Node 24.22.1 remains the checked project runtime even where system PATH defaults
to Node 26.13.1. See [MVP 0.2 report](mvp-0.2-report.md).

MVP 0.1 additionally passed actual Windows Electron draft/sale restarts, cash
checkout, duplicate-key retry and receipt retrieval. The independent Node host
remains diagnostic-only. See [MVP 0.1 report](mvp-0.1-report.md).

| Environment | Runtime | SQLite / Drizzle | Status |
| --- | --- | --- | --- |
| Windows x64, Node | Node `24.22.1` | SQLite `3.53.4`, Drizzle `1.0.0-rc.5` | Verified: integration tests and built standalone-host process |
| Windows x64, Node (MVP 0.4) | Node `24.22.3` | SQLite `3.54.1`, Drizzle `1.0.0-rc.5` | New management/history/import/export checks; exact results in milestone report |
| Windows x64, Electron main | Electron `45.3.0`, embedded Node `24.22.2`, Chromium `156.0.8078.96` | SQLite `3.53.4`, Drizzle `1.0.0-rc.5` | Verified: actual Electron main-process compatibility probe |
| Windows x64, Electron renderer | Chromium above, React `19.3.1` | No database access | Verified: rendered UI, IPC, isolated globals, OS renderer sandbox |
| Linux x64, Node | Intended pinned Node 24 toolchain | Not executed locally | PR CI job prepared; no GitHub result yet |
| Linux x64, Electron | Not executed | Not executed | Open; current workflow does not run Linux Electron smoke |
| Raspberry Pi Linux ARM64, Node | Intended Node 24 host | Not executed | Open: real Pi hardware and ARM64 package/runtime checks required |
| Raspberry Pi Chromium UI | Future browser host adapter | Not applicable to renderer | Not implemented or tested |
| `better-sqlite3` fallback | Not installed | No runtime probe | Alternative documented, no compatibility claim |

Both verified SQLite runtimes passed commit, rollback, foreign-key rejection,
WAL, reopen, Drizzle parameter binding and Drizzle commit/rollback checks.

## Raspberry Pi validation still required

The host contains no Electron import and shares application/contracts/storage
code with desktop. That reduces platform-specific code; it is not proof of ARM64
compatibility. Before declaring Pi support:

1. Install the pinned toolchain on real ARM64 hardware and verify frozen install,
   native build-tool availability, typecheck, lint, tests and build.
2. Run the built host and SQLite probes against local on-device storage.
3. Verify permissions, data paths, restart behavior and filesystem WAL support.
4. Add and validate the browser transport for Chromium in its own approved scope.

Power-loss durability, long-running contention, backup/restore, production-scale
migrations, installer identities and release/update behavior are unverified on
all platforms. Synthetic populated migration fixtures are verified on Windows;
they do not establish every real deployment's upgrade safety.
Node's built-in SQLite API and Drizzle's prerelease adapter must
be reviewed again before production financial operations. See the
[driver ADR](adr/0001-sqlite-driver.md) and [completion report](phase-5.0b-report.md).
