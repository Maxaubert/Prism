/**
 * DWM attributes, set by a tiny program that Prism starts per change (#189).
 *
 * THIS USED TO BE ONE RESIDENT POWERSHELL (2026-09-03): each change had spawned
 * a fresh powershell.exe and paid `Add-Type`'s C# compile, about two seconds,
 * so a window leaving fullscreen got its edge back two seconds late. The fix
 * was to start one PowerShell, compile once, and write "<hwnd> <attr> <value>"
 * lines to its STDIN over a pipe held open for the life of the app.
 *
 * AND THAT PIPE COST EVERY LAUNCH ABOUT 900 ms (measured 2026-09-22, #189). In
 * Electron's main process, the first child started with a held-open stdin
 * pipe blocks the UI thread for 850-900 ms (a second one takes 4 ms; with no
 * pipe the first takes 7 ms; in plain Node 3-12 ms, so it is Electron's, not
 * Windows' or Defender's). Prism started it inside `showWindow`, and the
 * window's first frame waited on the thread it blocked: 1.18 s from process
 * start to a visible window, against 0.36 s without it.
 *
 * So the compile moved to BUILD time: native/dwm/PrismDwm.cs, built by
 * tools/build-dwm.mjs with the .NET Framework compiler every Windows carries
 * (the Win+E helper's route), shipped in resources/dwm. It is started per
 * change with NO PIPES AT ALL and exits when done, so there is no process to
 * keep warm, nothing to restart when it dies, and nothing that talks to a
 * pipe. Changes made in the same tick (a border and a corner, a window and its
 * shroud) go in ONE process, since the program takes any number of triples.
 *
 * AND IT IS STARTED FROM A WORKER THREAD, NEVER MAIN'S (2026-10-12; owner,
 * "handle this", after e2e runs showed main freezing with nothing in flight).
 * Starting a process is synchronous on the thread that starts it: the lag
 * profiler (lagProfiler.ts) caught `spawn` of this helper holding main for
 * 405 ms as a window was shown (e2e `tabs`), with no JavaScript of Prism's
 * around it, and the same call is made on every theme, maximize and
 * fullscreen change. One resident worker (started with the helper found,
 * unref'd so it never holds a quit) takes each tick's triples and pays the
 * start on its own thread, the way the drive-label query does (#351). Still
 * no pipe to the helper: stdio 'ignore', so #189's first-pipe stall cannot
 * come back.
 *
 * Every attribute here is cosmetic: a missing helper (not built, not Windows)
 * or a worker that cannot start is a no-op, never an error.
 *
 * Attributes: 33 DWMWA_WINDOW_CORNER_PREFERENCE (0 default, 1 do not round),
 * 34 DWMWA_BORDER_COLOR (a COLORREF 0x00BBGGRR, -1 default, -2 none).
 */
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { Worker } from 'worker_threads'

let exe: string | null = null
let queued: string[] = []
let flushing = false
let worker: Worker | null = null

/** The worker's whole program: start the helper with what it is sent, no pipe
 *  (stdio 'ignore', #189), and never let a failure out. Builtins only, so it
 *  runs from a string with nothing to resolve. */
export const DWM_WORKER = `
const { parentPort } = require('worker_threads')
const { spawn } = require('child_process')
parentPort.on('message', (m) => {
  try {
    const child = spawn(m.exe, m.args, { stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {}
})
`

/** The resident worker, started once and again only after it died. */
function spawner(): Worker | null {
  if (worker) return worker
  try {
    const w = new Worker(DWM_WORKER, { eval: true })
    w.unref()
    const gone = (): void => {
      if (worker === w) worker = null
    }
    w.on('error', gone)
    w.on('exit', gone)
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** Where the helper can be: the installed app's resources, else a vendor/
 *  folder at or above the app (a dev build, the e2e's out/ build). */
export function dwmDirs(packaged: boolean, resourcesPath: string, appPath: string): string[] {
  const dirs: string[] = []
  if (packaged) dirs.push(join(resourcesPath, 'dwm'))
  let up = appPath
  for (let i = 0; i < 4; i++) {
    dirs.push(join(up, 'vendor', 'dwm'))
    const parent = dirname(up)
    if (parent === up) break
    up = parent
  }
  return dirs
}

/** Find the helper once, at startup. Absent, every change is a no-op. */
export function initDwmHelper(packaged: boolean, resourcesPath: string, appPath: string): string | null {
  exe = dwmDirs(packaged, resourcesPath, appPath)
    .map((d) => join(d, 'PrismDwm.exe'))
    .find((p) => existsSync(p)) ?? null // sync-ok: startup, module top level before ready, once
  // Started now, so the first window's edge does not wait for a thread.
  if (exe) spawner()
  return exe
}

/** Everything asked for in this tick, in one process, started by the worker. */
function flush(): void {
  flushing = false
  const args = queued
  queued = []
  if (!exe || args.length === 0) return
  try {
    spawner()?.postMessage({ exe, args })
  } catch {
    /* cosmetic: a helper that cannot start changes nothing */
  }
}

function send(hwnd: string, attribute: number, value: number): void {
  if (!exe) return
  queued.push(hwnd, String(attribute), String(value))
  if (flushing) return
  flushing = true
  setImmediate(flush)
}

/** The HWND as a decimal string, from Electron's native handle buffer. */
export function hwndOf(buf: Buffer): string {
  return (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString()
}

/** Square or default corners while the window is up. */
export function setCornersRounded(hwnd: string, rounded: boolean): void {
  send(hwnd, 33, rounded ? 0 : 1)
}

/** `'none'` strips the border, `'default'` gives DWM's back, a hex colour
 *  (`#rrggbb`) draws it in that colour - the way to a QUIETER edge, since the
 *  border is always one physical pixel and only its contrast can change. */
export function setBorder(hwnd: string, colour: 'none' | 'default' | `#${string}`): void {
  if (colour === 'none') return send(hwnd, 34, -2)
  if (colour === 'default') return send(hwnd, 34, -1)
  send(hwnd, 34, colorrefOf(colour))
}

/** The fullscreen fade includes transient restored bounds, even when both
 * endpoints cover the display. Keep the edge hidden until the fade finishes. */
export function borderColourForWindow(state: {
  maximized: boolean
  fullscreen: boolean
  transitioning: boolean
  light: boolean
}): 'none' | `#${string}` {
  if (state.maximized || state.fullscreen || state.transitioning) return 'none'
  return state.light ? '#c9ccd3' : '#34373d'
}

/** A CSS hex colour as a Win32 COLORREF, which is 0x00BBGGRR - red in the
 *  LOW byte, the reverse of the hex string. Pure, and tested, because a
 *  swapped channel is a border that is quietly the wrong colour. */
export function colorrefOf(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (b << 16) | (g << 8) | r
}
