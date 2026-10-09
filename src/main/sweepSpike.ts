/**
 * SPIKE (#338, task 1), REVERTED AT THE END OF THE TASK with its two hooks in
 * index.ts, the preload's `prismSweepSpike` and the block in useSweep. It loads
 * the native sweep addon behind `--sweep-spike`, draws the box from the press
 * point the renderer's test hook hands over, and writes what the measuring tool
 * (tools/sweep-latency) needs next to it. Nothing here runs without the flag.
 *
 *   --sweep-spike[=native|dom|both]  native: the native box, the DOM band hidden.
 *                                    dom: today's DOM box, its edge painted
 *                                    lime so the tool finds it and nothing
 *                                    else (a marked row's edge is the band's
 *                                    hue); its place and timing are today's.
 *                                    both: both drawn, the native box edge
 *                                    only (the K and origin run; measure.mjs
 *                                    shifts it with --sweep-spike-origin so
 *                                    the two edges never cover each other).
 *   --sweep-spike-log=<dir>          where spike-info.json, spike-events.jsonl and
 *                                    native-frames.csv go (default userData/sweep-spike)
 *   --sweep-spike-mode=tick|late     sample at the clock tick, or late in the frame
 *   --sweep-spike-lead-us=<n>        late mode: sample this long before the next frame
 *   --sweep-spike-k=auto:2,scroll:0,resize:2   anchor delays in frames
 *   --sweep-spike-origin=<x>,<y>     client-to-target offset in physical px
 *   --sweep-spike-quit-file=<path>   quit (app.quit) when this file appears
 *   --sweep-spike-check=<json>       the offscreen checks (task 1 step 2), then
 *                                    leave a box up; with --sweep-spike-quit, quit
 */
import { app, ipcMain, screen, type BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Rgba = [number, number, number, number]
interface PhysBox { ax: number; ay: number; left: number; top: number; right: number; bottom: number; edge: number }
interface Addon {
  probe(): { build: number; clock: boolean; remote: boolean }
  start(): boolean
  shutdown(ms: number): boolean
  attach(hwnd: Buffer): boolean
  detach(): void
  status(): { state: 'none' | 'pending' | 'ready' | 'failed'; hr: number }
  begin(box: PhysBox, fill: Rgba, edge: Rgba): boolean
  update(box: PhysBox, cause: string): void
  end(): void
  configure(c: Record<string, unknown>): void
  stats(): Record<string, number | boolean>
  takeLog(): Float64Array
  qpc(): number
  qpcFreq(): number
}
interface CssMsg {
  anchor: { x: number; y: number }
  clip: { left: number; top: number; right: number; bottom: number }
  dpr: number
  fill?: string
  edge?: string
  cause?: string
}

/** The spike's own box colours: magenta survives a red/blue swap, and no theme uses it. */
const NATIVE_FILL: Rgba = [255, 0, 255, 48]
const NATIVE_EDGE: Rgba = [255, 0, 255, 255]
const LOG_COLS = 12

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : ''
}

export function sweepSpikeMode(): 'native' | 'dom' | 'both' | null {
  const v = arg('sweep-spike')
  if (v === undefined) return null
  return v === 'dom' || v === 'both' ? v : 'native'
}

