// The native sweep box's offscreen check (#338; task 1 step 2, again for the
// product addon in task 4). Nothing on the owner's screen: each launch is a
// bare Electron main (addon-check-main.mjs) with one offscreen, unfocusable
// window, so the owner's Prism is never touched.
//
//   npm run build:sweep
//   node tools/sweep-latency/addon-check.mjs [--out <dir>] [--quits 50]
//
// Each launch: the thread starts and stops 100 times, the topmost target is
// made on the real window, a box is up for two seconds (button ignored), the
// idle second is counted, a second window attaches and detaches, a box goes up
// again and app.quit() runs with it up. Every exit code must be 0 (0xc0000409
// is the PrismTerminal #127 abort).
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const out = resolve(opt('out', join(ROOT, '.e2e', 'sweep-addon-check')))
const quits = Number(opt('quits', 50))
const addon = join(ROOT, 'vendor', 'sweep', 'prism_sweep.node')
if (!existsSync(addon)) throw new Error('Build first: npm run build:sweep')
mkdirSync(out, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

function launch(i) {
  const check = join(out, `run-${String(i).padStart(2, '0')}.json`)
  const started = Date.now()
  const child = spawn(
    electronPath,
    [join(HERE, 'addon-check-main.mjs'), `--user-data-dir=${join(out, 'profile')}`, `--check-out=${check}`, `--addon=${addon}`],
    { env, stdio: 'ignore', windowsHide: true }
  )
  return new Promise((done) => {
    const timer = setTimeout(() => {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } catch {
        /* gone meanwhile */
      }
    }, 60_000)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      let result = null
      try {
        result = JSON.parse(readFileSync(check, 'utf8'))
      } catch {
        /* no result: the run failed before the checks finished */
      }
      done({ i, code, signal, ms: Date.now() - started, result })
    })
  })
}

const runs = []
for (let i = 1; i <= quits; i++) {
  const r = await launch(i)
  runs.push(r)
  const hex = r.code === null ? String(r.signal) : '0x' + (r.code >>> 0).toString(16)
  if (r.code !== 0 || !r.result) console.log(`run ${i}: exit ${hex}${r.result ? '' : ' (no check result)'}`)
}
const ok = runs.filter((r) => r.code === 0 && r.result)
const all = (f) => ok.length > 0 && ok.every((r) => f(r.result))
const range = (xs) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null)
const pick = (f) => ok.map((r) => f(r.result)).filter((v) => typeof v === 'number')
const summary = {
  quits: runs.length,
  cleanExits: runs.filter((r) => r.code === 0).length,
  exitCodes: [...new Set(runs.map((r) => (r.code === null ? String(r.signal) : '0x' + (r.code >>> 0).toString(16))))],
  attachReady: all((x) => x.attach === 'ready'),
  startStop: {
    failedJoins: pick((x) => x.startStop.failedJoins).reduce((a, b) => a + b, 0),
    notReady: pick((x) => x.startStop.notReady).reduce((a, b) => a + b, 0),
    worstJoinMs: range(pick((x) => x.startStop.worstJoinMs))
  },
  begin: all((x) => x.begin === true && x.beginAgain === true),
  upStill: { ticks: range(pick((x) => x.up.ticks)), commits: range(pick((x) => x.up.commits)), cpuPct: range(pick((x) => x.up.cpuPctOfCoreCoarse)) },
  upMoving: {
    ticks: range(pick((x) => x.upMoving.ticks)),
    commits: range(pick((x) => x.upMoving.commits)),
    cpuPct: range(pick((x) => x.upMoving.cpuPctOfCoreCoarse)),
    maxWorkUs: range(pick((x) => x.upMoving.maxWorkUs))
  },
  idle: { wakeups: range(pick((x) => x.idle.wakeups)), ticks: range(pick((x) => x.idle.ticks)) },
  secondWindow: all((x) => x.secondWindow === 'ready' && x.secondBegin === true && x.secondAfterDetach === 'none'),
  failures: range(pick((x) => x.stats.failures)),
  shutdownJoined: all((x) => x.shutdownJoined === true && x.shutdownAgain === true),
  launchMs: range(runs.map((r) => r.ms))
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ summary, runs }, null, 2))
console.log(JSON.stringify(summary, null, 2))
const pass =
  summary.cleanExits === runs.length &&
  summary.attachReady &&
  summary.begin &&
  summary.secondWindow &&
  summary.shutdownJoined &&
  summary.startStop.failedJoins === 0 &&
  summary.startStop.notReady === 0
process.exit(pass ? 0 : 1)
