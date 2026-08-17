<div align="center">
  <img src="build/icon.png" alt="Prism" width="116">

  # Prism

  A fast, universal media viewer for Windows. Open anything, view it beautifully.

  [![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square)](https://github.com/Maxaubert/Prism/releases/latest)
  [![Built with](https://img.shields.io/badge/Electron%20·%20React%20·%20TypeScript-2b2e3a?style=flat-square)](#build-from-source)
  [![License: MIT](https://img.shields.io/badge/License-MIT-22b364?style=flat-square)](LICENSE)
</div>

---

<div align="center">
  <a href="docs/media/prism.mp4">
    <picture>
      <source srcset="docs/media/prism.avif" type="image/avif">
      <img src="docs/media/prism.webp" alt="Prism opening a photograph, a video, an audio file and a document" width="760">
    </picture>
  </a>

  <sub><a href="docs/media/prism.mp4">Download the film as an MP4</a></sub>
</div>

---

Prism opens an image, a video, an audio file, or a PDF and shows it instantly, then lets
you arrow through the rest of the folder without a beat. It is the "quick look" Windows
never shipped: one small app that opens everything and looks good doing it.

> Early development. See [`ROADMAP.md`](ROADMAP.md) for the plan and phases.

## What it is

- **Images**: zoom, pan, fit, rotate, fullscreen; common and exotic formats.
- **Video**: play / pause / seek / volume / fullscreen, frame-step, and a settings menu with
  speed, loop, autoplay (the next video in the folder plays itself), and subtitles: sidecar
  `.srt`/`.vtt` files are found by name, next to the file or in `Subs/`.
- **Audio**: play with a live circular visualizer; the same settings menu (speed, loop,
  autoplay the next track).
- **PDF**: Prism's own viewer, no browser chrome: continuous pages, zoom and fit, text
  selection, and its own Ctrl+F that counts matches across the whole document.
- **Documents**: markdown renders formatted (badges, images, even embedded video); plain text
  stays clean and monospaced.
- **Folder aware**: open one file, then use the arrow keys to move through its neighbours.
  Choose whether the arrows stay within media, within documents, or one file type, from the
  filter in the sidebar or Settings → General.
- **File tree** (`Ctrl+B`): a collapsible panel of the folder you opened in. Expand subfolders,
  click any file to view it. It never reaches above that folder. Right-click for the verbs:
  open in another app, show in Explorer, copy, duplicate, rename, delete. Drive it entirely
  from the keyboard: arrows move through folders and files alike, `Enter` opens or collapses
  a folder, and files open as you land on them.
- **Code, highlighted**: source files open with syntax colouring, line numbers, folding and
  their own `Ctrl+F`, across ~150 languages. Where the language has a real grammar, a syntax
  error gets the red underline you would expect from an editor.
- **Edit text files in place**: any text file is editable where it sits, `Ctrl+S` to save. Click
  into the text to get a caret; until you do, the arrow keys keep paging the folder. Markdown
  keeps a pencil in the top bar, to swap its rendered page for its raw source. An unsaved file
  is named in the tree in bold with a `*`, and nothing closes Prism out from under it.
- **Opens from Explorer**: opt in to make Prism the default viewer for the file types you choose.

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
