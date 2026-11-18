# Phase 5.0b completion report

Date: 2026-11-11 (Europe/Zurich)

Scope: development foundation only. No financial or POS workflow implemented.

This report records the initial foundation snapshot. The subsequent official-logo
integration and its additional checks are documented in [Branding](branding.md).

## Outcome

The pinned pnpm workspace, strict TypeScript, modular boundaries, React/Electron
shell, runtime-validated IPC, SQLite infrastructure and independent Node host are
implemented. `AGENTS.md` was read and remains unchanged. README now provides a
project overview, setup, current-state table and a screenshot of the real shell.

There were no commits, pushes, merges, releases, branch-protection changes or
production-data operations. Automated fixtures and smoke stores were temporary;
Beta and Stable were exercised only as directory names under disposable roots.

## Repository file tree

Source and documentation files below are the actual repository inventory, including
the existing `AGENTS.md`. Dependency directories, ignored build output and test
artifacts are excluded. `dist/` bundles were built for desktop, POS UI and Pi host;
they are reproducible local artifacts, not source files.

```text
Cash-Sloth-V3/
├── .github/
│   └── workflows/
│       └── foundation.yml
├── apps/
│   ├── customer-display/
│   │   ├── package.json
│   │   └── README.md
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── ipc-security.test.ts
│   │   │   ├── ipc-security.ts
│   │   │   ├── main.ts
│   │   │   └── preload.ts
│   │   └── package.json
│   ├── pi-host/
│   │   ├── src/
│   │   │   ├── index.integration.test.ts
│   │   │   ├── index.ts
│   │   │   └── main.ts
│   │   └── package.json
│   └── pos-ui/
│       ├── src/
│       │   ├── global.d.ts
│       │   ├── main.tsx
│       │   └── styles.css
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
├── docs/
│   ├── adr/
│   │   └── 0001-sqlite-driver.md
│   ├── assets/
│   │   └── foundation.png
│   ├── architecture.md
│   ├── phase-5.0b-report.md
│   ├── platform-compatibility.md
│   ├── setup.md
│   └── testing.md
├── packages/
│   ├── application/
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── index.test.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── domain/
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── i18n/
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── infrastructure-sqlite/
│   │   ├── src/
│   │   │   ├── connection.integration.test.ts
│   │   │   ├── connection.ts
│   │   │   ├── index.ts
│   │   │   └── probe.ts
│   │   └── package.json
│   ├── platform/
│   │   ├── src/
│   │   │   ├── index.integration.test.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── ui/
│       ├── src/
│       │   ├── foundation-status.tsx
│       │   └── index.ts
│       └── package.json
├── scripts/
│   ├── build.mjs
│   ├── check-boundaries.mjs
│   ├── smoke-pi-host.mjs
│   └── start-desktop.mjs
├── tests/
│   └── electron/
│       └── foundation.spec.ts
├── .gitignore
├── .node-version
├── AGENTS.md
├── eslint.config.mjs
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── tsconfig.json
└── vitest.config.ts
```

## Implemented modules

- Workspace: 4 application packages and 7 shared packages, with a root toolchain,
  frozen lockfile, reviewed install-script policy and shared build/check commands.
- Contracts/application: strict `{}` system-info request, validated response,
  narrow preload API and a host-independent provider port/use case.
- Desktop: sandboxed Electron composition root and bundled CommonJS preload;
  exact window/top-frame/URL authorization, denied navigation/popups/permissions
  and remote requests, channel-specific Electron paths and a local React screen.
- SQLite infrastructure: native connection policy with WAL, foreign keys, FULL
  synchronous writes, busy timeout, no extension loading and no application schema.
  A disposable probe validates both raw SQLite and Drizzle behavior.
- Platform/Node host: validated channel selection, distinct database/config/log
  paths and a real `127.0.0.1` HTTP diagnostic service independent of Electron.
- UI/i18n: reusable foundation-status component and English foundation strings.
  Domain and customer-display boundaries are intentionally reserved; no future
  business or customer-display behavior is hidden behind placeholders.
- CI/docs: pinned GitHub PR/manual workflow and setup, architecture, compatibility,
  testing and driver-decision documentation.

## Exact versions

| Component | Version |
| --- | --- |
| Development Node.js | `24.22.1` |
| pnpm | `11.25.0` |
| Electron | `45.3.0` |
| Electron's embedded Node.js | `24.22.2` |
| Electron's Chromium | `156.0.8078.96` |
| SQLite reported by both verified runtimes | `3.53.4` |
| Drizzle ORM | `1.0.0-rc.5` |
| React / React DOM | `19.3.1` |
| Zod | `4.6.7` |
| TypeScript | `6.0.3` |
| ESLint / `@eslint/js` | `10.14.0` / `10.0.1` |
| typescript-eslint | `8.72.2` |
| Vite | `8.3.8` |
| esbuild | `0.28.2` |
| Vitest | `5.1.0` |
| Playwright test | `1.65.0` |
| `@types/node` | `24.19.2` |
| `@types/react` / `@types/react-dom` | `19.3.0` |

