# Prism roadmap

A fast, universal media viewer for Windows, built on the shared **`prism-core`** engine that
also powers Filesmith's previews. This roadmap is the source of truth for what is planned and
shipped; keep it current.

Decisions locked at kickoff:

- **Product:** a universal *quick-viewer* (open → view/play → arrow through the folder). Not a
  library, player-with-playlists, or editor in v1.
- **Stack:** Electron + React + TypeScript + Vite + Tailwind v4 (same as Filesmith).
- **Code sharing:** a shared package, **`prism-core`**, in its own repo; Filesmith and Prism
  both consume it. Separate app repos, no runtime dependency between the two apps.
- **File associations:** opt-in only (Settings), never silently change defaults.
- **Filesmith relationship:** independent; Filesmith keeps its built-in preview via `prism-core`.

---

## Phase 0: Project setup ✅ (this repo)

- Repo, scaffold (Electron/React/TS/Vite/Tailwind), config, CLAUDE.md, README, this roadmap,
  design spec + implementation plan under `docs/superpowers/`.
- A minimal runnable dark shell with an empty state and a stubbed viewer router. The stub is a
  placeholder; the real viewer arrives from `prism-core` in Phase 2.

## Phase 1: Extract `prism-core`

Create the shared engine so there is one implementation, not two.

- New repo `Maxaubert/prism-core` (package name `prism-core`), TypeScript, framework-light:
  exports the viewer React components + the media protocol/helpers.
  - Move from Filesmith: `PreviewWindow` viewers (image/video/PDF), `AudioVisualizer`, the
    `fsmedia://` scheme + `serveMedia` (Range/206), `fileKind`, thumbnail/decoded-image fallback.
  - Define a clean, host-agnostic interface (the components take file descriptors + a media-URL
    resolver + callbacks; they do not reach into either app's IPC directly).
- Update **Filesmith** to consume `prism-core` (delete its now-duplicated copies), keep all its
  behavior and tests green. Filesmith ships unchanged to users.
- Prism consumes `prism-core` too (replaces the Phase 0 stub).
- Dev linking: `file:../prism-core` locally; a pinned git dependency for CI/release.
- Tests move with the code (arch-scan-style unit tests for `fileKind`, protocol range parsing).

## Phase 2: Prism v1, the universal viewer

- **Open routing:** file argument (Explorer / "open with" / CLI), drag-and-drop onto the window,
  and an open dialog. Resolve kind, mount the right `prism-core` viewer.
- **Folder awareness:** list sibling viewable files of the opened file; Left/Right arrow to move
  through them; wrap or clamp (decide); show "3 / 20" position.
- **Image:** fit-to-window, zoom (wheel + +/-), pan (drag), rotate (R), fullscreen (F).
- **Video:** the `prism-core` player; play/pause (space), seek, volume, speed, fullscreen, frame
  step (,/.).
- **Audio:** the `prism-core` player + circular visualizer; cover art; speed/volume.
- **PDF / text / code / markdown:** Chromium PDF; syntax-highlighted text/code; rendered markdown.
- **Chrome:** dark frameless window, indigo accent, auto-hiding controls, a minimal top strip
  with filename + window controls. Remember window size/position.
- **Icon + brand:** generate the Prism icon (indigo, prism/monogram), wire into electron-builder.

## Phase 3: Resident / instant open

- Single-instance lock; a second launch (opening another file) forwards the path to the running
  instance via `second-instance`, which shows/reuses the window immediately (kills the
  cold-start feel). Optional tray icon to keep it resident.
- Fast-boot tuning: defer non-critical work, keep the first paint tiny.

## Phase 4: Explorer integration (opt-in)

- Settings screen: "Set Prism as the default for…" with a checklist of image / video / audio /
  PDF / text types. Register/unregister handlers per-user (no admin), reversible, never silent.
- Ensure Prism appears in the Windows "Open with" list regardless.
- (Optional) an "Open with Prism" context-menu entry.

## Phase 5: Polish & niceties

- Thumbnail filmstrip / folder strip for quick jumping.
- Copy image / reveal in Explorer / open externally / set as wallpaper (image).
- Slideshow (timed advance) for images.
- Basic video subtitles (sidecar `.srt`), remember per-file playback position for long media.
- Audio "folder queue" (play through the folder): the lightest step toward a player, still not a
  library.

## Customization & theming (a defining feature, planned)

Prism should let people shape how their viewer looks and feels. The build is
structured around **interchangeable UI pieces** so this is configuration, not a rewrite:

- **Themes / color scheme**: dark (default), light, and "AMOLED black"; a single
  accent color the user picks (drives the progress bar, sliders, highlights). All chrome
  reads its colors from CSS variables (`--color-accent`, etc.) so a theme is just a token set.
- **Density / style**: a "minimalist" mode (auto-hide everything, thin controls, no chrome)
  vs a "full" mode (persistent controls, filename bar, filmstrip).
- **Interchangeable components**: the transport bar, the scrub bar, and especially the
  **audio visualizer** are swappable modules behind a small interface. A user chooses:
  - Visualizer style: **horizontal waveform / wave-bars** (default), circular ring, oscilloscope
    line, spectrum bars, or none.
  - Progress-bar shape/color, control-bar layout, corner radius, whether cover art shows.
- **Presets**: a few curated looks ("Minimal Dark", "Studio", "Neon") plus a settings panel
  to tweak and save your own.

Architecture note: keep every viewer's chrome (Transport, Scrubber, Visualizer) as small,
prop-driven, replaceable components in `prism-core`, reading theme tokens from CSS variables.
That is what makes the above configuration rather than forks.

## Distribution

electron-builder → per-user NSIS installer, unsigned, GitHub Releases (mirrors Filesmith).
Document the SmartScreen "Run anyway" step. Manual updates for now (electron-updater is a backlog
item).

## Backlog / maybe-later

- Office document viewing (docx/xlsx/pptx): Filesmith already bundles LibreOffice; Prism could
  render-to-PDF on demand or share that path.
- Cross-platform (macOS/Linux): Electron keeps the door open; not a v1 goal.
- HDR-aware image/video display; wide-gamut.
- Per-monitor DPI and multi-window ("open in new window").
- electron-updater auto-update.
