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

## Where it is going (2026-09-02)

The phases below are the original plan and are kept as history. Most of them shipped, some
of them did not happen the way they are written (`prism-core` was never extracted; the viewer
still lives in this repo), and the detail of what Prism actually does now lives in
[`CLAUDE.md`](CLAUDE.md), which is current. What follows is the direction, and the reasoning
that is worth keeping out of the issue tracker.

### Modularity: let people shape Prism down ([#83](../../issues/83))

Prism has become several apps sharing a window: a viewer, a comic reader, a code editor with a
terminal, an archive manager. The point of packaging it is **user feel** before weight - "I
built this because I needed X, and also because I did not want A, B and C" - so the ability to
drop features is the feature.

One Packages screen, two mechanisms behind it:

- **Toggled, instant, no network** ([#85](../../issues/85)) for everything that is code only.
  The renderer is already lazily chunked, so turning one off genuinely stops loading it. This is
  where most of "I do not want A, B and C" lives, and it costs almost nothing.
  [#84](../../issues/84) makes the terminal the first one, as the cheapest proof.
- **Fetched on demand, with a size** ([#86](../../issues/86)) only for the heavy binaries.

Two things that decide whether this works:

- **The packages people think in do not match what costs weight.** ffmpeg is used by video
  decode, audio decode, image decode (Targa, PSD, EXR, DPX, DDS), waveform peaks, ass-to-vtt
  conversion, container conversion and frame-rate probing. A movies package, a music package and
  an images package would all depend on the same 128MB artifact. Packages declare components;
  components are shared.
- **A toggle beats a download on the stated criterion.** "It is already there, click it" is
  faster than "click, wait 40MB". Downloading only wins for what is too big to have shipped.

The viewer stays the product, so images, video, audio and documents remain in the default
install. What is optional is what makes Prism something other than a viewer.

**The invariant not to spend:** Prism never generates a command, and main spawns only
executables it enumerated itself. Downloading binaries and running them is a general-purpose
code-execution channel in an unsigned app. The toggle half does not touch it; the fetch half
needs pinned hashes and a signature story first.

**The hard part is file associations** ([#87](../../issues/87)), not the packaging. Prism
registers ~298 per-extension ProgIDs from NSIS at install time, a UserChoice cannot be moved by
an app, and the uninstaller parity test exists because that already went wrong once.

Third-party plugins are **not** this. First-party optional components are a build and
distribution problem; third-party code inside Prism is an API contract that can never break, a
sandbox and a review process. Different decision, different scale.

### Streaming ([#88](../../issues/88), [#89](../../issues/89))

An `.m3u` is a **file**, and "open a file, get a sidebar, arrow through it" is the whole model -
so a channel list is the 299th extension rather than a new paradigm. The reuse is shallower than
it looks: `videoConvert.ts` converts once and plays the copy, which an unbounded live stream
cannot do, and Chromium has no HLS demuxer. It also needs states Prism has never had, because
files do not stall or go dead.

A YouTube URL box is the weaker half and is filed as such: no file means no root, no folder and
no sidebar, and `yt-dlp` is a permanent maintenance tax on an app whose network dependency is
currently zero.

### Loose ends already filed

[#91](../../issues/91) code and document collide at 16px in Explorer since the icons went
uniform, [#92](../../issues/92) the parked icon work (the coloured scheme behind one constant, an
HTML mark never picked from, the real brand logos), and [#93](../../issues/93) the image and
comic toolbar, which should auto-hide the way the transport does.

### Companion ([#90](../../issues/90))

Watch what is in the current tab on a phone, over the LAN. **Local only, in writing.** No relay,
no accounts, no TLS problem, no hosting bill.

The scope should be **the tab root, not a library**. A tab is already rooted at a folder that
main refuses to look outside, so the phone sees that folder and the security model is the one
that already exists. That also sidesteps needing a library, which is the thing this repo has
said no to since kickoff.

`fsaudio://` already live-transcodes with seekable Range requests; the client should be a web
page Prism serves rather than an app. What it still costs: "local" is not "only me" on shared
wifi, so it wants pairing; a firewall prompt on first listen; and the honest fact that it makes
Prism a server, which is the line worth deciding once rather than drifting across.

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
- **PDF / text / code / markdown:** first-party pdf.js viewer with its own Ctrl+F (done
  2026-08-08, replacing the Chromium PDF embed); rendered markdown (done 2026-08-08); plain
  mono text/code (syntax highlighting still open).
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
