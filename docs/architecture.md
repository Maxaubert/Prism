# Architecture

The full architecture notes, moved verbatim from `CLAUDE.md` on 2026-10-09. `CLAUDE.md` keeps a
summary of the rules; this file has the history, the measurements and the details.

## Architecture

Standard Electron three-layer split (`src/main`, `src/preload`, `src/renderer`), mirroring
Filesmith's conventions.

- **THE TERMINAL COMES FROM `prism-term-core`** (2026-09-19, #154; owner: the terminal in Prism and
  the sibling app Prism Terminal "should be synced"). The core is the `core/` folder of
  github.com/Maxaubert/PrismTerminal, consumed as a DEV dependency pinned to a `core-v*` tag (dev on
  purpose: electron-vite compiles dev dependencies INTO the app, so it ships as part of the bundle
  and nothing extra is packaged). It is TypeScript source, compiled by Prism's own Vite and checked
  by Prism's own tsc. **Do not recreate a local copy of a file the core owns** (`terminal`, `shells`,
  `termPrompt`, `agentDetect`, `termCwd`, `TerminalPanel`, `TermFind`, `termLook`, `termTheme`, and
  the renderer libs `agentTitle`, `agentClock`,
  `termActivity`, `termAnsi`, `termBus`, `termPaste`, `termPrefs`, `recentRoots`): a terminal fix is
  made in PrismTerminal's `core/`, released as a tag, and picked up here by bumping the pin. Its
  contract, and the build lines it needs here (`resolve.dedupe`, `optimizeDeps.exclude`, the
  `@source` line in `index.css`), are in that repo's `core/README.md`. The core's unit tests run in
  PrismTerminal's CI; Prism's gate on it is `tsc` and the terminal e2e scenarios. PRISM IS A HOST
  of the core: `src/renderer/src/termHost.ts` (imported FIRST by `main.tsx`, since App's module
  graph is evaluated before `main.tsx`'s body) declares every place Prism differs from Prism
  Terminal. What differs is only what MUST: the terminal follows the app style by default
  (styles exist only here), "acrylic" means letting the style's material show through and has no
  opacity slider (the style owns the glass), and Prism's own chords. Everything else is the same
  by owner decision (2026-09-19): the indicator is MINIMAL by default and its colours follow the
  accent, the panel paints the ground (so the dock paints nothing behind it), and a theme pick
  never resets Minimal / Full nor does a saved theme carry it. The panel, find, `termLook`,
  `termTheme`, the agent poll, the resume lookup, the bridge to main (`createTermApi` in the
  preload, `registerTermIpc` in main, which takes Prism's WALL as three small answers), the
  indicator's rules (`useAgentIndicator`, which was lifted out of this App), its colours
  (`useAgentColors`), the close rule (`agentClose`) and **the terminal's SETTINGS** all come from
  the core. Settings > Terminal and Settings > Agents are the core's sections (`ShellSection`,
  `TerminalTextSection`, `TerminalThemeSection`; `AgentMarksSection`, `ClaudeCodeSection`,
  `MarkColoursSection`) and nothing else (#292): "the setting names, types, how they function"
  are shared, the VALUES are this app's own. A terminal row written here instead of there is a
  fork, and the e2e `termOptions` goes red on it (it compares the two pages with the core's
  `settings/options.ts`, order checked per section, as Prism Terminal's `options` does).
  **BUMPING THE PIN HAS ITS OWN GATE: `npm run e2e:terminal`** (owner, 2026-09-19: "we need to
  run some automated tests that confirm that the terminal in Prism still works, since it has more
  failure points due to its larger footprint"). It builds and runs every scenario the terminal
  can break (terminal, termOptions, termCwd, agentTitle, handoffOverTerm, promptLayout, tabs, sort,
  pinRecent, and since #168 updateWindow, updateGuard and updateQuiet, because the update chip and
  its window come from the same core; about four minutes, plus 20s MEASURED for those three, which
  was 50s until review found 30 of them were one `locator.click()` waiting out its timeout on a
  notice that had already left) and is REQUIRED, green, in any PR that moves the `prism-term-core`
  tag, before the usual full e2e. **IT ALSO RUNS IN CI** (`.github/workflows/terminal-gate.yml`, #164;
  owner, 2026-09-19: "we need automated tests to confirm it never conflicts"): on any PR that moves
  the pin or touches the terminal's wiring, on a GitHub Windows runner, MEASURED green 3 runs of 3
  (173 checks, about six minutes, real dictation included). That is what lets PrismTerminal's
  `core-release` workflow open a bump PR that proves itself. KEEP THE GATE RUNNER-SAFE: nothing in
  those scenarios may assume this machine (a real `claude` CLI is skipped where absent; no path may
  be expected to sit under the Users folder). BUMPS MERGE THEMSELVES when every check is green (owner,
  2026-09-19; PrismTerminal's `PRISM_AUTO_MERGE`), so THE GATE IS THE ONLY REVIEWER, and the
  owner's rule for it is a ratchet: "if it ever creates a bug in only one app, we'll make a test
  that it needs to pass, so the automation gets more and more secure over time." A bug that
  reaches Prism through a core bump FIRST becomes a scenario here that fails on the broken build
  (in `e2e:terminal`, runner-safe), THEN gets fixed. And a FLAKY check in the gate is a bug in the
  gate: fix the race, never retry around it. The first automatic bump (#165) was held by exactly
  one, a scrollback check that read a re-attached xterm before it repainted.
  **A GATE CAN BE LANDED BEFORE THE CORE HAS THE FEATURE** (#253): `termColourPicker` drives the
  core's colour picker (alpha on the working colour, the Full tab's ink on the composite, Escape
  putting back an unset row, no alpha on the theme Background here) and SKIPS while
  `node_modules/prism-term-core/renderer/settings/ColourPicker.tsx` is missing, by the file and
  never a version, so the first bump that carries the picker is gated on it. `termOptions` checks
  the RULE for `onlyWhere` rows (every one absent), not that there is exactly one.
- **DICTATION IN THE TERMINAL IS THE CORE'S TOO** (2026-09-19, #162; owner: "make sure this feature
  is synced and part of the core and should be the same in normal Prism, with dictation as its own
  tab there too"). Hold Right Alt over a SHOWING terminal, speak, release: the words are pasted at
  the shell's cursor, never sent, transcribed on this PC by whisper.cpp. Every rule of it (off means
  off, local only, pinned checksums, Right Alt as a solo hold because it is AltGr on a Norwegian
  keyboard, live text shown and only the final pasted) is written down ONCE, in PrismTerminal's
  CLAUDE.md under DICTATION; do not restate or fork them here. What is Prism's own:
  - **A media viewer first.** App arms the core with the shell that is SHOWING, or with null, so
    Right Alt over a film, a PDF or the tree does nothing (`useDictationArm` in App.tsx; the e2e
    holds the key with no terminal up and asserts no pill and no process).
  - **Settings > Dictation**, its own page, is the core's `DictationPage` whole.
    Values are this app's; the model files are shared with Prism Terminal in
    `%LOCALAPPDATA%\PrismDictation`, so a model downloaded there is installed here.
  - **The engine ships in the installer**: `npm run fetch:whisper` runs the CORE's script
    (`node_modules/prism-term-core/tools/fetch-whisper.mjs`) into `vendor/whisper`, packaged as
    `resources/bin/whisper` (a folder of its own: its ggml DLLs must not sit among ffmpeg's). It
    carries Microsoft's C++ runtime app-local. It is the terminal's THIRD bundled binary reason
    after ffmpeg and 7-Zip, and like them is never committed.
  - **The microphone is the one new permission.** Main grants `media` for audio only, to Prism's
    own windows; the camera is refused. Everything else keeps Electron's default, deliberately: a
    closed list in an app this size would be a guess.
  - The pill lives in `TermDock`'s terminal box, the mic mark in `TabStrip`; both are core
    components that read the dictation store themselves, so speaking re-renders neither App nor
    the strip. `dictation` and `dictationPage` are in `npm run e2e:terminal`.
- **NO COMMAND HELP IN PRISM** (2026-09-22, owner: "command help shouldn't be part of Prism the
  normal app, only the terminal app"; reverses #175). The core's popup is Prism Terminal's alone:
  Prism mounts no `HelpPanel`, its terminal menu has no row, Settings has no switch, and F1 is the
  shell's (termHost's `ownsKey` no longer claims it). `noCommandHelp` in the e2e proves all three.
- **REMEMBER TABS IS A SETTING** (2026-09-22, owner: "Prism should also have the option to not
  remember tabs"). Settings > Explorer > Reopen tabs at start, on by default (how Prism always started), key
  `prism.tabs.remember` (`lib/tabRestorePrefs.ts`). Off, a COLD start opens only the Explorer tab
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
- **THE TERMINAL ROWS COME IN ONE ORDER, THE CORE'S** (2026-09-22, owner: the two apps' terminal
  settings "the same in terms of order"). The core's sections draw them; `termOptions` reads each
  core section (`[data-settings-section]`) top to bottom against `TERMINAL_OPTIONS`, as Prism
  Terminal's `options` does. The restore's claude lookup
  is the core's async one now (`claudeSessionsAsync`), which is Prism's half of the launch freeze.
- **SETTINGS DESCRIPTIONS ARE PLAIN WORDS** (2026-09-22, owner: "no symbols other than comma and
  dot, no mentioning of specific keys or tips, just a simple text description of what it does").
  Every hint on Prism's own pages was rewritten to that rule, the core's rows likewise in the core.
  Since #292 a subtext is also at most EIGHT words (`subTooLong`), and labels pass `labelProblem`:
  `settings/settingsCopy.test.ts` reads every file of `components/settings/`.
- **THE SETTINGS PAGE IS GROUPED CARDS, ON THE CORE'S FRAME** (#292; owner, 2026-10-05, approved
  v1 "Grouped cards" with no accent bar on the chosen rail item; spec and plan: PrismTerminal
  `docs/superpowers/specs/2026-10-05-settings-redesign-design.md`, PT side PrismTerminal#135).
  Rail: Find a setting, Appearance, Explorer, Project settings, Terminal, Agents, Dictation, Media,
  (spacer) About;
  Media's Visualizer | Progress bar switch is in its header. The frame, sections, rows, controls,
  search and flash are prism-term-core's (`renderer/settings/layout`, `sections`, `fields`); Prism's
  part is `components/settings/`: the pages, `appOptions.ts` (a CLOSED list of Prism's own rows,
  their subtexts and storage keys, the keys a snapshot in `appOptions.test.ts`: none changed),
  `settingsIndex.ts` (page order and what Find a setting indexes: the core's rows drawn here, no
  command help, the GPU row only with an NVIDIA card) and `icons.ts` (Prism's own row icons beside
  the core's). Every row carries `data-pref`; live state (Win+E's status, the Explorer menu
  check, the band opacity, a chosen folder) is the row's SUBTEXT. The chosen rail page is a GREY
  fill (`--p-hover-hi`), never the accent. Settings' Escape yields while Find a setting holds text
  (`[data-settings-find][data-owns-escape]`), and App gives Settings its plain keys (Up and Down
  walk the rail, not the folder behind). `colorScheme` on the overlay follows the style's mode,
  since `:root` says dark and the core's warning ink is `light-dark()`. Two STOPGAPS for the
  core, each to go when the core fixes it: the core's `exports` reach no plain `.ts` settings
  module, so `coreIndex`, `sectionIds` and `layout/icons` are resolved by exact specifier in
  `electron.vite.config.ts` (`CORE_TS`), `vitest.config.ts` and `tsconfig.web.json`; and the
  frame's `compact` classes lose in the cascade to its base ones, so `index.css` gives
  `[data-settings-compact]` the rail width. `settingsLook` (in `e2e:terminal`, runner-safe:
  contrast, grey rail, Save the only accent button, row and tile size, panel corners from the
  style's roundness, Large text, narrow and compact rail, screenshots of every page in both
  schemes) and `settingsSearch` (every indexed row found by its label and opened) hold it.
  **PROJECT SETTINGS IS ITS OWN PAGE, AND THE TREE ALWAYS FOLLOWS THE OPEN FILE** (#296; owner,
  2026-10-06: "project specific settings should be in a tab called project settings not in
  explorer. and remove the setting for scroll to open file, it should just be on by default, no
  setting"). `ProjectPage.tsx` holds Sidebar position (the tree's) and First view of a new project; Folder for
  new tabs stays on Explorer, since the + and Ctrl+T open an Explorer tab. Scroll to the open file
  is gone and a stored `prism.tree.autoscroll` is ignored.
- **SIDEBAR POSITION IS TWO SETTINGS: THE EXPLORER'S PLACES AND THE PROJECT TREE, AND THE PREVIEW
  TAKES THE OTHER SIDE** (#304; owner, 2026-10-07: "fix the setting in Explorer for the sidebar where
  you can put it on the right side or the left side? I think that's just an empty setting for now,
  but actually implement it. And remember that when the sidebar goes on the right, the preview menu
  and button to open it would have to go on the left"; then, the same day, after testing one shared
  row: "No, it should be two settings, one on the project tab and one on the explorer tab").
  Explorer > Layout opens with `explorer-side` (key `prism.explorer.side`, `lib/explorerSidePrefs.ts`,
  default Left): the Explorer tab's places panel, and nothing else. Project settings keeps
  `tree-side` (key `prism.tree.side`, unchanged): the project tree, and nothing else. Neither moves
  the other; App reads the Explorer's for an Explorer tab and the tree's for a project tab
  (`workspaceSide`), and each panel peeks from its own. On the Explorer's Right:
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

## Reuse from Filesmith (becomes `prism-core`)

These already exist in Filesmith and are the seed of `prism-core` (extracted in Phase 1):

- `src/renderer/src/components/PreviewWindow.tsx`: the image/video/PDF viewer shell.
- `src/renderer/src/components/AudioVisualizer.tsx`: the circular Web-Audio visualizer.
- `src/main/index.ts` `serveMedia` + the `fsmedia://` privileged scheme (Range/206 streaming).
- `src/shared/fileKind.ts`: extension → kind.
- `src/main/thumbnail.ts` + `Util/IconHelper` equivalents: thumbnail/decoded-image fallback.
