/**
 * Builds the video loop setup plays, from a source clip.
 *
 *     node build/installer/make-loop.cjs "C:\\path\\to\\clip.mp4"
 *
 * Out: build/installer/media/<1440|960>/v/000.jpg ...   the loop
 *
 * Three things worth knowing:
 *

 *  - The clip does not loop, so we make it loop. The last K frames are
 *    crossfaded onto the first K, which leaves frame 59 running into frame 0
 *    with a smaller step than an ordinary frame-to-frame one.
 *
 *  - The install page cannot animate: NSIS runs the section on the script
 *    thread, so nothing can call back into script while files are being
 *    written. That screen draws frame 30 once and lets the progress bar move.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SRC = process.argv[2]
const HERE = __dirname
const MEDIA = path.join(HERE, 'media')

const START = 0.05     // from the top: the whole clip, not a window into it
const LEN = 17.35
const FPS = 24         // this source runs at 23.976, so 24 keeps them one to one
const N = 380          // frames: the whole clip, end to end
const K = 36           // of which this many are crossfaded, a second and a half
// No grade. The clip is already monochrome, so a hue rotation would do nothing
// to it anyway, and it was asked for untouched.
const GRADE = ''
// One size for every display. The overlay stays per DPI so the type is always
// sharp, but the footage is defocused ink: a 960 to 1440 upscale is invisible on
// it, and halving the payload is what buys twenty seconds at twenty four frames.
// 800x600 for a 960 or 1440 window. Defocused ink is the one subject where an
// upscale costs nothing visible, and at fourteen hundred frames every pixel of
// width is megabytes. The type is a separate overlay and stays native.
const SIZES = [{ w: 800, h: 600, q: 62 }]

const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })

if (!SRC || !fs.existsSync(SRC)) {
  console.error('usage: node make-loop.cjs <source clip>')
  process.exit(1)
}

for (const { w, h, q } of SIZES) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-loop-'))
  const raw = path.join(tmp, 'raw')
  fs.mkdirSync(raw)

  // straight from the master: graded, cover-cropped to the window, at its size
  run('ffmpeg', ['-y', '-v', 'error', '-ss', String(START), '-t', String(LEN), '-i', SRC,
    '-vf', [`fps=${FPS}`, GRADE, `scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`]
      .filter(Boolean).join(','),
    path.join(raw, '%03d.png')])

  // However many frames the source really yielded: asking for one more than
  // exists is the difference between a loop and a crash.
  const have = fs.readdirSync(raw).length
  const n = Math.min(N, have - K)
  if (n < K * 2) throw new Error(`only ${have} frames available, need at least ${K * 3}`)

  const f = (i) => path.join(raw, `${String(i + 1).padStart(3, '0')}.png`)
  const vdir = path.join(MEDIA, String(w), 'v')
  fs.rmSync(vdir, { recursive: true, force: true })
  fs.mkdirSync(vdir, { recursive: true })

  for (let i = 0; i < n; i++) {
    const dst = path.join(vdir, `${String(i).padStart(3, '0')}.jpg`)
    if (i < K) {
      // out[i] = frame[N+i] fading out under frame[i] fading in, so that the
      // wrap from the last frame back to the first one is already in progress
      const pct = Math.round((100 * i) / K)
      const blend = path.join(tmp, 'b.png')
      run('magick', [f(n + i), f(i), '-define', `compose:args=${pct}`, '-compose', 'blend', '-composite', blend])
      run('magick', [blend, '-quality', String(q), '-sampling-factor', '4:2:0', '-strip', dst])
    } else {
      run('magick', [f(i), '-quality', String(q), '-sampling-factor', '4:2:0', '-strip', dst])
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  const bytes = fs.readdirSync(vdir).reduce((n, x) => n + fs.statSync(path.join(vdir, x)).size, 0)
  console.log(`${w}x${h}: ${n} frames of ${have} available, ${(bytes / 1e6).toFixed(1)} MB`)
  console.log(`   set FRAMES to ${n} in video.nsh`)
}
