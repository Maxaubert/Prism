/**
 * The shot list. Every clip is its own take, its own file, its own launch.
 *
 * One long recording meant a fluffed beat cost the whole thing; these are
 * independent, so any one can be re-shot on its own:
 *
 *   node tools/showcase/shots.mjs                      # everything, one take
 *   node tools/showcase/shots.mjs style-video          # just that one
 *   node tools/showcase/shots.mjs --takes 3 rename     # three goes at it
 *
 * Takes exist because the capture is not always sound: desktop duplication
 * shares the machine with whatever else is drawing, and a take shot while
 * something else owns the compositor comes back frozen or half black. Each take
 * paces itself differently, every take is scored for frozen and black frames,
 * and the lab plays them side by side so the good one can be chosen by eye.
 *
 * Output lands in .demo/shots/ with a manifest, and .demo/lab.html plays them
 * back one at a time for review.
 *
 * The pointer is drawn, not the mouse: the real one never moves. The style
 * switches go through the app's own setters (the --demo hook), because the
 * alternative is opening Settings, and Settings covers the thing being shown.
 */
import { _electron as electron } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const DEMO = join(ROOT, '.demo', 'PrismDemo')
const OUT = join(ROOT, '.demo', 'shots')
const PROFILE = join(tmpdir(), 'prism-showcase-profile')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
/** Detached instances started by a shot, so they can be cleaned up by handle. */
const strays = []

