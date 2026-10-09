# Prism

A fast, universal media viewer for Windows. Open a file, view or play it, arrow through the
rest of the folder. The "quick look" Windows never shipped.

## What it is

Electron (Windows App via electron-builder) + React 19 + TypeScript + Vite + Tailwind v4, x64
only, Windows 10 1809+ / Windows 11. Self-contained NSIS installer, per-user, unsigned,
distributed via GitHub Releases. Same stack as its sibling **Filesmith**, on purpose.
**Proprietary since v0.80.0** (#247, Wind's licence; v0.79.1 and earlier stay MIT): what ships
is listed in `THIRD-PARTY-NOTICES.md`, so a new bundled binary or dependency adds its entry in
the same PR. Setup's licence screen keeps Continue dead until the box is ticked, and never
opens the licence from `$PLUGINSDIR` (`build/installer/README.md`).

## Audience

Anyone who double-clicks a file and wants it open now, looking good. Prism replaces the
mediocre built-in Windows Photos / Media Player for everyday viewing. Not a pro tool, not a
library manager, not an editor.

## Build, test, release

- `npm run dev` / `npm test` for the inner loop; `npm run typecheck`, `npm run lint`.
- `npm run e2e` drives the built app through Playwright. `npm run e2e -- <name>` runs only the
  scenarios whose name contains `<name>`; each scenario has its own try/catch, and the run ends
  with a pass/fail/duration table.
- **THE E2E STAYS HEADLESS** (owner, 2026-10-03): it runs OFFSCREEN (`tools/e2e/run.mjs` `park()`:
  opacity 0, at -4000,-4000, off the taskbar) and never takes the foreground (`--e2e` makes the
  window `focusable: false` and `showInactive()`). Anything added to the e2e goes in
  `tools/e2e/run.mjs` and keeps that nature. Every scenario REAPS the processes it leaves (matched
  by profile path only, so the machine's own Prism is never touched): one leaked app holds the
  single-instance lock and fails every scenario after it.
- **THE E2E IS THE PR GATE AND NOTHING ELSE; AN INSTALL RUNS NONE** (owner, 2026-09-02 and
  2026-10-03): while iterating, the scenarios that cover the change; before a PR is opened or
  pushed, the whole suite. Agents and workflows follow the same split.
- **Bumping the `prism-term-core` pin has its own gate: `npm run e2e:terminal`**, required green in
  that PR before the full e2e (see Architecture).
- **A TEST RUN LEAVES NOTHING IN %TEMP%** (2026-09-28): `vitest.global.ts` points TEMP at one
  folder and removes it after, so a new test may mkdtemp freely.
- **New file type? Standing step:** if the change adds an extension, it goes in
  `src/shared/fileKind.ts` AND `build/installer/assoc.nsh` (both the install and the uninstall
  halves), or Windows never offers Prism for it. `src/shared/fileAssoc.test.ts` enforces the
  parity and names what to add, so `npm test` answers "did I remember?". Bare names
  (`Dockerfile`) and dotfiles cannot be registered: Windows associates on extension.
- **Releasing is automated** (2026-08-21): `.github/workflows/release.yml` builds and publishes on
  every push to main. A new `package.json` version creates release `v<version>` with generated
  notes; a push on an existing version replaces that release's installer in place. Bump the
  version when a release should be NEW. CI gates are typecheck + unit tests only (the e2e needs
  this machine). Unsigned, per-user, GitHub Releases.
- **Installing is the LAST verification step, every time work is finished**, after typecheck,
  lint and unit tests, and not something to ask about first. "Install" means: `npm run package`,
  kill every Prism AND every Prism-Setup, run `dist/Prism-Setup-x64-<version>.exe /S` (per-user,
  no elevation; never `Start-Process -Wait`, it hangs), then POLL `Prism.exe`'s LastWriteTime
  until it changes (it goes MISSING part way, during the uninstall phase), launch the app only
  after the setup process has gone, and report the installed version. A version string alone
  can be the previous build.

### Security walls (do not loosen without a decision)

- **The root wall covers `fsmedia://` and `fsaudio://`** (2026-08-28): media is served only from a
  root, an archive member main extracted on request, or something main made itself (a converted
  copy, a synthesised MIDI wav), each registered as handed over. A markdown document grants
  exactly the image files it names (`src/main/docImages.ts`). The app's OWN asset tree stays
  servable: pdf.js fetches cmaps, fonts, wasm and icc profiles over `fsmedia://` in the packaged
  build.
- Native dialogs are parented to the window (unparented, a fullscreen picker never shows).
- `file:text` is capped (64MB), awaited, and answers with a REASON, never null: a file Prism could
  not read is shown as unreadable and can never be saved over.

## Conventions

- TypeScript, `sealed`-by-default mindset, small focused files, feature-not-layer organization.
- Follow Filesmith's patterns (aliases `@shared`/`@renderer`, eslint/prettier config, IPC shape,
  frameless TopBar) so `prism-core` drops into both apps cleanly.
- No em-dashes anywhere (use en-dashes, commas, or parentheses).
- A new bundled binary or dependency adds its entry to `THIRD-PARTY-NOTICES.md` in the same PR.
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason. Current
  reasoned exceptions (all viewer-core, destined for `prism-core`): CodeMirror 6
  (`@codemirror/*` + `@lezer/highlight`, the code viewer), `react-markdown` + `remark-gfm` +
  `rehype-raw` + `rehype-sanitize` (markdown), `pdfjs-dist` (PDF), `heic-convert` (HEIC decode),
  `adm-zip` (the archive viewer; pure JS), `node-pty` + `@xterm/*` (the terminal, including
  `addon-search` for the scrollback), `exifr` (main-only, the photo's own EXIF). node-pty is the
  app's ONE native module, ships N-API prebuilds, and must stay asarUnpacked. Shells spawn with
  node-pty's bundled conpty.dll (`useConptyDll: true`): the OS conhost FAST-FAILS the whole app
  (0xc0000409, no dialog) when a pty is killed mid-read (crashed 2026-08-21).
- A feature decision is recorded in `docs/features.md` (the look in `docs/ui-direction.md`) in the
  file's voice: what the owner decided, the date and issue, and what test holds it.

## Working with me

This is a bounded product: a viewer. When a request drifts toward a library, an editor, or
general media management, ask before assuming. Especially anything that changes the viewer
chrome, the file-association behavior, or the `prism-core` interface (which Filesmith also
depends on). The look: quiet chrome so the media is the star; no new theme system or editing
tools without an explicit decision (rules in `docs/ui-direction.md`).

## Current scope (summary; the full record is `docs/features.md`)

- A universal quick-viewer: image, video, audio (with visualizer), PDF, office and ebook
  documents, code and text (CodeMirror, always editable, saves in place), markdown, comics,
  archives (zips browse as ordinary folders).
- Explorer tab (folder browser with places and preview), project tabs with a file tree, folder
  navigation with arrow keys, search with operators, rename / delete / move, right-click on
  every surface.
- A terminal per tab (from `prism-term-core`), with local dictation (Right Alt).
- Prism on your phone: a LAN page that browses and plays what the PC has open.
- Resident single-instance app, update chip, Win+E replacement, opt-in file associations.
- 18 themes on one wall, one colour picker with alpha (see `docs/ui-direction.md`).
- **Out of scope (v1):** playlists / library / collections, editing, casting, streaming URLs,
  cross-platform. Plan and phases: `ROADMAP.md`; specs and plans: `docs/superpowers/`.

## Architecture (summary; full notes in `docs/architecture.md`)

Standard Electron three-layer split (`src/main`, `src/preload`, `src/renderer`), mirroring
Filesmith's conventions.

- **THE TERMINAL COMES FROM `prism-term-core`** (#154): the `core/` folder of
  github.com/Maxaubert/PrismTerminal, a DEV dependency pinned to a `core-v*` tag and compiled into
  the app. **Do not recreate a local copy of a file the core owns** (`terminal`, `shells`,
  `termPrompt`, `agentDetect`, `termCwd`, `TerminalPanel`, `TermFind`, `termLook`, `termTheme`,
  `agentTitle`, `agentClock`, `termActivity`, `termAnsi`, `termBus`, `termPaste`, `termPrefs`,
  `recentRoots`): a terminal fix is made in PrismTerminal's `core/`, tagged, and picked up here by
  bumping the pin. Its contract and build lines are in that repo's `core/README.md`. Prism is a
  HOST: `src/renderer/src/termHost.ts` (imported FIRST by `main.tsx`) declares the only
  differences. Settings > Terminal, Agents and Dictation are the core's sections; a terminal row
  written here is a fork, and the e2e `termOptions` fails on it.
- **The pin gate**: `npm run e2e:terminal` is REQUIRED green in any PR that moves the core tag, and
  runs in CI (`.github/workflows/terminal-gate.yml`). Keep it RUNNER-SAFE (nothing may assume this
  machine). Core bumps MERGE THEMSELVES when green, so the gate is the only reviewer: a bug that
  reaches Prism through a bump FIRST becomes a failing scenario in `e2e:terminal`, THEN gets fixed.
  A flaky check is a bug in the gate: fix the race, never retry around it.
- **Dictation is the core's**; its rules live once in PrismTerminal's CLAUDE.md. Prism arms it
  only over a SHOWING terminal; the engine ships as `resources/bin/whisper`; the microphone is the
  one extra permission (audio only, camera refused).
- **No command help in Prism** (2026-09-22): the core's popup is Prism Terminal's alone.
- **Settings** (#292) is the core's grouped-card frame; Prism's part is `components/settings/`
  (`appOptions.ts` is a CLOSED list of Prism's rows). Descriptions are plain words, at most eight
  (`settings/settingsCopy.test.ts`). The chosen rail page is grey, never the accent.
- **The viewer lives here for now.** The planned shared package `prism-core` (also for Filesmith's
  previews) is not extracted. Filesmith and Prism never depend on each other at runtime.

## Docs

- `docs/features.md`: the full feature history and every per-feature rule (performance rules,
  phone, terminal, Explorer, media, installer). Read the matching entry before changing a feature.
- `docs/ui-direction.md`: the look (themes, colour picker, panels, toolbar). Read before any
  visual change.
- `docs/architecture.md`: the full architecture notes (core terminal contract, dictation, Win+E
  pipe protocol, settings frame stopgaps, sidebar side, reuse from Filesmith). Read before
  touching main/preload wiring, the core pin, or Win+E.
- `docs/build-and-conventions.md`: the full build, test, release and conventions notes, with the
  history and measurements behind each rule above. Read before changing the e2e, install or release flow.
- `ROADMAP.md` for phases; `docs/superpowers/` for specs and plans.
