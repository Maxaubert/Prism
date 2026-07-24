# Prism — design specification

**Status:** approved at kickoff (decisions below), 2026-07-24.

## Summary

Prism is a fast, universal media viewer for Windows: open a file, view or play it, and arrow
through the rest of its folder. It replaces the built-in Windows Photos / Media Player for
everyday viewing. It is deliberately a *viewer*, not a library, player-with-playlists, or editor.

Prism is built on **`prism-core`**, a shared viewer engine that also powers the previews in
[Filesmith](https://github.com/Maxaubert/Filesmith). One engine, two apps, no duplicated code,
no runtime dependency between the apps.

## Decisions (locked)

| Question | Decision |
|---|---|
| v1 scope | Universal quick-viewer (open → view → arrow through folder). |
| Code sharing | Shared `prism-core` package, separate app repos. |
| File associations | Opt-in in Settings; never silently change defaults. |
| Filesmith link | Independent at runtime; both only share `prism-core`. |
| Stack | Electron + React + TypeScript + Vite + Tailwind v4 (same as Filesmith). |
| Startup | Resident single-instance model for instant subsequent opens. |
| Theme | Dark viewer chrome, indigo `#5b5bd6` accent. |

## Goals

- Open an image, video, audio, or PDF from a double-click and show it in well under a second on a
  warm process; look premium doing it.
- Move through a folder of media with the arrow keys without re-opening the app.
- Broad, reliable format support with no native media code (lean on Chromium).
- Share the polished viewer with Filesmith so neither app carries a second copy.

## Non-goals (v1)

Library/collections, editing, playlists, casting, streaming URLs, subtitles, office-doc
rendering beyond PDF, cross-platform. Several are backlog items (see ROADMAP).

## Architecture

Electron three-layer split, mirroring Filesmith:

- **main** (`src/main`): app + window + tray lifecycle, single-instance/resident model, the
  `fsmedia://` protocol (from `prism-core`), open-file routing (argv / drag / dialog /
  associations), folder listing, settings persistence, packaging.
- **preload** (`src/preload`): a typed `contextBridge` API — `openDialog`, `onOpenFile`,
  `listFolder`, `mediaUrl`, window controls, settings get/set, association register/unregister.
- **renderer** (`src/renderer`): a dark frameless shell that resolves the current file's kind and
  mounts the matching `prism-core` viewer; handles keyboard navigation and fullscreen.

### `prism-core` (shared package, own repo)

The engine. Host-agnostic: components receive plain file descriptors, a `mediaUrl(path)`
resolver, and callbacks; they never reach into a specific app's IPC.

Exports:

- Viewer components: `ImageView`, `VideoView`, `AudioView` (+ `AudioVisualizer`), `PdfView`,
  `TextView`.
- Media plumbing: the `fsmedia://` privileged-scheme registration + a `serveMedia(request)`
  handler (Range/206 streaming, so `<video>`/`<audio>` seek), for the main process to install.
- Utilities: `fileKind(ext)`, thumbnail/decoded-image helpers.

Consumers (Prism, Filesmith) provide the host wiring (register the scheme, supply `mediaUrl`,
pass the file list). This is the seam that lets one engine serve two very different apps.

### Data flow (open a file)

1. A path arrives (argv on launch, `second-instance` forward, drag-drop, or dialog).
2. main resolves it, reads the sibling folder listing (viewable kinds only), sends
   `{ files, index }` to the renderer.
3. renderer picks the `prism-core` viewer by `fileKind`, renders it with `mediaUrl` =
   `fsmedia://local/<encoded-abs-path>`.
4. Arrow keys change `index`; the viewer swaps source. main streams bytes on demand via
   `serveMedia`.

## Error handling

- Unreadable/missing/deleted file: a clean in-viewer message, never a crash; arrowing skips it.
- Unsupported kind: a "can't preview this file type" state with "open externally".
- A media element error (bad codec): surface it in-place with the reason.
- The `fsmedia` handler wraps every path in try/catch, returns 400/404/500 Responses, and guards
  streams against mid-read deletion (as Filesmith's `serveMedia` already does).

## Security

- `contextIsolation` on, `sandbox` off only where required (matching Filesmith), no `nodeIntegration`
  in the renderer.
- The renderer only reads files through the `fsmedia://` scheme; no arbitrary fs from the renderer.
- File-association changes are per-user registry writes, reversible, behind an explicit Settings
  action. No admin.
- Never follow paths supplied by web content; Prism only opens local paths from the OS/user.

## Testing

- **Unit (Vitest):** `fileKind`, Range-header parsing in `serveMedia`, folder-listing filter,
  next/prev index math (wrap/clamp), settings/association state.
- **Manual / e2e:** open each media kind by double-click, drag, and dialog; arrow through a mixed
  folder; fullscreen; resident second-open is instant; associations register/unregister cleanly.
- `prism-core` carries its own tests; Filesmith's existing preview tests must stay green after it
  migrates onto `prism-core`.

## Distribution

electron-builder per-user NSIS installer, unsigned, GitHub Releases; SmartScreen "Run anyway"
documented. Version in `package.json`; tag + `gh release`.

## Open questions (decide during implementation, not blocking)

- Arrow navigation at folder ends: wrap or clamp.
- Whether the tray/resident process is on by default or opt-in.
- Exotic image formats: decode via a bundled tool (like Filesmith's ImageMagick) or rely on
  Chromium + a WASM decoder; affects whether Prism bundles any binaries.
- Markdown/code rendering: bundle a small highlighter/markdown lib or keep text plain in v1.
