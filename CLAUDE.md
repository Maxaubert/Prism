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

**In scope (v1 — universal quick-viewer):**

- Open via: a file argument (Explorer double-click / "open with" / CLI), drag-and-drop, and an
  open dialog.
- **Image** viewer: fit / zoom / pan / rotate / fullscreen; common formats natively, exotic
  formats via a decode fallback.
- **Video** player: play / pause / seek / volume / speed / fullscreen, frame-step.
- **Audio** player: play / seek / volume / speed, a live circular visualizer, cover art.
- **PDF / document** viewer: Chromium PDF; plain text, source code, and markdown.
- **Folder navigation**: from the opened file, page through sibling viewable files (arrow keys),
  with a scope setting (all / media vs documents / one file type) in Settings → General.
- **File tree sidebar** (`Ctrl+B`): collapsible panel rooted at the folder Prism was opened in;
  expand subfolders, click a file to view it. The root is a wall: main refuses paths outside it.
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

- **The viewer is not built here.** It lives in a shared package, **`prism-core`**, which also
  powers Filesmith's previews. Prism is a thin app shell around `prism-core`:
  - `prism-core` owns: the image / video / audio / PDF / text viewer React components, the
    audio visualizer, the `fsmedia://` streaming protocol (Range-aware, so `<video>`/`<audio>`
    can seek), file-kind detection, and thumbnail generation.
  - Prism owns: the window/tray/resident lifecycle, open-file routing (argv / drag / dialog /
    associations), folder navigation, settings, and packaging.
- **Filesmith and Prism never depend on each other at runtime.** They only share `prism-core`,
  which each bundles at build time. A user with Filesmith does not need Prism, and vice versa.

## Reuse from Filesmith (becomes `prism-core`)

These already exist in Filesmith and are the seed of `prism-core` (extracted in Phase 1):

- `src/renderer/src/components/PreviewWindow.tsx` — the image/video/PDF viewer shell.
- `src/renderer/src/components/AudioVisualizer.tsx` — the circular Web-Audio visualizer.
- `src/main/index.ts` `serveMedia` + the `fsmedia://` privileged scheme (Range/206 streaming).
- `src/shared/fileKind.ts` — extension → kind.
- `src/main/thumbnail.ts` + `Util/IconHelper` equivalents — thumbnail/decoded-image fallback.

## Build, test, release

`npm run dev` / `npm test` for the inner loop; `npm run package` builds the NSIS installer;
version lives in `package.json`; tag + `gh release` to ship. Unsigned, per-user, GitHub Releases.

## Conventions

- TypeScript, `sealed`-by-default mindset, small focused files, feature-not-layer organization.
- Follow Filesmith's patterns (aliases `@shared`/`@renderer`, eslint/prettier config, IPC shape,
  frameless TopBar) so `prism-core` drops into both apps cleanly.
- No em-dashes anywhere (use en-dashes, commas, or parentheses).
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason.

## Working with me

This is a bounded product: a viewer. When a request drifts toward a library, an editor, or
general media management, ask before assuming. Especially anything that changes the viewer
chrome, the file-association behavior, or the `prism-core` interface (which Filesmith also
depends on).
