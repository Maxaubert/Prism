# Prism

A fast, universal media viewer for Windows. Open a file, view or play it, arrow through the
rest of the folder. The "quick look" Windows never shipped.

## What it is

Electron (Windows App via electron-builder) + React 19 + TypeScript + Vite + Tailwind v4, x64
only, Windows 10 1809+ / Windows 11. Self-contained NSIS installer, per-user, unsigned,
distributed via GitHub Releases. Same stack as its sibling **Filesmith**, on purpose.

## Audience

Anyone who double-clicks a file and wants it open now, looking good. Prism replaces the
mediocre built-in Windows Photos / Media Player for everyday viewing. Not a pro tool, not a
library manager, not an editor.

## UI direction

Dark, quiet viewer chrome so the media is the star: near-black frameless window, a single
indigo accent (`#5b5bd6`), minimal controls that fade when not needed. The Prism monogram +
indigo tie it to the Filesmith family without copying its light utility look. Don't add a
light theme or editing tools without an explicit decision. The file-tree sidebar (2026-07-31)
was such a decision: a navigation panel bounded by the folder Prism opened in, not a library.

## Scope

**In scope (v1, the universal quick-viewer):**

- Open via: a file argument (Explorer double-click / "open with" / CLI), drag-and-drop, and an
  open dialog.
- **Image** viewer: fit / zoom / pan / rotate / fullscreen; common formats natively, exotic
  formats via a decode fallback.
- **Video** player: play / pause / seek / volume / fullscreen, frame-step, and a transport
  settings cog (2026-08-12): speed, loop, autoplay (next video in the folder, skipping other
  kinds), sidecar subtitles (`.srt`/`.vtt` matched by name beside the file or in `Subs/`,
  SRT converted to WebVTT; embedded MKV tracks deliberately out until a demuxer decision).
  Chromium ships no Dolby Digital (AC-3/E-AC-3), DTS or TrueHD decoder, so many MKV rips
  played picture-only. Prism DECODES THEM ITSELF (2026-08-24, owner decision to bundle):
  `vendor/ffmpeg` (BtbN's LGPL SHARED build, fetched by `tools/fetch-ffmpeg.mjs` against a
  pinned tag + SHA-256, never committed, ~128MB into `resources/bin`) feeds an `fsaudio://`
  stream that a hidden `<audio>` plays beside the picture. The trick is a FIXED PCM shape
  (48kHz/16-bit/stereo = 192000 bytes a second), so byte N is always second (N-44)/192000:
  Range requests are answered by starting ffmpeg at that timestamp, which makes a live
  transcode seek like a file - no temp files, no waiting. The video element needs no muting
  (it cannot decode the track either); the sidecar follows its clock and corrects drift by
  nudging playbackRate 2%. Codec choice is an ALLOWLIST of what Chromium plays, so an unknown
  codec gets decoded rather than silently lost. LGPL, not GPL, and shared, not static: the
  AC-3/DTS/TrueHD DECODERS are LGPL, and replaceable DLLs are what the licence asks for -
  which is also why the e2e fixtures encode with `libopenh264` (there is no libx264 here).
  The note that says Prism cannot help now appears only when no ffmpeg was found at all.
- **Audio** player: play / seek / volume, a live circular visualizer, cover art, and the same
  settings cog (speed, loop, autoplay next track). Loop/autoplay/subs-wanted persist.
- **PDF / document** viewer: first-party pdf.js viewer (2026-08-08): continuous canvas pages,
  zoom/fit, text selection, own Ctrl+F (no Chromium PDF UI). The zoom baseline is rebased
  (2026-08-12): 1.9 pdf.js units is the default and the pill calls it 100%. Markdown renders formatted
  (react-markdown, sanitized inline HTML, remote badges).
- **Code / text** viewer (2026-08-17): CodeMirror 6, always editable (see below). ~20 Lezer
  grammars give highlighting, folding and real syntax-error squiggles; `@codemirror/legacy-modes`
  adds ~100 stream lexers for highlighting only, so those languages never claim an error.
  Deliberately no semantic diagnostics: without a tsconfig or node_modules they would be noise.
  Every language loads on demand (one Vite chunk each). Prose (`.txt`, `.log`, `.csv`, subtitles)
  gets no gutter and no language. Token colours are fixed in `index.css`, NOT part of a style.
