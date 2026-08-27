import { _electron as electron } from 'playwright-core'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
const MAIN = join(process.cwd(), 'out', 'main', 'index.js')
const PROFILE = join(tmpdir(), 'prism-bg-profile')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const film = process.argv[2]
const seed = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`] })
const sw = await seed.firstWindow()
await sw.evaluate(() => { localStorage.setItem('prism.onboarded','1'); localStorage.setItem('prism.sidebar','0') })
await sleep(300); await seed.close(); await sleep(1200)
rmSync(join(PROFILE, 'tabs.json'), { force: true })

const app = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`, film] })
const win = await app.firstWindow()
await win.waitForSelector('video', { timeout: 40000, state: 'attached' })
await win.evaluate(() => { document.querySelector('video').muted = true; document.querySelector('video').currentTime = 60 })
await sleep(2500)
const shot = async (l) => {
  const r = await win.evaluate(() => {
    const vs = [...document.querySelectorAll('video')]
    return { count: vs.length, states: vs.map((v) => ({ paused: v.paused, t: Math.round(v.currentTime * 10) / 10, muted: v.muted })) }
  })
  console.log(l.padEnd(24), JSON.stringify(r)); return r
}
const a = await shot('playing')
await win.locator('[aria-label="Settings"]').click()
await sleep(1000)
const b = await shot('in settings')
await sleep(3000)
const c = await shot('  3s later')
await win.locator('[aria-label="Settings"]').click()
await win.waitForSelector('video', { timeout: 15000, state: 'attached' })
await sleep(1500)
const d = await shot('back')
const bgLive = b.count === 1 && b.states[0].paused === false
const advanced = c.states[0]?.t > b.states[0]?.t + 1.5
const back = d.count === 1 && d.states[0].paused === false && d.states[0].t >= c.states[0].t - 1
console.log(bgLive ? 'PASS the film is still playing off-screen' : 'FAIL nothing playing in the background')
console.log(advanced ? 'PASS and its clock is moving' : 'FAIL background clock stuck')
console.log(back ? 'PASS and it carries on when you come back' : 'FAIL return handoff')
await app.close()
process.exit(bgLive && advanced && back ? 0 : 1)
