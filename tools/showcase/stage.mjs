/**
 * Choose a take per shot and prepare it for the edit.
 *
 * The recorder writes three takes of everything and scores them; this picks one,
 * trims the head and tail, and lays it into the project's assets at the size the
 * compositions expect. All-intra, so the renderer can seek any frame exactly.
 *
 *   node tools/showcase/stage.mjs                 # every shot, best take
 *   node tools/showcase/stage.mjs video=slow      # override one choice
 *
 * It prints the staged durations, which is what the compositions are timed
 * against: guessing them is how a clip ends on a freeze frame.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const SHOTS = join(ROOT, '.demo', 'shots')
const OUT = join(ROOT, 'videos', 'prism-showcase', 'assets')

/** Head and tail to drop, per shot. Everything has a little air by design. */
const TRIM = {
  audio: { head: 0.5 },
  'style-video': { head: 0.4 },
  'style-audio': { head: 0.4 },
  'style-many': { head: 0.3 },
  settings: { head: 0.3 },
  text: { head: 0.4 },
  handoff: { head: 0.5 }
}

const overrides = Object.fromEntries(
  process.argv.slice(2).map((a) => a.split('=')).filter((p) => p.length === 2)
)

const manifestPath = join(ROOT, '.demo', 'shots.js')
if (!existsSync(manifestPath)) throw new Error('no shots.js: run shots.mjs first')
const manifest = JSON.parse(
  readFileSync(manifestPath, 'utf8').replace(/^window\.SHOT_DATA = /, '').trim()
)

const seconds = (file) =>
  Number(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      encoding: 'utf8'
    }).stdout.trim()
  )

mkdirSync(OUT, { recursive: true })
const staged = []

for (const shot of manifest) {
  const want = overrides[shot.id]
  // An override can name a take the scorer disliked; otherwise only a take that
  // passed is eligible. Falling back to a failed take means staging a file with
  // no moov atom, which ffmpeg refuses and the edit would have shown as a hole.
  const chosen =
    (want && shot.takes.find((t) => t.pace === want)) ?? shot.takes.find((t) => t.ok)
  if (!chosen || !existsSync(join(SHOTS, chosen.file))) {
    console.log(`  ${shot.id.padEnd(18)} no usable take, skipped`)
    continue
  }

  const { head = 0.25, tail = 0.2 } = TRIM[shot.id] ?? {}
  const full = seconds(join(SHOTS, chosen.file))
  const span = Math.max(0.5, full - head - tail)
  const out = join(OUT, `${shot.id}.mp4`)

  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', head.toFixed(3), '-t', span.toFixed(3), '-i', join(SHOTS, chosen.file),
    // Three pixels off each edge: the window's rounded corners were cut out of
    // the desktop, and the compositions round them again in CSS.
    '-vf', 'crop=2874:1794:3:3,scale=1440:900:flags=lanczos',
    '-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'slow',
    '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out
  ])
  staged.push({ id: shot.id, take: chosen.pace, seconds: Number(span.toFixed(2)) })
  console.log(`  ${shot.id.padEnd(18)} ${chosen.pace.padEnd(6)} ${span.toFixed(2)}s`)
}

console.log(`\n${staged.length} staged in ${OUT}`)
console.log(JSON.stringify(Object.fromEntries(staged.map((s) => [s.id, s.seconds]))))
