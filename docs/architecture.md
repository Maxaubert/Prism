# Architecture

The full architecture notes, moved verbatim from `CLAUDE.md` on 2026-10-09. `CLAUDE.md` keeps a
summary of the rules; this file has the history, the measurements and the details.

## Architecture

Standard Electron three-layer split (`src/main`, `src/preload`, `src/renderer`), mirroring
Filesmith's conventions.

- **EXPLORER ONLY** (owner, 2026-10-26; the record and the tests that hold it are in `docs/features.md`). The
  terminal, dictation and project tabs with their file tree are gone. Before that, `packages/term-core` was the
  terminal (2026-10-23, from the sibling Prism Terminal); it is PRUNED now to what Prism still uses: the settings
  frame and controls, the Diagnostics page, the update chip and window, the diag log, colour maths and Tooltips.
  The workspace keeps its name `prism-term-core` and its imports (`prism-term-core/...`); a rename can follow.
  It is a DEV dependency on purpose (electron-vite compiles it into the app), lint-walled (relative imports only,
  no `window.prism`, `src/` or `electron`), and `tools/check-core-link.mjs` (`pretest`, `pretypecheck`, `prebuild`,
  `e2e`, `package`) fails when `node_modules/prism-term-core` does not link to THIS checkout's `packages/term-core`
  (a worktree needs `npm install` after its node_modules is copied). Its contract: `packages/term-core/README.md`.
  Do not recreate a local copy of a file the core owns. Moved out of the core into `src/`: `recentRoots` (same
  storage keys), the permission handler (all `media` denied) and `openExternal`.
- **THE UI GATE: `npm run e2e:ui`** runs the runner-safe scenarios (settingsLook, diagLog, tabs, sort, pinRecent,
  updateWindow, updateGuard, updateQuiet); `.github/workflows/ui-gate.yml` runs it in CI. KEEP IT RUNNER-SAFE:
  nothing in those scenarios may need this machine's files, GPU or audio. A UI bug first becomes a scenario that
  fails on the broken build, then gets fixed.
