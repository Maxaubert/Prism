/**
 * Renders build/installer/over.html into the alpha overlays the installer
 * composites over its video loop, plus the rectangles NSIS needs to know about.
 *
 *     npx electron build/installer/make-over.cjs 1440
 *     npx electron build/installer/make-over.cjs 960
 *
 * Alpha is not captured, it is solved for. Each screen is rendered twice, once
 * on black and once on white; for a pixel of colour C at coverage a those give
 * A = C*a and B = C*a + (1-a), so a = 1 - (B - A) and C = A / a. That is exact
 * for antialiased type, soft shadows and the glow under the button, none of
 * which a screenshot of a transparent window reliably brings back on Windows.
 *
 * Out: build/installer/media/<size>/o/<screen>[-hot-<control>].png
 *      build/installer/over.nsh   rectangles, in 640x480 units
 */
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HERE = __dirname
const OUT = path.join(HERE, 'media')   // <media>/<size>/o, where UNPACK_MEDIA looks
const WIDTH = Number(process.argv[process.argv.length - 1]) || 1440
const SCALE = WIDTH / 640
const DIR = String(WIDTH)
const SCREENS = ['welcome', 'where', 'copy', 'done']

// which control is drawn hot on which screen, and so which crops we need twice
const HOT = {
  welcome: ['next', 'close', 'min'],
  where: ['next', 'back', 'browse', 'close', 'min'],
  copy: ['close', 'min'],
  done: ['next', 'close', 'min']
}

const magick = (args) => execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

/** capturePage on a parked window sometimes never settles, so every capture is
 *  raced against a timeout and retried rather than hanging the whole build. */
async function grab(win, w, h) {
  const shot = win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })
  let timer
  const bail = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('capture timed out')), 8000) })
  try {
    return await Promise.race([shot, bail])
  } finally {
    clearTimeout(timer)
  }
}

async function shoot(win, w, h, file) {
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  await wait(70)
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // the first capture off a parked window can be the previous frame, so one
      // is taken to flush it and the next is the one we keep
      await grab(win, 8, 8)
      await wait(40)
      const img = await grab(win, w, h)
      const size = img.getSize()
      if (size.width !== w || size.height !== h) throw new Error(`captured ${size.width}x${size.height}`)
      fs.writeFileSync(file, img.toPNG())
      return
    } catch (e) {
      last = e
      await wait(300)
    }
  }
  throw new Error(`${path.basename(file)}: ${last.message}`)
}

/** cut the one capture into its black pane and its white pane */
function split(shot, w, h, tmp) {
  const a = path.join(tmp, 'pane-k.png')
  const b = path.join(tmp, 'pane-w.png')
  magick([shot, '-crop', `${w}x${h}+0+0`, '+repage', a])
  magick([shot, '-crop', `${w}x${h}+${w}+0`, '+repage', b])
  return [a, b]
}

/** A = over black, B = over white  ->  straight RGBA */
function solveAlpha(onBlack, onWhite, out) {
  const tmp = path.dirname(out)
  const alpha = path.join(tmp, 'a.png')
  const colour = path.join(tmp, 'c.png')
  // a = 1 - (B - A). ImageMagick's Minus is second-minus-first, so the black
  // pass goes first here even though it is the one being subtracted.
  magick([onBlack, onWhite, '-compose', 'Minus', '-composite', '-colorspace', 'gray', '-negate', alpha])
  // C = A / a, and where a is 0 the colour is arbitrary, so let it be black
  magick([onBlack, alpha, '-compose', 'divide', '-composite', colour])
  magick([colour, alpha, '-alpha', 'off', '-compose', 'copy_opacity', '-composite', out])
  fs.rmSync(alpha, { force: true })
  fs.rmSync(colour, { force: true })
}

async function main() {
  fs.mkdirSync(path.join(OUT, DIR, 'o'), { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-over-'))
  const W = Math.round(640 * SCALE)
  const H = Math.round(480 * SCALE)
  let rects = null

  const win = new BrowserWindow({
    width: W * 2, height: H, x: -4000, y: 0, useContentSize: true, show: true, frame: false,
    skipTaskbar: true, focusable: false, backgroundColor: '#000000',
    webPreferences: { zoomFactor: SCALE, backgroundThrottling: false, partition: `over-${WIDTH}` }
  })
  await win.loadFile(path.join(HERE, 'over.html'))
  win.webContents.setZoomFactor(SCALE)
  await wait(150)

  for (let s = 0; s < SCREENS.length; s++) {
    const name = SCREENS[s]
    // Every screen is rendered with its checkboxes left out: setup paints those
    // itself, so the art does not need a variant per combination of states.
    for (const hot of [null, ...HOT[name]]) {
      await win.webContents.executeJavaScript(`render(${s}, ${JSON.stringify(hot)}, 'none')`)
      const shot = path.join(tmp, `${name}-${hot ?? 'plain'}.png`)
      await shoot(win, W * 2, H, shot)
      const out = `${name}${hot ? `-hot-${hot}` : ''}.png`
      solveAlpha(...split(shot, W, H, tmp), path.join(OUT, DIR, 'o', out))
      console.log(`  ${out}`)
    }

    // and the two states of one box, cut out to be stamped at runtime
    if (name === 'done') {
      const r = await win.webContents.executeJavaScript('rects()')
      const box = r.BOX_RUN
      for (const state of ['on', 'off']) {
        await win.webContents.executeJavaScript(`render(3, null, ${JSON.stringify(state)})`)
        const shot = path.join(tmp, `box-${state}.png`)
        await shoot(win, W * 2, H, shot)
        const solved = path.join(tmp, `box-${state}-solved.png`)
        solveAlpha(...split(shot, W, H, tmp), solved)
        const s2 = SCALE
        magick([solved, '-crop',
          `${Math.round(box.w * s2)}x${Math.round(box.h * s2)}+${Math.round(box.x * s2)}+${Math.round(box.y * s2)}`,
          '+repage', path.join(OUT, DIR, 'o', `box-${state}.png`)])
        console.log(`  box-${state}.png`)
      }
    }

    // rectangles are per screen, because the same button sits somewhere else on
    // each of them: O_WELCOME_NEXT is not O_DONE_NEXT
    await win.webContents.executeJavaScript(`render(${s}, null, 'none')`)
    const r = await win.webContents.executeJavaScript('rects()')
    rects = rects ?? {}
    for (const [k, v] of Object.entries(r)) rects[`${name.toUpperCase()}_${k}`] = v
  }

  if (WIDTH === 1440) fs.writeFileSync(path.join(HERE, 'over.nsh'), nsh(rects))
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`overlays @${WIDTH}: ${fs.readdirSync(path.join(OUT, DIR, 'o')).length} files, ${Object.keys(rects).length} rectangles`)
  win.destroy()
  app.exit(0)
}

function nsh(rects) {
  const out = [
    '; Generated by make-over.cjs from over.html. Do not edit: run',
    ';   npx electron build/installer/make-over.cjs 1440',
    '; Rectangles are in 640x480 units; the installer scales them to its window.',
    ''
  ]
  for (const [k, b] of Object.entries(rects)) {
    out.push(`!define O_${k}_X ${b.x}`, `!define O_${k}_Y ${b.y}`, `!define O_${k}_W ${b.w}`, `!define O_${k}_H ${b.h}`)
  }
  out.push('')
  return out.join('\n')
}

app.whenReady().then(main).catch((e) => {
  console.error(e)
  app.exit(1)
})
