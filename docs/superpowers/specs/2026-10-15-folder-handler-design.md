# Open folders in Prism instead of File Explorer (#393)

Owner, 2026-10-15 (asked through Prism Terminal, filed as #393): path links clicked in
Prism Terminal open folders in File Explorer; they want Prism. Prism Terminal must not know
Prism exists. Decision: Prism makes itself Windows' folder handler, behind a setting that is
**off by default**. Files are untouched.

## What was measured (2026-10-15, this machine, a logging stand-in, registry restored byte-identical after)

A stand-in command was registered as the HKCU default verb and each way of opening a folder
was tried:

| Opened by | `Directory` default verb | `Drive` | `Folder` |
|---|---|---|---|
| `Start-Process <folder>` (ShellExecuteEx, no verb) | caught | | |
| `cmd /c start "" <folder>` | caught | | |
| `shell:Downloads` | caught (as Directory) | | |
| `Start-Process C:\` | not caught | caught | |
| Control Panel (`control.exe`) | | | caught |
| `explorer.exe <folder>` | not caught (expected: no verb) | | |
| Electron `shell.openPath(folder)` | **not caught** | not caught | not caught |
| Electron `shell.openExternal(file://folder)` | not caught | | |
| `rundll32 shell32.dll,ShellExec_RunDLL <folder>` | not caught | | |

Electron's `openPath` was also tried against HKCU overrides of `Directory`/`Folder` `open`
and `explore`: none was hit. **Electron opens folders without any shell verb**, so no
registry entry can catch Prism Terminal's clicks as it stands.

Consequences:
- Prism registers `Directory` and `Drive` only. **Never `Folder`**: that is Control Panel,
  This PC, Recycle Bin and every other shell namespace.
- Prism Terminal needs one change (owner, 2026-10-15: yes): open a folder through the
  default verb (ShellExecuteEx with no verb), the measured route above. It still names no
  app: whatever the user picked for folders gets it, Explorer by default.
- Not measured: a double-click on a folder INSIDE an Explorer window or on the desktop
  (the screen was in use). It is checked by hand before the PR is opened, and the setting's
  description says what was found.

## Design

### Registration (HKCU only, reg.exe with argument lists, like `shellVerb.ts`)

For `C` in `Directory`, `Drive`:
- `HKCU\Software\Classes\C\shell\PrismBrowse`, label "Open" (it becomes the bold default
  row of the folder menu, where Windows' own "Open" was; whether `ProgrammaticAccessOnly`
  can hide a duplicate row while still serving as the default is measured in step 1),
  `command` =
  `"<launcher>" --folder "<Prism.exe>" "<profile>" "%1"`.
- `HKCU\Software\Classes\C\shell` default value = `PrismBrowse`.
- Before writing, the current HKCU default (normally unset; another file manager may own it)
  is saved as `PreviousDefault` on the `PrismBrowse` key, so turning off restores exactly
  what was there. The state lives in the registry, never only in memory.

Off (setting off, or the uninstaller): for each class, only if the default is `PrismBrowse`,
put `PreviousDefault` back (or delete the value when there was none), then delete the
`PrismBrowse` key. A default owned by another app is never touched.

### The launcher: Prism never leaves folders unopenable

The command does not point at Prism.exe. It points at the Win+E helper
(`native/win-e/PrismShortcut.cs`) with a new `--folder` command, **copied outside the install
folder** to `%LOCALAPPDATA%\Prism\folders\PrismShortcut.exe` when the setting is turned on.
It reuses the helper's existing Win+E handshake:
- start Prism with `--user-data-dir=<profile> --browse=<UUID> "<path>"`, wait for the ack
  on `\\.\pipe\PrismWinE.<UUID>`;
- Prism.exe missing, a failed launch, or no ack within 8 s: open `explorer.exe "<path>"`.

So a Prism folder deleted by hand, a crash or a hung start still opens the folder (in
Explorer). The uninstaller removes the registration and the copied launcher.

`%1` for a drive is `C:\`, and a quoted `"C:\"` reaches the CRT parser as `C:"`. The
launcher reads its own raw command line (`GetCommandLineW`) for the last argument and
normalises a trailing `"` back to `\`. A unit test in `tools/test-win-e.mjs` holds it.

### Prism's side

- `--browse=<UUID> <path>`: open `<path>` in the **Explorer tab** (as Win+E does, not as a
  project), focus the window, then ack. The second-instance and cold-start paths both take
  it (`winERequests.ts` already handles the first-ready race for Win+E).
- A path that is not a folder, or is gone, is opened by the launcher fallback, never by Prism
  guessing.
- No loop: Prism's own "Show in File Explorer" uses `shell.showItemInFolder`/`openPath`,
  which take no verb (measured above), so they still open File Explorer.

### The setting

Settings > Explorer > Windows, beside "Open file / Open as project":
- label **Open folders in Prism**, description (at most eight words) **Instead of File
  Explorer, everywhere in Windows** (adjusted by what the double-click check finds).
- Off by default. The switch reads the registry back, like the Explorer-menu switch.
- Startup repair (packaged builds only, never dev/e2e): when the user turned it ON (a marker
  in userData, the one fact worth storing) and the registration is missing or points at an
  older exe/profile, rewrite it. An upgrade's old uninstaller removed it; this puts it back.
  Without the marker nothing is ever written.

### Installer

`build/installer/assoc.nsh` uninstall half: the conditional restore above (NSIS
`ReadRegStr`/`WriteRegStr`/`DeleteRegValue`), delete the `PrismBrowse` keys and the copied
launcher. On an upgrade (`isUpdated`) the registration is KEPT, as the Win+E helper's is,
so folders never fall back to Explorer during an update; the launcher copy is refreshed by
the startup repair.

### Prism Terminal (separate PR in PrismTerminal `core/`)

`core/main/termPathOpen.ts`: a folder opens through the default verb, not `shell.openPath`.
Measured route: ShellExecuteEx with no verb. From Node without a shell parsing the path:
`powershell -NoProfile -NonInteractive -Command "Start-Process -LiteralPath $env:P"` with the
path in an env var (no command-line injection), or a call into a native helper if the core
has one. On failure it falls back to `shell.openPath`. Its own `e2e:terminal` covers it.
Prism picks it up through the usual core bump.

## Tests

- Unit: `folderHandler.test.ts` pins the reg argument lists (add, restore with and without
  `PreviousDefault`, never touching a foreign default), the status read-back and the startup
  repair rule (no marker, never writes).
- Launcher: `tools/test-win-e.mjs` gains `--folder` cases: missing Prism falls back to
  Explorer (recorded, not opened), drive path `C:\` survives quoting.
- e2e: `folderHandler` scenario starts the app with `--browse=<UUID> <fixture folder>` and
  checks the Explorer tab shows that folder and the ack is written. It never writes the real
  registry (the switch's registry calls are recorded under `--e2e`).
- By hand, once, before the PR: turn it on, then double-click a folder in Explorer, on the
  desktop, `Win+R` a path, click a path in Prism Terminal (after its PR), turn it off and diff
  the registry against a backup.

## Out of scope

Files (`.mp4` keeps its app), the `Folder` class, Win+E (its own switch), and any change to
how Prism's own "Show in File Explorer" behaves.
