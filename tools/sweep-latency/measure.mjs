// The spike's measured run in ONE command (#338, task 1 step 4). It needs the
// owner at the screen: it opens a dev Prism there and records while HE drags.
// PASSIVE: nothing is injected and nothing is clicked for him.
//
//   node tools/sweep-latency/measure.mjs --out <dir> [--runs native,dom,both]
//        [--sampling tick|late] [--lead-us 2000] [--seconds-scale 1]
//        [--keep-open] [--no-beep] [--parked]
//
// For each run it starts a dev Prism on its OWN profile in <dir> (never the
// owner's: his Prism holds the default profile's single-instance lock and is
// never closed), opened on a test folder of 400 files, waits for the spike to
// report the window's place, records with sweep-latency.exe for the run's
// phases (a beep at each change, the phase printed here), then asks that Prism
// to quit (a file it watches; only its own process is ever killed, and only if
// it has not gone 15 s later). Then analyze.mjs writes <dir>/summary.json and
// <dir>/summary.txt.
//
//   native: --sweep-spike        the native box, today's band hidden
//   dom:    --sweep-spike=dom    today's DOM box, unchanged (the hook only
//                                reports colours and timings)
//   both:   --sweep-spike=both   both drawn: the origin at rest and K[cause]
//
// --parked is a check of this command itself, never a measurement: Prism runs
// as the e2e does (--e2e: offscreen, unfocusable), so nothing appears on the
// screen and the recordings hold no box.
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const ADDON = join(ROOT, 'native', 'sweep', 'build', 'Release', 'prism_sweep.node')
const TOOL = join(HERE, 'build', 'sweep-latency.exe')

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)
const OUT = resolve(opt('out', join(ROOT, '.e2e', 'sweep-latency')))
const RUNS = opt('runs', 'native,dom,both').split(',').filter(Boolean)
const SAMPLING = opt('sampling', 'tick')
const LEAD = opt('lead-us', '2000')
const SCALE = Number(opt('seconds-scale', '1'))

