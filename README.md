<div align="center">
  <img src="build/icon.png" alt="Prism" width="116">

  # Prism

  A fast, universal media viewer for Windows. Open anything, view it beautifully.

  [![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square)](https://github.com/Maxaubert/Prism/releases/latest)
  [![Built with](https://img.shields.io/badge/Electron%20·%20React%20·%20TypeScript-2b2e3a?style=flat-square)](#build-from-source)
  [![License: MIT](https://img.shields.io/badge/License-MIT-22b364?style=flat-square)](LICENSE)
</div>

---

Prism opens an image, a video, an audio file, or a PDF and shows it instantly, then lets
you arrow through the rest of the folder without a beat. It is the "quick look" Windows
never shipped: one small app that opens everything and looks good doing it.

> Early development. See [`ROADMAP.md`](ROADMAP.md) for the plan and phases.

## What it is

- **Images** — zoom, pan, fit, rotate, fullscreen; common and exotic formats.
- **Video** — play / pause / seek / volume / speed / fullscreen, frame-step.
- **Audio** — play with a live circular visualizer and cover art.
- **PDF & documents** — flip through pages; text, code, and markdown too.
- **Folder-aware** — open one file, then use the arrow keys to move through its neighbours.
- **Opens from Explorer** — opt in to make Prism the default viewer for the file types you choose.

Prism is a **viewer**, not a library or editor. It stays fast, quiet, and out of the way.

## Shared engine

Prism's viewer is a standalone package, **[`prism-core`](https://github.com/Maxaubert/prism-core)**,
which also powers the previews inside [Filesmith](https://github.com/Maxaubert/Filesmith).
One engine, two apps, no duplicated code. Neither app needs the other installed.

## Install

Once released: download `Prism-Setup-x64-<version>.exe` from
[Releases](https://github.com/Maxaubert/Prism/releases/latest) and run it (per-user, no admin).
The installer is unsigned, so Windows SmartScreen may warn on first run: **More info → Run anyway**.

## Build from source

Requires Node.js 20+ and Windows.

```bash
npm install
npm run dev        # launch with hot reload
npm run typecheck  # tsc project checks
npm run lint       # eslint
npm test           # unit tests (vitest)
npm run package    # build the Windows installer into dist/
```

Stack: Electron + TypeScript, React + Vite + Tailwind v4. See `CLAUDE.md` for architecture and scope.

## License

[MIT](LICENSE)