const WIN = { w: 1280, h: 800, x: 200, y: 70 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* Each take runs the same script at a different pace. Not for variety: a take
   that failed because something arrived late fails differently when everything
   is given more room, so three paces beat three identical attempts. */
const PACE = [
  { name: 'even', wait: 1, settle: 1.5, roll: 0.9 },
  { name: 'slow', wait: 1.35, settle: 2.6, roll: 1.4 },
  { name: 'brisk', wait: 0.85, settle: 2, roll: 0.8 }
]

/**
 * Score a take without watching it.
 *
 * The first version called any still frame a fault and flagged every take at
 * 85%, which is what a picture viewer showing a picture looks like: correct, and
 * completely still. What actually goes wrong is a capture that stops — one long
 * unbroken freeze — or one that comes back black. So: the longest still RUN, not
 * the total.
 */
function inspect(file) {
  const read = (filter, key) => {
    const { stderr } = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-i', file, '-vf', filter, '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
    return (stderr.match(new RegExp(key + '=([0-9.]+)', 'g')) ?? []).map((m) =>
      Number(m.split('=')[1])
    )
  }
  const motion = read(
    'tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    'YAVG'
  )
  const luma = read('signalstats,metadata=print:key=lavfi.signalstats.YAVG', 'YAVG')
  if (motion.length < 30 || !luma.length) return { ok: false, why: 'unreadable or far too short' }

  let run = 0
  let worst = 0
  for (const m of motion) {
    run = m < 0.08 ? run + 1 : 0
    worst = Math.max(worst, run)
  }
  const frozen = worst / 60 // frames to seconds; the capture is 60fps
  const lit = luma.reduce((a, b) => a + b, 0) / luma.length
  const why =
    frozen > 3.5
      ? `stopped for ${frozen.toFixed(1)}s`
      : lit < 6
        ? 'nearly black'
        : motion.length / 60 < 2
          ? 'too short to use'
          : ''
  return { ok: !why, why, frozen: Number(frozen.toFixed(2)), luma: Number(lit.toFixed(1)) }
}

/* ---------------------------------------------------------------- the shots */
/* Each one: which file it opens on, what it is for, and what it does. `hold`
   is the tail left running after the last action so the clip does not end on a
   movement. */

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
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  window.__pc = {
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
        [{ transform: 'scale(.35)', opacity: 0.85 }, { transform: 'scale(1.25)', opacity: 0 }],
        { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' }
      )
    }
  }
})()`

const SHOTS = {
  open: {
    file: 'coastline-dawn.jpg',
    note: 'A photograph is already open. Arrow keys page through the folder.',
    run: async (k) => {
      await k.wait(1.3)
      for (const _ of [0, 1]) {
        await k.key('ArrowRight')
        await k.wait(1.15)
      }
    }
  },

  zoom: {
    file: 'glacier.jpg',
    note: 'Wheel zoom past 200%, a drag across the frame, then 0 to fit again.',
    run: async (k) => {
      await k.wait(0.7)
      await k.move(700, 420, 560)
      for (const _ of [0, 1, 2, 3, 4]) {
        await k.page.mouse.wheel(0, -240)
        await k.wait(0.2)
      }
      await k.wait(0.5)
      await k.drag(700, 420, 540, 350, 900)
      await k.wait(0.8)
      await k.key('0')
      await k.wait(1)
    }
  },

  tree: {
    file: 'coastline-dawn.jpg',
    note: 'Ctrl+B opens the tree, the panel is dragged wider, a subfolder opens.',
    run: async (k) => {
      await k.wait(0.6)
      await k.tree(true)
      await k.wait(0.5)
      const grip = await k.box(k.page.getByLabel('Resize file tree'))
      await k.drag(grip.x + 2, grip.y + grip.height / 2, grip.x + 122, grip.y + grip.height / 2, 850)
      await k.wait(0.8)
      await k.go(k.page.getByRole('treeitem', { name: 'Video' }), 650)
      await k.wait(1.1)
    }
  },

  video: {
    file: 'Video/wave-study.mp4',
    note: 'A video playing, the seek bar clicked, then the chrome fading out.',
    run: async (k) => {
      await k.wait(2)
      const bar = await k.box(k.page.locator('[class~="group/bar"]').first())
      await k.move(bar.x + bar.width * 0.42, bar.y + bar.height / 2, 560)
      await k.click(bar.x + bar.width * 0.42, bar.y + bar.height / 2)
      await k.wait(1.4)
      await k.move(640, 330, 700)
      await k.wait(2.2)
    }
  },

  audio: {
    file: 'coast-road.mp3',
    note: 'Cover art and the circular visualizer, running in the accent colour.',
    run: async (k) => {
      await k.wait(4.5)
    }
  },

  delete: {
    file: 'coastline-dawn.jpg',
    note: 'Delete goes to the Recycle Bin, so the one destructive-looking key is not.',
    run: async (k) => {
      await k.wait(0.6)
      await k.tree(true)
      await k.wait(0.5)
      await k.go(k.page.getByRole('treeitem', { name: 'spare.jpg' }), 650)
      await k.wait(0.6)
      await k.key('Delete')
      await k.wait(1.3)
      // The dialog says where the file goes, which is the whole point of the
      // shot: confirm it, and watch the row leave.
      await k.go(k.page.getByRole('button', { name: 'Delete', exact: true }), 620)
      await k.wait(1.8)
    }
  },

  /* The three the whole feature exists for: the look changes while the file
     keeps running. No Settings, no pause, no reload. */
  'style-video': {
    file: 'Video/wave-study.mp4',
    note: 'The style changes four times while the video plays. Nothing stops.',
    run: async (k) => {
      await k.wait(1.6)
      for (const id of ['terminal', 'driftwood', 'acrylic-red', 'aurora']) {
        await k.style(id)
        await k.wait(1.45)
      }
    }
  },

  'style-photo': {
    file: 'dunes.jpg',
    note: 'Dark to light and back: the whole window repaints around the picture.',
    run: async (k) => {
      await k.wait(1.2)
      await k.tree(true)
      await k.wait(0.6)
      await k.mode('light', 'daybreak')
      await k.wait(1.6)
      await k.style('paper')
      await k.wait(1.5)
      await k.style('frost')
      await k.wait(1.5)
      await k.mode('dark', 'aurora')
      await k.wait(1.5)
    }
  },

  'style-audio': {
    file: 'coast-road.mp3',
    note: 'The visualizer takes each style’s accent as the style changes.',
    run: async (k) => {
      await k.wait(1.6)
      for (const id of ['terminal', 'acrylic-red', 'driftwood', 'new-void', 'aurora']) {
        await k.style(id)
        await k.wait(1.35)
      }
    }
  },

  rename: {
    file: 'coastline-dawn.jpg',
    note: 'F2 renames in the tree. Nothing here is destroyed: the bin catches everything.',
    run: async (k) => {
      await k.wait(0.6)
      await k.tree(true)
      await k.wait(0.5)
      await k.go(k.page.getByRole('treeitem', { name: 'dunes.jpg' }), 650)
      await k.wait(0.5)
      await k.key('F2')
      await k.wait(0.6)
      // No select-all: the field opens with the stem already selected and the
      // extension left alone. Ctrl+A takes the extension with it, and the file
      // comes out with no type at all.
      await k.type('dunes-at-dawn', 55)
      await k.wait(0.5)
      await k.key('Enter')
      await k.wait(1.4)
    },
    // Put the name back, or the next take starts from a different folder.
    after: async (k) => {
      await k.go(k.page.getByRole('treeitem', { name: 'dunes-at-dawn.jpg' }), 400)
      await k.key('F2')
      await k.wait(0.4)
      await k.type('dunes', 20)
      await k.key('Enter')
      await k.wait(0.8)
    }
  },

  text: {
    file: 'notes.md',
    note: 'Markdown, plain text and source read in the same window as everything else.',
    run: async (k) => {
      await k.wait(1.4)
      await k.page.mouse.wheel(0, 260)
      await k.wait(1.6)
    }
  },

  /* ------------------------------------------------ what it opens, and how */

  kinds: {
    file: 'atrium.jpg',
    note: 'One folder, three kinds. The arrow key does not care which is next.',
    run: async (k) => {
      await k.wait(1.1)
      await k.key('ArrowRight') // an mp3, so the visualizer takes over
      await k.wait(2.1)
      await k.key('ArrowRight') // and back to a photograph
      await k.wait(1.6)
    }
  },

  portrait: {
    file: 'still-life.jpg',
    note: 'A tall picture and a wide one, each fitted without being asked.',
    run: async (k) => {
      await k.wait(1.5)
      await k.key('ArrowLeft')
      await k.wait(1.6)
      await k.key('ArrowRight')
      await k.wait(1.4)
    }
  },

  rotate: {
    file: 'atrium.jpg',
    note: 'R turns the picture a quarter at a time; 0 puts it back.',
    run: async (k) => {
      await k.wait(0.9)
      await k.key('r')
      await k.wait(1.2)
      await k.key('r')
      await k.wait(1.2)
      await k.key('0')
      await k.wait(1.2)
    }
  },

  'zoom-deep': {
    file: 'glacier.jpg',
    note: 'All the way in, and a long look around at 400%.',
    run: async (k) => {
      await k.wait(0.7)
      await k.move(760, 380, 520)
      for (const _ of [0, 1, 2, 3, 4, 5, 6, 7]) {
        await k.page.mouse.wheel(0, -240)
        await k.wait(0.16)
      }
      await k.wait(0.4)
      await k.drag(760, 380, 520, 470, 1000)
      await k.wait(0.3)
      await k.drag(520, 470, 780, 330, 1000)
      await k.wait(0.8)
    }
  },

  /* ------------------------------------------------------ the player, up close */

  seek: {
    file: 'Video/wave-study.mp4',
    note: 'Arrow keys jump five seconds; comma and period walk it a frame at a time.',
    run: async (k) => {
      await k.wait(1.4)
      await k.key('ArrowRight')
      await k.wait(0.8)
      await k.key('ArrowRight')
      await k.wait(0.9)
      await k.key(' ')
      await k.wait(0.7)
      for (const _ of [0, 1, 2, 3, 4, 5]) {
        await k.key('.')
        await k.wait(0.22)
      }
      await k.wait(0.7)
      await k.key(' ')
      await k.wait(1.2)
    }
  },

  speed: {
    file: 'Video/wave-study.mp4',
    note: 'Playback speed, from the transport rather than a settings page.',
    run: async (k) => {
      await k.wait(1.5)
      await k.go(k.page.getByTitle('Speed'), 620)
      await k.wait(0.9)
      // The menu is set with a multiplication sign, not the letter x.
      await k.go(k.page.getByRole('button', { name: /^1\.5/ }).first(), 520)
      await k.wait(1.8)
    }
  },

  /* ---------------------------------------------------------------- the tree */

  'tree-menu': {
    file: 'coastline-dawn.jpg',
    note: 'Right-click in the tree: rename and delete, where you would look for them.',
    run: async (k) => {
      await k.wait(0.6)
      await k.tree(true)
      await k.wait(0.6)
      const row = await k.box(k.page.getByRole('treeitem', { name: 'glacier.jpg' }))
      await k.move(row.x + 70, row.y + row.height / 2, 620)
      await k.page.evaluate(() => window.__pc.tap())
      await k.page.mouse.click(row.x + 70, row.y + row.height / 2, { button: 'right' })
      await k.wait(1.8)
      await k.key('Escape')
      await k.wait(0.8)
    }
  },

  'tree-walk': {
    file: 'coastline-dawn.jpg',
    note: 'Clicking down the tree: every file opens in the window beside it.',
    run: async (k) => {
      await k.wait(0.6)
      await k.tree(true)
      await k.wait(0.5)
      for (const name of ['dunes.jpg', 'rain-street.jpg', 'notes.md', 'still-life.jpg']) {
        await k.go(k.page.getByRole('treeitem', { name }), 520)
        await k.wait(1.05)
      }
    }
  },

  /* ------------------------------------------------------------- the settings */

  'settings-viz': {
    file: 'coast-road.mp3',
    note: 'The visualizer page changes the visualizer while it is running.',
    run: async (k) => {
      await k.wait(0.7)
      await k.go(k.page.getByRole('button', { name: 'Settings' }), 700)
      await k.wait(0.8)
      await k.go(k.page.getByRole('button', { name: 'Visualizer' }).first(), 620)
      await k.wait(1.4)
      await k.go(k.page.getByRole('switch', { name: 'Cycle' }).first(), 560)
      await k.wait(1.6)
      await k.go(k.page.getByRole('switch', { name: 'Move' }).first(), 520)
      await k.wait(1.8)
    }
  },

  'settings-general': {
    file: 'coastline-dawn.jpg',
    note: 'General: how far the arrow keys are allowed to walk, and what opens Prism.',
    run: async (k) => {
      await k.wait(0.7)
      await k.go(k.page.getByRole('button', { name: 'Settings' }), 700)
      await k.wait(0.8)
      await k.go(k.page.getByRole('button', { name: 'General' }).first(), 620)
      await k.wait(2.4)
      await k.page.mouse.wheel(0, 300)
      await k.wait(1.8)
    }
  },

  /* -------------------------------------------------------------- the look, live */

  'mode-audio': {
    file: 'coast-road.mp3',
    note: 'Light and dark, with the visualizer never missing a frame.',
    run: async (k) => {
      await k.wait(1.6)
      await k.mode('light', 'daybreak')
      await k.wait(2.2)
      await k.mode('dark', 'aurora')
      await k.wait(1.8)
    }
  },

  'style-text': {
    file: 'notes.md',
    note: 'The chrome wears the style; the writing stays in a face built for reading.',
    run: async (k) => {
      await k.wait(1.2)
      await k.tree(true)
      await k.wait(0.5)
      for (const id of ['terminal', 'driftwood', 'aurora']) {
        await k.style(id)
        await k.wait(1.5)
      }
    }
  },

  'style-many': {
    file: 'glacier.jpg',
    note: 'Eight styles in one run, dark and light, on one picture.',
    run: async (k) => {
      await k.wait(1)
      await k.tree(true)
      await k.wait(0.5)
      for (const id of ['default', 'new-void', 'terminal', 'driftwood', 'acrylic-red']) {
        await k.style(id)
        await k.wait(1.15)
      }
      await k.mode('light', 'daybreak')
      await k.wait(1.15)
      for (const id of ['paper', 'frost', 'linen']) {
        await k.style(id)
        await k.wait(1.15)
      }
      await k.mode('dark', 'aurora')
      await k.wait(1.5)
    }
  },

  /* One process, one window: opening a second file hands it to the one already
     running, which is the whole reason Prism feels instant on the second file. */
  handoff: {
    file: 'coastline-dawn.jpg',
    note: 'A second file, opened from outside. The running window takes it at once.',
    run: async (k) => {
      await k.wait(1.6)
      await k.open('dunes.jpg')
      await k.wait(2.2)
      await k.open('Video/wave-study.mp4')
      await k.wait(2.4)
    }
  },

  settings: {
    file: 'coast-road.mp3',
    note: 'The Style page: every style is a miniature of the window it makes.',
    run: async (k) => {
      await k.wait(0.7)
      await k.go(k.page.getByRole('button', { name: 'Settings' }), 700)
      await k.wait(1.2)
      await k.go(k.page.getByRole('button', { name: 'Terminal' }).first(), 620)
      await k.wait(1.4)
      await k.go(k.page.getByRole('button', { name: 'Aurora' }).first(), 560)
      await k.wait(1.3)
    }
  }
}

/* --------------------------------------------------------------- the camera */

/** Every take starts from the same settings: the profile is thrown away and
 *  written again, so a style, a sidebar width or a toggle left behind by the
 *  last take cannot change what this one records. */
async function seedProfile() {
  // Our own strays first: the handoff shot starts detached copies, and one of
  // them still holding the profile makes the delete below fail with EPERM. We
  // keep their handles rather than asking Windows to find them, which is both
  // faster and incapable of touching anything that is not ours.
  for (const child of strays.splice(0)) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; ; i += 1) {
    try {
      rmSync(PROFILE, { recursive: true, force: true })
      break
    } catch (e) {
      if (i >= 8) throw e
      await sleep(500) // Windows releases the handles a moment after the exit
    }
  }
  const seeder = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`] })
  await (await seeder.firstWindow()).evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, SEED)
  await sleep(400)
  await seeder.close()
  await sleep(700)
}

