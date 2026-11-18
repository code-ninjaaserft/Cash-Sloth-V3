# Official Cash Sloth V3 branding

## Source and derived assets

The supplied `CSV3-Logo.png` is the official source. No logo existed in the
repository when this task began; the user-provided original was available and
was copied byte-for-byte to `assets/branding/original/CSV3-Logo.png`.

The source is 1254 × 1254 pixels. SHA-256:

```text
23d5b93e8b02f309817b3b09af98da4d33543573957bcd9c1ade06a8e01b3601
```

`assets/branding/manifest.json` records the original, checksum, application identity
and generated paths. Generated assets preserve the full square artwork and its
background, colors, lettering and proportions. There is no crop, recoloring,
background removal, simplified substitute or generated motif.

| Asset relative to `assets/branding/` | Purpose |
| --- | --- |
| `original/CSV3-Logo.png` | Unmodified master, retained at original resolution |
| `generated/cash-sloth.ico` | Windows icon: 16, 20, 24, 32, 40, 48, 64, 128 and 256 px, 32-bit PNG frames |
| `generated/cash-sloth-128.png` | Compact React header logo |
| `generated/cash-sloth-256.png` | High-density React variant and non-Windows window icon |

The UI displays the whole logo with `object-fit: contain`, at 72 px normally and
56 px on compact layouts. The detail and lettering naturally become small at
icon sizes; the official image has not been redesigned to compensate.

## Reproduction and integration

On Windows with PowerShell and System.Drawing:

```powershell
./scripts/generate-branding.ps1
pnpm check
```

The generator checks the source hash before deriving anything. It uses
high-quality bicubic downsampling and writes PNG-backed ICO frames. No new
dependency or external image service is needed. Generated files are retained in
the repository, so ordinary builds on other platforms do not need Windows imaging
APIs. Future regeneration on a different imaging runtime may produce different
encoded bytes; review changes rather than treating those bytes as universal.

Electron main imports the manifest and resolves copied assets relative to its
built module. Build copies only the required ICO and 256 px PNG to
`apps/desktop/dist/branding/generated/`; the original is not shipped to the renderer.
React imports the two PNG variants through Vite, which hashes and emits them.
Presentation receives image URLs as props and never reads the filesystem.

On Windows, main sets the channel-specific application ID
`com.faultirsoftworks.cashslothv3.<channel>` before creating windows, supplies the
ICO to `BrowserWindow.icon`, and supplies the same application ID/icon to
`setAppDetails` for the taskbar. This separates Development, Beta and Stable
taskbar identities as well as their existing data paths.

The architecture checker permits only branding **data assets** (`.json`, `.png`,
`.ico`) from the central directory in desktop/POS UI. Cross-package code imports
remain prohibited.

## Future Windows packaging

No packager, release or installer is introduced in this task. When Windows
packaging is implemented, use the same manifest and ICO for:

- Executable icon resources and shortcut icons.
- Installer and uninstaller icons where the chosen packaging tool supports them.
- The packaged channel's AppUserModelID and Start-menu/desktop shortcuts.

For example, electron-builder exposes `win.icon`, `nsis.installerIcon` and
`nsis.uninstallerIcon`; point them to the central ICO resolved from the project
root and set `appId` to the matching channel ID. Include the built
`dist/branding/generated/` runtime assets in the package. This is guidance for a
future packager, not an installed or validated packaging configuration.

Changing a running window icon does not replace the icon embedded in the
development `electron.exe`. Pinned pre-existing shortcuts and Windows icon caches
can continue displaying an old/executable icon. EXE resource embedding, installed
shortcuts, installer UI and multiple display DPI settings require packaging-stage
tests; they are not established by a successful development-window test.

References:

- [Electron image formats](https://www.electronjs.org/docs/latest/api/native-image#supported-formats)
- [Electron taskbar app details](https://www.electronjs.org/docs/latest/api/browser-window#winsetappdetailsoptions-windows)
- [electron-builder Windows configuration](https://www.electron.build/docs/win/)

## Executed Windows verification

On 2026-11-11, Windows x64 with Electron 45.3.0:

- The provided source and repository copy have identical SHA-256 hashes.
- All nine ICO entries have the expected dimensions, 32-bit PNG frames, correct
  offsets and complete payloads. Both PNG variants match their ICO frames.
- `pnpm check` passed: strict TypeScript, ESLint/boundaries, 39 Vitest tests,
  UI/host builds and actual Electron/Node smoke tests.
- Electron loaded the built PNG and the Windows shell decoded the ICO. The
  React logo loaded visibly in the top-left header; the screenshot was inspected.
- An expanded smoke run passed with `desktopCapturer` selecting the exact
  BrowserWindow media-source ID and fetching its native Windows application icon.
  The returned 48 px icon was saved and visually confirmed to show the official
  logo, not Electron's default. The native application-window capture was also
  inspected. These are ignored test artifacts under `test-results/`.
- A desktop-control inspection was inconclusive because window capture/focus
  changed during user activity; the targeted native capture above supplied the
  reliable icon evidence. A separate visual taskbar/pinned-shortcut/DPI-matrix
  inspection remains open. Taskbar app ID/icon properties are set in source;
  installer/EXE resource embedding is deferred as described above.

The interactive desktop launcher now allows its application window to be shown
normally instead of requesting hidden startup. Temporary manual-inspection
processes and their isolated data were cleaned up. An intermediate smoke run
lost its execution context; a subsequent complete run passed, including the
native icon capture. No unresolved check failure is being reported as passing.
