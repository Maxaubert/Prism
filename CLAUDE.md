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
- **A terminal change has its own gate: `npm run e2e:terminal`**, green in any PR that touches `packages/term-core/`,
  `termHost.ts` or the terminal wiring, before the full e2e (`terminal-gate.yml` runs it in CI). A terminal bug becomes a
  failing scenario FIRST, then the fix ([`docs/terminal-rules.md`](docs/terminal-rules.md#ratchet)).
- **A worktree needs `npm install` after its node_modules is copied** from main, so `node_modules/prism-term-core`
  links to THIS worktree's `packages/term-core` (`tools/check-core-link.mjs` fails otherwise, see
  [the trap](docs/terminal-rules.md#worktree-core-link)).
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
  version when a release should be NEW. CI gates are typecheck, lint (0 errors), unit tests and the Win+E self-tests (the e2e needs
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
- **Main never waits on the disk** (2026-10-12): no `*Sync` fs or process call in `src/main` on a
  live path. Startup, quit, worker code and sync-IPC answers mark theirs `// sync-ok: <reason>`;
  `syncCalls.test.ts` fails on an unmarked one.
- A new bundled binary or dependency adds its entry to `THIRD-PARTY-NOTICES.md` in the same PR.
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason. Current
  reasoned exceptions (all viewer-core, destined for `prism-core`): CodeMirror 6
  (`@codemirror/*` + `@lezer/highlight`, the code viewer), `react-markdown` + `remark-gfm` +
  `rehype-raw` + `rehype-sanitize` (markdown), `pdfjs-dist` (PDF), `heic-convert` (HEIC decode),
  `adm-zip` (the archive viewer; pure JS), `node-pty` + `@xterm/*` (the terminal, including
  `addon-search` for the scrollback), `exifr` (main-only, the photo's own EXIF). node-pty is the
  app's ONE third-party native module, ships N-API prebuilds, and must stay asarUnpacked. Prism's
  OWN addon is `native/sweep` (#338, the native sweep box; rules in its README), built from source
  by `npm run build:sweep` (dev dependency `node-gyp`, MSVC, `/MT`). Shells spawn with
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
- A terminal per tab (the core in `packages/term-core`), with local dictation (Right Alt).
- Prism on your phone: a LAN page that browses the whole PC like the Explorer and plays what it
  finds (read-only, paired, the user's own network).
- Resident single-instance app, update chip, Win+E replacement, opt-in file associations,
  opt-in "open folders from other apps" (Prism as Windows' folder handler, #393).
- 18 themes on one wall, one colour picker with alpha (see `docs/ui-direction.md`).
- **Out of scope (v1):** playlists / library / collections, editing, casting, streaming URLs,
  cross-platform. Plan and phases: `ROADMAP.md`; specs and plans: `docs/superpowers/`.

## Architecture (summary; full notes in `docs/architecture.md`)

Standard Electron three-layer split (`src/main`, `src/preload`, `src/renderer`), mirroring
Filesmith's conventions.

- **THE TERMINAL IS `packages/term-core`** (npm workspace `prism-term-core`, in this repo since 2026-10-23; Prism
  Terminal, which it came from, is retired). A DEV dependency on purpose: electron-vite compiles it into the app.
  A terminal fix is an ordinary Prism PR: no core version, no tag, no bump PR, and Prism's own version ships it
  (XTVERSION reports it). Imports stay `prism-term-core/...`. Its contract: `packages/term-core/README.md`;
  the rules (inert input, resume-only command, `onKey`, cells, ConPTY, the panel's ground, replies, quit, dictation)
  with their measurements: [`docs/terminal-rules.md`](docs/terminal-rules.md). Read both before touching the core.
- **The renderer's host differences are `src/renderer/src/termHost.ts`** (`TermHostConfig`, imported FIRST by
  `renderApp.tsx`; main's are the `registerTermIpc` / `registerDictationIpc` deps in `src/main/ipc/terminal.ts`): every way Prism
  differs is a field or a dep, never a fork. Settings > Terminal, Agents and Dictation are the core's
  sections; a terminal row written in `src/` is a fork, and the e2e `termOptions` fails on it. Adding a field is an
  owner decision. The core is lint-walled (relative imports only, no `window.prism`, `src/` or `electron`).
- **The gate and the ratchet**: `npm run e2e:terminal` (runner-safe, also in CI) guards the terminal. A bug a
  terminal change caused FIRST becomes a failing scenario (or core unit test), THEN gets fixed; a flaky check is a
  bug in the gate: fix the race, never retry around it.
- **Dictation is the core's**, armed only over a SHOWING terminal (Right Alt, set in `termHost.ts`); the engine ships
  as `resources/bin/whisper`; the microphone is the one extra permission. Rules: `docs/terminal-rules.md`. No command
  help, tab marks, orchestrator or dictation link in Prism (dropped 2026-10-23).
- **A page that works is not a page that looks right**: after moving UI between `src/` and `packages/term-core/`,
  LOOK at the `settings-*.png` screenshots `settingsLook` writes.
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
- `docs/architecture.md`: the full architecture notes (the terminal core in Prism, dictation, Win+E
  pipe protocol, settings frame stopgaps, sidebar side, reuse from Filesmith). Read before
  touching main/preload wiring, the terminal core, or Win+E.
- `docs/terminal-rules.md`: the terminal's must-not-regress rules and dictation rules, with measurements and owner
  quotes (copied from Prism Terminal), plus how the core and Prism fit. `npm run diag` reads the diagnostics log.
- `docs/build-and-conventions.md`: the full build, test, release and conventions notes, with the
  history and measurements behind each rule above. Read before changing the e2e, install or release flow.
- `docs/menus.md`: every right-click menu and its builder in `src/renderer/src/menus/` (one file
  per surface, a test pinning its rows). A menu is never an inline array in a component.
- `docs/dialogs.md`: every question and notice dialog in `src/renderer/src/dialogs/` (one file
  per dialog, a test pinning its text and buttons). A dialog is never inline in a component.
- `ROADMAP.md` for phases; `docs/superpowers/` for specs and plans.