async function shoot(name, shot, pace, out) {
  await seedProfile()
  const app = await electron.launch({
    args: [MAIN, '--demo', `--user-data-dir=${PROFILE}`, join(DEMO, shot.file)]
  })
  const page = await app.firstWindow()
  // An unattended run that loses a take should say why, not just stop.
  app.process().stderr.on('data', (d) => process.stderr.write(`  [${name}] ${d}`))
  app.process().on('exit', (code) => {
    if (code !== 0) console.log(`  [${name}] electron exited ${code}`)
  })
  page.on('crash', () => console.log(`  [${name}] the renderer crashed`))
  page.on('pageerror', (e) => console.log(`  [${name}] page error: ${e.message.slice(0, 200)}`))
  await page.waitForLoadState('domcontentloaded')

  const scale = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'screen-saver')
    return screen.getPrimaryDisplay().scaleFactor
  })
  await app.evaluate(({ BrowserWindow }, b) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setBounds({ x: b.x, y: b.y, width: b.w, height: b.h })
    w.focus()
  }, WIN)

  await sleep(pace.settle * 1000)
  // Ask for the window again, right before rolling: a take recorded while
  // something else holds the foreground is the one that comes back wrong.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'screen-saver')
    w.focus()
  })
  await sleep(250)
  await page.evaluate(CURSOR)

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
      out
    ],
    { stdio: ['pipe', 'ignore', 'inherit'] }
  )
  await sleep(pace.roll * 1000)

  const k = {
    page,
    take: pace.name,
    wait: (s) => sleep(s * pace.wait * 1000),
    key: (combo) => page.keyboard.press(combo),
    type: async (text, per) => {
      for (const ch of text) {
        await page.keyboard.type(ch)
        await sleep(per)
      }
    },
    move: async (x, y, ms = 620) => {
      ms = Math.round(ms * pace.wait)
      const glide = page.evaluate(([a, b, c]) => window.__pc.to(a, b, c), [x, y, ms])
      await sleep(ms * 0.8)
      await page.mouse.move(x, y)
      await glide
    },
    click: async (x, y) => {
      await page.evaluate(() => window.__pc.tap())
      await page.mouse.click(x, y)
    },
    box: async (locator) => {
      const b = await locator.boundingBox()
      if (!b) throw new Error('nothing to aim at')
      return b
    },
    go: async (locator, ms) => {
      const b = await k.box(locator)
      const x = b.x + b.width / 2
      const y = b.y + b.height / 2
      await k.move(x, y, ms)
      await k.click(x, y)
    },
    drag: async (x1, y1, x2, y2, ms) => {
      await k.move(x1, y1, 520)
      await page.mouse.down()
      const glide = page.evaluate(([a, b, c]) => window.__pc.to(a, b, c), [x2, y2, ms])
      const steps = 7
      for (let i = 1; i <= steps; i += 1) {
        await sleep(ms / steps)
        await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps)
      }
      await glide
      await page.mouse.up()
    },
    /* Exactly what a double-click in Explorer does: start Prism again with a
       path. The single-instance lock forwards it to the window already up. */
    open: async (rel) => {
      const child = spawn(ELECTRON, [MAIN, `--user-data-dir=${PROFILE}`, join(DEMO, rel)], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      strays.push(child)
    },
    /** Open or close the tree by what is on screen, not by what a key does:
     *  Ctrl+B toggles, and a toggle is only correct if you know the state. */
    tree: async (want) => {
      const open = (await page.getByRole('treeitem').count()) > 0
      if (open !== want) {
        await page.keyboard.press('Control+b')
        await sleep(650)
      }
    },
    style: (id) => page.evaluate((s) => window.prismDemo.setStyle(s), id),
    mode: async (m, id) => {
      await page.evaluate((x) => window.prismDemo.setMode(x), m)
      await sleep(120)
      await page.evaluate((s) => window.prismDemo.setStyle(s), id)
    }
  }

  await shot.run(k)
  ff.stdin.write('q')
  await new Promise((r) => ff.on('close', r))
  if (shot.after) await shot.after(k)
  await app.close()
  // Prism is single-instance. Launch the next take before this process has
  // actually gone and the new one hands its file to the old window and quits,
  // which looks exactly like a crash from here.
  await sleep(1100)
  return out
}