// What the owner does in each phase. The tool beeps at every change.
const SWEEP_PHASES = [
  ['rest', 5, 'Press in the empty part of the list, drag down and to the right a little, then HOLD STILL with the button down.'],
  ['slow', 12, 'Keep holding. SLOW sweeps: down and up, then left and right. Release and press again whenever you like.'],
  ['medium', 12, 'MEDIUM speed sweeps: down and up, then left and right.'],
  ['fast', 12, 'FAST sweeps: down and up, then left and right, as fast as you would really move.'],
  ['escape', 8, 'Start a sweep, press Escape while still holding, then release. Repeat a few times.'],
  ['autoscroll', 8, 'Drag past the bottom of the list so it scrolls by itself, then back up past the top.'],
  ['wheel', 8, 'Hold the button still in the list with the box open, and turn the mouse wheel a few notches each way.']
]
const BOTH_PHASES = [SWEEP_PHASES[0], SWEEP_PHASES[5], SWEEP_PHASES[6]]
const phasesFor = (run) => (run === 'both' ? BOTH_PHASES : SWEEP_PHASES).map(([n, s, t]) => [n, Math.max(2, Math.round(s * SCALE)), t])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// ---- prerequisites --------------------------------------------------------------
function ensureBuilt() {
  if (!existsSync(ADDON)) {
    console.log('building the native addon (node-gyp)...')
    const node = JSON.parse(execFileSync(electronPath, ['-p', 'JSON.stringify(process.versions.node)'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }))
    const r = spawnSync('npx', ['--no-install', 'node-gyp', 'rebuild', `--target=${node}`, '--arch=x64'], { cwd: join(ROOT, 'native', 'sweep'), stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('node-gyp failed')
  }
  if (!existsSync(TOOL)) {
    const r = spawnSync(process.execPath, [join(HERE, 'build.mjs')], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('building sweep-latency.exe failed')
  }
  if (!existsSync(MAIN) || has('rebuild')) {
    const r = spawnSync('npx', ['electron-vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('electron-vite build failed')
  }
}

/** 400 files and a few folders: enough rows to sweep and to auto-scroll. */
function ensureFolder() {
  const folder = join(OUT, 'sweep-folder')
  if (existsSync(join(folder, 'file-0400.txt'))) return folder
  mkdirSync(folder, { recursive: true })
  for (let i = 1; i <= 12; i++) mkdirSync(join(folder, `folder-${String(i).padStart(2, '0')}`), { recursive: true })
  for (let i = 1; i <= 400; i++) writeFileSync(join(folder, `file-${String(i).padStart(4, '0')}.txt`), `sweep test file ${i}\n`)
  return folder
}

/** A fresh profile: past onboarding, the sidebar open, one Explorer tab on the folder. */
function seedProfile(profile, folder) {
  const prefs = join(profile, 'window-preferences')
  mkdirSync(prefs, { recursive: true })
  for (const [key, value] of Object.entries({
    'prism.onboarded': '1',
    'prism.sidebar': '1',
    'prism.newtab.mode': 'folder',
    'prism.newtab.folder': folder
  }))
    writeFileSync(join(prefs, createHash('sha256').update(key).digest('hex') + '.json'), JSON.stringify({ key, value }))
  const explorer = {
    id: 'sweep-explorer',
    role: 'explorer',
    pinned: true,
    root: folder,
    browse: { path: folder, history: [{ path: folder, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } }], cursor: 0, surface: 'folder', preview: false },
    panes: [],
    open: [folder]
  }
  writeFileSync(join(profile, 'tabs.json'), JSON.stringify({ active: 0, tabs: [explorer] }))
}

async function waitFor(test, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = test()
    if (v) return v
    await sleep(200)
  }
  return null
}

async function oneRun(run, folder) {
  const dir = join(OUT, run)
  mkdirSync(dir, { recursive: true })
  const profile = join(OUT, `profile-${run}`)
  if (!existsSync(join(profile, 'tabs.json'))) seedProfile(profile, folder)
  const quitFile = join(dir, 'quit')
  const flag = run === 'native' ? '--sweep-spike' : `--sweep-spike=${run}`
  const args = [
    MAIN,
    `--user-data-dir=${profile}`,
    flag,
    `--sweep-spike-log=${dir}`,
    `--sweep-spike-quit-file=${quitFile}`,
    `--sweep-spike-mode=${SAMPLING}`,
    `--sweep-spike-lead-us=${LEAD}`,
    ...(has('parked') ? ['--e2e'] : [])
  ]
  console.log(`\n=== run "${run}": starting Prism (${flag}) on its own profile`)
  const child = spawn(electronPath, args, { env, stdio: 'ignore' })
  const info = await waitFor(() => {
    try {
      const i = JSON.parse(readFileSync(join(dir, 'spike-info.json'), 'utf8'))
      return i.ready ? i : null
    } catch {
      return null
    }
  }, 60_000)
  if (!info) throw new Error(`run ${run}: Prism did not report ready within 60 s`)
  if (run !== 'dom' && info.attached?.state !== 'ready')
    console.log(`WARNING: the native target is ${info.attached?.state} (hr 0x${(info.attached?.hr >>> 0).toString(16)}); the native box will not draw`)
  const c = info.client
  const rect = c ? `${c.x},${c.y},${c.x + c.width},${c.y + c.height}` : null
  const phases = phasesFor(run)
  console.log('Prism is up. The phases (a beep at each change):')
  for (const [n, s, t] of phases) console.log(`  ${n.padEnd(10)} ${String(s).padStart(3)} s  ${t}`)
  console.log('Recording starts in 5 seconds: bring Prism to the front, nothing else needs to change.')
  await sleep(has('parked') ? 500 : 5000)
  const tool = spawnSync(
    TOOL,
    ['--out', dir, '--phases', phases.map(([n, s]) => `${n}:${s}`).join(','), ...(rect ? ['--rect', rect] : []), ...(has('no-beep') ? ['--no-beep'] : [])],
    { stdio: 'inherit' }
  )
  if (tool.status !== 0) console.log(`WARNING: sweep-latency exited ${tool.status}`)
  if (has('keep-open')) return dir
  writeFileSync(quitFile, '')
  const gone = await Promise.race([new Promise((r) => child.once('exit', (code) => r({ code }))), sleep(15_000).then(() => null)])
  if (!gone) {
    console.log('Prism did not quit within 15 s: ending that one process (pid ' + child.pid + ')')
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* gone meanwhile */
    }
  } else if (gone.code !== 0) console.log(`NOTE: the spike Prism exited with 0x${(gone.code >>> 0).toString(16)}`)
  return dir
}

ensureBuilt()
mkdirSync(OUT, { recursive: true })
const folder = ensureFolder()
console.log(`out: ${OUT}\ntest folder: ${folder}\nruns: ${RUNS.join(', ')}  sampling: ${SAMPLING}`)
console.log('Wind off or at 1x for the measured part: a magnified image puts the box in Wind\'s pixels.')
const dirs = []
for (const run of RUNS) dirs.push(await oneRun(run, folder))
console.log('\n=== analysing')
spawnSync(process.execPath, [join(HERE, 'analyze.mjs'), ...dirs, '--out', join(OUT, 'summary.json')], { stdio: 'inherit' })
