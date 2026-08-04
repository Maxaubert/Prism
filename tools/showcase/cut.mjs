/**
 * The edit's raw material: one take in, seven clips out.
 *
 * Finds the sync flash the shoot left at time zero, then cuts each beat against
 * the measured marks rather than a stopwatch. Clips come out all-intra so the
 * compositor can seek any frame exactly, which is what makes the render
 * deterministic instead of merely repeatable.
 *
 *   node tools/showcase/cut.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const RAW = join(ROOT, '.demo', 'raw.mp4')
const OUT = join(ROOT, 'videos', 'prism-showcase', 'assets')

const marks = JSON.parse(readFileSync(join(ROOT, '.demo', 'marks.json'), 'utf8'))
const at = (name) => {
  const m = marks.find((x) => x.name === name)
  if (!m) throw new Error(`no mark: ${name}`)
  return m.at
}

// Each clip is a span between two marks, trimmed to what the frame can hold.
const CLIPS = [
  { name: 'open', from: 'open', to: 'zoom', max: 5.2 },
  { name: 'zoom', from: 'zoom', to: 'tree', max: 5.4 },
  { name: 'tree', from: 'tree', to: 'video', max: 5.2 },
  // Lead: the first half second after the click is Prism decoding the file, which
  // is honest but reads as a blurred glitch at trailer speed.
  { name: 'video', from: 'video', to: 'audio', max: 6.4, lead: 0.8 },
  { name: 'audio', from: 'audio', to: 'settings', max: 4.4 },
  { name: 'style', from: 'settings', to: 'rest', max: 6.2 },
  { name: 'rest', from: 'rest', to: 'end', max: 1.8 }
]

/** The first frame the shoot painted white, and the first one after it. */
function zero() {
  // ffmpeg reports filter metadata on stderr, so this one is read there.
  const { stderr: out } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-t', '6', '-i', RAW, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
      '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  let t = null
  let last = null
  for (const line of out.split(/\r?\n/)) {
    const time = /pts_time:([\d.]+)/.exec(line)
    if (time) t = Number(time[1])
    const y = /YAVG=([\d.]+)/.exec(line)
    if (y && Number(y[1]) > 200 && t !== null) last = t
  }
  if (last === null) throw new Error('no sync flash found in the take')
  return last + 1 / 60
}

const t0 = zero()
mkdirSync(OUT, { recursive: true })
console.log(`sync flash ends at ${t0.toFixed(3)}s`)

for (const c of CLIPS) {
  const lead = c.lead ?? 0
  const start = t0 + at(c.from) + lead
  const span = Math.min(c.max, at(c.to) - at(c.from) - lead)
  const out = join(OUT, `${c.name}.mp4`)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', start.toFixed(3), '-t', span.toFixed(3), '-i', RAW,
    // Three pixels off each edge: the window's own rounded corners were cut
    // from the desktop, and the compositor rounds them again in CSS.
    '-vf', 'crop=2874:1794:3:3,scale=1440:900:flags=lanczos',
    '-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'slow',
    '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out
  ])
  console.log(`  ${c.name}.mp4  ${span.toFixed(1)}s`)
}
