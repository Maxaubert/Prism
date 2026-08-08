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
- **Video** player: play / pause / seek / volume / speed / fullscreen, frame-step.
- **Audio** player: play / seek / volume / speed, a live circular visualizer, cover art.
- **PDF / document** viewer: first-party pdf.js viewer (2026-08-08): continuous canvas pages,
  zoom/fit, text selection, own Ctrl+F (no Chromium PDF UI). Markdown renders formatted
  (react-markdown, sanitized inline HTML, remote badges); plain text and source code stay mono.
- **Folder navigation**: from the opened file, page through sibling viewable files (arrow keys),
  with a scope setting (all / media vs documents / one file type) in Settings → General and as
  a filter button in the sidebar header (filled funnel = filter active). Documents own their
  vertical keys: Up/Down and PageUp/PageDown scroll or flip pages in pdf/text; Left/Right
  always page the folder.
- **File tree sidebar** (`Ctrl+B`): collapsible panel rooted at the folder Prism was opened in;
  expand subfolders, click a file to view it. The root is a wall: main refuses paths outside it.
- **Rename + delete from the tree** (F2 / Delete / right-click, files and folders, decided 2026-08-01).
  The only writes Prism performs. Nothing is destroyed: deleting and overwriting both go via the
  Recycle Bin, a taken name asks (cancel / replace / keep both), and names are validated first.
  The session root itself can never be renamed or binned. Anything further (move, copy, new folder,
  multi-select) is a fresh decision, not a natural next step.
- Keyboard-first controls; remember window size/position.
- **Resident single-instance model**: one process; opening another file hands off to the running
  window so it appears instantly (mitigates Electron cold-start).
- **Opt-in file associations**: register Prism as the handler for chosen types, from Settings.
  Never hijack defaults silently.

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

`npm run dev` / `npm test` for the inner loop; `npm run package` builds the NSIS installer;
version lives in `package.json`; tag + `gh release` to ship. Unsigned, per-user, GitHub Releases.

## Conventions

- TypeScript, `sealed`-by-default mindset, small focused files, feature-not-layer organization.
- Follow Filesmith's patterns (aliases `@shared`/`@renderer`, eslint/prettier config, IPC shape,
  frameless TopBar) so `prism-core` drops into both apps cleanly.
- No em-dashes anywhere (use en-dashes, commas, or parentheses).
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason. Current
  reasoned exceptions (all viewer-core, destined for `prism-core`): `react-markdown` +
  `remark-gfm` + `rehype-raw` + `rehype-sanitize` (markdown), `pdfjs-dist` (PDF),
  `heic-convert` (HEIC decode).

## Working with me

This is a bounded product: a viewer. When a request drifts toward a library, an editor, or
general media management, ask before assuming. Especially anything that changes the viewer
chrome, the file-association behavior, or the `prism-core` interface (which Filesmith also
depends on).
