/**
 * Plate one of the trailer: Prism, driven by a script, recorded off the screen.
 *
 * The pointer you see is not the mouse. The real one never moves; a drawn
 * cursor is injected into the page and tweened, and the actual input events are
 * posted to the window under it. That is the whole point of doing it this way:
 * a hand-held recording wanders and overshoots, and this one lands on the pixel
 * it meant to, at the same speed, every take.
 *
 * It also writes marks.json, the time each beat began. The edit cuts against
 * those measured times rather than times anybody guessed, so a beat that runs
 * long moves the cut instead of breaking it.
 *
 *   node tools/showcase/media.mjs      # build the folder it browses (once)
 *   node tools/showcase/showcase.mjs   # shoot   → .demo/raw.mp4 + marks.json
 *   node tools/showcase/trailer.mjs    # cut     → docs/media/showcase.mp4 + .gif
 *
 * Takes about 40 seconds, and the window sits on top while it runs.
 */
import { _electron as electron } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const DEMO = join(ROOT, '.demo', 'PrismDemo')
const RAW = join(ROOT, '.demo', 'raw.mp4')
// Never the real profile: the recording changes the style twice and the mode
// once, and none of that should land on whoever is sitting here.
const PROFILE = join(tmpdir(), 'prism-showcase-profile')