/* ------------------------------------------------------------------ the run */

const argv = process.argv.slice(2)
const takeFlag = argv.indexOf('--takes')
const TAKES = takeFlag === -1 ? 1 : Math.max(1, Math.min(3, Number(argv[takeFlag + 1])))
// Guard the -1: without it, `takeFlag + 1` is 0 and the first shot named on the
// command line is quietly dropped as if it were the flag's value.
const wanted = argv.filter((a, i) => !a.startsWith('--') && (takeFlag === -1 || i !== takeFlag + 1))
const names = wanted.length ? wanted : Object.keys(SHOTS)
for (const n of names) if (!SHOTS[n]) throw new Error(`no such shot: ${n}`)

mkdirSync(OUT, { recursive: true })

/** The folder the shots browse is also a folder two of them edit. Put it back
 *  the way it started before every take, or take two of `delete` has nothing to
 *  delete and take two of `rename` is renaming a file that already moved. */
function tidyDemo() {
  const at = (n) => join(DEMO, n)
  if (existsSync(at('dunes-at-dawn.jpg'))) renameSync(at('dunes-at-dawn.jpg'), at('dunes.jpg'))
  if (existsSync(at('dunes-at-dawn'))) renameSync(at('dunes-at-dawn'), at('dunes.jpg'))
  if (!existsSync(at('spare.jpg'))) copyFileSync(at('atrium.jpg'), at('spare.jpg'))
}

