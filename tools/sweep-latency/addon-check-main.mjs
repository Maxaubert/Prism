// One launch of the native sweep box's offscreen check (#338; run by
// addon-check.mjs, never by hand). A bare Electron main, not Prism: an
// offscreen, unfocusable window that never shows on the owner's screen, the
// built addon from vendor/sweep, and app.quit() with a box up at the end.
import { app, BrowserWindow, screen } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const out = arg('check-out')
const addonPath = arg('addon') || join(__dirname, '..', '..', 'vendor', 'sweep', 'prism_sweep.node')
const cycles = Number(arg('cycles') || 100)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const result = {}
const write = () => out && writeFileSync(out, JSON.stringify(result, null, 2))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: -4000,
    y: -4000,
    width: 800,
    height: 600,
    show: false,
    focusable: false,
    skipTaskbar: true,
    titleBarStyle: 'hidden'
  })
  await win.loadURL('data:text/html,<body style="background:%23202020"></body>')
  win.showInactive()
  await sleep(300)
  const m = { exports: {} }
  process.dlopen(m, addonPath)
  const a = m.exports
  const hwnd = win.getNativeWindowHandle()
  const waitReady = async () => {
    for (let i = 0; i < 300; i++) {
      const s = a.status(hwnd)
      if (s !== 'pending') return s
      await sleep(5)
    }
    return a.status(hwnd)
  }
  result.probe = a.probe()
  // The thread starts (with an attach) and stops, again and again.
  let failedJoins = 0
  let notReady = 0
  let worst = 0
  for (let i = 0; i < cycles; i++) {
    a.attach(hwnd)
    if ((await waitReady()) !== 'ready') notReady++
    const t0 = performance.now()
    if (!a.shutdown(250)) failedJoins++
    worst = Math.max(worst, performance.now() - t0)
  }
  result.startStop = { cycles, failedJoins, notReady, worstJoinMs: +worst.toFixed(3) }
  a.attach(hwnd)
  result.attach = await waitReady()
  // A box up with nobody's button held: the check alone ignores the button.
  a.configure({ ignoreButton: true })
  const dpr = win.webContents.getZoomFactor() * (screen.getDisplayMatching(win.getBounds()).scaleFactor)
  const b = win.getContentBounds()
  const box = {
    ax: Math.round(b.width * 0.3 * dpr),
    ay: Math.round(b.height * 0.3 * dpr),
    left: 0,
    top: 0,
    right: Math.round(b.width * dpr),
    bottom: Math.round(b.height * dpr),
    edge: Math.max(1, Math.round(dpr))
  }
  const span = async (ms, moving) => {
    const before = a.stats()
    let n = 0
    const step = moving ? setInterval(() => a.update(hwnd, { ...box, ax: box.ax + (n++ % 2), cause: 'scroll' }), 4) : null
    await sleep(ms)
    if (step) clearInterval(step)
    const after = a.stats()
    const d = (k) => after[k] - before[k]
    return {
      ms,
      ticks: d('ticks'),
      commits: d('commits'),
      frames: d('frames'),
      cpuPctOfCoreCoarse: +((d('cpuUs') / (ms * 1000)) * 100).toFixed(3),
      maxWorkUs: after.maxWorkUs,
      timeouts: d('timeouts'),
      occluded: d('occluded'),
      failures: after.failures,
      sampling: after.sampling,
      leadUs: after.leadUs
    }
  }
  result.begin = a.begin(hwnd, box, [40, 120, 255, 41], [200, 220, 255, 255])
  result.up = await span(1000, false)
  result.upMoving = await span(1000, true)
  a.end(hwnd)
  await sleep(100)
  const idle0 = a.stats()
  await sleep(1000)
  const idle1 = a.stats()
  result.idle = { ms: 1000, wakeups: idle1.idleWakes - idle0.idleWakes, ticks: idle1.ticks - idle0.ticks }
  // A second window's target beside the first, then gone again.
  const other = new BrowserWindow({ x: -4000, y: -3000, width: 300, height: 200, show: false, focusable: false, skipTaskbar: true })
  await other.loadURL('data:text/html,<body></body>')
  other.showInactive()
  const h2 = other.getNativeWindowHandle()
  a.attach(h2)
  for (let i = 0; i < 200 && a.status(h2) === 'pending'; i++) await sleep(5)
  result.secondWindow = a.status(h2)
  result.secondBegin = a.begin(h2, { ...box, right: 300, bottom: 200 }, [1, 2, 3, 4], [5, 6, 7, 8])
  await sleep(50)
  a.detach(h2)
  await sleep(50)
  result.secondAfterDetach = a.status(h2)
  other.destroy()
  // Up again, so the quit below quits with a box up.
  result.beginAgain = a.begin(hwnd, box, [40, 120, 255, 41], [200, 220, 255, 255])
  await sleep(100)
  result.stats = a.stats()
  write()
  // The product's order: will-quit shuts the thread down; the env cleanup
  // hook and a second call are harmless.
  app.once('will-quit', () => {
    result.shutdownJoined = a.shutdown(250)
    result.shutdownAgain = a.shutdown(250)
    write()
  })
  app.quit()
})