const WIN = { w: 1280, h: 800, x: 200, y: 70 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Settings the recording assumes, written once into a throwaway profile. */
const SEED = {
  'prism.onboarded': '1',
  'prism.style': 'aurora',
  'prism.mode': 'dark',
  'prism.viz.theme': 'accent',
  'prism.viz.barTheme': 'accent',
  'prism.viz.glow': '1',
  'prism.viz.cycle': '0',
  'prism.viz.move': '0',
  'prism.volume': '0.7',
  'prism.sidebar': '0'
}

/**
 * The drawn cursor. Injected rather than built into the app, so nothing about
 * the recording rig ships in the product.
 */
const CURSOR = `(() => {
  if (window.__pc) return
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 26 30')
  svg.setAttribute('width', '25')
  svg.setAttribute('height', '29')
  svg.style.cssText = 'position:absolute;left:0;top:0;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))'
  svg.innerHTML = '<path d="M2 1.6 L2 24.6 L8.4 18.6 L12.4 27.6 L16.2 25.8 L12.2 17.1 L20.6 16.6 Z" ' +
    'fill="#fff" stroke="rgba(8,8,12,.9)" stroke-width="1.5" stroke-linejoin="round"/>'
  const ring = document.createElement('div')
  ring.style.cssText = 'position:absolute;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;' +
    'border-radius:999px;border:2px solid #fff;opacity:0'
  wrap.append(ring, svg)
  document.body.appendChild(wrap)

  let x = ${WIN.w / 2}, y = ${WIN.h - 120}
  const put = () => {
    svg.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    ring.style.left = x + 'px'
    ring.style.top = y + 'px'
  }
  put()
  // Symmetric ease. Nothing overshoots: the cursor is meant to read as aimed,
  // not as a hand arriving.
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

  window.__pc = {
    at: () => [x, y],
    to(tx, ty, ms) {
      const sx = x, sy = y, t0 = performance.now()
      return new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms)
          const e = ease(k)
          x = sx + (tx - sx) * e
          y = sy + (ty - sy) * e
          put()
          k < 1 ? requestAnimationFrame(step) : done()
        }
        requestAnimationFrame(step)
      })
    },
    tap() {
      ring.animate(
        [
          { transform: 'scale(.35)', opacity: 0.85 },
          { transform: 'scale(1.25)', opacity: 0 }
        ],
        { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' }
      )
    }
  }
})()`

async function main() {
  rmSync(PROFILE, { recursive: true, force: true })
  mkdirSync(dirname(RAW), { recursive: true })

  // --- pass one: write the settings the recording assumes, then quit ---------
  const seeder = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`] })
  const seedWin = await seeder.firstWindow()
  await seedWin.evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, SEED)
  await sleep(400) // let Chromium flush localStorage before the process goes
  await seeder.close()

  // --- pass two: the take ---------------------------------------------------
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${PROFILE}`, join(DEMO, 'coastline-dawn.jpg')]
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // On top and pinned, so nothing of the desktop can wander into frame.
  const scale = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'screen-saver')
    return screen.getPrimaryDisplay().scaleFactor
  })
  await app.evaluate(({ BrowserWindow }, b) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setBounds({ x: b.x, y: b.y, width: b.w, height: b.h })
    w.focus()
  }, WIN)

  await sleep(1400) // the first image decodes and settles
  await page.evaluate(CURSOR)

  // --- the camera -----------------------------------------------------------
  // Desktop Duplication, cropped to the window in physical pixels, so the whole
  // pipeline stays on the GPU until the encoder wants it.
  const px = (v) => Math.round(v * scale)
  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-init_hw_device', 'd3d11va',
      '-filter_complex',
      `ddagrab=output_idx=0:framerate=60:draw_mouse=0:video_size=${px(WIN.w)}x${px(WIN.h)}` +
        `:offset_x=${px(WIN.x)}:offset_y=${px(WIN.y)},hwdownload,format=bgra`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '14', '-pix_fmt', 'yuv420p',
      RAW
    ],
    { stdio: ['pipe', 'ignore', 'inherit'] }
  )
  await sleep(900) // ffmpeg opens the duplication device before frame one

  // --- the moves ------------------------------------------------------------
  /** Glide the drawn cursor there, and let the real pointer land just before it does. */
  const move = async (x, y, ms = 620) => {
    const glide = page.evaluate(([a, b, c]) => window.__pc.to(a, b, c), [x, y, ms])
    await sleep(ms * 0.8)
    await page.mouse.move(x, y)
    await glide
  }
  const click = async (x, y) => {
    await page.evaluate(() => window.__pc.tap())
    await page.mouse.click(x, y)
  }
  const at = async (locator) => {
    const b = await locator.boundingBox()
    if (!b) throw new Error('nothing to aim at')
    return [b.x + b.width / 2, b.y + b.height / 2]
  }
  const go = async (locator, ms) => {
    const [x, y] = await at(locator)
    await move(x, y, ms)
    await click(x, y)
  }
  // One white frame, so the edit knows where zero is. ffmpeg's device opens
  // whenever it opens; rather than guess that latency, the take starts with a
  // flash the cutter can find, and every mark below is measured from it.
  await page.evaluate(
    () =>
      new Promise((done) => {
        const flash = document.createElement('div')
        flash.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147483646'
        document.body.appendChild(flash)
        setTimeout(() => {
          flash.remove()
          done()
        }, 80)
      })
  )

  // Every beat records the second it began, measured from the flash. The edit
  // cuts against these, so a beat that runs long moves the cut with it.
  const t0 = Date.now()
  const marks = []
  const beat = async (label, ms, fn) => {
    marks.push({ name: label, at: (Date.now() - t0) / 1000 })
    console.log(`  ${label}`)
    if (fn) await fn()
    await sleep(ms)
  }

  await beat('open', 1500)

  await beat('browse', 900, async () => {
    // Two, not three: the third lands on the deliberately soft night street, and
    // "look closer" is a poor claim to make over a photograph that is out of focus.
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('ArrowRight')
      await sleep(950)
    }
  })

  await beat('zoom', 800, async () => {
    await move(700, 420, 560)
    // Far enough in that the pan never reaches an edge: a strip of background
    // sliding into frame reads as a bug, not a gesture.
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, -240)
      await sleep(200)
    }
  })

  await beat('pan', 700, async () => {
    await page.mouse.down()
    const glide = page.evaluate(() => window.__pc.to(540, 350, 900))
    for (let i = 1; i <= 6; i += 1) {
      await sleep(150)
      await page.mouse.move(700 - (160 * i) / 6, 420 - (70 * i) / 6)
    }
    await glide
    await page.mouse.up()
  })

  await beat('fit', 800, () => page.keyboard.press('0'))

  await beat('tree', 900, () => page.keyboard.press('Control+b'))

  await beat('drag', 900, async () => {
    // The panel is resizable, so the trailer resizes it: a handle nobody drags
    // looks like a border.
    const grip = page.getByLabel('Resize file tree')
    const b = await grip.boundingBox()
    const y = b.y + b.height / 2
    await move(b.x + b.width / 2, y, 560)
    await page.mouse.down()
    const glide = page.evaluate(([x, y]) => window.__pc.to(x, y, 850), [b.x + 118, y])
    for (let i = 1; i <= 7; i += 1) {
      await sleep(120)
      await page.mouse.move(b.x + b.width / 2 + (118 * i) / 7, y)
    }
    await glide
    await page.mouse.up()
  })

  await beat('subfolder', 800, () => go(page.getByRole('treeitem', { name: 'Video' }), 700))

  await beat('video', 2600, () => go(page.getByRole('treeitem', { name: 'wave-study.mp4' }), 620))

  await beat('scrub', 1500, async () => {
    const bar = page.locator('[class~="group/bar"]').first()
    const b = await bar.boundingBox()
    const y = b.y + b.height / 2
    await move(b.x + b.width * 0.44, y, 560)
    await click(b.x + b.width * 0.44, y)
  })

  await beat('fade', 2200, () => move(640, 330, 700))

  await beat('audio', 3600, () => go(page.getByRole('treeitem', { name: 'coast-road.mp3' }), 700))

  await beat('settings', 900, () => go(page.getByRole('button', { name: 'Settings' }), 700))

  await beat('terminal', 1600, () => go(page.getByRole('button', { name: 'Terminal' }).first(), 620))

  await beat('light', 2000, () =>
    go(page.getByRole('button', { name: 'Light', exact: true }).first(), 560)
  )

  await beat('dark', 400, () =>
    go(page.getByRole('button', { name: 'Dark', exact: true }).first(), 560)
  )
  await beat('aurora', 1500, () => go(page.getByRole('button', { name: 'Aurora' }).first(), 520))

  await beat('rest', 1800, () => page.keyboard.press('Escape'))
  marks.push({ name: 'end', at: (Date.now() - t0) / 1000 })

  // --- cut ------------------------------------------------------------------
  ff.stdin.write('q')
  await new Promise((r) => ff.on('close', r))
  await app.close()
  writeFileSync(join(ROOT, '.demo', 'marks.json'), JSON.stringify(marks, null, 2))
  console.log(`\nraw take: ${RAW}`)
  console.log(marks.map((m) => `  ${m.at.toFixed(1)}s ${m.name}`).join('\n'))
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})
