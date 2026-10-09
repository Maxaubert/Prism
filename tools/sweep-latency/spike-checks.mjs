// The native sweep box's offscreen checks (#338, task 1 step 2; task 4 step 5
// runs it again). Nothing on the owner's screen: every launch is the e2e's
// parked, unfocusable window (--e2e), on its OWN profile, so the owner's Prism
// (which holds the default profile's single-instance lock) is never touched.
//
//   npx electron-vite build
//   node tools/sweep-latency/spike-checks.mjs --out <dir> [--quits 50]
//
// Each launch: the thread starts and stops 100 times, the topmost target is
// made on the real window, a box is drawn for a second (button ignored), the
// idle second is counted, a box goes up again and app.quit() runs with it up.
// Every exit code must be 0 (0xc0000409 is the #127 abort).
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const out = resolve(opt('out', join(ROOT, '.e2e', 'sweep-spike-checks')))
const quits = Number(opt('quits', 50))
const extra = (opt('extra', '') || '').split(' ').filter(Boolean)
mkdirSync(out, { recursive: true })
if (!existsSync(MAIN)) throw new Error('Build first: npx electron-vite build')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

function launch(i) {
  const dir = join(out, `run-${String(i).padStart(2, '0')}`)
  mkdirSync(dir, { recursive: true })
  const check = join(dir, 'spike-check.json')
  const started = Date.now()
  const child = spawn(
    electronPath,
    [
      MAIN,
      `--user-data-dir=${join(out, 'profile')}`,
      '--e2e',
      '--sweep-spike',
      `--sweep-spike-log=${dir}`,
      `--sweep-spike-check=${check}`,
      '--sweep-spike-quit',
      ...extra
    ],
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
const first = runs.find((r) => r.result)?.result ?? null
const pick = (f) => ok.map((r) => f(r.result)).filter((v) => typeof v === 'number')
const range = (xs) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null)
const span = (get) => {
  const keys = ['ticks', 'commits', 'shownRows', 'workPctOfCore', 'cpuPctOfCoreCoarse', 'cyclesPerSecond', 'maxWorkUs', 'timeouts', 'occluded']
  return Object.fromEntries(keys.map((k) => [k, range(pick((x) => get(x)?.[k]))]))
}
const summary = {
  quits: runs.length,
  cleanExits: runs.filter((r) => r.code === 0).length,
  exitCodes: [...new Set(runs.map((r) => (r.code === null ? String(r.signal) : '0x' + (r.code >>> 0).toString(16))))],
  attachAllReady: ok.every((r) => r.result.attach?.state === 'ready'),
  attachHr: [...new Set(ok.map((r) => r.result.attach?.hr))],
  startStop: {
    cyclesPerRun: first?.startStop?.cycles,
    failedJoins: pick((x) => x.startStop?.failedJoins).reduce((a, b) => a + b, 0),
    worstJoinMs: range(pick((x) => x.startStop?.worstJoinMs))
  },
  thread: first?.thread,
  probe: first?.probe,
  boxUpStill2s: span((x) => x.up),
  boxUpMoving2s: span((x) => x.upMoving),
  idle2s: {
    wakeups: range(pick((x) => x.idle?.wakeups)),
    ticks: range(pick((x) => x.idle?.ticks))
  },
  launchMs: range(runs.map((r) => r.ms))
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ summary, runs }, null, 2))
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.cleanExits === runs.length && summary.attachAllReady ? 0 : 1)
