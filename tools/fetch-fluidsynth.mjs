// Fetch the MIDI synthesiser Prism bundles, at build time, into vendor/fluidsynth.
//
// A .mid holds no sound: it is a score, and playing one means synthesising it
// from an instrument bank. ffmpeg cannot (its build has no fluidsynth), and
// Chromium never could, so Prism carries both halves - the synthesiser and a
// General MIDI soundfont.
//
//   FluidSynth   LGPL-2.1, from the project's own Windows release
//   FluidR3Mono  MIT (Frank Wen, mono conversion by Michael Cowgill), the
//                soundfont MuseScore ships, pinned by commit
//
// Both are verified by SHA-256 and neither is committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pinnedDownload, stampHolds, unzipFlat, writeStamp } from './lib/pinnedDownload.mjs'
import { ROOT } from './lib/repo.mjs'

const OUT = join(ROOT, 'vendor', 'fluidsynth')

const FS_URL = 'https://github.com/FluidSynth/fluidsynth/releases/download/v2.6.0/fluidsynth-v2.6.0-win10-x64-cpp11.zip'
const FS_SHA = '817262deacaa748edb3af6731dffe1766b00146790becfccc949a9f701e76681'
// SDL3 is only for fluidsynth's live audio output; Prism renders to a file.
const FS_WANTED = ['bin/fluidsynth.exe', 'bin/libfluidsynth-3.dll', 'bin/sndfile.dll']

const SF_COMMIT = '1a4bd0feb9378cd145418dbcb40246980ca1013d'
const SF_URL = `https://raw.githubusercontent.com/musescore/MuseScore/${SF_COMMIT}/share/sound/FluidR3Mono_GM.sf3`
const SF_SHA = '2aacd036d7058d40a371846ef2f5dc5f130d648ab3837fe2626591ba49a71254'

// The release zip carries no licence text, and LGPL asks that it travel with
// the binary, so both licences are fetched beside their artifacts.
const FS_LIC_URL = 'https://raw.githubusercontent.com/FluidSynth/fluidsynth/v2.6.0/LICENSE'
const FS_LIC_SHA = '20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95'
const SF_LIC_URL = `https://raw.githubusercontent.com/musescore/MuseScore/${SF_COMMIT}/share/sound/FluidR3Mono_License.md`
const SF_LIC_SHA = 'cf1889febeafd2b0a20c2c82359245524fc7dba29ded336cc3b51e0bcfdc8b84'

const want = FS_SHA + ' ' + SF_SHA + ' ' + FS_LIC_SHA
if (stampHolds(OUT, 'fluidsynth.exe', want)) {
  console.log('fluidsynth: vendor/fluidsynth is already current')
  process.exit(0)
}

const get = (url, sha, what) => pinnedDownload('fluidsynth', url, sha, { what })
const zipBuf = await get(FS_URL, FS_SHA, 'FluidSynth 2.6.0 (3 MB)')
const sf = await get(SF_URL, SF_SHA, 'the FluidR3Mono soundfont (24 MB)')
const fsLic = await get(FS_LIC_URL, FS_LIC_SHA, "FluidSynth's licence")
const sfLic = await get(SF_LIC_URL, SF_LIC_SHA, "the soundfont's licence")

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

await unzipFlat('fluidsynth', zipBuf, FS_WANTED, OUT)
writeFileSync(join(OUT, 'soundfont.sf3'), sf)
writeFileSync(join(OUT, 'LICENSE-fluidsynth.txt'), fsLic)
writeFileSync(join(OUT, 'LICENSE-soundfont.md'), sfLic)
writeStamp(OUT, want)
console.log('fluidsynth: unpacked the synthesiser and its soundfont into vendor/fluidsynth')
