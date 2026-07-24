# Prism — implementation plan

**Goal:** Ship a fast universal media viewer for Windows, built on a shared `prism-core` engine
reused by Filesmith.

**Architecture:** Electron three-layer app; the viewer lives in `prism-core` (own repo) and is
consumed by both Prism and Filesmith. Prism is the window/lifecycle/open-routing shell.

**Tech stack:** Electron 43, React 19, TypeScript, Vite, Tailwind v4, electron-builder (NSIS),
Vitest.

## Global constraints

- Same conventions as Filesmith: aliases `@shared` / `@renderer`, eslint/prettier config,
  frameless `TopBar`, IPC shape, per-user unsigned NSIS.
- No em-dashes in any user-facing text or docs.
- Prism and Filesmith share only `prism-core`; no runtime dependency between the apps.
- Everything the renderer reads goes through `fsmedia://`; no arbitrary fs from the renderer.

---

## Phase 0 — Setup (this repo) ✅

Scaffold + config + planning docs + a minimal runnable dark shell with a stubbed viewer. Done.

## Phase 1 — Extract `prism-core`

**T1.1 Create the package repo.** `Maxaubert/prism-core`, package `prism-core`. TS build (tsup or
Vite lib mode) emitting ESM + types. Peer deps: `react`, `react-dom`. No Electron dependency in
the package itself (host-agnostic).

**T1.2 Move the viewer components.** From Filesmith into `prism-core/src`:
`ImageView`, `VideoView`, `AudioView`, `AudioVisualizer`, `PdfView`, `TextView`. Refactor so they
take props (`file`, `mediaUrl(path)`, callbacks) rather than importing Filesmith IPC. Add tests
for pure logic (visualizer math is exercised via a smoke render).

**T1.3 Move the media protocol.** Export `MEDIA_SCHEME`, `registerScheme()` (privileged), and
`serveMedia(request)` (Range/206, error Responses, stream-error guard). Unit-test Range parsing.

**T1.4 Move `fileKind` + thumbnail helpers.** `fileKind(ext)` and the decoded-image/thumbnail
fallback interface. Unit-test `fileKind`.

**T1.5 Migrate Filesmith onto `prism-core`.** Replace Filesmith's local copies with imports;
delete the duplicates; wire its main process to `registerScheme()`/`serveMedia`. Keep every
Filesmith test green and behavior identical. Dev via `file:../prism-core`, release via pinned git
dep.

**T1.6 Consume in Prism.** Add `prism-core` as a dependency; delete the Phase 0 stub viewer.

## Phase 2 — Prism v1 viewer

**T2.1 Main: open routing.** Parse the file path from `process.argv` on launch; handle drag-drop
(`will-navigate`/`ondrop` guard + IPC) and an open dialog. Compute the media URL and folder
listing; send `{ files, index }` to the renderer.

**T2.2 Main: folder listing.** List siblings of the opened file filtered to viewable kinds
(`fileKind !== 'other'`), sorted naturally; return paths + the opened file's index.

**T2.3 Preload API.** `openDialog()`, `onOpenFile(cb)`, `listFolder(path)`, `mediaUrl(path)`,
window controls, settings get/set.

**T2.4 Renderer shell.** Dark frameless window; a `Viewer` that switches on `fileKind` to the
`prism-core` component; a top strip (filename + position + window controls) that auto-hides; an
empty state (open / drop). Remember window bounds.

**T2.5 Navigation + keyboard.** Left/Right = prev/next file; Space = play/pause; F = fullscreen;
+/- + wheel = zoom (image); R = rotate (image); Esc = exit fullscreen / close; ,/. = frame step
(video). Position indicator "3 / 20".

**T2.6 Brand.** Generate the Prism icon (indigo prism/monogram), build `build/icon.ico`, wire
`electron-builder.yml`; set the frameless top-strip mark.

## Phase 3 — Resident / instant open

**T3.1 Single-instance + forward.** `requestSingleInstanceLock`; on `second-instance`, parse the
new path from its argv, show/restore the window, and load that file instantly. First launch is
the only cold start.

**T3.2 Optional tray + fast boot.** Tray icon to keep resident (opt-in); defer non-critical
startup work so first paint is minimal.

## Phase 4 — Explorer integration (opt-in)

**T4.1 Settings screen.** "Set Prism as default for…" checklist (image/video/audio/pdf/text).
Persist choices.

**T4.2 Association register/unregister.** Per-user registry writes (no admin), reversible; ensure
Prism appears in "Open with" regardless. Confirm each change; never silent.

## Phase 5 — Polish

Filmstrip; copy/reveal/open-externally/set-as-wallpaper; slideshow; sidecar subtitles; remember
playback position; folder audio queue. (Each independently shippable.)

## Distribution

`npm run package` → `dist/Prism-Setup-x64-<version>.exe`; `gh release create`. Unsigned, per-user;
document SmartScreen "Run anyway".

## Execution notes

- Phase 1 is the linchpin: it touches Filesmith (public, released), so do it carefully behind its
  test suite and ship Filesmith unchanged to users. Prefer subagent-driven or careful inline
  execution with the review loop.
- Keep `prism-core`'s public interface small and stable; both apps depend on it.
