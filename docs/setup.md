# Development setup

Internal operation: **OP Faultir Chrysos**. Public product and developer identities
follow [project identity](project-identity.md).

## Toolchain

- Node.js `24.22.1` (also pinned in `.node-version`); the supported development
  major is Node 24. Electron supplies its own embedded Node runtime.
- pnpm `11.25.0`, pinned through `packageManager` and the workspace engines.
- Windows x64 is locally verified. Linux and ARM64 are separate compatibility gates.

Install these tools using your normal trusted distribution. Corepack, if provided
by your Node installation, or pnpm's official installation instructions can be
used; do not assume npm or Corepack is installed. No global project tools beyond
Node and pnpm are required.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The lockfile fixes transitive dependencies; `pnpm-workspace.yaml` pins shared
versions and explicitly permits only reviewed dependency install scripts. A
reviewed exact Vite release is exempted from pnpm's release-age gate. Other new
exceptions require review, not automatic acceptance. Electron may download its
pinned binary on first launch. Package/binary installation requires network
access. The desktop runtime itself needs no internet connection.

`pnpm dev` builds once and launches the desktop; rerun it after edits. For an
already built desktop use `pnpm start:desktop`. The launcher clears
`ELECTRON_RUN_AS_NODE` so embedded tooling environments do not launch the wrong
Electron mode. It launches `apps/desktop` as an application package, preserving
the application version instead of reporting Electron's version as the app version.

## Standalone Node host

```sh
pnpm build
pnpm start:pi
```

`GET http://127.0.0.1:3210/api/system/info` returns validated runtime information.
There is no Electron dependency, LAN binding option, CORS allowance or POS API on
this diagnostic host. Desktop startup applies the versioned First Sale schema
and seeds test products only in Development; see [MVP 0.1](mvp-0.1.md).
The React renderer currently requires
Electron's preload bridge. Raspberry Pi browser integration is not implemented.

The desktop also applies the additive [MVP 0.2 catalog migration](mvp-0.2.md) and
offers Catalog in its navigation. Existing drafts/sales survive this upgrade;
there is no destructive reset command. Use New product with a first priced variant,
then add variants and category assignments as needed.

MVP 0.3 adds migration `0003-payments-refunds`, guided manual Card/TWINT and fast
cash checkout, historical refunds and local Reconciliation. It preserves both
earlier migrations and completed cash records. See the
[payment and recovery walkthrough](mvp-0.3.md#manual-workflow) before exercising
manual transfer assertions. No real provider API or administrative network route
is configured.

MVP 0.4 adds import provenance/plans/results and history indexes through migrations
0004/0005. **Development tools → Load Demo Catalog** is explicit and Development
only; it does not replace the three existing startup fixtures or reset databases.
Use **Import** for the [sample CSV](../examples/catalog-import.csv), and **Recent
sales** for filters/export. Follow the [management guide](mvp-0.4.md) before applying.

The locally available bundled runtime for MVP 0.4 checks is Node 24.22.3, within
the declared `>=24.22.1 <25` engines range. `.node-version` and CI remain pinned
to 24.22.1; no project dependency/runtime pin or system configuration was changed.

If a globally installed Node 26 shadows the pinned Node 24, select Node 24 using
your version manager or a process-local PATH before running checks. Do not treat
an engine warning as an approved project-runtime upgrade. The MVP 0.2/0.3 checks
use Node 24.22.1; the available system Node 26 was not substituted for that gate.

## Environment configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CASH_SLOTH_CHANNEL` | `development` | Exactly `development`, `beta` or `stable`; other values fail |
| `CASH_SLOTH_DATA_ROOT` | OS data root below | Absolute custom root, allowed only in Development |
| `CASH_SLOTH_PORT` | `3210` | Node-host loopback port; `0` requests an ephemeral test port |

Default base directories:

- Windows: `%LOCALAPPDATA%/CashSlothV3`, with a home-directory fallback.
- Linux: `$XDG_DATA_HOME/CashSlothV3`, falling back to `~/.local/share/CashSlothV3`.

Each base contains distinct `development/`, `beta/` and `stable/` roots. Only the
selected channel is created. Each channel contains:

```text
<channel>/
  database/cash-sloth.sqlite
  config/
  logs/
  electron/                 Desktop only
    sessions/
    crash-dumps/
```

Electron user data, session data, crash dumps and logs are explicitly rooted in
the selected channel. Config/log directories are prepared; no settings store or
diagnostic logging system is implemented. Separate installer identities and
release/update infrastructure are future work.

For an isolated development session in PowerShell:

```powershell
$env:CASH_SLOTH_CHANNEL = 'development'
$env:CASH_SLOTH_DATA_ROOT = Join-Path $env:TEMP 'cash-sloth-manual-dev'
pnpm dev
```

Tests always use disposable temporary roots and do not select real Beta or Stable
data. Keep normal development on Development; do not point it at production data.
Do not place a live WAL database in a synchronized folder or network filesystem.
The default runtime data is outside this OneDrive-hosted source checkout.