- **REMEMBER TABS IS A SETTING** (2026-09-22, owner: "Prism should also have the option to not
  remember tabs"). Settings > Explorer > Reopen tabs at start, on by default (how Prism always started), key
  `prism.tabs.remember` (`lib/tabs/tabRestorePrefs.ts`). Off, a COLD start opens only the Explorer tab
  and whatever Prism was opened with: main reads the key from the window preferences store in
  `restoreWhenListening`, once per process (`coldRestoreDone`), so a reload of the window keeps its
  tabs. The tabs are still SAVED while it is off, so switching it back on loses nothing. Agent
  sessions are not resumed while it is off; they stay on disk. Proved in the `tabs` scenario.
- **WIN+E WAITS FOR A COLD START** (2026-09-22, owner: after a boot Win+E opened File Explorer until
  Prism had been run once). Two causes. (1) Windows starts the per-user Run entry that launches the
  helper late and one entry at a time, MEASURED at 48 seconds after the desktop appeared on this
  machine; before that there is no hook and Win+E is Windows' own. A per-user install cannot start
  it earlier without admin rights, so that first minute is a known limit, not fixed. (2) The helper
  gave Prism 8 seconds to answer, and a cold Electron start after boot takes longer, so it fell back
  to File Explorer. Now TWO STAGES over the one pipe connection the helper's server accepts: main
  writes "<id> started" the moment it has the request (`announceWinE`, called from the request
  queue's `enqueue`) and holds the socket open; `acknowledgeWinE` writes "<id>" down the SAME socket
  when the folder browser shows. The helper keeps 8 seconds for the first line, then waits up to 45
  (`LaunchAndWait`'s `patience`), and falls back at once if the pipe closes because Prism died. The
  helper and the app ship together; an old helper would read "started" as a wrong answer, which is
  why they must. `npm run test:win-e` holds the helper's three new cases.
- **WIN+E OPENED FILE EXPLORER TOO, AND SOMETIMES ONLY IT** (#350; owner, 2026-10-11: "it will
  almost always open both prism and file explorer"). MEASURED by playing the helper's part against
  the installed app: Prism wrote "started" and its socket closed 4 ms later. The helper's server only
  READS (`PipeDirection.In`), so Node's end sees end-of-file at once, and with the default
  `allowHalfOpen: false` it closed the held socket; the helper took the close for a dead Prism and
  opened File Explorer beside the Prism it had started, on every press. `announceWinE` connects
  half-open now; `winERequests.test.ts` holds it against a real .NET read-only pipe. In the helper,
  the 500 ms lifecycle check (registry and file reads) moved OFF the hook's thread, where a slow read
  could hold the hook past `LowLevelHooksTimeout` (the key then reaches Explorer, and repeated
  timeouts make Windows drop the hook silently), the hook is re-armed every 15 s, and the helper
  keeps `logs\win-e.log` in the profile: start, stop, late presses, and how each request ended.
- **SETTINGS DESCRIPTIONS ARE PLAIN WORDS** (2026-09-22, owner: "no symbols other than comma and
  dot, no mentioning of specific keys or tips, just a simple text description of what it does").
  Every hint on Prism's own pages was rewritten to that rule, the core's rows likewise in the core.
  Since #292 a subtext is also at most EIGHT words (`subTooLong`), and labels pass `labelProblem`:
  `settings/settingsCopy.test.ts` reads every file of `components/settings/`.
- **THE SETTINGS PAGE IS GROUPED CARDS, ON THE CORE'S FRAME** (#292; owner, 2026-10-05, approved
  v1 "Grouped cards" with no accent bar on the chosen rail item; spec and plan: the archived PrismTerminal repo's
  `docs/superpowers/specs/2026-10-05-settings-redesign-design.md`, #135 there).
  Rail: Find a setting, Appearance, Explorer, Media, Diagnostics,
  (spacer) About;
  Media's Visualizer | Progress bar switch is in its header. The frame, sections, rows, controls,
  search and flash are prism-term-core's (`renderer/settings/layout`, `sections`, `fields`); Prism's
  part is `components/settings/`: the pages, `appOptions.ts` (a CLOSED list of Prism's own rows,
  their subtexts and storage keys, the keys a snapshot in `appOptions.test.ts`: none changed),
  `settingsIndex.ts` (page order and what Find a setting indexes: the core's rows drawn here, no
  command help, the GPU row only with an NVIDIA card); Prism's own row icons beside the core's are
  `components/icons/settingsIcons.ts`. Every row carries `data-pref`; live state (Win+E's status, the Explorer menu
  check, the band opacity, a chosen folder) is the row's SUBTEXT. The chosen rail page is a GREY
  fill (`--p-hover-hi`), never the accent. Settings' Escape yields while Find a setting holds text
  (`[data-settings-find][data-owns-escape]`), and App gives Settings its plain keys (Up and Down
  walk the rail, not the folder behind). `colorScheme` on the overlay follows the style's mode,
  since `:root` says dark and the core's warning ink is `light-dark()`. Two STOPGAPS for the
  core, each to go when the core fixes it: the core's `exports` reach no plain `.ts` settings
  module, so `coreIndex`, `sectionIds` and `layout/icons` are resolved by exact specifier in
  `electron.vite.config.ts` (`CORE_TS`), `vitest.config.ts` and `tsconfig.web.json`; and the
  frame's `compact` classes lose in the cascade to its base ones, so `index.css` gives
  `[data-settings-compact]` the rail width. `settingsLook` (in `e2e:ui`, runner-safe:
  contrast, grey rail, Save the only accent button, row and tile size, panel corners from the
  style's roundness, Large text, narrow and compact rail, screenshots of every page in both
  schemes) and `settingsSearch` (every indexed row found by its label and opened) hold it.
  Project settings (#296) is gone with the project tabs (2026-10-26); a stored `prism.tree.side` or
  `prism.tree.autoscroll` is ignored.
- **SIDEBAR POSITION IS THE EXPLORER'S PLACES SIDE, AND THE PREVIEW TAKES THE OTHER SIDE** (#304; owner, 2026-10-07: "fix the setting in Explorer for the sidebar where
  you can put it on the right side or the left side? I think that's just an empty setting for now,
  but actually implement it. And remember that when the sidebar goes on the right, the preview menu
  and button to open it would have to go on the left"; then, the same day, after testing one shared
  row: "No, it should be two settings, one on the project tab and one on the explorer tab").
  Explorer > Layout opens with `explorer-side` (key `prism.explorer.side`, `lib/prefs/explorerSidePrefs.ts`,
  default Left): the Explorer tab's places panel, and nothing else. The project tree's twin
  (`tree-side`, key `prism.tree.side`) went with the tree on 2026-10-26; the key is dead. On the Explorer's Right:
  `.folder-browser[data-side='right']` is a three-column grid (preview, list, places;
  the preview column 0px while shut, so its slide still tweens one column), the places come after
  the list in the DOM (Tab walks left to right), the preview toggle LEADS the address row (before
  Back, the end nearest the pane), the viewer laid over the slot sits at `left: 0`
  (`.browse-workspace[data-sidebar-side='right']`), each grip is its left twin turned round
  (`ExplorerResize`'s `edge`: a drag toward the middle widens), and the places peek from the right
  edge. Left is the window as it was, box for box. The `explorerSide` e2e holds it (it fails on
  main), one coat of a see-through ground included, and that each row moves only its own panel.


- **The viewer lives here for now.** The plan is a shared package, **`prism-core`**, which
  would also power Filesmith's previews, but it has not been extracted: `ImageView`,
  `VideoView`, `AudioView`, `Visualizer` and the `fsmedia://` protocol are all in this repo
  today. When it is extracted, the split is:
  - `prism-core` owns: the image / video / audio / PDF / text viewer React components, the
    audio visualizer, the `fsmedia://` streaming protocol (Range-aware, so `<video>`/`<audio>`
    can seek), file-kind detection, and thumbnail generation.
  - Prism owns: the window/tray/resident lifecycle, open-file routing (argv / drag / dialog /
    associations), folder navigation, settings, and packaging.
- **Filesmith and Prism never depend on each other at runtime.** They only share `prism-core`,
  which each bundles at build time. A user with Filesmith does not need Prism, and vice versa.
- **Renderer folders** (structure cleanup, 2026-10-12): every React hook (`use*.ts`) lives in
  `src/renderer/src/hooks/`, never in `lib/`. `lib/` groups by feature: `code/` (language,
  lint, prefs, theme, jsonc), `pdf/`, `drag/`, `tabs/` (the tab model, crumbs, restore, volume,
  width), `prefs/` (`createPref` and the small pref stores), `viz/` (with `vizStore`),
  `themes/`. What belongs to no group stays flat in `lib/`.
- **Single homes** (structure cleanup, 2026-10-12): one module per shared job. Use it, never a
  local copy.
  - localStorage read that never throws: `src/renderer/src/lib/storage.ts` (`readStored`).
  - paths: `src/shared/path.ts` (`baseName`, `parentDir`, `extOf`, `trimSep`, `pathKey`,
    `samePath`, `isInside`, and the one natural-order collator `naturalCompare` / `byName`).
    Pure strings, so the phone uses it too; not the root wall (that stays canonical, in main).
  - which files are markdown: `isMarkdown` in `src/shared/fileKind.ts`.
  - main's small fs answers: `src/main/fsUtil.ts` (`exists`, `sleep`, `isBusyError`).
  - a file written whole or not at all: `writeAtomic` / `writeAtomicSync` (quit only) in
    `src/main/latestWrite.ts`, beside `latestWriter`. Every state file goes through them.
  - userData paths: `src/main/paths.ts` (`userPaths.tabs()`, `.converted()`, `.comics()`, ...).
  - a small newest-N cache: `src/main/lru.ts` (`createLru(max)`; `get` touches, `peek` does not).
  - colour maths on hex: `src/renderer/src/lib/colour.ts` (`hexToRgb` reads the first six digits,
    `rgbToHex`, `mix`, `luminance`, `contrast`); tests import it, never a copy. Computed CSS colours
    are `cssColour.ts`, the stored accent alpha `accentAlpha.ts`.
  - a saved setting: `src/renderer/src/lib/prefs/createPref.ts` (`createPref({ key, parse, fallback })`
    gives `get` / `set` / `use` / `subscribe`; storage that refuses never throws). Every `prism.*`
    key and whether it travels between windows: `src/shared/prefKeys.ts`; the window sync's local
    keys derive from it, and `prefKeys.test.ts` pins the strings. A new key goes there first.
    `theme.ts` and `vizStore.ts` keep their own stores.
  - a module value components follow: `src/renderer/src/lib/store.ts` (`createStore`; jobs,
    extraction, the cut mark).
  - "is the user typing, or is the key somebody else's": `src/renderer/src/lib/focusGuards.ts`
    (`isTypingTarget`, `isFormField`, `isTextBox`, and the `FIELD` / `EDITOR` / `OVERLAY` /
    `NAV_SURFACE` selectors a key handler joins). The lists are pinned by `focusGuards.test.ts`.
  - a document viewer's Ctrl+F (who owns it in split view): `src/renderer/src/hooks/useFindShortcut.ts`.
  - the spinner and a viewer still loading: `components/LoadingState.tsx` (`Spinner`, `LoadingState`).
  - a line over the whole stage (an error, a score being synthesised): `components/StageNotice.tsx`.
  - a popover's way out (press outside, blur, Escape): `src/renderer/src/hooks/useDismiss.ts`.
  - the modal shell (scrim, box, Escape, focus on the primary button): `components/Modal.tsx`;
    `Dialog` and `PropertiesDialog` wrap it. The look stays in `dialogLook.ts` (with
    `DIALOG_EMPHASIS`, the name inside a question), which `ExtractWindow` shares.
  - `clamp`: `src/renderer/src/lib/clamp.ts`.
  - the archive verbs (password retry, add with Keep both and the move's binning, extract,
    rename, the permanent delete) and every line they say: `components/archive/archiveOps.ts`,
    with their questions in `useArchiveOps.tsx`. The member panel (ArchiveView) and a zip in
    the Explorer or tree (`useArchiveActions`) both use it. adm-zip's write cap is
    `src/shared/archiveLimits.ts` (`ZIP_WRITE_MAX`), read by main and the renderer.
  - renaming in place (the tree, an archive's member rows): `components/RenameField.tsx`; in a
    dialog (the Explorer, a zip member there, an archive's own Rename): `browse/BrowseRename.tsx`.
    The stem selection is `lib/selectStem.ts`.
  - pasting files into a folder (Explorer and tree), with every line it says: `hooks/useFilePaste.ts`
    (`useFilePaste`, `PASTE_MESSAGES`, `pasteMessage`).
  - the unsaved-changes question (closing, installing, closing a tab):
    `dialogs/UnsavedDialog.tsx`; App's `saveAllThen` and `discardTabBuffers` answer it.
  - every question and notice dialog: `src/renderer/src/dialogs/` (one file per dialog, a test
    beside each; App's `Ask` union and `AskDialogs`). Index: `docs/dialogs.md`.
  - App's parts by job (structure cleanup, stage 11): the title bar `components/titlebar/`
    (`TopBar`, `TitleButtons`); the stage's views `components/stage/` (`Viewer`, `EmptyState`); the file operations and undo/redo over them `hooks/useFileOps.ts`, with the
    inverse of each undo entry in `lib/undoApply.ts` (`undoEntry`, `redoEntry`; `undo.ts` stays
    the pure stack); leaving the window and the update install `hooks/useWindowClose.ts`;
    fullscreen and its fade `hooks/useFullscreenVeil.ts`; the window's keys `hooks/useAppKeys.ts`;
    the tabs (new, close, recent,
    pick, reorder) `hooks/useTabOps.ts`; the session's tab and shell ids
    `lib/sessionIds.ts`.
  - the archive panel's parts (ArchiveView.tsx): `components/archive/` (`useArchiveListing` the
    members and the reload, `useBandSelect` the drag-select band, `entry.ts` the row shape and
    columns, `MemberView`, `LockBadge`, `RenameInput`, `ArcVerb`; the verbs stay
    `archiveOps.ts` / `useArchiveOps.tsx`).
  - which viewer a file kind gets, and the lazy viewer chunks: `components/ViewerSwitch.tsx`, with
    a mode per host (`full` App's stage, `phone`, `member` an archive panel's preview). The host
    passes what an archive is (App's card, the phone's panel, a nested panel).
  - icons: `components/icons/`. A line glyph is `<Icon name | d size weight>` (`Icon.tsx`, with
    `FolderFill` and `Gear`) over `paths.ts` (`PATHS`, every drawing used twice, stated once;
    `paths.test.ts` fails on a path string written out a second time). The families keep their
    modules there: `FileMenuIcon`, `BrowseIcon`, `PlaceIcon`, `TabKindIcon`, `propertyGlyphs`,
    `settingsIcons`, `transport`, `menuGlyphs` (`menuIcon`, `tickIf`), and `FileIcons`
    (`KindIcon`, `FolderIcon`, `iconColour`). The generated file-kind art stays `lib/iconPaths.ts`.
  - the root wall: `src/main/pathWall.ts` (`createPathWall`; `readable`, `editable`, `movable`,
    `archiveOk`, `archiveReadOk`, `comicOk`, `insideWall`, `mediaAllowed`, and the grants main
    makes itself). Every handler asks it; `pathWall.test.ts` pins each guard. Never loosen one.
  - a worker main talks to (lazy start, pending map, a minute idle then killed, a dead one fails
    what it held): `src/main/workerClient.ts` (`createWorkerPool`). The HEIC decoder
    (`heicClient.ts`), the zip worker (`zipClient.ts`) and the document worker (`docClient.ts`)
    sit on it.
  - fsmedia://: `src/main/mediaProtocol.ts` (`createMediaServer`, Range answers, walled by
    `mediaAllowed`). Content types: `src/main/mime.ts` (`mediaMime`, the phone page's `assetMime`,
    `HLS_MIME`).
  - the bundled programs: `src/main/bundledTools.ts` (`ffmpegTools()`, `sevenExe()`,
    `fluidTools()`), never `findFfmpeg(app.isPackaged, ...)` spelled out.
  - what several parts of main share about the app right now (the window, unsaved text, a
    working agent, the close answer, an install or quit under way): `src/main/appState.ts`
    (`appState`, and `E2E`). Read and written in place, never copied out.
  - main's concerns out of index.ts: `windowChrome.ts` (window state, material, borderless
    fullscreen, DWM border, `raise`, the window:* messages), `tabsSession.ts` (restore, save,
    flush the strip), `updateFlow.ts` (the offer and update:*), `dialogs.ts` (parented native
    dialogs, `pickFolder`, `pickFiles`), `phone/index.ts` (`startPhoneService`, pos:*).
  - the IPC handlers, by area: `src/main/ipc/` (`window`, `open`, `files`, `browse`,
    `props`, `media`, `archive`). Each is a `registerXIpc(ctx)` that index.ts's whenReady calls
    in the order the handlers were always registered; `ctx` (`MainCtx`) is index.ts's shared
    state and helpers, `ready` (`ReadyCtx`) what whenReady makes. A new handler goes in its
    area's file, never back into index.ts. Push to the page with `sendToPage`, check a sender
    with `isMainSender` (`appState.ts`).
  - IPC channel names: `src/shared/channels.ts` (`PUSH` main to page, `CALL` page to main,
    `SWEEP_CHANNELS`). Main and the preload never spell a channel as a string;
    `channels.test.ts` fails on a bare one and on an entry one side lacks. The diagnostics
    channels (`DGCH`) stay the core's.
  - what the bridge answers: `src/shared/ipcTypes.ts` (`FileStat`, `PhotoInfo`, `SubtitleTrack`,
    paste, move and archive results, progress payloads, `HostCapabilities`); the extraction
    results (`ExtractFailure` and the per-route answers) in `src/shared/extraction.ts`. Main
    returns them, the preload promises them, the phone shim answers them.
  - the preload's listener and sync-ask shapes: `subscribe<T>(PUSH.x)` and `syncOr(CALL.x,
    fallback)` in `src/preload/index.ts`.
  - the phone's wire: `src/shared/phoneWire.ts` (`ROUTE` names, the `/pair` `/api/` `/m/` `/hls/`
    prefixes, `PlayAnswer`, `Me`, the stat, pos and tab answers). The page's fetch helpers are
    `phone/api.ts` (`getJson`, `getOr`, `postJson`, `postFireAndForget`).
  - build scripts: `tools/lib/pinnedDownload.mjs` (every SHA-256-pinned fetch, its `.source`
    stamp and flat unzip, and the e2e's `.e2e/cache`), `tools/lib/csc.mjs` (the C# helpers),
    `tools/lib/msvc.mjs` (vswhere, vcvars64, dumpbin), `tools/lib/repo.mjs` (`ROOT`,
    `windowsOnly`). The pins stay in each `tools/fetch-*.mjs`, where the CI cache key reads them.
  - e2e harness, inside `tools/e2e/run.mjs`: `until` (the one poll), `startApp` (every launch),
    `launchWith(env, file)` (env for one launch), `explorerTab`/`writeTabs` (tab seeds),
    `seedPreferences`, `powershell`/`processCount`, `setPref`/`styleKeeper` (theme and pref
    save-restore).
  - unit-test stand-ins: `src/renderer/src/testing/host.ts` (`aliasWindow`, `setHost`/`clearHost`,
    `capabilityHost`, `fakeClipboard`).

## Reuse from Filesmith (becomes `prism-core`)

These already exist in Filesmith and are the seed of `prism-core` (extracted in Phase 1):

- `src/renderer/src/components/PreviewWindow.tsx`: the image/video/PDF viewer shell.
- `src/renderer/src/components/AudioVisualizer.tsx`: the circular Web-Audio visualizer.
- `src/main/index.ts` `serveMedia` + the `fsmedia://` privileged scheme (Range/206 streaming).
- `src/shared/fileKind.ts`: extension → kind.
- `src/main/thumbnail.ts` + `Util/IconHelper` equivalents: thumbnail/decoded-image fallback.
