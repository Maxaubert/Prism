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
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  renameSync
} from 'node:fs'
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

/* The installed Prism, filmed by default. What you see in your own copy is then
   what gets filmed, by definition. Pass --dev to use the build in out/ instead:
   that one carries the --demo hook, which is the only way to change style or
   visualizer while a file is playing, so the live-change shots need it. */
const INSTALLED = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Prism', 'Prism.exe')
const DEV = process.argv.includes('--dev') || !existsSync(INSTALLED)

/* --live films the installed app against its OWN profile: no copy, no seeding,
   no overrides, nothing written by the recorder. It is the app as it sits on
   this machine, which is the only way to settle whether a copy was ever faithful.
   Opening a file is all it does; it changes no setting. */
const LIVE = process.argv.includes('--live')

/* Where the frames come from.
 *
 * Desktop Duplication films the screen, which means the window has to BE on the
 * screen: it takes over the display for the length of a run, it catches whatever
 * shows through a translucent style, and it competes with anything else drawing.
 *
 * Chromium can hand over its own frames instead. That only became possible once
 * every shot moved to an opaque style - acrylic is composited by Windows and
 * simply is not there in a page capture - and once --demo stopped Chromium
 * throttling a window nobody is looking at, which had it painting less than one
 * frame a second. Now the window can sit at x=-4000 and film at sixty.
 *
 * --screen forces the old path, for anything that genuinely needs the compositor.
 */
const OFFSCREEN = !process.argv.includes('--screen')

/**
 * Launch, and try again if the lock was still held.
 *
 * Prism is single-instance: start it while a previous one is still shutting down
 * and the new process hands its file over and exits, which from here looks
 * exactly like the window closing on its own. Waiting is the whole fix.
 */
async function launch(options, tries = 4) {
  for (let i = 1; ; i += 1) {
    try {
      const app = await electron.launch(options)
      await app.firstWindow()
      return app
    } catch (e) {
      if (i >= tries) throw e
      await new Promise((r) => setTimeout(r, 1500 * i))
    }
  }
}

/** Detached instances started by a shot, so they can be cleaned up by handle. */
const strays = []

/* The window is sized to the work area, not to a number chosen here.
 *
 * 1280x800 was the old value and it was the root of the "too tall" problem: the
 * visualizer box is a percentage of the window's HEIGHT, so in a short narrow
 * window the bars fill a bigger share of the frame than they do in the wide one
 * anybody actually uses. A ring is sized by the smaller dimension and looked
 * identical either way, which is exactly why Halo passed and the bars did not.
 *
 * Filling the work area also makes the footage 16:9, which is what the films
 * are, so nothing has to be cropped afterwards. */
let WIN = { w: 1280, h: 800, x: 200, y: 70 }
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

/* The real profile, copied.
 *
 * Every attempt to rebuild these settings by hand got something wrong: the
 * height came from a stale record, the position from an older one still, and
 * each wrong guess cost a recording session. The app's own store is the only
 * accurate description of how this machine is set up, so the recorder copies it
 * rather than describing it.
 *
 * It copies into a throwaway directory. The takes switch styles and modes
 * constantly, and none of that reaches the profile actually in use.
 */
const REAL_PROFILE = join(process.env.APPDATA ?? '', 'Prism')

/* Two overrides, and only two.
 *
 * There were six once - style, mode, visualizer shape, glow, height, position -
 * each added for a decent reason, and together they meant the recording could
 * not look like the app whatever else was copied. Everything about the
 * visualizer now comes from the profile: shape, size, position, palette, glow.
 *
 * The theme is the exception, because the films are dark and this machine runs
 * light. Change these two to change what the films wear. */
