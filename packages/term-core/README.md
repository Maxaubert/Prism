# prism-term-core

What Prism keeps in a shared package: the settings frame and controls, the Diagnostics page and log, the update chip
with its window, colour maths and Tooltips. It lives in this repo as `packages/term-core`, an npm workspace named
`prism-term-core`; every import is `prism-term-core/...`. The name is a leftover: the terminal, agents and dictation
left the core on 2026-10-26 (owner decision, "Explorer only", see `docs/features.md`). A rename can follow.

## Where it came from

It began (2026-09-18) as the `core/` folder of Prism Terminal, shared by two apps through a pinned tag. On
2026-10-23 Prism Terminal was retired and the core moved into Prism. There is no core version, tag or release; a
change here is an ordinary Prism PR.

## What is in it

- `renderer/settings/`: the grouped-card frame (`layout/`: `SettingsFrame`, `SettingsSection`, `SettingRow`,
  `SettingBlock`, search, flash), the controls (`fields.tsx`, `ColourPicker.tsx`), `coreIndex.ts`, `sectionIds.ts`,
  `diagnosticsOptions.ts` and `sections/DiagnosticsPage.tsx`. Spec: `docs/superpowers/specs/2026-10-05-settings-redesign-design.md`.
- `renderer/components/`: `UpdateChip`, `UpdateDialog`, `Modal` (every dialog's frame), `Tooltips`, `layers.ts`
  (the overlay z-order). `renderer/lib/`: `updateFlow` + `useUpdateFlow`, `colour*`, `diag`, `tipPlace`, `hiddenTitle`.
- `main/`: the diagnostics log (`diagnostics`, `diagLog`, `stallWatch`, `memWatch`, `crashHooks`, `ipcTiming`,
  `diagIpc`), `updatePreview`, `atomicWrite`. `preload/diagApi.ts`, `shared/` (update types, release notes, `DGCH`).

## Contract

1. **Props only.** Components here never reach for a bridge; a host hands in what they need (the update chip takes
   the three preload members of `UpdateBridge`).
2. **Relative imports only.** No `@shared` / `@renderer` aliases (a bundler resolves an alias against ITS tree).
   No `window.prism`, no import from a host's `src/`, no `electron`. Prism's `eslint.config.js` enforces this.
3. **The update notes are plain text**: they come off the network, so they are parsed to strings and printed as
   text nodes; never HTML, never rendered markdown. **The update chip never changes width**, in any phase.
4. **The settings page**: the chosen rail item is a grey fill (`--p-hover-hi`), never the accent; a subtext is at
   most eight plain words. Rows carry `data-pref` and `data-setting-row`; sections `data-settings-section`.
5. **The colour picker**: one stored form (`#rrggbb` or `#rrggbbaa`); the DOM contract is the code field, the
   `[data-colour-swatch]` button and the `[data-colour-popover]` dialog. A host's window-level key listener must
   leave events from inside the popover alone.
6. **The diagnostics log**: `startDiagnostics` wires it in one call (call it before any IPC is registered);
   a host without `diagLogDir` logs nothing. Read it with `npm run diag`. Pass `appMetrics` for the
   `memory` crumbs, and call the page's `noteDiagBackground(minimised)` so its beat slows while the window
   is minimised (`watchWindow` slows main's watch to match from the window's own events). A host with
   several windows calls `watchWindow` for each: every page beats on its own (keyed by its webContents id,
   2026-10-29), the stack is asked of the page that went quiet, and a closed window is forgotten.
   A page may write `op` (an operation's outcome: `op`, `ok`, counts, `reason`, `ms`) and `note` (a note the
   user was shown: `text`, `op`, `title`, `level` error/warn/info) at every level (owner, 2026-11-06);
   Prism's fields are listed in its `docs/features.md`, #484.
7. A main-side file obeys "main never waits on the disk": a `*Sync` call is marked `// sync-ok: <reason>`.

## The log's kinds

Every line is `{t, up, src, k, ...fields}`: `t` UTC ISO, `up` ms since the process began (`performance.now()`),
`src` `main` or `page`. The core writes `session`, `quit`, `main-lag`, `fs-slow`, `ipc`/`ipc-slow`/`ipc-error`,
`page-stack`, `gone`, `unresponsive`/`responsive`, `memory` crumbs and `mem-high`, `verbose`, `mark`; a page writes
the kinds `diagIpc.ts` lets it (`page-stall`, `page-task`, `page-error`, `page-rejection`, `crumb`, `op`, `note`, an
app's own `-slow`). `npm run diag` lists `PROBLEMS` and every `-slow` kind (`tools/lib/diagProblems.mjs`).

Host fields and Prism's own kinds (owner, 2026-11-06; `docs/features.md` "Standby, the hotkey path and startup in
the log"):

- `session` + the host's `sessionFields`: Prism adds `created` (the OS start of the process, epoch ms), `bootMs`
  (from it to this line), `reason` (`win-e`, `file`, `folder`, `plain`), `winE` (the request's first 8
  characters), `browse`.
- `quit` + `reason` when the host passes one to `stop(reason)`: `user`, `last-window`, `update`, `session-end`,
  `gave-up`.
- `page-stall` + the host's `pageInfo`: Prism adds `win` (the window's key, `w1`...), `hidden` (nobody could see
  it; then not a problem), `spare`.
- Prism's `op` lines also carry films (2026-11-08): `op: 'film'` (page, one per event: `ev` `route`, `first-frame`,
  `error`, `no-picture`, `black`, `to-live`, `live-open`, `live-error`) and `op: 'live-job'` (main: `ev` `start`, `exit`,
  `kill`, `encoder-fallback`); `ok: false` is a problem. `docs/features.md`, the .mov entry.
