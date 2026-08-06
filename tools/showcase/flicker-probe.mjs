/**
 * Reproduce the hover-theft flicker without a game.
 *
 * After exiting a fullscreen game, a dying overlay window can intermittently
 * steal hit-testing, so the window underneath receives alternating
 * mouseleave / mousemove. This probe synthesizes that stream over a playing
 * video and counts how often the transport chrome flips visibility.
 *
 *   node tools/showcase/flicker-probe.mjs
 *
 * A robust UI holds the chrome steady (0-1 flips). The bug shows dozens.
 */
import { _electron as electron } from 'playwright-core'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const VIDEO = join(ROOT, '.demo', 'PrismDemo', 'Video', 'wave-study.mp4')
const PROFILE = join(tmpdir(), 'prism-flicker-profile')

rmSync(PROFILE, { recursive: true, force: true })
const app = await electron.launch({
  args: [MAIN, '--demo', `--user-data-dir=${PROFILE}`, VIDEO]
})
const page = await app.firstWindow()
await page.evaluate(() => localStorage.setItem('prism.onboarded', '1'))

// Park the window off-screen so the probe never touches the desktop.
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.setPosition(-4000, 200)
})
await page.waitForSelector('video', { timeout: 15000 })
await page.waitForFunction(() => {
  const v = document.querySelector('video')
  return v && !v.paused && v.currentTime > 0.2
})

const result = await page.evaluate(async () => {
  const stage = document.querySelector('video').parentElement
  const chrome = stage.querySelector('.transition-opacity')
  const visible = () => !chrome.classList.contains('opacity-0')

  // 25 leave/move pairs at overlay-flap cadence: leave, then move 40 ms later.
  // Sample visibility every 10 ms and count transitions.
  let last = visible()
  let flips = 0
  const sampler = setInterval(() => {
    const v = visible()
    if (v !== last) flips++
    last = v
  }, 10)

  const fire = (type) =>
    stage.dispatchEvent(
      new MouseEvent(type, { bubbles: true, relatedTarget: null, clientX: 300, clientY: 300 })
    )
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  for (let i = 0; i < 25; i++) {
    fire('mouseout')
    await sleep(40)
    fire('mousemove')
    await sleep(40)
  }
  await sleep(300)
  clearInterval(sampler)
  return { flips, endVisible: visible() }
})

// A real departure must still hide the chrome (while playing).
const hides = await page.evaluate(async () => {
  const stage = document.querySelector('video').parentElement
  const chrome = stage.querySelector('.transition-opacity')
  stage.dispatchEvent(
    new MouseEvent('mouseout', { bubbles: true, relatedTarget: null, clientX: 300, clientY: 300 })
  )
  await new Promise((r) => setTimeout(r, 800))
  return chrome.classList.contains('opacity-0')
})

console.log(`flap flips: ${result.flips} (0-1 is steady, dozens is the bug)`)
console.log(`chrome visible after flap: ${result.endVisible}`)
console.log(`real leave still hides: ${hides}`)
await app.close()
