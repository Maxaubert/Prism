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

### ffmpeg (LGPL v3 or later as built, shared build)
BtbN's LGPL shared build (`ffmpeg-n9.0.1`, pinned in `tools/fetch-ffmpeg.mjs`), in
`resources/bin`. Shared on purpose: its DLLs can be replaced with your own build of the same
libraries. Licence: `resources/bin/LICENSE.txt`. https://ffmpeg.org,
https://github.com/BtbN/FFmpeg-Builds

The build links these libraries into its `av*.dll` and `sw*.dll` files, as its `configuration:`
line (`ffmpeg -version`) names them. Their own licence texts do not travel with the release zip; the
exact source and version of each is in BtbN's build scripts (`scripts.d`) at the pinned tag
`autobuild-2026-08-31-13-27`.

- **BSD, MIT, ISC and similar permissive licences**: dav1d, libaom, SVT-AV1, rav1e, libvpx,
  libwebp, libjxl, OpenJPEG, OpenH264, Kvazaar, vvenc, uavs3d, OpenAPV, LCEVC decoder, Opus,
  Ogg, Vorbis, Theora, libopenmpt, libvmaf, libxml2, HarfBuzz, FreeType (FreeType Licence),
  Fontconfig, libass, libaribcaption, librist, Snappy, zimg, LV2 (lilv, serd, sord, sratom),
  oneVPL, nv-codec-headers and AMF headers, the Vulkan and OpenCL headers and loader
  (Apache-2.0), opencore-amr (Apache-2.0), zlib and SDL2 (zlib licence), xz / liblzma (0BSD).
- **MPL-2.0**: libsrt, ZeroMQ.
- **LGPL** (v2.1 or later, or v3): libiconv, FriBidi, GMP, libssh, libbluray, Game Music Emu,
  LAME, TwoLAME, SoX Resampler, libplacebo, OpenAL Soft, Chromaprint, aribb24, ZVBI. Because
  aribb24 and GMP are LGPL v3, the build is configured with `--enable-version3` and ffmpeg as a
  whole is under LGPL v3 or later.

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

That `sndfile.dll` (libsndfile 1.2.2) has these built in, as its version strings show: Ogg and
Vorbis 1.3.7 and Opus 1.4 (BSD 3-clause, Xiph.Org), FLAC 1.4.2 (BSD 3-clause), and mpg123 and
LAME 3.100 (LGPL v2.1). The build that produced it is FluidSynth's own Windows CI at `v2.6.0`.
https://github.com/FluidSynth/fluidsynth

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
- **pdf.js support data**, copied from `pdfjs-dist` 6.2.108 into
  `resources/app.asar/out/renderer/pdf`, each folder with its own licence files:
  - `cmaps`: Adobe's character maps, BSD 3-clause (Adobe Systems), `cmaps/LICENSE`.
  - `standard_fonts`: the Foxit fonts (`*.pfb`), BSD 3-clause (PDFium Authors),
    `LICENSE_FOXIT`; Liberation Sans (`*.ttf`), SIL Open Font License 1.1 (Google, Red Hat),
    `LICENSE_LIBERATION`.
  - `wasm`: OpenJPEG, BSD 2-clause (`LICENSE_OPENJPEG`); JBIG2 from PDFium, BSD 3-clause
    (`LICENSE_JBIG2`); qcms, MIT (`LICENSE_QCMS`); Mozilla's wrappers round them, BSD and
    Apache-2.0 (`LICENSE_PDFJS_*`); QuickJS (`quickjs-eval.wasm`), MIT (Fabrice Bellard and
    Charlie Gordon), which carries no licence file of its own.
  - `iccs`: the CGATS001 compatible ICC profile, CC0 1.0, `iccs/LICENSE`.
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