- **Archive viewer** (2026-08-22, #68): open a `.zip` onto its manifest - the archive's own
  SYSTEM icon (the user's association, via app.getFileIcon, one fetch per extension; the
  amber parcel is only the loading/no-handler fallback, its picker deliberately removed),
  name and totals, with the members in a bounded panel. Navigation is Explorer-shaped:
  clicking a folder walks INTO it, the crumb row (fixed height, so the panel never jumps)
  or Backspace climbs out - no collapsible tree, and NO hover quick-verbs (tried twice,
  rejected twice). Verbs are right-click + F2/Delete: view (extracted to a temp file main
  grants individually, shown with the ordinary viewers), copy out (real clipboard), rename,
  delete. Member delete is the ONE permanent delete in Prism (a zip has no Recycle Bin) and
  the dialog says so. Passwords: asked once per archive and remembered; ZipCrypto opens via
  adm-zip, AES members go through a DETECTED 7-Zip (7z.exe at its standard install paths,
  args-only execFile - the same enumerated-exe rule as "Open in"), and without 7-Zip they
  say so honestly. zip only; 7z/rar containers are out until a fresh decision. Oversized
  archives (>600MB) list but refuse member operations. Properties on a zip reports what it
  holds, how much it saved, and its encryption (2026-08-22).
- **Folder navigation**: from the opened file, page through sibling viewable files (arrow
  keys). The navigation-scope filter (all / group / per-type, 2026-07-31) was REMOVED
  2026-08-20: a forgotten filter read as missing files. Do not reintroduce it without a
  fresh decision. A sort menu sits in the sidebar header (2026-08-12, Playnite-shaped: one
  asc/desc pair, then name / date modified / size / type); tree rows and arrow-paging share
  the order. Documents own their
  vertical keys: Up/Down and PageUp/PageDown scroll or flip pages in pdf/text; Left/Right
  always page the folder. **FOCUS decides the vertical keys, for every kind, and nothing
  auto-focuses a document any more** (2026-08-17): opening a pdf, a README or a code file
  takes no focus, so Up/Down and PageUp/PageDown keep paging the folder while you browse from
  the sidebar. Click into the document (or Tab to it) and it owns them: the pdf flips pages,
  the page scrolls, the caret moves. Escape hands them back without closing the window.
  Documents mark their scroller `data-doc-scroller`; App's `docFocused()` is the single test,
  and there is deliberately no kind-based DOC set any more. A window-level key listener in a
  viewer (PdfView's page keys, CodeView's Ctrl+S/Ctrl+F) must check focus itself.
- **File tree sidebar** (`Ctrl+B`): collapsible panel rooted at the folder Prism was opened in;
  expand subfolders, click a file to view it. The root is a wall: main refuses paths outside it.
  **Keyboard-navigable (2026-08-17)**: the arrows drive a cursor over the flattened visible rows
  (`fileTree.visibleRows` / `stepRow`, pure and tested), folders included. Up/Down step every
  row and walk into expanded folders; Left/Right keep meaning previous/next FILE, and become
  the chevron while the cursor is on a folder. Landing on a file opens it, landing on a folder
  only moves the highlight. ONE mark, not two: the filled accent belongs to the cursor and
  follows it onto folders; the open file is deliberately left unmarked while the cursor is
  elsewhere (`aria-selected` still names it). The cursor row is the tree's single tab stop (roving `tabIndex`),
  so Enter and Space are the row button's own activation, with no key handling for them
  anywhere. Sidebar lends the whole thing to App through `onNav`, returning false when there is
  no tree to drive (panel shut, search showing, end of tree) so App pages the folder instead.
- **Rename + delete from the tree** (F2 / Delete / right-click, files and folders, decided 2026-08-01).
  Nothing is destroyed: deleting and overwriting both go via the Recycle Bin, a taken name asks
  (cancel / replace / keep both), and names are validated first. The session root itself can never
  be renamed or binned.
- **Context-menu verbs** (2026-08-12): "Open in" (a submenu of the apps Windows registers for that
  extension, from the registry, plus the Windows chooser; main only launches exes it enumerated
  itself), Show in File Explorer, Copy path, Copy file (real clipboard drop via PowerShell),
  Duplicate (Explorer-style "name (2)" naming).
- **Text edits in place** (2026-08-17, replacing the 2026-08-12 edit mode): every text file is
  simply editable where it sits, Ctrl+S to save. The pencil now belongs to **markdown alone**,
  the one kind with a rendered form to toggle away from; code and `.txt` have none, so a mode
  switch there was meaningless chrome. **Unsaved text lives in App, keyed by path**
  (2026-08-18), not inside the editor: leaving a file keeps it, so switching files asks
  NOTHING and coming back shows your edits rather than what is on disk. Every dirty file is
  starred and bold in the tree, not just the open one. The only thing that can destroy the
  work is closing, so only closing asks: main mirrors the renderer's dirty flag and blocks
  `win.on('close')` until the user answers **Cancel / Discard / Save all changes** (which
  covers Alt+F4 and the taskbar, not just the X). A failed write cancels the close and names
  the file rather than closing over the top of it.
  **Undo and redo** (2026-08-22, `lib/undo.ts`, pure and tested): Ctrl+Z / Ctrl+Y (and
  Ctrl+Shift+Z) reverse Prism's own file writes - move, rename, bin, duplicate - and a
  quiet pill says what went back. Undo NEVER asks and never overwrites: it puts things
  beside whatever appeared meanwhile ('keep-both'), and a binned file comes back through
  the shell's Recycle Bin namespace (MoveHere, not the localised Restore verb). Behind the
  typing guard, so a focused editor and the terminal keep their own Ctrl+Z. Archive-internal
  writes are deliberately NOT on the stack (a member delete is permanent anyway).
  Prism's writes are therefore: rename, bin,
  duplicate, the editor's save, and the archive's member verbs (rename/delete inside a
  zip, 2026-08-22). Anything further (move, new folder) is a fresh decision, not a
  natural next step - except MOVE, which was decided (2026-08-22, #70) and is reachable
  ONLY by dragging: a row (or a whole multi-selection) dropped on a folder row moves there,
  taken names asking cancel / keep both / replace. The same drag crosses surfaces: sidebar
  rows dropped INTO an open archive are added to the zip at that folder, archive members
  dropped on a sidebar folder are extracted there (sharing the archive's remembered
  password via `lib/archivePass`), members dropped on an archive folder move inside the
  zip, and files dragged from EXPLORER onto the archive panel are added to it. Folders
  travel whole on every route. Rebuilding a password-protected zip is refused rather than
  risked (adm-zip would re-emit those entries wrongly), and dropping on the window at
  large still just opens the file. Multi-select WAS that fresh decision too (2026-08-22): shift ranges and
  ctrl toggles select WITHOUT opening, in the tree and the archive alike (drag-to-select
  was tried and REMOVED the same day: dragging is for moving, and the sweep's pointer
  state outlived real drags); right-click inside a multi-selection acts on all of it (copy
  files, copy paths, delete N with one question). The tree KEEPS its quick-look single
  click - a plain click still opens a file or expands a folder (double-click-to-open was
  tried and rolled back the same day; only the ARCHIVE is double-click, where single
  click selects). Contiguous selected rows fuse (shared edges drop their rounding).
  Search results speak the same selection language, multi right-click included.
  Tabs reorder by dragging along the strip (`reorderTabs`, pure and tested), with a
  hairline showing where one would land.
  Selection is the accent fill (`data-selected`); `aria-selected` still means the OPEN
  file, which is what the e2e leans on. Keyboard unchanged: arrows land-and-open, Enter
  opens, F2/Delete act on the row (Delete takes the whole selection when the row is in
  one).
- **Open a folder, and project tabs** (2026-08-20): the root used to be inferred from
  whatever file arrived and there was only ever one. A title-bar button and `Ctrl+T` now
  choose a folder, and several roots stay open as tabs. **A tab is a root and a current
  file, nothing else** - no per-tab settings, no pinning, no list you curate. A file
  arriving from outside reuses a tab whose root already holds it (five photos from one
  folder is one tab), otherwise spawns one, otherwise fills the empty window. Tabs persist
  in `tabs.json`; a root that is gone is dropped without a word. The strip is present from the
  FIRST tab, so the `+` is always reachable and the chrome never shifts when a second folder
  opens; it goes only when nothing is open at all. **Two folder buttons, two verbs**: the
  strip's `+` (and `Ctrl+T`) ADDS a tab instantly (its RIGHT click offers the last five folders
  Prism has been opened in, newest first, deduped, read fresh each time - history, not a list
  to curate; a folder that has gone drops out on the attempt), rooted at the user's home folder with no
  dialog, and spawns unconditionally (pressing + must never appear to do nothing); the
  sidebar's folder button (on the search row, left of the search box, away from sort/filter
  which narrow rather than change) opens the chooser and REPLACES the current tab root. Rerooting onto a folder another tab already holds switches there instead,
  keeping one tab per root. `Ctrl+W` closes a tab and the
  last one leaves an EMPTY WINDOW rather than quitting: Prism is resident and a window that
  vanishes under a reflex keystroke is the failure the close flow exists to prevent.
  Closing a tab holding unsaved text asks, like the window does.
  The root wall is a set now (`src/main/roots.ts`), not one string. Navigation handlers
  (`open:within`, `dir:list`, `search:files`) name their root and get the strict per-tab
  check; everything else checks `insideAnyRoot`. The renderer owns the tab list and reports
  it, which is what narrows the wall when a tab closes.