const OVERRIDE = {
  'prism.onboarded': '1',
  'prism.style': 'aurora',
  'prism.mode': 'dark'
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
      // Each picture is held long enough to be looked at rather than counted.
      await k.wait(1.9)
      for (let i = 0; i < 2; i += 1) {
        await k.key('ArrowRight')
        await k.wait(1.8)
      }
    }
  },

  zoom: {
    file: 'glacier.jpg',
    note: 'Wheel zoom past 200%, a drag across the frame, then 0 to fit again.',
    run: async (k) => {
      await k.wait(0.7)
      await k.move(700, 420, 560)
      for (let i = 0; i < 5; i += 1) {
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
    tree: true,
    note: 'Ctrl+B opens the tree, the panel is dragged wider, a subfolder opens.',
    run: async (k) => {
      await k.wait(0.6)
      const grip = await k.box(k.page.getByLabel('Resize file tree'))
      await k.drag(grip.x + 2, grip.y + grip.height / 2, grip.x + 122, grip.y + grip.height / 2, 850)
      await k.wait(0.8)
      await k.go(k.page.getByRole('treeitem', { name: 'Video' }), 650)
      await k.wait(1.1)
    },
    after: async (k) => {
      // Put the panel back. Its width is a stored setting, so a drag left
      // unwound is a wide sidebar in every shot filmed after this one.
      const grip = await k.box(k.page.getByLabel('Resize file tree'))
      await k.drag(grip.x + 2, grip.y + grip.height / 2, grip.x - 118, grip.y + grip.height / 2, 500)
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
    /* Void, not the acrylic default. A translucent window puts the desktop
       behind the visualizer, and a blurred photograph behind moving bars is the
       worst thing you can hand an h264 encoder: it bands, it smears, and the
       bars lose their edges. Flat black costs nothing to encode and the
       visualizer is the only thing left to look at. */
    look: 'new-void',
    note: 'Cover art and the circular visualizer, running in the accent colour.',
    run: async (k) => {
      await k.wait(4.5)
    }
  },

  delete: {
    file: 'coastline-dawn.jpg',
    tree: true,
    note: 'Delete goes to the Recycle Bin, so the one destructive-looking key is not.',
    run: async (k) => {
      await k.wait(0.6)
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
    look: null,
    hook: true,
    note: 'The style changes four times while the video plays. Nothing stops.',
    run: async (k) => {
      await k.wait(1.6)
      for (const id of ['new-void', 'driftwood', 'frost', 'aurora']) {
        await k.style(id)
        await k.wait(1.8)
      }
    }
  },

  'style-photo': {
    file: 'dunes.jpg',
    look: null,
    hook: true,
    note: 'Dark to light and back: the whole window repaints around the picture.',
    run: async (k) => {
      await k.wait(1.2)
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
    look: null,
    hook: true,
    note: 'The visualizer takes each style’s accent as the style changes.',
    run: async (k) => {
      // The seeded palette is a fixed one, because that is what this machine
      // runs. This shot is about the accent-following palette, so it asks for it.
      await k.viz('Flow')
      await k.vizTheme('accent')
      await k.wait(1.6)
      for (const id of ['terminal', 'acrylic-red', 'driftwood', 'aurora']) {
        await k.style(id)
        await k.wait(1.6)
      }
    }
  },

  /* ------------------------------------------------- the visualizer, properly */

  'audio-noglow': {
    file: 'coast-road.mp3',
    /* Void, not the acrylic default. A translucent window puts the desktop
       behind the visualizer, and a blurred photograph behind moving bars is the
       worst thing you can hand an h264 encoder: it bands, it smears, and the
       bars lose their edges. Flat black costs nothing to encode and the
       visualizer is the only thing left to look at. */
    look: 'new-void',
    note: 'The same player with the glow off, to compare against `audio` after encoding.',
    pre: (k) => k.vizGlow(false),
    run: async (k) => {
      await k.wait(4.6)
    }
  },

  'viz-shapes': {
    file: 'coast-road.mp3',
    hook: true,
    note: 'Five of the seven visualizer shapes, changed while the track runs.',
    run: async (k) => {
      await k.wait(1.5)
      for (const id of ['mirror-caps', 'ripples', 'liquid', 'clean-wall']) {
        await k.viz(id)
        await k.wait(2)
      }
    }
  },

  'viz-colour': {
    file: 'coast-road.mp3',
    /* Void, not the acrylic default. A translucent window puts the desktop
       behind the visualizer, and a blurred photograph behind moving bars is the
       worst thing you can hand an h264 encoder: it bands, it smears, and the
       bars lose their edges. Flat black costs nothing to encode and the
       visualizer is the only thing left to look at. */
    look: 'new-void',
    hook: true,
    note: 'The same shape, four palettes: accent, ocean, gold, aurora.',
    pre: (k) => k.viz('Halo'),
    run: async (k) => {
      await k.wait(1.4)
      for (const id of ['ocean', 'gold', 'aurora', 'accent']) {
        await k.vizTheme(id)
        await k.wait(1.5)
      }
    }
  },

  /* The warm ones. Driftwood in the dark and Linen in the light are the two
     that stop looking like a theme and start looking like a room. */
  /* A document with the tree beside it, and the look changed while it is open.
     Text is where a style shows itself most plainly: the chrome moves, the
     reading face does not. */
  'video-plain': {
    file: 'Video/wave-study.mp4',
    note: 'A video playing, nothing touched. The chrome fades out and stays out.',
    run: async (k) => {
      // No pointer movement at all: the transport hides itself when nothing has
      // happened for a moment, which is the state worth filming.
      await k.wait(8)
    }
  },

  'doc-theme': {
    file: 'field-notes.txt',
    tree: true,
    look: null,
    note: 'A text document with the tree open, dressed in four different styles.',
    run: async (k) => {
      /* Five, and two of them light. Black to brown and back is one idea shown
         twice; the light styles are where a document changes most, since the
         page itself turns over. */
      await k.wait(2.2)
      /* Not Frost: it sets grey text on a grey page and the document stops being
         readable, which is a fault in the style rather than something to show
         off. Daybreak is solid rather than acrylic, so the ink stays dark. */
      for (const id of ['new-void', 'driftwood', 'daybreak', 'linen', 'aurora']) {
        await k.style(id)
        await k.wait(2.5)
      }
    }
  },

  'style-warm': {
    file: 'still-life.jpg',
    look: null,
    hook: true,
    note: 'Driftwood, then the warm light styles, each held long enough to read.',
    run: async (k) => {
      await k.wait(1.1)
      await k.style('driftwood')
      await k.wait(2.4)
      await k.mode('light', 'linen')
      await k.wait(2.4)
      await k.style('paper')
      await k.wait(2.2)
      await k.mode('dark', 'driftwood')
      await k.wait(2)
    }
  },

  'style-warm-audio': {
    file: 'coast-road.mp3',
    look: null,
    hook: true,
    note: 'Driftwood with the player: the visualizer takes the copper accent.',
    pre: async (k) => {
      await k.viz('Caps')
      await k.vizTheme('accent')
    },
    run: async (k) => {
      await k.wait(1.2)
      await k.style('driftwood')
      await k.wait(2.6)
      await k.mode('light', 'linen')
      await k.wait(2.6)
      await k.mode('dark', 'aurora')
      await k.wait(1.6)
    }
  },

  rename: {
    file: 'coastline-dawn.jpg',
    tree: true,
    note: 'F2 renames in the tree. Nothing here is destroyed: the bin catches everything.',
    run: async (k) => {
      await k.wait(0.6)
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
    file: 'field-notes.pdf',
    note: 'A PDF, read in the same window as everything else.',
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
    pre: (k) => k.viz('Caps'),
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
      for (let i = 0; i < 8; i += 1) {
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
      for (let i = 0; i < 6; i += 1) {
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
    tree: true,
    note: 'Right-click in the tree: rename and delete, where you would look for them.',
    run: async (k) => {
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
    tree: true,
    note: 'Clicking down the tree: every file opens in the window beside it.',
    run: async (k) => {
      await k.wait(0.6)
            for (const name of ['dunes.jpg', 'rain-street.jpg', 'glacier.jpg', 'still-life.jpg']) {
        await k.go(k.page.getByRole('treeitem', { name }), 520)
        await k.wait(1.05)
      }
    }
  },

  /* ------------------------------------------------------------- the settings */

  'settings-viz': {
    file: 'coast-road.mp3',
    note: 'The visualizer page changes the visualizer while it is running.',
    pre: (k) => k.viz('Flow'),
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
    look: null,
    hook: true,
    note: 'Light and dark, with the visualizer never missing a frame.',
    pre: (k) => k.viz('Wall'),
    run: async (k) => {
      await k.wait(1.6)
      await k.mode('light', 'daybreak')
      await k.wait(2.2)
      await k.mode('dark', 'aurora')
      await k.wait(1.8)
    }
  },

  'style-text': {
    file: 'field-notes.pdf',
    hook: true,
    note: 'The chrome wears the style; the writing stays in a face built for reading.',
    run: async (k) => {
      await k.wait(1.2)
            for (const id of ['terminal', 'driftwood', 'aurora']) {
        await k.style(id)
        await k.wait(1.7)
      }
    }
  },

  'style-many': {
    file: 'glacier.jpg',
    look: null,
    hook: true,
    note: 'Eight styles in one run, dark and light, on one picture.',
    run: async (k) => {
      await k.wait(1)
            for (const id of ['new-void', 'terminal', 'driftwood', 'acrylic-red']) {
        await k.style(id)
        await k.wait(1.7)
      }
      await k.mode('light', 'linen')
      await k.wait(1.7)
      await k.style('orchid')
      await k.wait(1.7)
      await k.mode('dark', 'aurora')
      await k.wait(1.8)
    }
  },

  /* One process, one window: opening a second file hands it to the one already
     running, which is the whole reason Prism feels instant on the second file. */
  handoff: {
    file: 'coastline-dawn.jpg',
    // Needs the screen: the point of the shot is a SECOND process handing its
    // file to this window, and Chromium's own capture sees only this page.
    screen: true,
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
    look: null,
    note: 'The Style page: every style is a miniature of the window it makes.',
    pre: (k) => k.viz('Halo'),
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

/* One clip per visualizer shape, generated rather than written out twelve times.
   Same track, same second of it, same settings: the only variable is the shape,
   which is the point of a comparison. */
/* The presets, by the names Settings shows. Each carries its own geometry, which
   is the whole reason this list is names and not shape ids. */
/* Three, not twelve. Twelve was a catalogue: two seconds each, several of them
   near-identical at a glance, and the film spent half its length on looks nobody
   picked. These are the ones that survived review. */
const VIZ_SHAPES = ['Halo', 'Flow', 'Wall 2']

/* All twelve in one run, two seconds each. Separate clips meant twelve launches
   to compare twelve looks; this way they are on one timeline and the comparison
   is a scrub rather than a playlist. */
SHOTS['viz-tour'] = {
  file: 'coast-road.mp3',
  hook: true,
  look: 'new-void',
  note: 'Halo, Flow and Wall 2, held long enough to see, on one track.',
  pre: (k) => k.viz(VIZ_SHAPES[0]),
  run: async (k) => {
    await k.wait(3)
    for (const id of VIZ_SHAPES.slice(1)) {
      await k.viz(id)
      await k.wait(3)
    }
  }
}

for (const id of VIZ_SHAPES) {
  SHOTS[`viz-${id.toLowerCase().replace(/ /g, '-')}`] = {
    file: 'coast-road.mp3',
    hook: true,
    note: `Visualizer preset: ${id}.`,
    pre: (k) => k.viz(id),
    run: async (k) => {
      await k.wait(6)
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
  // Local Storage holds every prism.* setting; copying that one folder brings
  // the configuration across without the caches around it.
  const from = join(REAL_PROFILE, 'Local Storage')
  if (!existsSync(from)) throw new Error(`no installed profile at ${REAL_PROFILE}`)
  mkdirSync(PROFILE, { recursive: true })
  cpSync(from, join(PROFILE, 'Local Storage'), { recursive: true })

  const seeder = DEV
    ? await launch({ args: [MAIN, `--user-data-dir=${PROFILE}`] })
    : await launch({ executablePath: INSTALLED, args: [`--user-data-dir=${PROFILE}`] })
  await (await seeder.firstWindow()).evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, OVERRIDE)
  await sleep(400)
  await seeder.close()
  await sleep(700)
}

async function shoot(name, shot, pace, out) {
  for (const child of strays.splice(0)) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
  if (!LIVE) await seedProfile()
  else await sleep(600)
  const app = DEV
    ? await launch({
        args: [MAIN, '--demo', `--user-data-dir=${PROFILE}`, join(DEMO, shot.file)]
      })
    : await launch({
        executablePath: INSTALLED,
        args: LIVE
          ? ['--demo', join(DEMO, shot.file)]
          : ['--demo', `--user-data-dir=${PROFILE}`, join(DEMO, shot.file)]
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

  const display = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'screen-saver')
    const d = screen.getPrimaryDisplay()
    return { scale: d.scaleFactor, area: d.workArea, full: d.bounds }
  })
  const scale = display.scale
  WIN = { w: display.area.width, h: display.area.height, x: display.area.x, y: display.area.y }
  /* Do not resize. This is the root of a whole evening of wrong footage.
   *
   * Prism opens every window at a fixed size and does not remember one, so a
   * launch gives exactly what a double-click in Explorer gives. The recorder
   * used to stretch that to the full work area, taking the aspect from 1.51 to
   * 1.87 - and since the visualizer's box is a percentage of HEIGHT while its
   * shapes are drawn across the WIDTH, every proportion moved. Shapes measured
   * off the height came out too big, shapes fitted to the smaller dimension came
   * out too small, and nothing matched the app on screen.
   *
   * So: film the window as it opens, and only nudge it if it landed somewhere
   * the capture cannot reach. */
  const got = await app.evaluate(({ BrowserWindow, screen }, o) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (o.offscreen) {
      // Off every monitor. Still a real window with a real size, so nothing
      // about layout changes; it is simply nowhere anybody is looking.
      if (!o.onScreen) {
        w.setPosition(-4000, 200)
        return w.getBounds()
      }
    }
    const b = w.getBounds()
    const area = screen.getPrimaryDisplay().workArea
    const x = Math.min(Math.max(b.x, area.x + o.margin), area.x + area.width - b.width - o.margin)
    const y = Math.min(Math.max(b.y, area.y + o.margin), area.y + area.height - b.height - o.margin)
    if (x !== b.x || y !== b.y) w.setPosition(Math.round(x), Math.round(y))
    w.focus()
    return w.getBounds()
  }, { margin: 8, offscreen: OFFSCREEN, onScreen: shot.screen === true })
  /* Clamp to the screen. A maximised window's bounds overhang the display by
     the invisible resize border - x can be -8 - and a capture rectangle that
     starts off-screen is rejected outright, which looks like ffmpeg writing an
     empty file for no reason. */
  const area = display.full
  const x = Math.max(area.x, got.x)
  const y = Math.max(area.y, got.y)
  WIN = {
    x,
    y,
    w: Math.min(got.width - (x - got.x), area.x + area.width - x),
    h: Math.min(got.height - (y - got.y), area.y + area.height - y)
  }
  /* H.264 wants even dimensions in physical pixels, and a window of 1194x794 at
     2.25 scaling comes to 2686.5x1786.5, which rounds to odd. The encoder then
     refuses to open at all and ffmpeg writes an empty file, which reads as the
     capture having failed for no reason. Trim rather than pad: a pixel off an
     edge is invisible, a pixel of desktop is not. */
  const even = (v) => Math.floor((v * scale) / 2) * 2
  WIN.wPx = even(WIN.w)
  WIN.hPx = even(WIN.h)

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
      /* The same binary and the same profile as the window being filmed, or
         there is no handoff to film: a second instance pointed at a different
         profile takes a different single-instance lock and simply opens its own
         window. */
      const child = LIVE
        ? spawn(INSTALLED, [join(DEMO, rel)], { detached: true, stdio: 'ignore' })
        : spawn(ELECTRON, [MAIN, `--user-data-dir=${PROFILE}`, join(DEMO, rel)], {
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
    /* A preset, not a shape: it carries height, position, width and palette, and
       switching only the shape leaves the last one's geometry behind. */
    viz: (name) => page.evaluate((s) => window.prismDemo.setPreset(s), name),
    vizTheme: (id) => page.evaluate((s) => window.prismDemo.setVizTheme(s), id),
    vizGlow: (on) => page.evaluate((b) => window.prismDemo.setVizGlow(b), on),
    mode: async (m, id) => {
      await page.evaluate((x) => window.prismDemo.setMode(x), m)
      await sleep(120)
      await page.evaluate((s) => window.prismDemo.setStyle(s), id)
    }
  }

  /* A stills shot never rolls the camera. It sets a look, waits for it to
     finish arriving, and takes one frame; the clip is those frames cut
     together. Filming the change instead catches the window mid-repaint, which
     is a real frame of a real app and still looks like a glitch. Anything with
     motion of its own - a video playing, a visualizer running - stays filmed,
     because there the movement is the point. */
  if (shot.stills) {
    const frames = []
    for (const [i, look] of shot.stills.entries()) {
      await k.style(look)
      await sleep(1100 * pace.wait) // the repaint, the acrylic, and a breath
      const frame = join(OUT, `.${name}-${String(i).padStart(2, '0')}.png`)
      if (OFFSCREEN) {
        writeFileSync(frame, await page.screenshot({ type: 'png' }))
        frames.push(frame)
        continue
      }
      spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-init_hw_device', 'd3d11va',
        '-filter_complex',
        `ddagrab=output_idx=0:framerate=10:draw_mouse=0:video_size=${WIN.wPx}x${WIN.hPx}` +
          `:offset_x=${Math.round(WIN.x * scale)}:offset_y=${Math.round(WIN.y * scale)},` +
          'hwdownload,format=bgra',
        '-frames:v', '1', frame
      ])
      frames.push(frame)
    }
    // Held long enough to read, cut with no dissolve: the point is that each is
    // a different window, and a crossfade would blur exactly that.
    const list = join(OUT, `.${name}.txt`)
    writeFileSync(
      list,
      frames.map((f) => `file '${f.replace(/\\/g, '/')}'\nduration ${shot.hold ?? 1.6}`).join('\n') +
        `\nfile '${frames[frames.length - 1].replace(/\\/g, '/')}'\n`
    )
    spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'fps=60,format=yuv420p',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'slow',
      out
    ])
    for (const f of [...frames, list]) rmSync(f, { force: true })
    await app.close()
    await sleep(1100)
    return out
  }

  // Anything a shot needs true on frame one happens before the camera rolls.
  // A clip that opens on one visualizer and switches a beat later is showing
  // the rig, not the app.
  // The demo hook arrives via an async import, so it is not there the instant
  // the window is. Without this wait the pre-roll call is a no-op and the shot
  // opens on whatever style the profile carried, then switches on camera. The
  // installed build has no hook at all, which is the price of filming it.
  // Ask the window whether it has the hook rather than assuming from which
  // build this is: the installed app has it too when launched with --demo, and
  // that is what makes a style change mid-playback possible at all. It arrives
  // through an async import, so it is worth waiting a moment for.
  const hooked = await page
    .waitForFunction(() => Boolean(window.prismDemo), null, { timeout: 6000 })
    .then(() => true)
    .catch(() => false)

  if (hooked) {
    // The tree is furniture unless the shot is about the tree, and every shot
    // sits in a style. Both settled before the camera rolls.
    await k.tree(shot.tree === true)
    /* Void by default: OLED black, no translucency. The acrylic styles put the
       desktop wallpaper behind the window, which arrives as coloured bands
       either side of a picture and as a blurred field behind a visualizer -
       honest on screen, and mush after h264. A film wants one flat ground.
       `look: null` opts out, for the shots where the style IS the subject. */
    if (shot.look !== null) await k.style(shot.look ?? 'new-void')
    if (shot.pre) await shot.pre(k)
  } else if (shot.hook) {
    console.log(`  ${name}: changes the look mid-take, and this build has no hook`)
    await app.close()
    await sleep(900)
    return null
  }

  const px = (v) => Math.round(v * scale)

  /* Off-screen: collect Chromium's own frames and their timestamps, then let
     ffmpeg lay them on a constant 60fps timeline. Frames arrive when the page
     paints, so their spacing is uneven; a concat list with real durations keeps
     the motion true rather than assuming they were evenly spread. */
  let shots = null
  if (OFFSCREEN && !shot.screen) {
    const dir = join(OUT, `.${name}-frames`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const cdp = await page.context().newCDPSession(page)
    const times = []
    let n = 0
    cdp.on('Page.screencastFrame', (f) => {
      const file = join(dir, `f${String(n++).padStart(6, '0')}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      times.push({ file, at: f.metadata.timestamp })
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: 4000,
      maxHeight: 3000,
      everyNthFrame: 1
    })
    shots = { dir, times, cdp }
  }

  const ff = shots ? null : spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-init_hw_device', 'd3d11va',
      '-filter_complex',
      `ddagrab=output_idx=0:framerate=60:draw_mouse=0:video_size=${WIN.wPx}x${WIN.hPx}` +
        `:offset_x=${px(WIN.x)}:offset_y=${px(WIN.y)},hwdownload,format=bgra`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '14', '-pix_fmt', 'yuv420p',
      out
    ],
    { stdio: ['pipe', 'ignore', 'inherit'] }
  )
  await sleep(pace.roll * 1000)

  await shot.run(k)

  if (shots) {
    await shots.cdp.send('Page.stopScreencast').catch(() => {})
    await sleep(200)
    const { times, dir } = shots
    /* Frames arrive when the page paints, and a viewer showing a photograph
       paints once. That is not a failed capture: the concat below holds each
       frame for the time it was actually on screen, so eight frames over four
       seconds is a correct four seconds. What would be a failure is nothing at
       all, or a capture that stopped early. */
    const covered = times.length ? times[times.length - 1].at - times[0].at : 0
    if (times.length < 2 || covered < 1)
      throw new Error(`capture covered ${covered.toFixed(1)}s in ${times.length} frames`)
    /* Each line is a frame and how long it stayed on screen. Frames arrive when
       the page paints, so their spacing is uneven; real durations keep the
       motion true where assuming an even spread would rush and stall it. The
       last frame is repeated because concat gives the final entry no duration. */
    const list = join(OUT, `.${name}.txt`)
    const lines = times.map((t, i) => {
      const next = times[i + 1]?.at ?? t.at + 1 / 60
      return `file '${t.file.replace(/\\/g, '/')}'\nduration ${Math.max(1 / 240, next - t.at).toFixed(4)}`
    })
    writeFileSync(
      list,
      lines.join('\n') + `\nfile '${times[times.length - 1].file.replace(/\\/g, '/')}'\n`
    )
    spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', list,
      // Even dimensions, because H.264 will not open on odd ones.
      '-vf', 'fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'slow',
      out
    ])
    rmSync(dir, { recursive: true, force: true })
    rmSync(list, { force: true })
  } else {
    ff.stdin.write('q')
    await new Promise((r) => ff.on('close', r))
  }
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

/* A Prism left running holds the single-instance lock, and every launch this
   run makes would hand its file to that window and exit. Clear the field first.
   This closes a Prism you have open; a recording run needs the app to itself. */
spawnSync('powershell', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-Process Prism -ErrorAction SilentlyContinue | Stop-Process -Force'
])
await sleep(1200)

/** The folder the shots browse is also a folder two of them edit. Put it back
 *  the way it started before every take, or take two of `delete` has nothing to
 *  delete and take two of `rename` is renaming a file that already moved. */
function tidyDemo() {
  const at = (n) => join(DEMO, n)
  if (existsSync(at('dunes-at-dawn.jpg'))) renameSync(at('dunes-at-dawn.jpg'), at('dunes.jpg'))
  if (existsSync(at('dunes-at-dawn'))) renameSync(at('dunes-at-dawn'), at('dunes.jpg'))
  if (!existsSync(at('spare.jpg'))) copyFileSync(at('atrium.jpg'), at('spare.jpg'))
}

/* Live mode drives the app's own setters, and those write to the real profile.
   Whatever the last shot happened to leave selected would otherwise become the
   setting from then on, so the run borrows the settings and gives them back. */
let borrowed = null
async function withSettings(fn, arg) {
  const app = await launch({ executablePath: INSTALLED, args: ['--demo'] })
  const page = await app.firstWindow()
  const out = await page.evaluate(fn, arg)
  await sleep(300)
  await app.close()
  await sleep(900)
  return out
}

if (LIVE) {
  borrowed = await withSettings(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith('prism.'))
        .map((k) => [k, localStorage.getItem(k)])
    )
  )
  console.log(`  borrowed ${Object.keys(borrowed).length} settings, to be put back at the end`)
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

// Merge, never replace: re-recording one shot must not empty the lab of the
// other twenty-five. Fresh entries win, the rest stay as they were, and the list
// keeps the shot list's own order so the lab reads the way the file reads.
//
// A JS file rather than JSON: the lab opens over file://, where fetch is refused
// but a script tag is not.
const manifestPath = join(ROOT, '.demo', 'shots.js')
let previous = []
try {
  previous = JSON.parse(
    readFileSync(manifestPath, 'utf8').replace(/^window\.SHOT_DATA = /, '').trim()
  )
} catch {
  /* first run, or a manifest written by an older shape of this script */
}
const order = Object.keys(SHOTS)
const merged = [
  ...previous.filter((old) => !manifest.some((fresh) => fresh.id === old.id)),
  ...manifest
].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
writeFileSync(manifestPath, `window.SHOT_DATA = ${JSON.stringify(merged, null, 2)}\n`)
if (borrowed) {
  await withSettings((kv) => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('prism.') && !(k in kv)) localStorage.removeItem(k)
    }
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, borrowed)
  console.log('  settings put back')
}

const bad = manifest.flatMap((m) => m.takes).filter((t) => !t.ok).length
console.log(`\n${names.length} shot(s), ${TAKES} take(s) each, ${bad} suspect`)