TypeScript 6 was selected deliberately: the installed typescript-eslint declares
support below TypeScript 6.1, whereas the registry's latest TypeScript was 7.0.2.
No unsupported latest-version pairing was installed. Exact transitive dependency
versions and integrity hashes are in `pnpm-lock.yaml`.

## SQLite decision

Use `node:sqlite` with Drizzle's native `1.0.0-rc.5` adapter for this foundation.
Published package inspection confirmed the adapter is absent in stable `0.45.4`
and present in the pinned RC. Both actual runtimes passed the probe; no substitute
proxy implementation or separate native addon was required.

The prerelease is a conscious foundation tradeoff, not production approval.
`better-sqlite3` is documented as the fallback, with native ABI/ARM64 validation
costs; it was not installed or runtime-tested because the preferred driver passed.
See [ADR 0001](adr/0001-sqlite-driver.md).

## Executed checks and results

All final results were obtained locally on Windows x64.

| Check | Final result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; all 12 workspace projects, no lockfile updates needed |
| `pnpm typecheck` | Passed, strict source/test/config compilation |
| `pnpm lint` | Passed, ESLint and 11-module architecture/cycle checks |
| Vitest unit project | 22 passed: 6 contract and 16 IPC cases |
| Vitest integration project | 14 passed: 8 SQLite and 6 platform/HTTP cases |
| `pnpm test` | 5 files, 36 tests passed |
| `pnpm build` | Passed: React assets, Electron main/preload and Node-host bundles |
| Electron Playwright smoke | 1 passed: UI, bridge, isolation, actual unauthorized-window rejection, channel paths and SQLite probe |
| Built Node-host smoke | Passed: independent compiled host, actual HTTP, correct runtime and isolated Development directory |
| `pnpm check` | Passed end to end; launcher/app-version refinement additionally smoke-tested |
| Documentation/scope review | Local Markdown links and whitespace checked; generated files ignored; governance file unchanged |

The eight shared SQLite probe checks were true under Node and Electron: commit,
rollback, foreign keys, WAL, reopen, Drizzle binding, Drizzle transaction commit
and Drizzle rollback. The Electron smoke also checked the OS renderer sandbox
and that renderer `require`/`process` are unavailable.

Intermediate issues were resolved: concurrent pnpm auto-installs caused a
transient Windows file-lock failure; subsequent explicit frozen installs passed.
A forged Host-header test was corrected to use raw HTTP because fetch normalizes
that header. TypeScript CSS declarations and the Electron smoke's diagnostic
access were corrected. Launching the application package instead of its main
file fixed the displayed application version; the regression is asserted.
Playwright emitted a harmless inherited `NO_COLOR`/`FORCE_COLOR` warning.

## Open issues and unexecuted checks

- Drizzle is a release candidate. Review a stable native adapter or explicitly
  approved fallback before a production release; rerun both runtime probes after
  driver, ORM, Node or Electron upgrades.
- Raspberry Pi ARM64 hardware, ARM64 install/build tools and on-device SQLite
  behavior are untested. No Pi support claim is made.
- Linux checks are prepared in CI but were not executed locally or on GitHub.
  Linux Electron smoke is not included in the current workflow.
- The Chromium-to-Node-host UI transport is not implemented; the present UI is
  Electron-hosted. The Node host provides only diagnostic system information.
- The Electron smoke uses an untyped runtime preference diagnostic method;
  production code does not. Future Electron upgrades may require adapting it.
- Power-loss/long-duration contention, migrations, verified backups/restoration,
  packaged installer identities, updates and financial recovery are not tested
  or implemented in this foundation. Separate channel directories do not establish
  installer/update isolation by themselves.
- GitHub Actions execution, releases and deployment were not performed.

## Readiness for MVP 0.1 — First Sale

**Ready to begin MVP 0.1 on the verified Windows development foundation.** The
module boundaries, secure host interface, persistent storage primitives and
repeatable checks are available. There is no unresolved local foundation test
failure. Raspberry Pi and production readiness remain separate gates.

Before the first-sale implementation, specify the minimal domain/use-case and
transaction contracts, integer-Rappen behavior, snapshot persistence, completion
idempotency and failure/recovery expectations. Implement them only after an
explicit MVP 0.1 task. No production use is approved by this report.
