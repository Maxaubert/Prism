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
 * Every attribute here is cosmetic: a missing helper (not built, not Windows)
 * is a no-op, never an error.
 *
 * Attributes: 33 DWMWA_WINDOW_CORNER_PREFERENCE (0 default, 1 do not round),
 * 34 DWMWA_BORDER_COLOR (a COLORREF 0x00BBGGRR, -1 default, -2 none).
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'

let exe: string | null = null
let queued: string[] = []
let flushing = false

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
    .find((p) => existsSync(p)) ?? null
  return exe
}

/** Everything asked for in this tick, in one process. */
function flush(): void {
  flushing = false
  const args = queued
  queued = []
  if (!exe || args.length === 0) return
  try {
    // stdio 'ignore' is the whole point: no pipe, so no first-pipe stall.
    const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true })
    child.on('error', () => {
      /* cosmetic: a helper that cannot start changes nothing */
    })
    child.unref()
  } catch {
    /* cosmetic */
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
