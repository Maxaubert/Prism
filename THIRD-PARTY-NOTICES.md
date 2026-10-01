# Third-party notices

Prism is proprietary (see `LICENSE`), but it builds on the components below, each under its own
licence. Those licences are unaffected by Prism's licence and their notices must be preserved.
Every program in `resources/bin`, `resources/everything` and `resources/bin/whisper` is used
unmodified, as a separate program.

Paths are relative to the install folder (`%LOCALAPPDATA%\Programs\Prism` by default).

## Shipped in the product

### Electron and Chromium (MIT, and Chromium's own licences)
Electron 43, which carries Chromium, Node.js and V8. `Prism.exe` is Electron's executable.
Electron's licence is `LICENSE.electron.txt`; Chromium's and those of everything it bundles are
`LICENSES.chromium.html`, both in the install folder. https://www.electronjs.org/

### ffmpeg (LGPL v2.1 or later, shared build)
BtbN's LGPL shared build (`ffmpeg-n9.0.1`, pinned in `tools/fetch-ffmpeg.mjs`), in
`resources/bin`. Shared on purpose: its DLLs can be replaced with your own build of the same
libraries. Licence: `resources/bin/LICENSE.txt`. https://ffmpeg.org,
https://github.com/BtbN/FFmpeg-Builds

### 7-Zip 25.00 (GNU LGPL, with the unRAR restriction; parts BSD 3-clause and 2-clause)
Igor Pavlov. `7z.exe` and `7z.dll` in `resources/bin`. The rar code is under the unRAR licence
restriction: it may not be used to recreate the RAR compression algorithm. Licence:
`resources/bin/License.txt`. https://www.7-zip.org

### FluidSynth 2.6.0 (LGPL v2.1)
`fluidsynth.exe`, `libfluidsynth-3.dll` and `sndfile.dll` from the project's own Windows
release, in `resources/bin`. Licence: `resources/bin/LICENSE-fluidsynth.txt`.
https://www.fluidsynth.org

`sndfile.dll` is libsndfile, which arrives inside that FluidSynth release. libsndfile is
LGPL v2.1 or later; its licence text does not travel with the release zip.
https://libsndfile.github.io/libsndfile/

### FluidR3Mono General MIDI soundfont (MIT)
FluidR3 by Frank Wen, mono conversion by Michael Cowgill, as shipped by MuseScore (pinned by
commit in `tools/fetch-fluidsynth.mjs`). `resources/bin/soundfont.sf3`. Licence and
acknowledgements: `resources/bin/LICENSE-soundfont.md`.

### whisper.cpp (MIT)
The official CPU build of `whisper-server.exe` and its ggml DLLs, for dictation, in
`resources/bin/whisper`. Copyright (c) 2023-2026 The ggml authors. Licence:
`resources/bin/whisper/LICENSE-whisper.cpp.txt`. https://github.com/ggml-org/whisper.cpp

### Microsoft Visual C++ runtime
`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll` and `vcomp140.dll` in
`resources/bin/whisper`, redistributed unmodified as published by Microsoft so the speech engine
runs on a Windows without the Visual C++ Redistributable. Microsoft's licence terms for the
Visual C++ redistributable files apply.

### Everything 1.4.1.1032 and ES 1.1.0.38 (voidtools)
David Carpenter / voidtools, for fast file search. `resources/everything`. Everything is under
voidtools' permissive licence (which also covers its bundled PCRE); ES is MIT. Licences:
`resources/everything/Everything-LICENSE.txt`, `resources/everything/ES-LICENSE.txt`, and
`resources/everything/NOTICE.txt`. https://www.voidtools.com/

### prism-term-core (MIT)
The terminal shared with Prism Terminal, from Maxaubert/PrismTerminal (`core/`), compiled into
the app. Copyright (c) 2026 Max. https://github.com/Maxaubert/PrismTerminal

### node-pty (MIT), Microsoft ConPTY and winpty
`node-pty` (Copyright (c) 2012-2015 Christopher Jeffrey, and Microsoft) in
`resources/app.asar.unpacked/node_modules/node-pty`, with the `conpty.dll` and
`OpenConsole.exe` that Microsoft publishes from the Windows Terminal project. Licence:
`node_modules/node-pty/LICENSE` in the same folder. node-pty's copy of ConPTY carries no licence
file of its own; the Windows Terminal project that publishes it is MIT.
node-pty also carries `winpty-agent.exe` from winpty (MIT, Copyright (c) 2011-2016 Ryan
Prichard); its licence is `node_modules/node-pty/deps/winpty/LICENSE` in the same folder.

### electron-builder's installer pieces (MIT) and NSIS (zlib/libpng licence)
Setup and the uninstaller are built with NSIS, and electron-builder adds its own install and
uninstall logic and `resources/elevate.exe`. https://nsis.sourceforge.io,
https://www.electron.build

### JavaScript libraries
Compiled into the app or carried in `resources/app.asar`, where each package's own licence file
sits at `node_modules/<package>/LICENSE`.

- **MIT**: React and React DOM, CodeMirror 6 and its language packages, Lezer, xterm.js and its
  addons, react-markdown, remark-gfm and the unified / rehype / remark family, adm-zip, exifr,
  qrcode, jszip (dual MIT or GPL-3.0, used under MIT), the stylesheet Tailwind CSS generates,
  and their MIT dependencies.
- **Apache-2.0**: pdf.js (`pdfjs-dist`, Mozilla), SheetJS Community Edition (`xlsx`, with its
  `cfb`, `ssf`, `codepage`, `adler-32`, `crc-32`, `frac`, `wmf` and `word` helpers), hls.js.
- **BSD 2-clause**: mammoth, lop, option, dingbat-to-unicode, entities. **BSD 3-clause**:
  jpeg-js, sprintf-js. **BSD**: duck.
- **ISC**: heic-convert, heic-decode and a handful of small helpers.
- **MIT and Zlib**: pako.
- **LGPL-3.0**: libheif-js (libheif compiled to JavaScript and WebAssembly), which decodes HEIC
  photos. It is loaded as its own module from `resources/app.asar/node_modules/libheif-js` and
  can be replaced there. Licence: `node_modules/libheif-js/LICENSE` inside the archive.
  https://github.com/catdad-experiments/libheif-js

## Build and test only, not shipped

TypeScript, Vite, electron-vite, ESLint, Prettier, Vitest and
Playwright. MIT and Apache-2.0. None of them is linked into a shipped file.

---

MIT licence text, as it applies to the MIT components above:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
