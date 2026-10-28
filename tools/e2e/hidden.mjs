// THE E2E RUNS ON ITS OWN WINDOWS DESKTOP (owner, 2026-10-28: "going forward
// can you do your e2e or testing headless. the current way is constantly
// stealing focus and distracting whatever im currently doing").
//
// Parking the window offscreen and making it unfocusable (run.mjs `park()`,
// `--e2e`) was not enough: the suite also starts helpers and windows of its
// own, and any of them can come to the front. So the whole run moves to a
// second desktop in the same window station (CreateDesktop, HiddenDesktop.cs):
// nothing on it can take the foreground of the owner's desktop, every process
// the run starts inherits it, and Chromium still renders and screenshots there
// (measured 2026-10-28: diagLog, explorerSide and listScrollbar green, shots
// drawn). Output goes to a file this script follows, so the terminal still
// sees every line, and the exit code is the run's.
//
// Usage: node tools/e2e/hidden.mjs tools/e2e/run.mjs [args...]
// Runs directly (no second desktop) under CI, or with PRISM_E2E_DESKTOP=same.
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const [script, ...args] = process.argv.slice(2)
const direct = !!process.env.CI || process.env.PRISM_E2E_DESKTOP === 'same' || process.platform !== 'win32'

if (direct) {
  const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', cwd: root })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  const logDir = join(root, '.e2e')
  mkdirSync(logDir, { recursive: true })
  const log = join(logDir, 'hidden-run.log')
  writeFileSync(log, '')
  const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
  const cmd = `cmd.exe /d /c "${[quote(process.execPath), quote(script), ...args.map(quote)].join(' ')} > ${quote(log)} 2>&1"`
  const ps = [
    `Add-Type -Path '${join(here, 'HiddenDesktop.cs')}'`,
    `exit [HiddenDesktop]::Run('prism-e2e-${process.pid}', $env:PRISM_E2E_HIDDEN_CMD, '${root}')`
  ].join('; ')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PRISM_E2E_HIDDEN_CMD: cmd, PRISM_E2E_DESKTOP: 'hidden' },
    windowsHide: true
  })
  // Follow the log: print what the run wrote since the last look.
  let at = 0
  const follow = () => {
    try {
      const size = statSync(log).size
      if (size <= at) return
      const fd = openSync(log, 'r')
      const buf = Buffer.alloc(size - at)
      readSync(fd, buf, 0, buf.length, at)
      closeSync(fd)
      at = size
      process.stdout.write(buf)
    } catch {
      /* not there yet */
    }
  }
  const timer = setInterval(follow, 250)
  child.on('exit', (code) => {
    clearInterval(timer)
    follow()
    process.exit(code ?? 1)
  })
}