- `standby(on)` parks the stall watch (its tick and canary timers stop). Prism writes `standby` lines: `ev`
  `enter` (`failed` parts), `rest` (`trimmed`, `processes`, `privateMb`, `workingSetMb`, `mainMb`, `gpuMb`,
  `pageMb`), `wake` (`why`, `restedMs`).
- Prism's `startup` (one per launch or wake): `reason` (also `standby-wake`), `from`, the marks `ready`, `made`,
  `readyToShow`, `shown`, `listed`, `restored`, `winEAck` as `up` ms, `shownMs`/`listedMs`/`winEMs` from `from`,
  `partial` after 30 s, `winE`/`via` for a wake.
- Prism's `win-e`: `ev` `received` (`path` cold/warm/standby, `via` argv/second-instance/pipe, `browse`),
  `dispatched` (`host`, `ms`), `shown` (`ms` from received, `win`), `acked` (`ms`), `dropped` (`reason`
  expired/window-closed), `repeat` (`action` follow/raise, `leader`), `pipe-error`. `id` is 8 characters.
- Prism's `second-instance` (`via`, `winE`, `args`, `standby`), `lock-lost` (a process that lost the
  single-instance lock: its `pid`, `created`, `bootMs`, `winE`), `session-end`, and the problems `raise-slow`
  (`ms`, `showMs`, `focusMs`, `why`; over 200 ms), `spare-slow` (`phase` make/ready, `ms`, `gaveUp`) and
  `window-make-slow` (`ms`, `win`, `spare`).

CSS: the core uses Tailwind utilities and the `--p-*` tokens Prism defines. A new token needed here is added there.

## How Prism consumes it

Root `package.json` has `"workspaces": ["packages/*"]` and the devDependency `"prism-term-core": "*"`, which npm
links as `node_modules/prism-term-core`. A DEV dependency on purpose: electron-vite bundles dev dependencies into
the app. Prism's build needs `resolve.dedupe: ['react', 'react-dom']` and `optimizeDeps.exclude: ['prism-term-core']`
in `electron.vite.config.ts`, and `@source '../../../packages/term-core'` in `src/renderer/src/index.css`.
Plain `.ts` settings modules that `exports` do not reach (`coreIndex`, `sectionIds`, `layout/icons`,
`diagnosticsOptions`) are resolved by exact specifier through `CORE_TS` in `electron.vite.config.ts` and
`vitest.config.ts`, and the paths in `tsconfig.web.json`.

**A worktree must relink the package.** A copied `node_modules` still links to main's folder; run `npm install`
in the worktree. `tools/check-core-link.mjs` fails `test`, `typecheck`, `build`, `e2e` and `package` otherwise.