/** Chromium's computed colours: rgb(), rgba(), color(srgb r g b / a). */
export function parseCss(s: string | undefined): Rgba | null {
  if (!s) return null
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s.trim())
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [+m[1], +m[2], +m[3], Math.round(a * 255)].map((v) => Math.round(v)) as Rgba
  }
  m = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\s*\)$/.exec(s.trim())
  if (m) {
    const c = (v: string): number => Math.round(Math.min(1, Math.max(0, parseFloat(v))) * 255)
    return [c(m[1]), c(m[2]), c(m[3]), m[4] === undefined ? 255 : c(m[4])]
  }
  return null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function initSweepSpike(win: BrowserWindow): void {
  const mode = sweepSpikeMode()
  if (!mode) return
  const dir = arg('sweep-spike-log') || join(app.getPath('userData'), 'sweep-spike')
  mkdirSync(dir, { recursive: true })
  const eventsFile = join(dir, 'spike-events.jsonl')
  const framesFile = join(dir, 'native-frames.csv')
  const infoFile = join(dir, 'spike-info.json')
  const origin = (arg('sweep-spike-origin') ?? '0,0').split(',').map(Number)
  const [ox, oy] = [Number.isFinite(origin[0]) ? origin[0] : 0, Number.isFinite(origin[1]) ? origin[1] : 0]
  const k = Object.fromEntries(
    (arg('sweep-spike-k') ?? '').split(',').filter(Boolean).map((p) => {
      const [name, v] = p.split(':')
      return [name, Number(v)]
    })
  )

  // In both, the native box has no fill: its tint over the DOM band's edges
  // would move their colour out of the analysis' tolerance.
  const nativeFill: Rgba = mode === 'both' ? [NATIVE_FILL[0], NATIVE_FILL[1], NATIVE_FILL[2], 0] : NATIVE_FILL

  let addon: Addon | null = null
  let loadError = ''
  // Loaded in every mode, so every run's events carry the same QPC clock as the
  // measuring tool; only native and both attach and draw.
  {
    for (const p of [
      join(__dirname, '..', '..', 'native', 'sweep', 'build', 'Release', 'prism_sweep.node'),
      join(__dirname, '..', '..', 'vendor', 'sweep', 'prism_sweep.node')
    ]) {
      if (!existsSync(p)) continue
      try {
        const m = { exports: {} as unknown }
        process.dlopen(m as NodeModule, p)
        addon = m.exports as Addon
        break
      } catch (err) {
        loadError = String(err)
      }
    }
    if (!addon && !loadError) loadError = 'missing: run node-gyp in native/sweep'
  }
  const qpc = (): number => (addon ? addon.qpc() : Number(process.hrtime.bigint() / 100n))
  const event = (kind: string, fields: object): void => {
    try {
      appendFileSync(eventsFile, JSON.stringify({ kind, qpc: qpc(), ...fields }) + '\n')
    } catch {
      /* the spike's log is best effort */
    }
  }
  const flushFrames = (): void => {
    if (!addon) return
    const rows = addon.takeLog()
    if (!rows.length) return
    let out = existsSync(framesFile) ? '' : 'tick_qpc,sample_qpc,cursor_x,cursor_y,left,top,right,bottom,shown,committed,commit_qpc,frame\n'
    for (let i = 0; i < rows.length; i += LOG_COLS) out += Array.from(rows.subarray(i, i + LOG_COLS)).join(',') + '\n'
    appendFileSync(framesFile, out)
  }

  let info: Record<string, unknown> = {
    pid: process.pid,
    mode,
    ready: false,
    loadError: loadError || undefined,
    probe: addon?.probe(),
    qpcFreq: addon ? addon.qpcFreq() : 10_000_000,
    nativeFill,
    nativeEdge: NATIVE_EDGE,
    origin: [ox, oy],
    k,
    samplingMode: arg('sweep-spike-mode') === 'late' ? 'late' : 'tick',
    leadUs: Number(arg('sweep-spike-lead-us') ?? 2000)
  }
  const writeInfo = (more: Record<string, unknown>): void => {
    info = { ...info, ...more }
    writeFileSync(infoFile, JSON.stringify(info, null, 2))
  }
  writeInfo({})

  const toPhys = (m: CssMsg): PhysBox => ({
    ax: Math.round(m.anchor.x * m.dpr) + ox,
    ay: Math.round(m.anchor.y * m.dpr) + oy,
    left: Math.floor(m.clip.left * m.dpr) + ox,
    top: Math.floor(m.clip.top * m.dpr) + oy,
    right: Math.ceil(m.clip.right * m.dpr) + ox,
    bottom: Math.ceil(m.clip.bottom * m.dpr) + oy,
    edge: Math.max(1, Math.round(m.dpr))
  })
  const fromPage = (e: Electron.IpcMainEvent): boolean => e.sender === win.webContents

  ipcMain.on('sweep-spike:begin', (e, m: CssMsg) => {
    if (!fromPage(e)) return
    const phys = toPhys(m)
    const ok = addon && mode !== 'dom' ? addon.begin(phys, nativeFill, NATIVE_EDGE) : false
    event('begin', { css: m, phys, ok })
    writeInfo({ domFill: parseCss(m.fill), domEdge: parseCss(m.edge), dpr: m.dpr, clipPhys: phys, client: clientRect() })
  })
  ipcMain.on('sweep-spike:update', (e, m: CssMsg) => {
    if (!fromPage(e)) return
    const phys = toPhys(m)
    if (addon && mode !== 'dom') addon.update(phys, m.cause ?? 'auto')
    event('update', { cause: m.cause, css: m, phys })
  })
  ipcMain.on('sweep-spike:end', (e, m: { reason?: string }) => {
    if (!fromPage(e)) return
    addon?.end()
    event('end', { reason: m?.reason })
    setTimeout(() => {
      flushFrames()
      if (addon) event('stats', addon.stats())
    }, 100)
  })

  const clientRect = (): Electron.Rectangle | null =>
    win.isDestroyed() ? null : screen.dipToScreenRect(win, win.getContentBounds())

  const shutdown = (): void => {
    if (!addon) return
    flushFrames()
    const joined = addon.shutdown(250)
    event('shutdown', { joined })
  }
  app.once('will-quit', shutdown)
  process.once('exit', () => addon?.shutdown(250))

  /** The colours today's band would have, from the theme in force. */
  const bandColours = async (): Promise<{ fill: Rgba | null; edge: Rgba | null }> => {
    const [fill, edge] = (await win.webContents.executeJavaScript(`(() => {
      const el = document.createElement('div')
      el.style.cssText = 'position:fixed;left:-99px;top:-99px;width:8px;height:8px;' +
        'background:color-mix(in srgb, var(--p-sel-hue) 16%, transparent);' +
        'border:1px solid color-mix(in srgb, var(--p-sel-hue-hi) 45%, var(--p-text))'
      ;(document.getElementById('root') ?? document.body).appendChild(el)
      const cs = getComputedStyle(el)
      const out = [cs.backgroundColor, cs.borderTopColor]
      el.remove()
      return out
    })()`)) as [string, string]
    return { fill: parseCss(fill), edge: parseCss(edge) }
  }

  win.webContents.once('did-finish-load', () => {
    // After the first paint (#189): nothing on the startup path.
    setTimeout(() => void ready(), 400)
  })

  const ready = async (): Promise<void> => {
    if (win.isDestroyed()) return
    let attached: { state: string; hr: number } | null = null
    if (addon && mode !== 'dom') {
      addon.configure({
        mode: arg('sweep-spike-mode') === 'late' ? 'late' : 'tick',
        leadUs: Number(arg('sweep-spike-lead-us') ?? 2000),
        kAuto: k.auto ?? 0,
        kScroll: k.scroll ?? 0,
        kResize: k.resize ?? 0
      })
      if (arg('sweep-spike-check') !== undefined) await checks(addon)
      addon.attach(win.getNativeWindowHandle())
      attached = await waitReady(addon)
    }
    const colours = await bandColours().catch(() => ({ fill: null, edge: null }))
    const dpr = (await win.webContents.executeJavaScript('devicePixelRatio').catch(() => null)) as number | null
    writeInfo({ ready: true, attached, domFill: colours.fill, domEdge: colours.edge, dpr, client: clientRect() })
    event('ready', { attached })
    if (addon && mode !== 'dom' && arg('sweep-spike-check') !== undefined) await checksAttached(addon)
    const quitFile = arg('sweep-spike-quit-file')
    if (quitFile) {
      const poll = setInterval(() => {
        if (existsSync(quitFile)) {
          clearInterval(poll)
          app.quit()
        }
      }, 200)
    }
  }

  const waitReady = async (a: Addon): Promise<{ state: string; hr: number }> => {
    for (let i = 0; i < 300; i++) {
      const s = a.status()
      if (s.state !== 'pending') return s
      await sleep(10)
    }
    return a.status()
  }

  // ---- task 1 step 2: the offscreen checks ---------------------------------
  const result: Record<string, unknown> = {}
  const checks = async (a: Addon): Promise<void> => {
    // The thread starts and stops 100 times.
    let worst = 0
    let failedJoins = 0
    for (let i = 0; i < 100; i++) {
      a.start()
      await sleep(1)
      const t0 = performance.now()
      if (!a.shutdown(250)) failedJoins++
      worst = Math.max(worst, performance.now() - t0)
    }
    result.startStop = { cycles: 100, failedJoins, worstJoinMs: +worst.toFixed(3) }
  }
  const checksAttached = async (a: Addon): Promise<void> => {
    const out = arg('sweep-spike-check') || join(dir, 'spike-check.json')
    result.probe = a.probe()
    result.attach = a.status()
    // A box up with nobody's button held: the check ignores the button.
    a.configure({ ignoreButton: true })
    const bounds = win.getContentBounds()
    const dpr = screen.getDisplayMatching(win.getBounds()).scaleFactor
    const css = {
      anchor: { x: bounds.width * 0.3, y: bounds.height * 0.3 },
      clip: { left: 0, top: 0, right: bounds.width, bottom: bounds.height },
      dpr
    }
    const phys = toPhys(css)
    const span = async (ms: number, moving: boolean): Promise<Record<string, unknown>> => {
      const before = a.stats()
      a.takeLog()
      // Moving: the anchor steps a pixel every 4 ms, so nearly every frame
      // commits, as a real sweep does (nothing is sent to the cursor).
      let n = 0
      const step = moving ? setInterval(() => a.update({ ...phys, ax: phys.ax + (n++ % 2) }, 'auto'), 4) : null
      await sleep(ms)
      if (step) clearInterval(step)
      const after = a.stats()
      const rows = a.takeLog()
      let shownRows = 0
      for (let i = 0; i < rows.length; i += LOG_COLS) if (rows[i + 8] === 1) shownRows++
      const d = (key: string): number => Number(after[key]) - Number(before[key])
      return {
        ms,
        ticks: d('ticks'),
        commits: d('commits'),
        logRows: rows.length / LOG_COLS,
        shownRows,
        // The loop's own wake-to-commit time, an upper bound on its CPU (the
        // thread's kernel times move in 15.6 ms steps and say little here).
        workPctOfCore: +((d('workUs') / (ms * 1000)) * 100).toFixed(3),
        cpuPctOfCoreCoarse: +((d('cpuUs') / (ms * 1000)) * 100).toFixed(3),
        cyclesPerSecond: Math.round(d('cycles') / (ms / 1000)),
        maxWorkUs: after.maxWorkUs,
        timeouts: d('timeouts'),
        occluded: d('occluded'),
        failures: after.failures
      }
    }
    result.begin = a.begin(phys, NATIVE_FILL, NATIVE_EDGE)
    const still = await span(2000, false)
    const moving = await span(2000, true)
    const up = a.stats()
    result.up = still
    result.upMoving = moving
    result.thread = { awareness: up.awareness, pmv2: up.pmv2 }
    a.end()
    await sleep(100)
    const idle0 = a.stats()
    await sleep(2000)
    const idle1 = a.stats()
    result.idle = {
      ms: 2000,
      wakeups: Number(idle1.idleWakes) - Number(idle0.idleWakes),
      ticks: Number(idle1.ticks) - Number(idle0.ticks),
      cpuUs: Number(idle1.cpuUs) - Number(idle0.cpuUs)
    }
    // Up again, so a quit that follows quits with a box up.
    result.beginAgain = a.begin(phys, NATIVE_FILL, NATIVE_EDGE)
    await sleep(100)
    writeFileSync(out, JSON.stringify(result, null, 2))
    if (process.argv.includes('--sweep-spike-quit')) app.quit()
  }
}