const manifest = []
for (const name of names) {
  const takes = []
  for (let i = 0; i < TAKES; i += 1) {
    const pace = PACE[i % PACE.length]
    const file = TAKES === 1 ? `${name}.mp4` : `${name}-${pace.name}.mp4`
    const started = Date.now()
    tidyDemo()
    let verdict
    try {
      await shoot(name, SHOTS[name], pace, join(OUT, file))
      verdict = inspect(join(OUT, file))
    } catch (e) {
      // An unattended run keeps going. A take that throws is a take that failed,
      // not a reason to lose the twenty after it.
      verdict = { ok: false, why: String(e.message ?? e).split('\n')[0].slice(0, 80) }
    }
    takes.push({ file, pace: pace.name, ...verdict })
    console.log(
      `  ${name} \u00b7 ${pace.name}  ${((Date.now() - started) / 1000).toFixed(1)}s  ` +
        (verdict.ok ? 'ok' : `SUSPECT: ${verdict.why}`)
    )
  }
  manifest.push({ id: name, note: SHOTS[name].note, file: SHOTS[name].file, takes })
}

// A JS file rather than JSON: the lab opens over file://, where fetch is refused
// but a script tag is not.
writeFileSync(
  join(ROOT, '.demo', 'shots.js'),
  `window.SHOT_DATA = ${JSON.stringify(manifest, null, 2)}\n`
)
const bad = manifest.flatMap((m) => m.takes).filter((t) => !t.ok).length
console.log(`\n${names.length} shot(s), ${TAKES} take(s) each, ${bad} suspect`)