- **A terminal, one per tab** (2026-08-20): opens FULL VIEW (the viewer steps aside but
  stays mounted, so scroll/zoom/playback survive) via `Ctrl+\``, `Ctrl+Shift+T`, or the
  sidebar FOOTER-row button (a new bottom row, one button so far). SPLIT is the deliberate
  arrangement, menu-only (no hotkey, 2026-08-21): right-click a file, "Open in split view"
  PINS file panes (up to 4 windows, FIFO, direction flyout with memory); the terminal's own
  split docks bottom/top/left/right (right-click menus), resizable. Ctrl+W closes
  innermost-first: pinned panes pop LIFO, then the tab itself. The terminal wears the style (reads
  --p-bg/--p-text/--p-accent-hi live): void means a black terminal. Right-clicking the
  terminal button offers split view and Clear terminal. The agent indicator has two
  volumes (owner picks, 2026-08-23): MINIMAL runs an indeterminate line along the tab's
  bottom edge while an agent works and says nothing else - no finished state, that is
  full's alone; FULL fills the tab with the working colour, and holds the finished colour
  until the tab is visited. Syntax highlighting and history
  ghost-suggestions (RightArrow accepts, Up/Down recalls) are PSReadLine's, forced on at
  spawn - including `-EnableScreenReaderMode:$false`, because automation tooling
  false-positives the system screen-reader flag and PSReadLine then silently drops to a
  plain renderer (diagnosed 2026-08-20; a real screen-reader user gets a Settings knob if
  ever asked for). cwd starts at the tab's root; hiding keeps the shell running; exit,
  tab close, or quit kill it; rerooting keeps it. A tab whose terminal was SHOWING at quit
  reopens as a terminal (tabs.json remembers the view; the shell itself is fresh) - a
  Claude-session tab must not come back as an empty viewer (2026-08-21). And a shell that
  HOSTED CLAUDE at quit resumes the conversation BY SESSION ID: main reads the newest
  session claude recorded for the folder (~/.claude/projects) and launches the shell with
  `claude --resume <id>` as its STARTUP command - never typed on screen, never a bare
  --continue guessing (no session on disk = no resume). That is the ONE command Prism
  ever writes itself - an explicit owner exception (2026-08-21) to the line below,
  claude AND codex (2026-08-23): claude comes back by session id, codex by its own `codex resume --last`, whose picker already filters by cwd so no lookup is needed; agent detection names the kind and tabs.json records it (the old boolean means claude). Other agents light the dot but have nothing to come back to. Ctrl+C
  over a selection copies it, Windows Terminal style; unselected it stays the interrupt.
  pwsh by default, Settings picks from what the machine has. The pty gets a
  terminal's OWN environment, not Prism's (2026-08-23): TERM=xterm-256color and
  COLORTERM=truecolor, with NO_COLOR and FORCE_COLOR=0 dropped, and the SESSION MARKERS an
  agent leaves for its children stripped by name (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION /
  SESSION_ID / MESSAGING_SOCKET / MESSAGING_TOKEN / ENTRYPOINT / EXECPATH, CLAUDE_PID,
  CODEX_COMPANION_*). Prism inherits whatever launched it: from an agent's own shell that
  meant monochrome agents AND child sessions - no transcript saved, so nothing for Prism's
  resume to find, and a live pipe to somebody else's conversation. Real CLAUDE_CODE_*
  configuration (web-search limits, feature flags) is deliberately kept. **This is the one thing in Prism that executes**, accepted by design -
  the line that remains is that Prism never generates a command: main spawns only shells it
  detected itself, and forwards keystrokes. AI CLIs are the primary workload: an image on
  the clipboard forwards the ^V KEYSTROKE (Claude Code reads the image itself - swallowing
  that key is how other terminals break image paste), copied files paste as quoted paths,
  text is bracketed paste, Shift+Enter sends the backslash-CR continuation, and a file
  dropped on the panel types its path instead of opening. Prism claims only Ctrl+\` and
  F11 over a focused shell: Escape stays vim's, Ctrl+W stays delete-word.
- Keyboard-first controls; remember window size/position.
- **Resident single-instance model**: one process; opening another file hands off to the running
  window so it appears instantly (mitigates Electron cold-start).
- **Opt-in file associations**: register Prism as the handler for chosen types, from Settings.
  Never hijack defaults silently. The installer offers EVERY viewable type
  (`build/installer/assoc.nsh`); the app itself just opens Windows' Default apps page, so that
  list is the only thing deciding what Windows will offer Prism for.
  That list only governs the RECOMMENDED half of "Open with" (2026-08-20). The dialog's
  "More apps" section is every installed application, unfiltered, so Prism can be pointed at
  a `.zip` no matter what we register, and no app can remove itself from it: the only lever,
  `NoOpenWith`, is all-or-nothing and would drop the 143 types we do support. Hence
  `UnsupportedView`, which names the file and the format instead of leaving an empty window.

**Out of scope (v1):** playlists / library / collections, editing, casting, streaming URLs,
subtitles (planned later), office-doc rendering beyond PDF (planned later), cross-platform
(Electron keeps it feasible later, but Windows-only for now).

Detailed plan and phases live in [`ROADMAP.md`](ROADMAP.md); the design spec and implementation
plan live in `docs/superpowers/`.

## Architecture

Standard Electron three-layer split (`src/main`, `src/preload`, `src/renderer`), mirroring
Filesmith's conventions.

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

## Build, test, release

**Standing step, every time a new file type is supported:** ask whether this change adds an
extension. If it does, it goes in `src/shared/fileKind.ts` AND
`build/installer/assoc.nsh`, or Windows will never offer Prism for it - Prism will open the
file happily and be missing from its "Open with", which is exactly what happened to 96
extensions when the code viewer landed. `src/shared/fileAssoc.test.ts` enforces the parity and
names the extensions to add, so the answer to "did I remember?" is `npm test`, not a re-read.
Bare names (`Dockerfile`, `Makefile`) and dotfiles cannot be registered: Windows associates on
extension and they have none.

`npm run dev` / `npm test` for the inner loop; `npm run e2e` drives the built app through
Playwright and runs OFFSCREEN (`tools/e2e/run.mjs` `park()`: opacity 0, position -4000,-4000,
off the taskbar) so it never covers what you are doing. Electron has no headless mode, and a
truly hidden window stops answering clicks and screenshots, so parking it is the way.
`npm run package` builds the NSIS installer;
version lives in `package.json`. **Releasing is automated** (2026-08-21):
`.github/workflows/release.yml` builds and publishes on every push to main - a new
`package.json` version creates release `v<version>` with generated notes, a push on an existing
version replaces that release's installer in place. Bump the version when a release should be
NEW; CI gates are typecheck + unit tests only (the e2e needs this machine). Unsigned, per-user,
GitHub Releases.

**Installing is the LAST verification step, every time work is finished** - after tests,
typecheck, lint and e2e, and not something to ask about first. Tests and e2e drive the built
bundle, never the shipped app: packaging and installing is what proves the installer still
works, that the associations still register, and that the resident app actually launches.
`npm run package`, then install `dist/Prism-Setup-x64-<version>.exe` silently with `/S`
(per-user, no elevation), closing any running Prism first. Report the installed version.

## Conventions

- TypeScript, `sealed`-by-default mindset, small focused files, feature-not-layer organization.
- Follow Filesmith's patterns (aliases `@shared`/`@renderer`, eslint/prettier config, IPC shape,
  frameless TopBar) so `prism-core` drops into both apps cleanly.
- No em-dashes anywhere (use en-dashes, commas, or parentheses).
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason. Current
  reasoned exceptions (all viewer-core, destined for `prism-core`): CodeMirror 6
  (`@codemirror/*` + `@lezer/highlight`, the code viewer: highlighting, folding, search and
  syntax-error squiggles across ~150 languages, which is not a thing to hand-roll),
  `react-markdown` +
  `remark-gfm` + `rehype-raw` + `rehype-sanitize` (markdown), `pdfjs-dist` (PDF),
  `heic-convert` (HEIC decode), `adm-zip` (the archive viewer: reading and rewriting zip
  containers is not a thing to hand-roll; pure JS, no native code), `node-pty` + `@xterm/*` (the terminal: a real ConPTY and
  its renderer, not a thing to hand-roll; node-pty is the app's ONE native module, ships
  N-API prebuilds, and must stay asarUnpacked or Windows cannot load it). Shells spawn
  with node-pty's bundled conpty.dll (`useConptyDll: true`): the OS conhost FAST-FAILS
  the whole app (0xc0000409, no dialog) when a pty is killed mid-read (crashed 2026-08-21).

## Working with me

This is a bounded product: a viewer. When a request drifts toward a library, an editor, or
general media management, ask before assuming. Especially anything that changes the viewer
chrome, the file-association behavior, or the `prism-core` interface (which Filesmith also
depends on).
