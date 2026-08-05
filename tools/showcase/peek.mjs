/**
 * Open the dev build for a look, in its own profile.
 *
 * For the times a change has to be judged by eye rather than by a test. It uses
 * the recorder's throwaway profile, never the real one, so nothing here can
 * change the style, size or settings of the Prism you actually use.
 *
 *   node tools/showcase/peek.mjs                          # the player, as recorded
 *   node tools/showcase/peek.mjs mirror-caps              # a given visualizer
 *   node tools/showcase/peek.mjs clean-wall coast-road.mp3
 *
 * It leaves the window open and exits. Close it yourself.
 */
import { _electron as electron } from 'playwright-core'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const DEMO = join(ROOT, '.demo', 'PrismDemo')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PROFILE = join(tmpdir(), 'prism-peek-profile')

const viz = process.argv[2] ?? 'mirror-caps'
const file = process.argv[3] ?? 'coast-road.mp3'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SEED = {
  'prism.onboarded': '1',
  'prism.style': 'aurora',
  'prism.mode': 'dark',
  'prism.viz.style': viz,
  'prism.viz.theme': 'prism',
  'prism.viz.height': '41',
  'prism.viz.pos': '50',
  'prism.viz.width': 'full',
  'prism.viz.glow': '1',
  'prism.viz.cycle': '0',
  'prism.viz.move': '0',
  'prism.volume': '0.5'
}

rmSync(PROFILE, { recursive: true, force: true })
const seeder = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`] })
await (await seeder.firstWindow()).evaluate((kv) => {
  for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
}, SEED)
await sleep(400)
await seeder.close()
await sleep(900) // single instance: let the lock go before the real one starts

// Detached, so the window outlives this script and can be looked at properly.
spawn(ELECTRON, [MAIN, '--demo', `--user-data-dir=${PROFILE}`, join(DEMO, file)], {
  detached: true,
  stdio: 'ignore'
}).unref()

console.log(`${viz} on ${file}, in its own profile. Close the window when done.`)
