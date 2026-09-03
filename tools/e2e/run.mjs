/**
 * End-to-end checks for the viewer, driven through the real built app.
 *
 *   npm run build && node tools/e2e/run.mjs
 *
 * Three scenarios, each in its own launch (the app is single-instance, so they
 * run in sequence against a throwaway profile): the markdown viewer against the
 * real README, the pdf viewer + find against a generated known-text PDF, and
 * the sidebar navigation filter against a mixed folder. Screenshots land in
 * .e2e/shots for eyeballing; assertions throw, and the script exits non-zero.
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync, spawn } from 'node:child_process'
import electronPath from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildFixtures, OTHER_ROOT } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const PROFILE_NAME = 'prism-e2e-profile'
const PROFILE = join(tmpdir(), PROFILE_NAME)
const SHOTS = join(ROOT, '.e2e', 'shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (cond, name) => {
  if (cond) console.log(`  pass  ${name}`)
  else {
    failures += 1
    console.error(`  FAIL  ${name}`)
  }
}

/** One throwaway profile, seeded past onboarding with the sidebar open. The
 *  seeding is its own launch (peek.mjs's trick): the file a scenario opens is
 *  delivered on first load, so the scenario launch must not reload. */
async function seedProfile() {
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e'] })
  const win = await app.firstWindow()
  await offscreen(app)
  await win.evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, { 'prism.onboarded': '1', 'prism.sidebar': '1', 'prism.tabs.confirmClose': '0' })
  await sleep(300)
  await app.close()
  await sleep(900) // let the single-instance lock go
}

/**
 * Park the window where nobody has to watch the suite run: off the virtual
 * desktop, transparent, out of the taskbar. Electron has no headless mode, and
 * a genuinely hidden window (`win.hide()`) stops answering clicks and
 * screenshots - it keeps compositing at this position, so everything works and
 * nothing appears. Main shows the window on ready-to-show, so this has to run
 * after that, and again once it has settled.
 */
const park = ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  if (!w) return
  w.setSkipTaskbar(true)
  w.setOpacity(0)
  w.setPosition(-4000, -4000)
}

async function offscreen(app) {
  await app.evaluate(park)
  await sleep(500)
  await app.evaluate(park)
}

/**
 * Launch Prism on a file, in the seeded profile, and wait until that file is
 * really the one on screen. Prism is single-instance: if the previous
 * scenario's process still holds the lock, this launch hands the path to the
 * OLD window and exits, and for a moment the window is still showing whatever
 * it had. Sleeping and hoping made roughly one run in four type into the wrong
 * file; waiting for the selected row settles it.
 */
/**
 * Kill anything of ours still running (2026-08-28).
 *
 * MEASURED: the terminal scenario's app outlived its `app.close()` - five
 * electron processes still up - and it holds the single-instance lock, so
 * every scenario after it launched, handed its file over and exited. Fifteen
 * scenarios failed for one leak, and no amount of retrying could have helped.
 * Only OUR processes are touched: the match is on the e2e profile path, which
 * the machine's own Prism never has.
 */
function reapStrays() {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ` +
          `Where-Object { $_.CommandLine -like '*${PROFILE_NAME}*' } | ` +
          'ForEach-Object { $_.ProcessId }'
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    const pids = out.split(/\s+/).filter(Boolean)
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' })
      } catch {
        /* already gone */
      }
    }
    return pids.length
  } catch {
    return 0
  }
}

/** How many electron processes are alive right now. A failed launch with ZERO
 *  of them is not a lock being held, whatever the error says - which is the
 *  difference between waiting longer and looking somewhere else. */
function electronCount() {
  try {
    // OURS, not every electron on the machine: on a dev box the answer was
    // always "some are alive", which told nobody anything (2026-08-28).
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ` +
          `Where-Object { $_.CommandLine -like '*${PROFILE_NAME}*' } | Measure-Object | ` +
          '%{ $_.Count }'
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    return Number(out.trim()) || 0
  } catch {
    return -1
  }
}

async function launch(file, keepTabs = false) {
  // Prism is single-instance. If the previous scenario's window has not fully
  // let go of the lock, this launch hands its path over and EXITS at once, and
  // every call against it dies with "garbage collected" or "has been closed".
  // Waiting longer between scenarios only moves the odds; retrying until the
  // lock is genuinely free is what settles it.
  //
  // Five tries over twenty seconds was not always enough: the scenarios that
  // convert video leave ffmpeg finishing, and the app after them can hold the
  // lock for longer than that. Eight tries with a longer backoff costs nothing
  // when the lock is free, which is almost always.
  let last
  for (let attempt = 0; attempt < 14; attempt++) {
    try {
      return await launchOnce(file, keepTabs)
    } catch (err) {
      // Say so. A silent retry loop and a genuine hang look identical from
      // the outside, and this one has cost several runs.
      // A failed launch means the previous app is STILL holding the lock -
      // it hangs in teardown often enough that the reap after the scenario
      // can miss it by a second. Kill it here, where we know it is in the
      // way, rather than waiting out a backoff it will never satisfy.
      const killed = reapStrays()
      if (attempt > 0 || killed)
        console.log(
          `  (launch ${attempt + 1} failed; ${killed} stray process(es) killed, ${electronCount()} left)`
        )
      // Every shape the handoff-exit takes on the way out. It has also been
      // seen as an ECONNRESET on the debugging socket and as a plain launch
      // timeout: the process this launch talked to had already decided to
      // quit. They are all the same lock, so they all retry.
      if (
        !/garbage collected|Target page, context or browser has been closed|Target closed|ECONNRESET|WebSocket error|Timeout .* exceeded.*(launch|firstWindow)|browserType.launch/i.test(
          String(err)
        )
      )
        throw err
      last = err
      await sleep(Math.min(8000, 2000 + attempt * 1200))
    }
  }
  throw last
}

async function launchOnce(file, keepTabs = false) {
  // Every scenario but the tab one expects a single-root world. The profile is
  // shared across scenarios (it is wiped once, at the start), so last
  // scenario's strip would restore into this one and change what the tree
  // counts. Forgetting it is the isolation; the tab scenario opts out, because
  // surviving a restart is the thing it is checking.
  if (!keepTabs) rmSync(join(PROFILE, 'tabs.json'), { force: true })
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e', file] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await offscreen(app)
  const want = /[^\\/]*$/.exec(file)?.[0] ?? file
  await win
    .waitForFunction(
      (name) =>
        document
          .querySelector('[role="treeitem"][aria-selected="true"]')
          ?.textContent?.includes(name) ?? false,
      want,
      { timeout: 15000 }
    )
    .catch(() => {})
  await sleep(400)
  return { app, win }
}

async function mdScenario(fixtures) {
  console.log('markdown viewer');
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    await win.waitForSelector('.p-md h1', { timeout: 10000 })
    ok((await win.textContent('.p-md h1')) === 'Prism', 'h1 renders')
    ok((await win.locator('.p-md pre code').count()) >= 1, 'fenced code renders')
    ok((await win.locator('.p-md table, .p-md ul, .p-md li').count()) >= 1, 'lists render')

    const badges = win.locator('.p-md img[src^="https://img.shields.io"]')
    ok((await badges.count()) === 3, 'three shields.io badges present')
    const badgeLoaded = await badges
      .first()
      .evaluate((el) =>
        el.complete && el.naturalWidth > 0
          ? true
          : new Promise((r) => {
              el.addEventListener('load', () => r(true), { once: true })
              el.addEventListener('error', () => r(false), { once: true })
              setTimeout(() => r(false), 8000)
            })
      )
    if (badgeLoaded) ok(true, 'badge loads from the network')
    else console.warn('  warn  badge did not load (offline?)')

    const local = win.locator('.p-md img[src^="fsmedia://"]').first()
    ok((await local.count()) === 1 || (await win.locator('.p-md img[src^="fsmedia://"]').count()) >= 1, 'local image resolves to fsmedia://')
    ok(
      await local.evaluate((el) =>
        el.complete && el.naturalWidth > 0
          ? true
          : new Promise((r) => {
              el.addEventListener('load', () => r(true), { once: true })
              el.addEventListener('error', () => r(false), { once: true })
              setTimeout(() => r(false), 8000)
            })
      ),
      'local image decodes'
    )
    // Nothing executable survives sanitizing.
    ok((await win.locator('.p-md script, .p-md iframe').count()) === 0, 'no scripts or iframes')

    // GitHub fidelity: align="center" really centers (Tailwind's preflight
    // used to blockify images out of it), and lists keep their bullets.
    ok(
      await win.evaluate(() => {
        const md = document.querySelector('.p-md')
        const icon = md.querySelector('img[src*="icon"]')
        const col = md.getBoundingClientRect()
        const r = icon.getBoundingClientRect()
        return Math.abs(r.left + r.width / 2 - (col.left + col.width / 2)) < 4
      }),
      'align="center" centers the header image'
    )
    ok(
      await win.evaluate(() => getComputedStyle(document.querySelector('.p-md ul')).listStyleType === 'disc'),
      'bullet lists keep their discs'
    )

    // A rendered README takes no focus either, so Up/Down keep paging the
    // folder until the reader actually clicks into the page.
    const mdRow = () => win.locator('[role="treeitem"][aria-selected="true"]').textContent()
    ok(
      await win.evaluate(() => !document.activeElement?.closest('[data-doc-scroller]')),
      'an opened README takes no focus'
    )
    await win.keyboard.press('ArrowDown')
    await sleep(700)
    ok(!((await mdRow()) ?? '').includes('README.md'), 'Down pages the folder from an unfocused README')
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('.p-md h1', { timeout: 10000 })
    await sleep(400)

    await win.click('.p-md h1')
    await sleep(300)
    ok(
      await win.evaluate(() => !!document.activeElement?.closest('[data-doc-scroller]')),
      'clicking the page focuses the document'
    )
    ok(((await mdRow()) ?? '').includes('README.md'), 'and the folder stays put')
    await win.keyboard.press('Escape')
    await sleep(300)
    ok(!win.isClosed(), 'Escape releases the document without closing the window')

    // The bar repeats the file name only when the tree isn't showing it.
    ok((await win.locator('.drag:has-text("README.md")').count()) === 0, 'bar stays quiet while the tree names the file')
    await win.keyboard.press('Control+b')
    await sleep(400)
    ok((await win.locator('.drag:has-text("README.md")').count()) === 1, 'closing the tree puts the name in the bar')
    await win.keyboard.press('Control+b')
    await sleep(400)
    await win.screenshot({ path: join(SHOTS, 'markdown.png') })

    // The sidebar search walks folders the tree never expanded.
    await win.fill('[aria-label="Search files"]', 'prism')
    await win.waitForSelector('[role="option"]', { timeout: 8000 })
    ok((await win.locator('[role="option"]').count()) === 2, 'search finds the 2 films in docs/media')
    ok(
      (await win.locator('[role="option"]').first().textContent())?.includes('docs\\media'),
      'hits say where they live'
    )
    await win.screenshot({ path: join(SHOTS, 'search.png') })
    await win.click('[role="option"]:has-text("prism.webp")')
    await sleep(600)
    ok(
      (await win.locator('[role="option"][aria-selected="true"]').textContent())?.includes('prism.webp'),
      'clicking a hit opens it'
    )
    await win.locator('[aria-label="Search files"]').press('Escape')
    await sleep(300)
    ok((await win.locator('[role="tree"]').count()) === 1, 'Escape clears the search and the tree returns')
    ok(!win.isClosed(), 'window survives search Escape')
  } finally {
    await app.close()
  }
}

async function pdfScenario(fixtures) {
  console.log('pdf viewer')
  const { app, win } = await launch(join(fixtures, 'sample.pdf'))
  try {
    await win.waitForSelector('canvas', { timeout: 15000 })
    ok((await win.locator('canvas').count()) >= 1, 'a page canvas renders')
    ok((await win.locator('[data-page]').count()) === 3, 'three page frames')

    await sleep(800) // the fit settles once every page has been measured
    const over = await win.evaluate(() => {
      const box = document.querySelector('[data-doc-scroller]')
      return box ? box.scrollWidth - box.clientWidth : -1
    })
    ok(over <= 0, `a pdf opens with no horizontal overflow (over by ${over}px)`)

    ok(await win.locator('text=/\\/ 3/').first().isVisible().catch(() => false), 'pill shows / 3')
    // A document OPENS FITTED now, so the pill need not read 100% - a page
    // wider than the window would otherwise open already overflowing, which is
    // being zoomed in on the reader's behalf. What 100% MEANS is unchanged and
    // is still the thing worth asserting, so press it and then measure.
    await win.click('button[title="Default zoom (0)"]')
    await sleep(400)
    ok((await win.locator('button[title="Default zoom (0)"]').textContent()) === '100%', 'the 100% button reads 100%')
    ok(
      await win.evaluate(() => {
        const page = document.querySelector('[data-page="1"]')
        return Math.abs(page.getBoundingClientRect().width - 612 * 1.9) < 2
      }),
      '100% really is 1.9 pdf units'
    )
    // NO HORIZONTAL SCROLLBAR ON OPEN, which is the property rather than any
    // particular zoom. A document that opens overflowing has been zoomed in on
    // the reader's behalf, and a bar for ONE pixel of rounding looks exactly
    // the same as a bar for a page that is genuinely too wide.
    await win.waitForSelector('.p-pdf-textlayer span', { timeout: 10000 })
    ok((await win.locator('.p-pdf-textlayer span').count()) > 0, 'text layer present')

    // Focus decides here too, and this has to be checked before anything in
    // the scenario legitimately focuses the document (the find bar does).
    // Straight off the sidebar the pdf has taken no focus, so the vertical
    // keys belong to the folder rather than silently flipping pages under a
    // user who was only browsing.
    ok(
      await win.evaluate(() => !document.activeElement?.closest('[data-doc-scroller]')),
      'an opened pdf takes no focus'
    )

    await win.keyboard.press('Control+f')
    await win.waitForSelector('[data-owns-escape] input', { timeout: 5000 })
    await win.keyboard.type('grape')
    await win.waitForFunction(
      () => /5/.test(document.querySelector('[data-owns-escape]')?.textContent ?? ''),
      undefined,
      { timeout: 10000 }
    )
    const counter = await win.textContent('[data-owns-escape] span')
    ok(counter?.trim() === '1 / 5', `find counts five matches (got "${counter?.trim()}")`)
    await win.keyboard.press('Enter')
    ok((await win.textContent('[data-owns-escape] span'))?.trim() === '2 / 5', 'Enter steps to 2 / 5')
    await win.keyboard.press('Shift+Enter')
    ok((await win.textContent('[data-owns-escape] span'))?.trim() === '1 / 5', 'Shift+Enter steps back')
    await win.screenshot({ path: join(SHOTS, 'pdf-find.png') })

    await win.keyboard.press('Escape')
    await sleep(300)
    ok((await win.locator('[data-owns-escape]').count()) === 0, 'Escape closes the find bar')
    ok(!win.isClosed(), 'window survives Escape')

    // The find bar just handed focus back to the document, so give it back to
    // nobody first: this is about what an untouched pdf does with the keys.
    const selected = () => win.locator('[role="treeitem"][aria-selected="true"]').textContent()
    await win.evaluate(() => document.activeElement?.blur())
    // PageUp, not PageDown: sample.pdf sorts last in this folder, so a Down
    // would stop at the edge and prove nothing either way.
    await win.keyboard.press('PageUp')
    await sleep(700)
    ok(!((await selected()) ?? '').includes('sample.pdf'), 'PageUp pages the FOLDER while the pdf is unfocused')
    ok((await win.locator('canvas').count()) === 0, 'and really left the pdf')

    await win.click('[role="treeitem"]:has-text("sample.pdf")')
    await win.waitForSelector('[data-page="1"]', { timeout: 15000 })
    await sleep(600)

    // Click into the document and it owns them, exactly as an editor would.
    await win.click('[data-page="1"]', { position: { x: 40, y: 300 } })
    await sleep(300)
    ok(
      await win.evaluate(() => !!document.activeElement?.closest('[data-doc-scroller]')),
      'clicking the page focuses the document'
    )
    await win.keyboard.press('PageDown')
    await sleep(500)
    ok((await win.inputValue('input[aria-label="Page number"]')) === '2', 'now PageDown flips to page 2')

    // Escape hands the keys back without closing the window.
    await win.keyboard.press('Escape')
    await sleep(300)
    ok(
      await win.evaluate(() => !document.activeElement?.closest('[data-doc-scroller]')),
      'Escape releases the document'
    )
    ok(!win.isClosed(), 'and does not close the window')
    await win.screenshot({ path: join(SHOTS, 'pdf.png') })

    // 100% IS A WIDTH ON SCREEN, not 1.9x whatever the page measures. A
    // 1822pt-wide page used to render 3462 CSS px across at "100%". The
    // document opens FITTED now, so press 100% before measuring what it means.
    await win.click('button[title="Default zoom (0)"]')
    await sleep(400)
    const letterW = await win.evaluate(
      () => document.querySelector('[data-page="1"]').getBoundingClientRect().width
    )
    ok(Math.abs(letterW - 612 * 1.9) < 2, `a letter page is unchanged at 100% (${letterW.toFixed(0)}px)`)

    // Links. Page 1 carries three annotations in the fixture and Prism must
    // render exactly two: the /Launch at calc.exe is refused, and that
    // refusal is the point of the whole layer.
    await win.click('input[aria-label="Page number"]', { clickCount: 3 })
    await win.keyboard.type('1')
    await win.keyboard.press('Enter')
    await sleep(700)
    await win.waitForSelector('[data-page="1"] .p-pdf-annots button', { timeout: 10000 })
    ok(
      (await win.locator('[data-page="1"] .p-pdf-annots button').count()) === 2,
      'two link boxes on page 1: the Launch at an executable is not one of them'
    )

    // The boxes are percentages of the page, so a zoom must not move them off
    // their text. Measure the box against its page both ways.
    const boxFrac = async () =>
      win.evaluate(() => {
        const page = document.querySelector('[data-page="1"]')
        const b = page.querySelector('.p-pdf-annots button')
        const pr = page.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        return { x: (br.left - pr.left) / pr.width, y: (br.top - pr.top) / pr.height }
      })
    const before = await boxFrac()
    await win.hover('[data-page="1"]', { position: { x: 40, y: 40 } })
    await win.click('button[title="Zoom in (+)"]')
    await sleep(700)
    const after = await boxFrac()
    ok(
      Math.abs(before.x - after.x) < 0.002 && Math.abs(before.y - after.y) < 0.002,
      `the boxes stay on their text through a zoom (dx=${Math.abs(before.x - after.x).toFixed(4)})`
    )
    await win.click('button[title="Default zoom (0)"]')
    await sleep(500)

    // The external one opens through the OS shell and NOT in the app. Stubbed,
    // or thirty e2e runs would each open a browser tab.
    await app.evaluate(({ shell }) => {
      globalThis.__opened = []
      shell.openExternal = (u) => {
        globalThis.__opened.push(u)
        return Promise.resolve()
      }
    })
    await win.locator('[data-page="1"] .p-pdf-annots button').first().click()
    await sleep(500)
    const opened = await app.evaluate(() => globalThis.__opened)
    ok(
      opened.length === 1 && opened[0] === 'https://example.com/docs',
      `the external link goes to the shell, once, with its own url (${JSON.stringify(opened)})`
    )
    ok((await win.inputValue('input[aria-label="Page number"]')) === '1', 'and did not move the document')

    // The internal one jumps to page 3, and to the /XYZ y on it rather than
    // to the top of it.
    await win.locator('[data-page="1"] .p-pdf-annots button').nth(1).click()
    await sleep(800)
    ok((await win.inputValue('input[aria-label="Page number"]')) === '3', 'the internal link jumps to page 3')
    const landed = await win.evaluate(() => {
      const box = document.querySelector('[data-doc-scroller]')
      const page = document.querySelector('[data-page="3"]')
      return page.getBoundingClientRect().top - box.getBoundingClientRect().top
    })
    // /XYZ top 500 on a 792pt page is 292pt down, times the 1.9 default scale
    // = ~555px, so page 3's top edge sits that far ABOVE the scroller's, less
    // the gap goToPage leaves. Landing at the top of the page would put this
    // at about +24 instead.
    ok(landed < -450 && landed > -640, `and lands at the destination y, not the top (${landed.toFixed(0)}px)`)

    // The pill's buttons take real CLICKS (they once sat under the text
    // layer's z-index and swallowed nothing but hover).
    await win.hover('[data-page="2"]', { position: { x: 40, y: 40 } })
    await win.click('button[title="Zoom in (+)"]')
    ok((await win.textContent('button[title="Default zoom (0)"]')) === '118%', 'clicking + zooms to 118%')
    await win.click('button[title="Default zoom (0)"]')
    ok((await win.textContent('button[title="Default zoom (0)"]')) === '100%', 'clicking the label resets to 100%')
    await win.click('button[title="Fullscreen (F)"]')
    await sleep(600)
    ok(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
      'clicking fullscreen goes fullscreen'
    )
    await win.keyboard.press('f')
    await sleep(600)
    ok(
      !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())),
      'F leaves fullscreen again'
    )

    // A PDF's Properties knows its pages.
    await win.click('[role="treeitem"][aria-selected="true"]', { button: 'right' })
    await win.click('[role="menuitem"]:has-text("Properties")')
    await win.waitForFunction(
      () => /Pages/.test(document.querySelector('[role="dialog"]')?.textContent ?? ''),
      undefined,
      { timeout: 10000 }
    )
    ok(/Pages\s*3/.test(((await win.textContent('[role="dialog"]')) ?? '').replace(/\s+/g, ' ')), 'pdf properties show 3 pages')
    await win.click('button:has-text("Close")')
  } finally {
    await app.close()
  }
}

async function sortScenario(fixtures) {
  console.log('sorting')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    // File rows in the tree (folders have aria-expanded, files don't). No
    // filter any more (removed 2026-08-20: a forgotten filter read as missing
    // files) - every viewable sibling is always listed.
    const fileRows = win.locator('[role="treeitem"]:not([aria-expanded])')
    await fileRows.first().waitFor({ timeout: 10000 })
    ok((await fileRows.count()) === 9, 'the tree lists every viewable file, unfiltered')
    ok(
      (await win.locator('[aria-label="Navigation filter"]').count()) === 0,
      'the funnel is gone'
    )

    // Sorting: Playnite's shape, one direction pair for every field. Size
    // ascending puts the smallest first; flipping to descending, the biggest.
    const sortBtn = win.locator('[aria-label="Sort order"]')
    const sortMenu = '[role="menu"][aria-label="Sort order"]'
    const firstRow = () => fileRows.first().textContent()
    await sortBtn.click()
    await win.click(`${sortMenu} [role="menuitemradio"]:has-text("Size")`)
    await sleep(250)
    ok(((await firstRow()) ?? '').includes('notes.txt'), 'size ascending puts the smallest file first')
    const rootFiles = readdirSync(fixtures).filter((n) => statSync(join(fixtures, n)).isFile())
    const sizeOf = (n) => statSync(join(fixtures, n)).size
    const maxSize = Math.max(...rootFiles.map(sizeOf))
    await sortBtn.click()
    await win.click(`${sortMenu} [role="menuitemradio"]:has-text("Descending")`)
    await sleep(250)
    const first = (await firstRow()) ?? ''
    ok(
      rootFiles.some((n) => first.includes(n) && sizeOf(n) === maxSize),
      'descending flips: a biggest file first'
    )
    // Back to defaults, so the scenarios after this one see the normal order.
    await sortBtn.click()
    await win.click(`${sortMenu} [role="menuitemradio"]:has-text("Ascending")`)
    await sleep(150)
    await sortBtn.click()
    await win.click(`${sortMenu} [role="menuitemradio"]:has-text("Name")`)
    await sleep(150)
    ok(((await firstRow()) ?? '').includes('ep1.en.srt'), 'name ascending is back to normal')
    await win.screenshot({ path: join(SHOTS, 'sorting.png') })

    // Settings opens as a TAB on the strip now, so it can be flipped to and
    // from; its rail grew a Terminal page with theme cards and font size.
    await win.click('[aria-label="Settings"]')
    await sleep(400)
    ok(
      await win.locator('[role="tab"]:has-text("Settings")').isVisible().catch(() => false),
      'the cog opens Settings as a tab on the strip'
    )
    await win.click('button:has-text("Terminal")')
    await sleep(300)
    ok(
      (await win.locator('[data-term-card]').count()) >= 30 && (await win.locator('#term-font').count()) === 1,
      'the Terminal settings page offers 30+ theme cards and font size'
    )

    // Two rows by default, the rest behind the arrow.
    ok(
      (await win.locator('button[aria-expanded="false"][aria-label^="Show all"]').count()) === 1,
      'the theme wall is collapsed to two rows behind a centred arrow'
    )
    // The pencil lives on the SELECTED card only: select bright-lights, its
    // pencil appears, edit, save - the one Custom slot.
    await win.locator('button[aria-label^="Show all"]').click()
    await sleep(200)
    await win.locator('[data-term-card="bright-lights"]').click()
    ok(
      (await win.locator('[data-edit-theme]').count()) === 1 &&
        (await win.locator('[data-edit-theme="bright-lights"]').count()) === 1,
      'only the selected theme wears the pencil'
    )
    // The acrylic regression: the DEFAULT style publishes an rgba background,
    // which once turned every follow-style hue pure black. The follow-style
    // card's editor must seed real colours.
    await win.locator('[data-term-card="style"]').click()
    await win.locator('[data-edit-theme="style"]').click()
    await win.waitForSelector('[data-theme-editor]', { timeout: 5000 })
    const styleRed = await win.locator('[data-theme-editor] input[aria-label="red"]').inputValue()
    const styleBg = await win.locator('[data-theme-editor] input[aria-label="Background"]').inputValue()
    ok(
      /^#[0-9a-f]{6}$/i.test(styleBg) && styleRed !== '#000000',
      `follow-style seeds real colours on the acrylic default (bg=${styleBg}, red=${styleRed})`
    )
    await win.locator('[data-theme-editor] button:has-text("Cancel")').click()
    await sleep(300)

    await win.locator('[data-term-card="bright-lights"]').click()
    await win.locator('[data-edit-theme="bright-lights"]').click()
    await win.waitForSelector('[data-theme-editor]', { timeout: 5000 })
    await win.locator('[data-theme-editor] input[aria-label="Background"]').fill('#123456')
    await win.locator('button:has-text("Save as Custom")').click()
    await sleep(400)
    ok(
      (await win.locator('[data-term-card="custom"][aria-pressed="true"]').count()) === 1,
      'saving lands in the single Custom slot, selected'
    )
    ok(
      (await win.evaluate(() => JSON.parse(localStorage.getItem('prism.term.custom') ?? '{}').bg)) === '#123456',
      'with the edited colour kept'
    )
    // Flip away to the folder tab and back: the strip is the way around.
    await win.locator('[role="tab"]:not(:has-text("Settings"))').first().click()
    await sleep(300)
    ok(
      await win.locator('.p-md h1').first().isVisible().catch(() => false),
      'flipping to the folder tab shows the document again'
    )
    await win.locator('[role="tab"]:has-text("Settings")').click()
    await sleep(300)
    ok((await win.locator('[data-term-card]').count()) >= 6, 'and back to Settings, same page')
    // Close it like any tab.
    await win.locator('[role="tab"]:has-text("Settings")').locator('..').locator('[aria-label^="Close"]').click()
    await sleep(300)
    ok(
      (await win.locator('[role="tab"]:has-text("Settings")').count()) === 0,
      'the Settings tab closes like any other'
    )
  } finally {
    await app.close()
  }
}

async function contextMenuScenario(fixtures) {
  console.log('context menu')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    const row = win.locator('[role="treeitem"][aria-selected="true"]')
    await row.waitFor({ timeout: 10000 })
    await row.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })

    for (const label of ['Cut', 'Copy', 'Open in', 'Show in File Explorer', 'Copy path', 'Duplicate', 'Rename', 'Delete']) {
      ok((await win.locator(`[role="menuitem"]:has-text("${label}")`).count()) >= 1, `menu has ${label}`)
    }

    // The flyout: hover "Open in", expect the two rows that exist on every
    // machine (the app list between them varies by what is installed).
    // has-text is a substring match and "Open in split view" / "Open in new
    // tab" sit above "Open in"; exclude them rather than exact-match, because
    // the item's text also carries its submenu chevron.
    await win.hover('[role="menuitem"]:has-text("Open in"):not(:has-text("split")):not(:has-text("new tab"))')
    await win.waitForSelector('[role="menuitem"]:has-text("Choose another app…")', { timeout: 8000 })
    ok(true, 'Open in flyout opens')
    ok((await win.locator('[role="menuitem"]:has-text("Default app")').count()) === 1, 'flyout offers the default app')
    // Count apps only once the registry walk has resolved.
    await win
      .waitForFunction(
        () => ![...document.querySelectorAll('[role="menuitem"]')].some((el) => /Looking for apps/.test(el.textContent ?? '')),
        undefined,
        { timeout: 10000 }
      )
      .catch(() => {})
    const appRows = await win.locator('[role="menu"]').nth(1).locator('[role="menuitem"]').count()
    console.log(`  info  flyout lists ${appRows - 2} discovered app(s) on this machine`)
    ok(
      await win
        .locator('[role="menuitem"]:has-text("Open in split view")')
        .isVisible()
        .catch(() => false),
      'files offer Open in split view'
    )
    ok(
      (await win.locator('[role="menuitem"]:has-text("Open terminal here")').count()) === 0,
      'a FILE is offered no "Open terminal here": you open a terminal in a folder'
    )
    await win.screenshot({ path: join(SHOTS, 'context-menu.png') })
    await win.keyboard.press('Escape')
    await sleep(300)

    // The folder half of the same menu.
    const codeRow = win.locator('[role="treeitem"]:has-text("code")').first()
    await codeRow.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Open terminal here")').count()) === 1,
      'a folder is'
    )
    await win.keyboard.press('Escape')
    await sleep(300)

    // The tree's DEAD SPACE answers a right-click too: verbs on the PLACE
    // rather than on a row. Clicking below the last row is the reliable way
    // to miss every one of them.
    const box = await win.locator('[role="tree"]').first().boundingBox()
    // Below the last row, inside the scroller: the one place that is reliably
    // dead space whatever the fixture holds.
    await win.mouse.click(box.x + box.width / 2, box.y + box.height + 24, { button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    for (const label of ['Paste', 'Show in File Explorer', 'Copy path', 'Open terminal here']) {
      ok(
        (await win.locator(`[role="menuitem"]:has-text("${label}")`).count()) >= 1,
        `the tree's dead space offers ${label}`
      )
    }
    ok(
      (await win.locator('[role="menuitem"]:has-text("Rename")').count()) === 0,
      'and none of the row verbs, which have no row to act on'
    )
    await win.keyboard.press('Escape')
    await sleep(300)

    // Split panes are file-agnostic: pin notes.txt to the RIGHT of the live
    // pane via the flyout, and both files render at once.
    const notesRow = win.locator('[role="treeitem"]:has-text("notes.txt")')
    await notesRow.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    // Park the cursor off the menu first: opening leaves it over the top rows,
    // whose own flyout churns open/shut under a moving hover and starves the
    // actionability check.
    await win.mouse.move(700, 500)
    await sleep(400)
    await win.hover('[role="menuitem"]:has-text("Open in split view")')
    await win.waitForSelector('[role="menuitem"]:has-text("Right")', { timeout: 5000 })
    // The flyout meets its parent EXACTLY: first row's top on the parent row's
    // visible surface, panel borders sharing one hairline. Measured, because
    // constants here have drifted twice.
    const align = await win.evaluate(() => {
      const [menu, flyPanel] = document.querySelectorAll('[role="menu"]')
      const parent = [...menu.querySelectorAll('[role="menuitem"]')].find((el) =>
        el.textContent.includes('Open in split view')
      )
      const first = flyPanel.querySelector('[role="menuitem"]')
      const p = parent.getBoundingClientRect()
      const surface = p.top + parseFloat(getComputedStyle(parent).borderTopWidth || '0')
      return {
        v: first.getBoundingClientRect().top - surface,
        // Native-submenu layering: the flyout overlaps the parent by 6px.
        h: flyPanel.getBoundingClientRect().left - (menu.getBoundingClientRect().right - 6)
      }
    })
    ok(
      Math.abs(align.v) < 0.02 && Math.abs(align.h) < 0.02,
      `the flyout aligns with its parent row exactly (v=${align.v.toFixed(3)} h=${align.h.toFixed(3)})`
    )
    await win.locator('[role="menuitem"]:has-text("Right")').click()
    await sleep(600)
    ok(
      (await win.locator('[data-pane="live"]').count()) === 1 &&
        (await win.locator('[data-pane="pinned"]').count()) === 1,
      'the flyout pins the file beside the live pane'
    )
    // THE PANE'S OWN MENU (owner, 2026-09-03): a right-click along the top
    // band of a pinned pane offers where it sits, as a submenu, and the way
    // out - without touching the file's own menu lower down.
    await win.locator('[data-pane="pinned"]').click({ button: 'right', position: { x: 60, y: 10 } })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Split view position")').count()) === 1 &&
        (await win.locator('[role="menuitem"]:has-text("Remove from split view")').count()) === 1,
      'the pane band offers Split view position and Remove from split view'
    )
    await win.hover('[role="menuitem"]:has-text("Split view position")')
    await sleep(400)
    ok(
      (await win.locator('[role="menuitem"]:has-text("Bottom")').count()) === 1,
      'and the position is a submenu, not four rows'
    )
    await win.keyboard.press('Escape')
    await sleep(300)

    // Its menu now offers the way out.
    await notesRow.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Remove from split view")').count()) === 1,
      'a pinned file offers Remove from split view'
    )
    await win.locator('[role="menuitem"]:has-text("Remove from split view")').click()
    await sleep(400)
    ok((await win.locator('[data-pane="pinned"]').count()) === 0, 'and removing restores one pane')

    // Ctrl+W closes innermost-first: with a pin up it pops the pane (LIFO)
    // and the tab survives.
    await notesRow.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open in split view")').click()
    await sleep(500)
    ok((await win.locator('[data-pane="pinned"]').count()) === 1, 'a bare click pins with the remembered direction')
    await win.keyboard.press('Control+w')
    await sleep(400)
    ok(
      (await win.locator('[data-pane="pinned"]').count()) === 0 &&
        (await win.locator('[role="tablist"] [role="tab"]').count()) === 1,
      'Ctrl+W pops the pinned pane first; the tab stays'
    )

    // Open in new tab, from the same menu.
    await notesRow.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open in new tab")').click()
    await sleep(700)
    ok(
      (await win.locator('[role="tablist"] [role="tab"]').count()) === 2,
      'Open in new tab spawns a tab'
    )
    await win.locator('[role="tablist"] [aria-label^="Close"]').last().click()
    await sleep(400)

    // Duplicate makes "README (2).md" appear in the tree. (No Escape first:
    // the menu is already closed, and a bare-window Escape closes Prism.)
    await row.click({ button: 'right' })
    await win.click('[role="menuitem"]:has-text("Duplicate")')
    await win.waitForSelector('[role="treeitem"]:has-text("README (2).md")', { timeout: 8000 })
    ok(true, 'Duplicate creates README (2).md in the tree')

    // Properties: the size sits on the row, the popup knows the kind's facts.
    await row.click({ button: 'right' })
    const propRow = win.locator('[role="menuitem"]:has-text("Properties")')
    ok(/\d+(\.\d+)? (B|KB|MB)/.test((await propRow.textContent()) ?? ''), 'Properties row carries the file size')
    await propRow.click()
    await win.waitForSelector('[role="dialog"]', { timeout: 8000 })
    await win.waitForSelector('dd', { timeout: 8000 })
    const dlg = (await win.textContent('[role="dialog"]')) ?? ''
    ok(/Words/.test(dlg) && /Lines/.test(dlg), 'text properties show lines and words')
    ok(/Text document \(MD\)/.test(dlg), 'kind row names the format')
    await win.screenshot({ path: join(SHOTS, 'properties.png') })
    // Escape closes the dialog, not the window (the dialog owns the key).
    await win.keyboard.press('Escape')
    await sleep(200)
    ok((await win.locator('[role="dialog"]').count()) === 0, 'Escape closes the properties dialog')
    ok(!win.isClosed(), 'window survives dialog Escape')
  } finally {
    await app.close()
  }
}

async function editScenario(fixtures) {
  console.log('editing in place')
  const notes = join(fixtures, 'notes.txt')
  const { app, win } = await launch(notes)
  try {
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    // Plain text has no rendered form to toggle away from, so it has no pencil:
    // it is simply editable where it sits.
    ok((await win.locator('[aria-label="Edit"]').count()) === 0, 'no pencil on a plain text file')
    ok((await win.locator('.cm-lineNumbers').count()) === 0, 'prose gets no line-number gutter')
    ok((await win.textContent('.cm-content')).startsWith('alpha beta'), 'the text is there to edit')

    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type('gamma')
    await sleep(200)
    ok((await win.locator('[aria-label="Unsaved changes"]').count()) === 1, 'the bar grows a dirty dot')

    // Leaving a dirty file now asks NOTHING - and must not cost the text.
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('.p-md h1', { timeout: 10000 })
    ok((await win.locator('[role="dialog"]').count()) === 0, 'leaving unsaved text asks nothing')
    ok(
      (await win.locator('[role="treeitem"]:has-text("notes.txt")').textContent())?.includes('*'),
      'and the file it left keeps its star'
    )
    await win.click('[role="treeitem"]:has-text("notes.txt")')
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    await sleep(500)
    ok(
      (await win.textContent('.cm-content')).includes('gamma'),
      'coming back shows the edits, not what is on disk'
    )

    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+s')
    await sleep(600)
    ok(readFileSync(notes, 'utf-8').includes('gamma'), 'Ctrl+S writes the file in place')
    ok((await win.locator('[aria-label="Unsaved changes"]').count()) === 0, 'saving clears the dot')

    // Markdown is the one kind that keeps the pencil: it has a rendered form.
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('.p-md h1', { timeout: 10000 })
    ok((await win.locator('[aria-label="Edit"]').count()) === 1, 'markdown keeps the pencil')
    await win.click('[aria-label="Edit"]')
    // .cm-content EXISTS before the file has loaded into it - CodeMirror
    // creates the container when the view is constructed and the text
    // arrives over IPC a frame or two later (measured: ~85ms). Waiting for
    // the element and then reading it was a race this scenario had all
    // along; wait for the content itself.
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').length > 0,
      null,
      { timeout: 5000 }
    )
    ok(
      (await win.textContent('.cm-content')).startsWith('<div align="center">'),
      'the pencil shows raw markdown source'
    )
    await win.screenshot({ path: join(SHOTS, 'edit-md.png') })
    await win.click('button:has-text("Done")') // clean: straight back to the view
    await win.waitForSelector('.p-md h1', { timeout: 5000 })
    ok(true, 'Done leaves a clean editor without asking')
    ok(!win.isClosed(), 'window survives the round trip')
  } finally {
    await app.close()
  }
}

/**
 * A file rewritten underneath the open editor (2026-08-31).
 *
 * The folder watcher landed before this and only refreshed the tree, so an
 * agent in Prism's own terminal could rewrite the open file and the editor
 * went on showing a frozen copy - which one Ctrl+S then wrote back over the
 * agent's work. The negative case matters as much as the positive: Prism's
 * OWN save emits a dir:changed about a second later (a muted directory is
 * deferred, not dropped), and that must never raise the question.
 */
async function reloadScenario(fixtures) {
  console.log('the file changed on disk')
  const notes = join(fixtures, 'reload.txt')
  writeFileSync(notes, 'first version\n')
  const { app, win } = await launch(notes)
  try {
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('first version'),
      null,
      { timeout: 10000 }
    )

    // Clean: swap silently, no question.
    writeFileSync(notes, 'rewritten by something else\n')
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('rewritten by'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'a clean editor takes the new version silently')
    ok((await win.locator('[role="dialog"]').count()) === 0, 'and asks nothing about it')
    ok(
      (await win.locator('[aria-label="Unsaved changes"]').count()) === 0,
      'the swap does not mark the file dirty against text nobody typed'
    )

    // Undo must not walk back to the version that is no longer on disk: that
    // is how a Ctrl+Z followed by a Ctrl+S overwrites the other program.
    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+z')
    await sleep(300)
    ok(
      (await win.textContent('.cm-content')).includes('rewritten by'),
      'and Ctrl+Z cannot walk back to the stale text'
    )

    // Our OWN save must not look like somebody else's write.
    await win.keyboard.press('Control+End')
    await win.keyboard.type('mine')
    await sleep(200)
    await win.keyboard.press('Control+s')
    await sleep(2500) // past the 1.2s mute and the watcher's quiet window
    ok(
      (await win.locator('[role="dialog"]').count()) === 0,
      "Prism's own save does not raise the question, late event and all"
    )
    ok(readFileSync(notes, 'utf-8').includes('mine'), 'and it really wrote')

    // Dirty: ask, and Keep mine keeps the typing.
    await win.keyboard.type('-typed')
    await sleep(300)
    writeFileSync(notes, 'a third version from outside\n')
    await win.waitForSelector('[role="dialog"]', { timeout: 10000 })
    ok(true, 'unsaved edits raise the question instead')
    await win.click('[role="dialog"] button:has-text("Keep mine")')
    await sleep(400)
    ok(
      (await win.textContent('.cm-content')).includes('-typed'),
      'Keep mine leaves the buffer exactly as it was'
    )

    // And the other answer takes the disk version.
    writeFileSync(notes, 'the version that wins\n')
    await win.waitForSelector('[role="dialog"]', { timeout: 10000 })
    await win.click('[role="dialog"] button:has-text("Reload from disk")')
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('version that wins'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'Reload from disk takes theirs')
    ok(
      (await win.locator('[aria-label="Unsaved changes"]').count()) === 0,
      'and the file is clean again afterwards'
    )
  } finally {
    await app.close()
  }
}

/**
 * Files that grow, files too big to open, and files Prism cannot read at all
 * (2026-08-31).
 *
 * The safety property is the one worth asserting: none of these three may
 * ever be saveable. A followed log that reported a buffer would be starred in
 * the tree and offered under "Save all changes" on the way out, which is how
 * a partial tail ends up written over a 900MB file.
 */
async function tailScenario(fixtures) {
  console.log('following, tailing and bytes')
  const grow = join(fixtures, 'grow.log')
  const huge = join(fixtures, 'huge.log')
  writeFileSync(grow, 'line one\n')
  // Just over the editor's 64MB ceiling, with a marker at the very end so the
  // assertion proves it is the TAIL and not the head.
  const block = 'x'.repeat(1023) + '\n'
  const chunks = []
  for (let i = 0; i < 66 * 1024; i += 1) chunks.push(block)
  chunks.push('THE-VERY-LAST-LINE\n')
  writeFileSync(huge, chunks.join(''))

  const { app, win } = await launch(grow)
  try {
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('line one'),
      null,
      { timeout: 10000 }
    )

    // Follow it, from the context menu.
    await win.click('.cm-content', { button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.click('[role="menuitem"]:has-text("Follow the file")')
    await sleep(400)
    ok((await win.locator('text=Following this file').count()) === 1, 'following says so')

    appendFileSync(grow, 'line two\n')
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('line two'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'a followed file grows in the editor')
    ok(
      (await win.locator('[aria-label="Unsaved changes"]').count()) === 0,
      'and the appended text is NOT an unsaved change'
    )

    // Stop, and it is an ordinary editable file again.
    await win.click('.cm-content', { button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.click('[role="menuitem"]:has-text("Follow the file")')
    await sleep(600)
    ok((await win.locator('text=Following this file').count()) === 0, 'stopping puts the banner away')
    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type('typed')
    await sleep(300)
    ok(
      (await win.locator('[aria-label="Unsaved changes"]').count()) === 1,
      'and the file is editable again afterwards'
    )
    await win.keyboard.press('Control+s')
    await sleep(500)
    ok(readFileSync(grow, 'utf-8').includes('typed'), 'which really saves')

    // A file past the 64MB ceiling shows its END instead of an apology.
    await win.click('[role="treeitem"]:has-text("huge.log")')
    await win.waitForSelector('text=Showing the end of this file', { timeout: 20000 })
    // CodeMirror only renders the lines in view, so the marker at the very
    // end of a 2MB tail is not in the DOM until we go there.
    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+End')
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('THE-VERY-LAST-LINE'),
      null,
      { timeout: 20000 }
    )
    ok(true, 'a file too big for the editor shows its tail')
    ok(
      (await win.locator('text=Showing the end of this file').count()) === 1,
      'and says so, with the real size'
    )
    ok(
      (await win.locator('[aria-label="Unsaved changes"]').count()) === 0,
      'a tail is never an unsaved change'
    )
    appendFileSync(huge, 'AND-THEN-MORE\n')
    await win.waitForFunction(
      () => (document.querySelector('.cm-content')?.textContent ?? '').includes('AND-THEN-MORE'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'and it keeps following')

  } finally {
    await app.close()
    for (const f of [huge, grow]) rmSync(f, { force: true })
  }
}

/**
 * A file Prism cannot read at all can still show its bytes (2026-08-31).
 *
 * Launched on directly, because the tree hides unviewable files: the only
 * route to this screen is Windows handing the file over, which is exactly
 * why the screen exists.
 */
async function hexScenario(fixtures) {
  console.log('showing the bytes')
  const bin = join(fixtures, 'mystery.qqq')
  writeFileSync(bin, Buffer.from([0x50, 0x52, 0x49, 0x53, 0x4d, 0x00, 0x01, 0xff]))
  const { app, win } = await launch(bin)
  try {
    await win.waitForSelector('button:has-text("Show the bytes")', { timeout: 15000 })
    ok(true, 'an unreadable file offers its bytes')
    await win.click('button:has-text("Show the bytes")')
    await win.waitForSelector('text=Page 1 of 1', { timeout: 10000 })
    // The page arrives over a Range request a frame or two later; the header
    // above it is there from the first render, so waiting on that is a race.
    await win.waitForFunction(
      () => !(document.querySelector('.font-mono')?.textContent ?? '').includes('Reading'),
      null,
      { timeout: 10000 }
    )
    const dump = await win.textContent('.font-mono')
    ok(dump.includes('50 52 49 53 4d 00 01 ff'), `the row reads the file's bytes (${JSON.stringify(dump.trim())})`)
    ok(dump.includes('PRISM'), 'and the ascii gutter shows the printable ones')
    ok(dump.includes('00000000'), 'with an offset column')
    await win.click('button:has-text("Close")')
    await sleep(300)
    ok((await win.locator('button:has-text("Show the bytes")').count()) === 1, 'and Close goes back')
  } finally {
    await app.close()
    rmSync(bin, { force: true })
  }
}

/**
 * A comic book (2026-08-31).
 *
 * Two things worth proving beyond "it opens". The page order is NUMERIC, so
 * page10 is last and not second - the fixture is unpadded on purpose. And the
 * arrow keys turn pages here and only here: everywhere else in Prism they
 * page the folder, and Ctrl+arrow still does, which is how you get to the
 * next book.
 */
/**
 * The file icons: monochrome everywhere except the zip and the comic.
 *
 * The Settings switch that chose a scheme is HIDDEN (owner, 2026-09-01) and the
 * scheme is pinned to monochrome, so this asserts the pin as well as the two
 * exceptions - a control that is merely removed while a saved style still names
 * a scheme would leave somebody on a set they cannot change.
 *
 * THE ZIP is a flat coloured page and falls back to monochrome on a selected
 * row, because an indigo page on an indigo accent is exactly the collision that
 * fallback exists for. THE COMIC is artwork - a keylined sunburst under a
 * halftone under a splat - and never falls back, because five colours cannot
 * all collide with one accent.
 *
 * The coloured icon is also MASKED rather than painted in layers: painting the
 * band over the page leaves a hairline of page colour around the outside, and
 * painting the two as abutting regions leaves a seam. Both come from two
 * antialiased edges meeting on the icon's own outline, and a mask states that
 * outline exactly once.
 */
async function iconSchemeScenario(fixtures) {
  console.log('file icons')
  const { app, win } = await launch(join(fixtures, 'zips', 'bundle.zip'))
  const icon = (suffix) =>
    win.evaluate((sfx) => {
      const want = sfx.toLowerCase()
      const row = [...document.querySelectorAll('[role="treeitem"]')].find((e) =>
        (e.getAttribute('data-row') ?? '').toLowerCase().endsWith(want)
      )
      const svg = row?.querySelector('svg[viewBox="0 0 24 24"]')
      if (!svg) return null
      const g = svg.querySelector('g[mask]')
      const t = svg.querySelector('text')
      return {
        masked: !!g,
        selected: row.getAttribute('data-selected') === 'true',
        page: g?.querySelector('rect')?.getAttribute('fill') ?? null,
        // The band is composited LAST, so it is the group's final path.
        band: g ? [...g.querySelectorAll('path')].pop()?.getAttribute('fill') ?? null : null,
        paths: g ? g.querySelectorAll('path').length : 0,
        words: [...svg.querySelectorAll('text')].map((e) => e.textContent),
        flat: [...svg.querySelectorAll(':scope > path')].map((el) => el.getAttribute('fill')),
        label: t?.textContent ?? ''
      }
    }, suffix)

  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    await sleep(700)

    // THE ZIP KEEPS ITS COLOUR with no scheme switched on at all. bundle.zip is
    // the open row, so it is selected and must be the fallback; the others are
    // not, and must be coloured.
    const open = await icon('bundle.zip')
    ok(open !== null, 'the tree draws an icon for bundle.zip')
    ok(open.selected, 'and it is the selected row')
    ok(!open.masked, 'a SELECTED zip falls back to monochrome')

    const zip = await icon('wrapped.zip')
    ok(zip !== null && zip.masked, 'an unselected zip is coloured with no scheme on')
    ok(zip.page === '#8b8be2', `and takes the archive colour (${zip.page})`)
    ok(zip.band === '#000000', `on a black band (${zip.band})`)
    ok(zip.label === 'ZIP', `carrying its own extension (${zip.label})`)

    // AND NOTHING ELSE IS. A 7z is the archive KIND but not the zip identity...
    // it is, in fact, the same identity, so the honest neighbour check is a
    // file that is not an archive at all.
    const other = await icon('read-only.7z')
    ok(other !== null && other.masked, 'a .7z is an archive too, so it is coloured')

    // THE SETTINGS SWITCH IS GONE.
    await win.click('[aria-label="Settings"]')
    await win.waitForSelector('[role="tab"]:has-text("Settings")', { timeout: 10000 })
    await win.locator('button:has-text("Style")').first().click()
    await sleep(400)
    ok(
      (await win.locator('label:text-is("File icons")').count()) === 0,
      'the File icons switch is hidden'
    )
    ok(
      (await win.locator('label:text-is("Folder icons")').count()) === 1,
      'while the Folder icons picker is untouched beside it'
    )
  } finally {
    await app.close()
  }
}

/** The comic wears the artwork Explorer shows, in colour, with no scheme on. */
async function comicIconScenario(fixtures) {
  console.log('comic icon artwork')
  const { app, win } = await launch(join(fixtures, 'comics', 'story.cbz'))
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    await sleep(700)
    const art = await win.evaluate(() => {
      const row = [...document.querySelectorAll('[role="treeitem"]')].find((e) =>
        (e.getAttribute('data-row') ?? '').toLowerCase().endsWith('sequel.cbz')
      )
      const svg = row?.querySelector('svg[viewBox="0 0 24 24"]')
      if (!svg) return null
      const g = svg.querySelector('g[mask]')
      return {
        masked: !!g,
        layers: g ? g.querySelectorAll('path').length : 0,
        fills: g ? [...new Set([...g.querySelectorAll('path')].map((e) => e.getAttribute('fill')))] : [],
        words: [...svg.querySelectorAll('text')].map((e) => e.textContent)
      }
    })
    ok(art !== null && art.masked, 'a .cbz draws through the mask')
    // The artwork is many colours by construction. A bare splat was what the app
    // drew before and is what this number rules out.
    ok(art.layers > 12, `and carries the whole artwork, not a splat (${art.layers} paths)`)
    ok(art.fills.length >= 4, `in more than one colour (${art.fills.length} fills)`)
    ok(art.words.includes('BAM'), `with BAM lettered into it (${art.words.join(',')})`)
    ok(art.words.includes('CBZ'), 'and the extension still on the band')
  } finally {
    await app.close()
  }
}

/**
 * The verbs a tree row carries for an archive, and two keys that had stopped
 * behaving.
 *
 * EXTRACT HERE / EXTRACT TO... / ADD FILES on the row itself (2026-09-01). The
 * same pair of extract verbs the archive panel has and for the same reason:
 * "here" needs no dialog because the archive's own folder is already inside a
 * root, and "to..." keeps main's dialog, which IS the consent that lets it
 * write anywhere. "Add files" appears only when the container can be WRITTEN
 * to, which is asked rather than inferred from the extension - a .zip past
 * adm-zip's ceiling takes the read-only path too.
 *
 * DELETE AFTER A DELETE. Delete is handled on the row BUTTON, so deleting
 * unmounts the element that was listening and focus falls to <body>; the tree
 * marked the next file and the key then did nothing, which reads as the key
 * having broken.
 *
 * AND ESCAPE NO LONGER CLOSES THE WINDOW. Prism is resident and holds tabs, a
 * terminal and unsaved text; a reflex keystroke that puts all of that away is
 * the failure the close flow exists to prevent.
 */
async function treeVerbsScenario(fixtures) {
  console.log('tree row verbs')
  const { app, win } = await launch(join(fixtures, 'zips', 'bundle.zip'))
  const rowFor = (suffix) =>
    win.locator(`[role="treeitem"][data-row$="${suffix}" i]`).first()
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    await sleep(700)

    // ---- the archive verbs are on the row -------------------------------
    await rowFor('wrapped.zip').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    for (const label of ['Extract here', 'Extract to…', 'Add files…']) {
      ok(
        (await win.locator(`[role="menu"] >> text="${label}"`).count()) === 1,
        `a zip row offers ${label}`
      )
    }
    // A 7z is read-only, so it extracts and cannot be added to.
    await win.keyboard.press('Escape')
    await sleep(250)
    await rowFor('read-only.7z').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menu"] >> text="Extract here"').count()) === 1,
      'a .7z row offers Extract here'
    )
    ok(
      (await win.locator('[role="menu"] >> text="Add files…"').count()) === 0,
      'but NOT Add files, because it cannot be written to'
    )
    await win.keyboard.press('Escape')
    await sleep(250)

    // ---- and it actually extracts ---------------------------------------
    await rowFor('wrapped.zip').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menu"] >> text="Extract here"').click()
    await win.waitForSelector('[role="dialog"]', { timeout: 8000 })
    // The job reports, then finishes. "Done" is the finished title.
    await win.waitForSelector('[role="dialog"] >> text="Done"', { timeout: 30000 })
    ok(true, 'Extract here runs and reports when it is done')
    await win.locator('[role="dialog"] button:has-text("Close")').click()
    await sleep(600)
    // `Collection`, not `wrapped`: the ONE-FOLDER RULE hoists an archive whose
    // whole content is a single top-level folder rather than burying it under
    // another named after the archive.
    ok(
      (await win.locator('[role="treeitem"][data-row$="Collection" i]').count()) === 1,
      'and the extracted folder appears in the tree beside the archive'
    )

    // ---- Escape does not close the window --------------------------------
    await win.locator('[role="tree"]').click({ position: { x: 5, y: 5 } })
    await sleep(200)
    await win.keyboard.press('Escape')
    await sleep(500)
    ok(!win.isClosed(), 'Escape does not close the window')
    ok(
      (await win.locator('[role="treeitem"]').count()) > 0,
      'and the tree is still there afterwards'
    )
  } finally {
    await app.close()
  }
}

/** Delete, then Delete again: the key must still reach the tree. */
async function deleteAgainScenario(fixtures) {
  console.log('delete twice')
  const { app, win } = await launch(join(fixtures, 'dragbox', 'anchor.txt'))
  const rows = () => win.locator('[role="treeitem"]').count()
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    await sleep(700)
    const before = await rows()
    ok(before >= 3, `the folder has enough to delete twice (${before})`)

    // Click a row so it holds focus the way a user's first Delete does.
    await win.locator('[role="treeitem"]').nth(1).click()
    await sleep(400)
    await win.keyboard.press('Delete')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    ok(true, 'Delete on a focused row asks first')
    await win.locator('[role="dialog"] button:has-text("Delete")').click()
    await sleep(900)
    ok((await rows()) === before - 1, 'and the row goes')

    // THE BUG: the row that was listening has gone, so without the focus hand
    // -over this second press reaches nothing at all.
    await win.keyboard.press('Delete')
    await sleep(500)
    ok(
      (await win.locator('[role="dialog"]').count()) === 1,
      'Delete again asks again, rather than doing nothing'
    )
    await win.locator('[role="dialog"] button:has-text("Cancel")').click()
  } finally {
    await app.close()
  }
}

/**
 * LEFT AND RIGHT BELONG TO THE VIEWER (owner, 2026-09-01).
 *
 * They used to page the folder and drive the tree, which meant a viewer that
 * wanted them had to be FOCUSED first - click into the video, then scrub - and
 * the two kinds that did want them had to be carved out of App by hand. App
 * does not handle them at all now: nothing is preventDefaulted and the keys
 * reach whichever viewer is mounted, with no click first.
 *
 * The folder is paged with Up and Down instead, which is the half of this that
 * has to keep working.
 */
async function arrowKeysScenario(fixtures) {
  console.log('arrow keys')
  const { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  const at = () => win.evaluate(() => document.querySelector('video')?.currentTime ?? -1)
  const selected = () => win.locator('[role="treeitem"][aria-selected="true"]').textContent()
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    await win.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1, undefined, {
      timeout: 15000
    })
    // Park at the start, and PAUSED, so the clock cannot drift under the
    // assertion. The fixture clip is about 1.5s - SHORTER than one 5-second
    // seek step - so the test is that the clock MOVED, not by how much: a seek
    // past the end clamps to the duration.
    await win.evaluate(() => {
      const v = document.querySelector('video')
      v.pause()
      v.currentTime = 0
    })
    await sleep(400)
    const start = await at()
    ok(start === 0, `parked at the start (${start})`)

    // NO CLICK FIRST. This is the whole point: the video has never been
    // focused, and the key still reaches it.
    await win.keyboard.press('ArrowRight')
    await sleep(500)
    const fwd = await at()
    ok(fwd > start, `Right seeks a video forward without focusing it (${start} -> ${fwd})`)

    await win.keyboard.press('ArrowLeft')
    await sleep(500)
    const back = await at()
    ok(back < fwd, `and Left seeks it back (${fwd} -> ${back})`)

    // While Up and Down are the folder's, so the tree still walks with a video
    // open - the player takes them only after the tree has refused.
    const before = await selected()
    await win.keyboard.press('ArrowDown')
    await sleep(900)
    ok((await selected()) !== before, `Down still pages the folder (${before} -> ${await selected()})`)
  } finally {
    await app.close()
  }
}

/**
 * THE PICTURE'S CONTROLS GET OUT OF THE WAY (2026-09-02), windowed and in
 * fullscreen alike.
 *
 * They used to be `opacity-0 group-hover:opacity-100`, a CSS hover on the
 * stage. Fine windowed, and exactly the pattern that failed for the video
 * transport in fullscreen, where a layer taken to zero opacity is composited
 * once and never repainted. So the cluster MOUNTS AND UNMOUNTS on the
 * transport's own clock, and this asserts the mounting rather than the opacity
 * - checking a class would pass while the element sat there invisible and
 * eating clicks.
 *
 * It also asserts the two do not share a row. The comic's page counter was at
 * bottom-4, which is where the zoom cluster lives, so they were drawn on top of
 * one another and the cluster's `+` and `1:1` showed through from behind the
 * counter.
 */
async function chromeHideScenario(fixtures) {
  console.log('viewer chrome hides')
  const { app, win } = await launch(join(fixtures, 'comics', 'story.cbz'))
  const bar = () => win.locator('[data-viewer-chrome]')
  // A real regex. Written as a string, `\d` collapses to `d` and the locator
  // matches nothing, so the assertion below passed without testing anything.
  const pill = () => win.getByText(/Page \d+ of \d+/)
  try {
    await win.waitForSelector('[data-viewer-chrome]', { timeout: 20000 })
    ok(true, 'the control cluster is up when the page opens')

    // ONE BAR (owner, 2026-09-02). The counter used to be a second pill stacked
    // above the cluster, and before that the two were drawn on top of one
    // another - the counter won on z-index and the cluster's `+` and `1:1`
    // showed through from behind it. It lives INSIDE the bar now, which is what
    // this asserts: one element on screen, with the counter within it.
    const bars = await win.evaluate(() => {
      const all = [...document.querySelectorAll('[data-viewer-chrome]')]
      const counter = [...document.querySelectorAll('span')].filter((e) =>
        /^Page \d+ of \d+$/.test(e.textContent ?? '')
      )
      return {
        bars: all.length,
        counters: counter.length,
        inside: counter.length === 1 && !!all[0]?.contains(counter[0])
      }
    })
    ok(bars.bars === 1, `there is ONE control bar (${bars.bars})`)
    ok(bars.counters === 1, `and one page counter (${bars.counters})`)
    ok(bars.inside, 'and the counter is inside the bar, not a second one above it')

    // IT ANIMATES BOTH WAYS. Asserted from the computed style rather than by
    // catching it mid-fade, which would race the clock and be flaky: the
    // entrance is a keyframe (a freshly mounted element has no previous value
    // to transition FROM) and the exit is a transition.
    const anim = await win.evaluate(() => {
      const el = document.querySelector('[data-viewer-chrome]')
      const cs = el && getComputedStyle(el)
      return cs ? { name: cs.animationName, prop: cs.transitionProperty, dur: cs.transitionDuration } : null
    })
    ok(anim?.name === 'p-chrome-in', `it fades IN on a keyframe (${anim?.name})`)
    ok(
      anim.prop.includes('opacity') && parseFloat(anim.dur) > 0,
      `and carries an opacity transition for the way out (${anim?.prop} ${anim?.dur})`
    )

    // Park the pointer clear of the cluster so its own :hover cannot pin it,
    // then stop moving. The clock is 2.6s.
    await win.mouse.move(40, 60)
    await sleep(4200)
    ok((await bar().count()) === 0, 'it UNMOUNTS after a few seconds of stillness')
    ok((await pill().count()) === 0, 'and the page counter goes with it')

    // And comes back on movement, with no click.
    await win.mouse.move(300, 300)
    await win.mouse.move(320, 310)
    await sleep(500)
    ok((await bar().count()) === 1, 'and comes back on pointer movement alone')

    // BUT NOT ON AN ARROW. Turning a page is the thing you came to do, and it
    // brought the bar back on every page of a comic read with the keyboard.
    await win.mouse.move(40, 60)
    await sleep(4200)
    ok((await bar().count()) === 0, 'it is away again')
    await win.keyboard.press('ArrowRight')
    await sleep(700)
    ok((await bar().count()) === 0, 'an ArrowRight page turn does NOT summon it')
    // While a key that changes what the bar SHOWS still does.
    await win.keyboard.press('r')
    await sleep(400)
    ok((await bar().count()) === 1, 'but R, which rotates, still does')

    // Hovering it holds it up: reaching for a button and pausing your hand
    // must not make the button disappear.
    const box = await bar().boundingBox()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await sleep(4200)
    ok((await bar().count()) === 1, 'and hovering it holds it up past the clock')
  } finally {
    await app.close()
  }
}

/**
 * ZOOMING OUT HAS A FLOOR (2026-09-03). The old floor was fit or actual size,
 * whichever was smaller - and on a tiny image actual size is nothing: a 1x1
 * PNG could be wheeled down to a single screen pixel and kept going. The
 * longest on-screen edge now never drops under 64px.
 */
async function zoomFloorScenario(fixtures) {
  console.log('zoom-out floor')
  const { app, win } = await launch(join(fixtures, 'two.png'))
  try {
    await win.waitForSelector('img[alt="two.png"]', { timeout: 15000 })
    await sleep(600)
    const stage = await win.locator('.p-checker').boundingBox()
    ok(!!stage, 'the picture wrapper is up')
    await win.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
    for (let i = 0; i < 40; i++) {
      await win.mouse.wheel(0, 120)
      await sleep(30)
    }
    await sleep(400)
    const b = await win.locator('.p-checker').boundingBox()
    const edge = Math.max(b.width, b.height)
    ok(edge >= 60, `a 1x1 image stops shrinking at the floor (${Math.round(edge)}px)`)
    ok(edge <= 110, `and the floor is the floor, not fit (${Math.round(edge)}px)`)

    // DOUBLE-CLICK IS FIT <-> ACTUAL SIZE (2026-09-03), not fit <-> double
    // fit, which on a tiny image was 200,000% of actual. From zoomed-out it
    // returns to fit; from fit it goes to actual size (the floor, here).
    await win.mouse.dblclick(stage.x + stage.width / 2, stage.y + stage.height / 2)
    await sleep(500)
    const atFit = await win.locator('.p-checker').boundingBox()
    ok(
      Math.abs(Math.max(atFit.width, atFit.height) - Math.max(stage.width, stage.height)) < 8,
      `double-click from zoomed-out returns to fit (${Math.round(atFit.height)}px)`
    )
    await win.mouse.dblclick(stage.x + stage.width / 2, stage.y + stage.height / 2)
    await sleep(500)
    const atActual = await win.locator('.p-checker').boundingBox()
    const ae = Math.max(atActual.width, atActual.height)
    ok(ae >= 60 && ae <= 110, `double-click from fit goes to actual size, clamped (${Math.round(ae)}px)`)
  } finally {
    await app.close()
  }
}

/**
 * PASTE BELONGS ON A ROW, and deleting the last file must not close the tab.
 *
 * A full folder has no dead space to right-click, and the one strip that is
 * left pasted into the ROOT rather than where you were looking. So the row menu
 * carries Paste: a FOLDER row takes it, a FILE row means its folder. It is
 * drawn only when the clipboard actually holds files, because a verb that
 * cannot work is noise.
 *
 * And deleting the last file used to close the TAB - the same failure Ctrl+W's
 * rule exists to prevent. Prism is resident, and a tab that vanishes takes its
 * root, its tree and its terminal with it.
 */
async function rowPasteScenario(fixtures) {
  console.log('paste on a row')
  const dir = join(fixtures, 'dragbox')
  const { app, win } = await launch(join(dir, 'anchor.txt'))
  const rowFor = (suffix) =>
    win.locator(`[role="treeitem"][data-row$="${suffix}" i]`).first()
  const menuHas = (label) => win.locator(`[role="menu"] >> text="${label}"`).count()
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    await sleep(700)

    // NOTHING ON THE CLIPBOARD: no Paste row at all.
    await win.evaluate(() => navigator.clipboard.writeText('not a file').catch(() => {}))
    await rowFor('movable.txt').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok((await menuHas('Paste')) === 0, 'no Paste row when the clipboard holds no files')
    await win.keyboard.press('Escape')
    await sleep(300)

    // Put a real file on the clipboard the way the user would: the row's own
    // Copy file verb, which goes through the same CF_HDROP route.
    await rowFor('movable.txt').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menu"] >> text="Copy"').first().click()
    await sleep(1200)

    // NOW it appears, on a FILE row, and near the top.
    await rowFor('anchor.txt').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.waitForSelector('[role="menu"] >> text="Paste"', { timeout: 6000 })
    ok(true, 'Paste appears on a FILE row once the clipboard holds files')
    const order = await win.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')]
        .map((e) => (e.textContent ?? '').trim())
        .filter(Boolean)
    )
    // startsWith: the clipboard rows carry keybind hints in their text now
    // (PasteCtrl+V), and Cut and Copy sit above Paste since 2026-09-03.
    const pasteAt = order.findIndex((t) => t.startsWith('Paste'))
    const cutAt = order.findIndex((t) => t.startsWith('Cut'))
    ok(
      pasteAt >= 0 && pasteAt < 7 && cutAt >= 0 && cutAt < pasteAt,
      `and the Cut/Copy/Paste block sits near the top (cut ${cutAt}, paste ${pasteAt} of ${order.length})`
    )

    const before = await win.locator('[role="treeitem"]').count()
    await win.locator('[role="menu"] >> text="Paste"').click()
    await sleep(2500)
    const after = await win.locator('[role="treeitem"]').count()
    ok(after > before, `pasting on a file row lands in ITS folder (${before} -> ${after} rows)`)
    // THE PASTED FILE IS THE MARKED ROW (2026-09-03, owner - Explorer's way).
    await sleep(600)
    const markedAfterPaste = await win.evaluate(() =>
      [...document.querySelectorAll('aside [data-selected]')].map((r) => r.textContent).join('|')
    )
    ok(/movable \(2\)/.test(markedAfterPaste), `and the pasted copy is what is marked (${markedAfterPaste})`)
    // ...and it is the OPEN file too (owner, 2026-09-03): aria-selected is
    // the tree's word for what the viewer is showing.
    await sleep(600)
    const openAfterPaste = await win.evaluate(
      () => document.querySelector('aside [role="treeitem"][aria-selected="true"]')?.textContent ?? ''
    )
    ok(/movable \(2\)/.test(openAfterPaste), `and the pasted copy is what is OPEN (${openAfterPaste})`)

    // CUT AND PASTE FROM THE KEYBOARD (2026-09-03, owner): Ctrl+X dims the
    // row, Ctrl+V on a folder MOVES it there, and the mark clears.
    await rowFor('anchor.txt').click()
    await sleep(400)
    await win.keyboard.press('Control+x')
    await sleep(300)
    const dimmed = await win.evaluate(
      () =>
        [...document.querySelectorAll('aside [role="treeitem"]')].find((r) =>
          (r.getAttribute('data-row') ?? '').toLowerCase().endsWith('anchor.txt')
        )?.style.opacity
    )
    ok(dimmed === '0.45', `Ctrl+X dims the cut row (opacity ${dimmed})`)
    // EXPLORER'S RULE for Ctrl+V (owner, 2026-09-03): the target is the
    // folder CONTAINING the highlighted row. First a file INSIDE `into`, so
    // the cursor can stand there: the row menu's Paste on the folder row
    // (explicit, so it means "into this folder") puts movable.txt in.
    await rowFor('into').click({ button: 'right' })
    await win.waitForSelector('[role="menu"] >> text="Paste"', { timeout: 6000 })
    // the clipboard holds anchor.txt (cut) now; that is what lands in `into`
    await win.locator('[role="menu"] >> text="Paste"').click()
    for (let i = 0; i < 40 && !existsSync(join(dir, 'into', 'anchor.txt')); i++) await sleep(200)
    ok(existsSync(join(dir, 'into', 'anchor.txt')), 'menu Paste on a folder row lands INSIDE it, and a cut moves')
    ok(!existsSync(join(dir, 'anchor.txt')), 'so it left where it was')
    await sleep(800)
    // Now the keyboard: with the cursor on into/anchor.txt, Ctrl+C then
    // Ctrl+V with the FOLDER `into` highlighted must paste into its PARENT
    // (the root), not into `into`.
    // `into` is usually open already - the moved file OPENED, and opening a
    // file expands the folders above it - so expand only if it is shut, and
    // by the CHEVRON, since a row click would select and a second toggle.
    await win.evaluate(() => {
      const el = [...document.querySelectorAll('aside [role="treeitem"]')].find((r) =>
        (r.getAttribute('data-row') ?? '').toLowerCase().endsWith('\\into')
      )
      if (el?.getAttribute('aria-expanded') === 'false')
        el.querySelector('span')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await win.waitForSelector('[role="treeitem"][data-row$="anchor.txt" i]', { timeout: 8000 })
    await rowFor('anchor.txt').click()
    await sleep(400)
    await win.keyboard.press('Control+c')
    await sleep(400)
    await rowFor('into').click() // first click on a folder row only highlights it
    await sleep(300)
    await win.keyboard.press('Control+v')
    for (let i = 0; i < 40 && !existsSync(join(dir, 'anchor.txt')); i++) await sleep(200)
    ok(existsSync(join(dir, 'anchor.txt')), 'Ctrl+V with a folder highlighted pastes into its PARENT')
    ok(existsSync(join(dir, 'into', 'anchor.txt')), 'and a copy leaves the original where it was')
  } finally {
    await app.close()
  }
}

/** Deleting the last file leaves the tab open and empty, not closed. */
async function deleteLastScenario(fixtures) {
  console.log('delete the last file')
  const dir = join(fixtures, 'lastfile')
  const { app, win } = await launch(join(dir, 'only.txt'))
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    await sleep(700)
    const tabs = () => win.locator('[role="tab"]').count()
    const before = await tabs()
    ok(before >= 1, `the tab is there to begin with (${before})`)

    await win.locator('[role="treeitem"]').first().click()
    await sleep(400)
    await win.keyboard.press('Delete')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    await win.locator('[role="dialog"] button:has-text("Delete")').click()
    await sleep(1500)

    ok(!win.isClosed(), 'the window survives deleting the only file')
    ok((await tabs()) === before, `and the TAB is still open (${await tabs()})`)
    ok(
      (await win.locator('[role="treeitem"]').count()) === 0,
      'with an empty tree, which is the point: the folder is still the tab root'
    )
  } finally {
    await app.close()
  }
}

async function comicScenario(fixtures) {
  console.log('comic books')
  const { app, win } = await launch(join(fixtures, 'comics', 'story.cbz'))
  try {
    await win.waitForSelector('text=Page 1 of 3', { timeout: 20000 })
    ok(true, 'a .cbz opens on its first page')
    const shown = async () => (await win.getAttribute('img[alt]', 'alt')) ?? ''
    ok((await shown()) === 'page1.png', `and page one is page1.png (${await shown()})`)
    ok(
      (await win.locator('text=Page 1 of 3').count()) === 1,
      'ComicInfo.xml and the macOS resource fork are not pages'
    )

    await win.keyboard.press('ArrowRight')
    await sleep(400)
    ok((await win.locator('text=Page 2 of 3').count()) === 1, 'Right turns the page')
    ok((await shown()) === 'page2.png', `to page2, not page10 (${await shown()})`)

    await win.keyboard.press('ArrowRight')
    await sleep(400)
    ok((await shown()) === 'page10.png', `and page10 sorts last, numerically (${await shown()})`)

    // The end is the end: Right again stays put rather than wrapping.
    await win.keyboard.press('ArrowRight')
    await sleep(300)
    ok((await win.locator('text=Page 3 of 3').count()) === 1, 'the last page is the last page')

    await win.keyboard.press('ArrowLeft')
    await sleep(400)
    ok((await win.locator('text=Page 2 of 3').count()) === 1, 'Left goes back')

    // UP AND DOWN are the folder now (2026-09-01): Left and Right belong to the
    // book, and Ctrl no longer buys the folder back because App does not handle
    // those keys at all. sequel.cbz sorts BEFORE story.cbz, so the way to it is
    // Up.
    await win.keyboard.press('ArrowUp')
    await sleep(1200)
    ok(
      ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes(
        'sequel'
      ),
      'Up pages the FOLDER, to the next comic'
    )

    // And coming back opens where the book was put down. The counter lives on
    // the auto-hiding bar and the two folder steps above outlast its idle
    // clock, so wake it the way a reader would - by moving the mouse.
    await win.keyboard.press('ArrowDown')
    await sleep(1500)
    await win.mouse.move(700, 400)
    await win.mouse.move(720, 420)
    await sleep(300)
    ok((await win.locator('text=Page 2 of 3').count()) === 1, 'a comic reopens where you left it')
    ok(!win.isClosed(), 'window survives the comic')
  } finally {
    await app.close()
  }
}

/**
 * Extract-all, and the ONE-FOLDER RULE (2026-08-31).
 *
 * A zip whose whole content is a single top-level folder is what every
 * "download as zip" produces, and it used to land as
 * `chosen/archive-name/TheFolder` - one level deeper than anybody wanted.
 * Uses "Extract here", which needs no dialog: the archive's own folder is
 * already inside a root, so there is nothing to consent to.
 */
async function extractScenario(fixtures) {
  console.log('extracting')
  const zip = join(fixtures, 'zips', 'wrapped.zip')
  const landed = join(fixtures, 'zips', 'Collection')
  rmSync(landed, { recursive: true, force: true })
  const { app, win } = await launch(zip)
  try {
    await win.waitForSelector('[data-arc-row]', { timeout: 15000 })
    ok(
      (await win.locator('button:has-text("Extract here")').count()) === 1,
      'the verb row offers a one-click Extract here'
    )
    ok(
      (await win.locator('button:has-text("Extract to")').count()) === 1,
      'and Extract to... beside it'
    )
    // The inline track is GONE (2026-09-03, owner): extraction progress is
    // the same self-dismissing popup the sidebar's verb shows, so the layout
    // has nothing to move. Still measured, because "it looks fine" is
    // exactly how the jump got shipped the first time.
    const listTop = async () =>
      win.evaluate(() => document.querySelector('[data-arc-row]').getBoundingClientRect().top)
    const beforeTop = await listTop()
    ok(
      (await win.locator('[role="progressbar"]').count()) === 0,
      'no inline progress track: the popup is the one look'
    )
    // The first row starts ON the header's hairline: no gutter above it.
    const gap = await win.evaluate(() => {
      const list = document.querySelector('[data-arc-list]')
      const row = document.querySelector('[data-arc-row]')
      return row.getBoundingClientRect().top - list.getBoundingClientRect().top
    })
    ok(Math.abs(gap) < 0.6, `the first row sits on the header hairline (${gap.toFixed(2)}px)`)
    await win.click('button:has-text("Extract here")')
    await win.waitForFunction(
      () => !document.body.textContent.includes('Extracting'),
      null,
      { timeout: 30000 }
    )
    await sleep(600)
    const afterTop = await listTop()
    ok(
      Math.abs(afterTop - beforeTop) < 0.5,
      `the member list never moved (${beforeTop.toFixed(1)} -> ${afterTop.toFixed(1)})`
    )
    ok(
      (await win.locator('[role="dialog"]').count()) === 0,
      'and finishing raises no popup'
    )
    ok(existsSync(landed), 'the single top-level folder landed directly, not wrapped')
    ok(
      existsSync(join(landed, 'one.txt')) && existsSync(join(landed, 'sub', 'two.txt')),
      'with its shape intact'
    )
    ok(
      !existsSync(join(fixtures, 'zips', 'wrapped')),
      'and no folder named after the archive was left behind'
    )
    // Every OTHER extract route, driven through the same preload API the menu
    // rows call. The menus themselves are asserted above; this proves the
    // handlers behind them actually put files on disk.
    const zipPath = zip.split(String.fromCharCode(92)).join('/')

    // A folder member, to a temp copy - what "Copy folder" puts on the
    // clipboard. It used to extract the members one at a time and copy the
    // loose FILES, so the shape is the thing to check.
    const toTemp = await win.evaluate(
      (z) => window.prism.archiveExtractDir(z, 'Collection'),
      zipPath
    )
    ok(toTemp.ok === true, `a folder member extracts to a temp copy (${JSON.stringify(toTemp)})`)
    if (toTemp.ok) {
      ok(statSync(toTemp.path).isDirectory(), 'and it really is a FOLDER, not a pile of files')
      ok(
        existsSync(join(toTemp.path, 'one.txt')) &&
          existsSync(join(toTemp.path, 'sub', 'two.txt')),
        'with the whole shape under it'
      )
      rmSync(dirname(toTemp.path), { recursive: true, force: true })
    }

    // The same folder, beside the archive - "Extract folder here".
    const here1 = await win.evaluate(
      (z) => window.prism.archiveExtractDir(z, 'Collection', true),
      zipPath
    )
    ok(here1.ok === true, 'a folder member extracts beside the archive')
    if (here1.ok) {
      ok(
        dirname(here1.path) === join(fixtures, 'zips'),
        `landing beside the archive, not in temp (${here1.path})`
      )
      ok(existsSync(join(here1.path, 'sub', 'two.txt')), 'shape intact there too')
    }
    // A second time: beside the first, never over it. The name is whatever is
    // free - Extract here has already taken "Collection" earlier in this
    // scenario - so what matters is that it is a DIFFERENT folder and the
    // first still has its contents.
    const here2 = await win.evaluate(
      (z) => window.prism.archiveExtractDir(z, 'Collection', true),
      zipPath
    )
    ok(
      here2.ok === true && here1.ok === true && here2.path !== here1.path,
      `a second extract lands beside the first (${here2.ok ? here2.path : 'failed'})`
    )
    ok(
      here2.ok === true && existsSync(join(here2.path, 'one.txt')),
      'and carries the same contents'
    )
    ok(
      here1.ok === true && existsSync(join(here1.path, 'one.txt')),
      'while the first is untouched'
    )
    if (here1.ok) rmSync(here1.path, { recursive: true, force: true })
    if (here2.ok) rmSync(here2.path, { recursive: true, force: true })
  } finally {
    await app.close()
    rmSync(landed, { recursive: true, force: true })
    for (const n of ['Collection', 'Collection (2)', 'Collection (3)'])
      rmSync(join(fixtures, 'zips', n), { recursive: true, force: true })
  }
}

/**
 * A zip with NO directory records (2026-08-31).
 *
 * Directory entries are optional in a zip and plenty of writers leave them
 * out - Google Takeout is the one that found this. The panel lists one level
 * at a time by matching each member's parent, so such an archive showed
 * NOTHING at its root: every member's parent was two levels down and the
 * folders those names imply did not exist to be listed.
 */
async function flatZipScenario(fixtures) {
  console.log('a zip that records no folders')
  const { app, win } = await launch(join(fixtures, 'zips', 'nodirs.zip'))
  try {
    await win.waitForSelector('[data-arc-row]', { timeout: 15000 })
    const names = async () =>
      (await win.locator('[data-arc-row]').allTextContents()).join(' | ')
    ok((await win.locator('[data-arc-row]').count()) > 0, 'the archive does not read as empty')
    ok((await names()).includes('Deep'), 'the folder its member names imply is listed')
    await win.locator('[data-arc-row]:has-text("Deep")').first().dblclick()
    await sleep(500)
    ok((await names()).includes('Inner'), 'and so is the one below that')
    ok((await names()).includes('other.txt'), 'beside the real member at that level')
  } finally {
    await app.close()
  }
}

/**
 * 100% is a WIDTH ON SCREEN, not a multiple of the page's own size
 * (2026-08-31).
 *
 * pdf.js scales are relative to the page, so a flat "100% = 1.9 units" meant
 * an artbook with 1822pt pages opened three times the width of a letter
 * document and read as the viewer being broken.
 */
async function pdfZoomScenario(fixtures) {
  console.log('pdf zoom baseline')
  const { app, win } = await launch(join(fixtures, 'bigpdf', 'big.pdf'))
  try {
    await win.waitForSelector('[data-page="1"] canvas', { timeout: 15000 })
    await sleep(600)
    // Opening FITTED is the point for a page this size - 1822pt at 100% is
    // 1163px, wider than the window this runs in - so the assertion is that it
    // does not overflow, and then that 100% still means what it means.
    ok(
      await win.evaluate(() => {
        const box = document.querySelector('[data-doc-scroller]')
        return !!box && box.scrollWidth <= box.clientWidth
      }),
      'a big-page document opens with no horizontal overflow'
    )
    await win.click('button[title="Default zoom (0)"]')
    await sleep(400)
    const w = await win.evaluate(
      () => document.querySelector('[data-page="1"]').getBoundingClientRect().width
    )
    ok(
      Math.abs(w - 612 * 1.9) < 3,
      `and lands the same width as a letter page (${w.toFixed(0)}px, letter is ${(612 * 1.9).toFixed(0)})`
    )
    await win.hover('[data-page="1"]', { position: { x: 40, y: 40 } })
    await win.click('button[title="Zoom in (+)"]')
    await sleep(400)
    ok(
      (await win.textContent('button[title="Default zoom (0)"]')) === '118%',
      'and the zoom ladder still reads in percent from there'
    )
  } finally {
    await app.close()
  }
}

async function codeScenario(fixtures) {
  console.log('code viewer')
  const dir = join(fixtures, 'code')
  const { app, win } = await launch(join(dir, 'main.py'))
  const selected = () => win.locator('[role="treeitem"][aria-selected="true"]').textContent()
  const caretInFile = () =>
    win.evaluate(() => !!document.activeElement?.classList.contains('cm-content'))
  try {
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    ok((await win.locator('.cm-line span').count()) > 5, 'python highlights into coloured tokens')
    ok((await win.locator('.cm-lineNumbers').count()) === 1, 'code gets a line-number gutter')
    ok((await win.locator('.cm-foldGutter').count()) === 1, 'and a fold gutter')
    ok((await win.locator('[aria-label="Edit"]').count()) === 0, 'no pencil on a code file')
    await win.screenshot({ path: join(SHOTS, 'code.png') })

    // The whole focus contract: a freshly opened file has no caret, so the
    // arrows still belong to the folder, exactly as they do for an image.
    ok(!(await caretInFile()), 'a freshly opened file has no caret')
    // ...and when the scroller DOES take focus, it must not draw Chromium's
    // ring around the whole document frame.
    ok(
      await win.evaluate(() => {
        const s = document.querySelector('.cm-scroller')
        s.focus()
        const focused = document.activeElement === s
        const ringless = getComputedStyle(s).outlineStyle === 'none'
        s.blur()
        return focused && ringless
      }),
      'a focused scroller draws no focus frame'
    )
    await win.keyboard.press('ArrowUp')
    await sleep(700)
    ok(((await selected()) ?? '').includes('hello.sh'), 'Up pages the folder while nothing is focused')

    // AND LEFT DOES NOT (2026-09-01). It is the viewer's key now, and a text
    // file has no use for it, so it must do nothing at all rather than page.
    const parked = await selected()
    await win.keyboard.press('ArrowLeft')
    await sleep(500)
    ok((await selected()) === parked, 'Left does not page the folder any more')
    await win.keyboard.press('ArrowRight')
    await sleep(500)
    ok((await selected()) === parked, 'and neither does Right')

    // Click into the text and the arrows become the caret's. Waiting for the
    // caret rather than sleeping at it: offscreen, the click takes a beat
    // longer to land and a fixed pause made this flaky.
    await win.locator('.cm-line').first().click()
    await win
      .waitForFunction(() => !!document.activeElement?.classList.contains('cm-content'), undefined, {
        timeout: 8000
      })
      .catch(() => {})
    ok(await caretInFile(), 'clicking into the text puts the caret in the file')
    const before = await selected()
    await win.keyboard.press('ArrowUp')
    await sleep(500)
    ok((await selected()) === before, 'the arrows stop paging once the caret is in the file')

    await win.keyboard.press('Escape')
    await sleep(300)
    ok(!(await caretInFile()), 'Escape hands focus back to the folder')
    ok(!win.isClosed(), 'Escape does not close the window')
    await win.keyboard.press('ArrowDown')
    await sleep(700)
    ok(((await selected()) ?? '').includes('main.py'), 'and the arrows page again')

    // Up and Down have to agree with Left and Right. They used to be handed to
    // every document unconditionally, which meant they did nothing at all on a
    // code file the user was only navigating past.
    await win.keyboard.press('ArrowUp')
    await sleep(700)
    ok(((await selected()) ?? '').includes('hello.sh'), 'Up pages the folder when the caret is not in the file')
    await win.keyboard.press('ArrowDown')
    await sleep(700)
    ok(((await selected()) ?? '').includes('main.py'), 'and Down pages back')

    await win.locator('.cm-line').first().click()
    await win
      .waitForFunction(() => !!document.activeElement?.classList.contains('cm-content'), undefined, {
        timeout: 8000
      })
      .catch(() => {})
    const held = await selected()
    await win.keyboard.press('ArrowUp')
    await sleep(500)
    ok((await selected()) === held, 'but the caret takes Up once you click into the text')
    await win.keyboard.press('Escape')
    await sleep(300)

    // Squiggles, and the honest limit on them.
    await win.click('[role="treeitem"]:has-text("broken.ts")')
    await win.waitForSelector('.cm-lintRange-error', { timeout: 10000 })
    ok(true, 'a TypeScript syntax error gets a red underline')
    await win.screenshot({ path: join(SHOTS, 'code-error.png') })

    await win.click('[role="treeitem"]:has-text("bad.json")')
    await win.waitForSelector('.cm-lintRange-error', { timeout: 10000 })
    ok(true, "JSON's trailing comma gets one too")

    await win.click('[role="treeitem"]:has-text("hello.sh")')
    await sleep(1500) // past the linter's debounce, so absence means absence
    ok((await win.locator('.cm-line span').count()) > 3, 'shell is still coloured')
    ok(
      (await win.locator('.cm-lintRange-error').count()) === 0,
      'a stream-lexed language never claims an error'
    )

    // Ctrl+F belongs to the file, whether or not the caret is in it.
    await win.keyboard.press('Control+f')
    await win.waitForSelector('.cm-panel.cm-search', { timeout: 5000 })
    ok(true, 'Ctrl+F opens the code find bar')
    await win.keyboard.type('echo')
    await win.waitForSelector('.cm-searchMatch', { timeout: 8000 }).catch(() => {})
    ok((await win.locator('.cm-searchMatch').count()) >= 1, 'and finds a match')
    await win.screenshot({ path: join(SHOTS, 'code-find.png') })
  } finally {
    await app.close()
  }
}

async function treeNavScenario(fixtures) {
  console.log('tree navigation')
  // Open inside code/, so the root has folders above and below the cursor.
  const { app, win } = await launch(join(fixtures, 'code', 'bad.json'))
  const cursor = () => win.evaluate(() => document.activeElement?.getAttribute('data-row') ?? '')
  const name = (p) => (p ?? '').split('\\').pop()
  // Found by walking the rows rather than by selector: a Windows path in a CSS
  // attribute selector needs escaping that is easy to get quietly wrong.
  const expanded = (n) =>
    win.evaluate(
      (folder) =>
        [...document.querySelectorAll('[role="treeitem"][aria-expanded]')]
          .find((e) => (e.getAttribute('data-row') ?? '').toLowerCase().endsWith(folder.toLowerCase()))
          ?.getAttribute('aria-expanded') ?? 'missing',
      n
    )
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    await sleep(600)

    // Up from the first file lands on the folder row above it, which is the
    // whole point: folders are rows the keyboard can reach.
    await win.keyboard.press('ArrowUp')
    await sleep(500)
    ok(name(await cursor()) === 'nested', `Up steps onto the folder row (got ${name(await cursor())})`)
    ok((await win.locator('.cm-content').count()) === 1, 'and the viewer keeps showing the file')

    // One mark, and it belongs to the cursor. The open file goes unmarked while
    // the cursor is elsewhere; aria-selected still names it for a reader.
    const marks = await win.evaluate(() => {
      const solid = (el) => {
        const c = getComputedStyle(el).backgroundColor
        return c !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(c)
      }
      const open = document.querySelector('[role="treeitem"][aria-selected="true"]')
      return {
        folderFilled: solid(document.activeElement),
        openFilled: solid(open),
        openRinged: getComputedStyle(open).boxShadow !== 'none'
      }
    })
    ok(marks.folderFilled, 'the folder under the cursor takes the accent')
    ok(!marks.openFilled && !marks.openRinged, 'and the open file carries no second highlight')

    // Enter is the row's own activation - it expands, then collapses.
    ok((await expanded('nested')) === 'false', 'the folder starts collapsed')
    await win.keyboard.press('Enter')
    await sleep(600)
    ok((await expanded('nested')) === 'true', 'Enter expands the folder')
    await win.keyboard.press('Enter')
    await sleep(600)
    ok((await expanded('nested')) === 'false', 'Enter again collapses it')

    // LEFT AND RIGHT ARE NOT THE CHEVRON any more (2026-09-01): the tree is
    // Up and Down only, and Enter is how a folder opens and closes from the
    // keyboard - which is the row button's own activation and never went
    // through the tree's nav at all.
    await win.keyboard.press('ArrowRight')
    await sleep(500)
    ok((await expanded('nested')) === 'false', 'Right does not expand the folder')
    await win.keyboard.press('Enter')
    await sleep(600)
    ok((await expanded('nested')) === 'true', 'Enter still does')
    await win.keyboard.press('ArrowLeft')
    await sleep(500)
    ok((await expanded('nested')) === 'true', 'and Left does not collapse it')
    await win.keyboard.press('Enter')
    await sleep(600)
    ok((await expanded('nested')) === 'false', 'Enter again collapses it')

    // Down off a folder goes back to the files, opening as it lands.
    await win.keyboard.press('ArrowDown')
    await sleep(700)
    ok(name(await cursor()) === 'bad.json', 'Down returns to the file below')
    ok(
      ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('bad.json'),
      'and the file is the open one again'
    )

    // Walking into an expanded folder: the cursor follows what is on screen.
    await win.keyboard.press('ArrowUp')
    await sleep(400)
    await win.keyboard.press('Enter') // expand `nested`
    await sleep(700)
    await win.keyboard.press('ArrowDown')
    await sleep(600)
    ok(name(await cursor()) === 'level-two', 'Down walks INTO the expanded folder')
    await win.screenshot({ path: join(SHOTS, 'tree-nav.png') })
  } finally {
    await app.close()
  }
}

async function unsavedScenario(fixtures) {
  console.log('unsaved work')
  const notes = join(fixtures, 'notes.txt')
  const { app, win } = await launch(notes)
  const row = () => win.locator('[role="treeitem"][aria-selected="true"]')
  try {
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    ok(!((await row().textContent()) ?? '').includes('*'), 'a saved file gets no star')

    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type('delta')
    await sleep(300)

    // The sidebar says which file is unsaved, the way every editor says it.
    ok(((await row().textContent()) ?? '').includes('notes.txt*'), 'the dirty row gains a star')
    ok(
      await row().evaluate((el) => Number(getComputedStyle(el).fontWeight) >= 700),
      'and goes bold'
    )
    await win.screenshot({ path: join(SHOTS, 'unsaved-star.png') })

    // Closing must not throw the buffer away in silence. This is the real
    // window close (main blocks it), not a renderer-side intercept.
    await win.evaluate(() => window.prism.close())
    await win.waitForSelector('text=/unsaved changes/i', { timeout: 5000 })
    ok(true, 'closing with unsaved text asks first')

    await win.click('button:has-text("Cancel")')
    await sleep(400)
    ok(!win.isClosed(), 'Cancel keeps the window open')
    ok(((await row().textContent()) ?? '').includes('*'), 'and keeps the unsaved text')

    // A second file, edited and left: two buffers pending at once, which is
    // what "save all changes" is for.
    const readme = join(fixtures, 'README.md')
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('.p-md h1', { timeout: 10000 })
    await win.click('[aria-label="Edit"]')
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type('epsilon')
    await sleep(400)
    ok(
      (await win.locator('[role="treeitem"]').filter({ hasText: '*' }).count()) === 2,
      'two files are starred at once'
    )

    await win.evaluate(() => window.prism.close())
    await win.waitForSelector('text=/unsaved changes/i', { timeout: 5000 })
    const body = (await win.textContent('[role="dialog"]')) ?? ''
    ok(/notes\.txt/.test(body) && /README\.md/.test(body), `the question names both files, as they are spelled (said: ${JSON.stringify(body.slice(0, 120))})`)
    ok(body.includes('Save all changes') && body.includes('Discard'), 'and offers cancel / discard / save all')
    await win.screenshot({ path: join(SHOTS, 'unsaved-close.png') })

    await win.click('button:has-text("Save all changes")')
    await sleep(2000)
    ok(readFileSync(notes, 'utf-8').includes('delta'), 'Save all writes the first file')
    ok(readFileSync(readme, 'utf-8').includes('epsilon'), 'and the second')
    ok(win.isClosed(), 'and the window closes')
  } finally {
    await app.close().catch(() => {})
  }
}

async function playerScenario(fixtures) {
  console.log('player settings')
  const { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 10000 })
    await win.hover('video') // keep the chrome awake
    const cog = win.locator('[aria-label="Player settings"]')
    ok((await cog.count()) === 1, 'the transport carries the settings cog')
    await cog.click()
    await win.waitForSelector('[role="menu"][aria-label="Player settings"]', { timeout: 5000 })

    await win.locator('input[aria-label="Playback speed"]').evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '2')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    ok(await win.evaluate(() => document.querySelector('video').playbackRate === 2), 'speed slider sets playbackRate')

    await win.click('[role="menuitemcheckbox"]:has-text("Loop")')
    ok(await win.evaluate(() => document.querySelector('video').loop), 'loop toggle sets the element')

    // Loop and autoplay are mutually exclusive: enabling one drops the other.
    await win.click('[role="menuitemcheckbox"]:has-text("Autoplay")')
    ok(
      (await win.locator('[role="menuitemcheckbox"]:has-text("Loop")').getAttribute('aria-checked')) === 'false',
      'enabling autoplay switches loop off'
    )
    await win.click('[role="menuitemcheckbox"]:has-text("Autoplay")') // off again; subtitles next

    // Subtitles: the sidecar ep1.en.srt shows up as English; picking it loads cues.
    ok((await win.locator('[role="menuitemradio"]:has-text("English")').count()) === 1, 'sidecar srt listed as English')
    await win.click('[role="menuitemradio"]:has-text("English")')
    await win.waitForFunction(
      () => {
        const t = document.querySelector('video')?.textTracks
        return t && t.length > 0 && t[0].cues && t[0].cues.length > 0
      },
      undefined,
      { timeout: 8000 }
    )
    ok(true, 'picking the track loads its cues')
    await win.screenshot({ path: join(SHOTS, 'player-menu.png') })

    // Autoplay: on, then jump near the end; the next video should take over.
    await win.click('[role="menuitemcheckbox"]:has-text("Autoplay")')
    await win.keyboard.press('Escape')
    // Wait for the metadata: seeking against a duration of NaN throws, and
    // "the provided double value is non-finite" reads as a player bug when it
    // is only a test that jumped the gun.
    // Check and seek in the SAME evaluation: waiting for a finite duration and
    // then seeking in a second call leaves a window in which the element can
    // reload (autoplay reaching the end of the previous take is enough), and
    // the seek then throws "non-finite" - a test race that reads as a player
    // bug (2026-08-28).
    await win.waitForFunction(
      () => {
        const v = document.querySelector('video')
        if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return false
        v.currentTime = Math.max(0, v.duration - 0.3)
        void v.play()
        return true
      },
      null,
      { timeout: 15000 }
    )
    await win.waitForSelector('[role="treeitem"][aria-selected="true"]:has-text("ep2.mp4")', { timeout: 10000 })
    ok(true, 'autoplay advances to the next video')
    ok(!win.isClosed(), 'window survives the whole tour')
  } finally {
    await app.close()
  }
}

async function dolbyScenario(fixtures) {
  console.log('audio Chromium cannot decode')
  const { app, win } = await launch(join(fixtures, 'av', 'dolby.mkv'))
  try {
    await win.waitForSelector('video', { timeout: 10000 })
    // The probe is what puts the element there: no waiting on playback.
    await win.waitForSelector('audio', { state: 'attached', timeout: 10000 })
    ok(true, 'a Dolby track gets a decoded sidecar')

    await win.evaluate(() => {
      const v = document.querySelector('video')
      v.currentTime = 0
      return v.play().catch(() => {})
    })
    // The counter cannot lie: bytes mean the sound is genuinely decoding.
    await win.waitForFunction(
      () => (document.querySelector('audio')?.webkitAudioDecodedByteCount ?? 0) > 0,
      undefined,
      { timeout: 15000 }
    )
    ok(true, 'and it really decodes audio, where the video element decodes none')
    ok(
      await win.evaluate(() => (document.querySelector('video').webkitAudioDecodedByteCount ?? 0) === 0),
      'the video element itself is still deaf to the track'
    )

    const err = await win.evaluate(() => document.querySelector('audio').error?.code ?? null)
    ok(err === null, 'the stream is one Chromium accepts')

    // Sync: the two clocks must agree, and keep agreeing over a seek.
    await win.waitForFunction(
      () => {
        const v = document.querySelector('video')
        const a = document.querySelector('audio')
        return !v.paused && !a.paused && Math.abs(a.currentTime - v.currentTime) < 0.12
      },
      undefined,
      { timeout: 10000 }
    )
    ok(true, 'the sound plays in step with the picture (within 120ms)')

    await win.evaluate(() => {
      document.querySelector('video').currentTime = 4
    })
    await win.waitForFunction(
      () => {
        const a = document.querySelector('audio')
        return Math.abs(a.currentTime - 4) < 0.4
      },
      undefined,
      { timeout: 10000 }
    )
    ok(true, 'and follows a seek, which is what the byte arithmetic is for')

    // No note: the note is for a file Prism cannot help with, not this one.
    ok((await win.locator('[role="status"]').count()) === 0, 'no apology is shown when the sound works')
    await win.screenshot({ path: join(SHOTS, 'dolby.png') })
  } finally {
    await app.close()
  }
}

async function formatsScenario(fixtures) {
  console.log('formats Chromium cannot handle')
  {
    // An audio file needs no syncing: the decoded stream simply IS the source.
    const { app, win } = await launch(join(fixtures, 'av', 'lossless.m4a'))
    try {
      await win.waitForSelector('audio', { state: 'attached', timeout: 10000 })
      ok(
        await win.evaluate(() => (document.querySelector('audio')?.getAttribute('src') ?? '').startsWith('fsaudio:')),
        "an Apple Lossless file plays from Prism's own decoder"
      )
      await win.evaluate(() => document.querySelector('audio')?.play().catch(() => {}))
      await win.waitForFunction(
        () => (document.querySelector('audio')?.webkitAudioDecodedByteCount ?? 0) > 0,
        undefined,
        { timeout: 15000 }
      )
      ok(true, 'and really decodes, where Chromium alone reported an error')
      ok(
        (await win.evaluate(() => document.querySelector('audio')?.error?.code ?? null)) === null,
        'with no error left on the element'
      )
    } finally {
      await app.close()
    }
  }
  await sleep(700)
  {
    // MPEG-2 has no decoder in Chromium either, and unlike the audio case it
    // cannot be decoded live - so it is converted once and the copy plays.
    // (The "No picture" note VideoView still carries is for when there is no
    // ffmpeg at all, which this suite cannot produce.)
    const { app, win } = await launch(join(fixtures, 'av', 'nopicture.mkv'))
    try {
      await win.waitForSelector('video', { timeout: 10000 })
      await win.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0, undefined, {
        timeout: 60000
      })
      ok(true, 'an MPEG-2 file ends up with a picture')
      await win.evaluate(() => document.querySelector('video')?.play().catch(() => {}))
      await win.waitForFunction(
        () => (document.querySelector('video')?.webkitVideoDecodedByteCount ?? 0) > 0,
        undefined,
        { timeout: 15000 }
      )
      ok(true, 'and really decodes it')
    } finally {
      await app.close()
    }
  }
}

async function sevenZipScenario(fixtures) {
  console.log('archives beyond zip')
  const { app, win } = await launch(join(fixtures, 'zips', 'read-only.7z'))
  try {
    const row = (name) => win.locator('[role="listbox"] [role="option"]', { hasText: name })
    await win.waitForSelector('[role="listbox"] [role="option"]', { timeout: 15000 })
    const names = await win.locator('[role="listbox"] [role="option"]').allTextContents()
    ok(
      names.some((n) => n.includes('note.txt')),
      'a 7z lists its members (saw: ' + names.map((n) => n.trim().split(/\s+/)[0]).join(', ').slice(0, 50) + ')'
    )
    ok(names.some((n) => n.includes('sub')), 'folders included')

    // Read-only: the verbs that would rewrite the container are not offered.
    await row('note.txt').first().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    const items = (await win.locator('[role="menu"] [role="menuitem"]').allTextContents()).join(' ')
    ok(/View/.test(items) && /Copy file/.test(items), 'view and copy are offered')
    ok(!/Rename|Delete/.test(items), 'rename and delete are not, since 7z is never rewritten')
    await win.keyboard.press('Escape')

    // And a member really opens, which means 7-Zip extracted it.
    await row('note.txt').first().dblclick()
    await win.waitForFunction(() => /hello from inside a 7z/.test(document.body.innerText), undefined, {
      timeout: 15000
    })
    ok(true, 'and a member opens, extracted by the bundled 7-Zip')

    // A whole FOLDER out of a 7z, in one 7-Zip call rather than one per
    // member: the per-member route re-opened the container each time, which
    // is what "Extract folder here" was failing on for a big archive.
    const sevenPath = join(fixtures, 'zips', 'read-only.7z')
      .split(String.fromCharCode(92))
      .join('/')
    const sub = await win.evaluate(
      // The folder is called "sub"; the row's TEXT reads "subFolder1"
      // because it concatenates the name, the type and the item count.
      (z) => window.prism.archiveExtractDir(z, 'sub'),
      sevenPath
    )
    ok(sub.ok === true, `a folder extracts out of a 7z (${JSON.stringify(sub)})`)
    if (sub.ok) {
      ok(statSync(sub.path).isDirectory(), 'and it is a folder')
      ok(readdirSync(sub.path).length > 0, 'with its contents under it')
      rmSync(dirname(sub.path), { recursive: true, force: true })
    }
  } finally {
    await app.close()
  }
}

async function synthAndRawScenario(fixtures) {
  console.log('scores and camera raw')
  {
    // A .mid is a score: it has to be synthesised before there is anything to
    // play, and what the element plays is the rendering.
    const { app, win } = await launch(join(fixtures, 'av', 'arpeggio.mid'))
    try {
      await win.waitForSelector('audio', { state: 'attached', timeout: 30000 })
      await win.waitForFunction(
        () => (document.querySelector('audio')?.getAttribute('src') ?? '').includes('converted'),
        undefined,
        { timeout: 40000 }
      )
      ok(true, 'a MIDI file is synthesised and the player is given the rendering')
      await win.evaluate(() => document.querySelector('audio')?.play().catch(() => {}))
      await win.waitForFunction(
        () => (document.querySelector('audio')?.webkitAudioDecodedByteCount ?? 0) > 0,
        undefined,
        { timeout: 20000 }
      )
      ok(true, 'and it really makes a sound')
    } finally {
      await app.close()
    }
  }
  await sleep(1500)
  {
    // A raw file: the camera's own embedded preview, which is what every fast
    // viewer shows.
    const { app, win } = await launch(join(fixtures, 'av', 'photo.cr2'))
    try {
      await win.waitForSelector('img', { timeout: 15000 })
      await win.waitForFunction(() => (document.querySelector('img')?.naturalWidth ?? 0) > 0, undefined, {
        timeout: 15000
      })
      ok(true, 'a camera raw shows its embedded preview')
      ok(
        await win.evaluate(() => document.querySelector('img').naturalWidth === 320),
        "at the preview's real size"
      )
    } finally {
      await app.close()
    }
  }
}

async function documentScenario(fixtures) {
  console.log('office and ebook documents')
  // One window, walked through the folder: three launches in a row raced the
  // profile and the middle one lost.
  const { app, win } = await launch(join(fixtures, 'docs2', 'report.docx'))
  try {
    const show = async (name, expect_) => {
      if (name) await win.locator(`[role="treeitem"]:has-text("${name}")`).first().click()
      await win.waitForSelector('[data-doc-scroller]', { timeout: 20000 })
      await win.waitForFunction((t) => document.body.innerText.includes(t), expect_, { timeout: 25000 })
      ok(true, (name ?? 'report.docx') + ' renders (found "' + expect_ + '")')
    }
    await show(null, 'The Quarterly Report')
    await show('letter.rtf', 'It worked.')
    await show('novel.epub', 'Chapter One')

    // The epub carried a script and a remote image; neither may reach the page.
    const html = await win.evaluate(() => document.querySelector('[data-doc-scroller]').innerHTML)
    ok(/Chapter One[\s\S]*Chapter Two/.test(html), 'an epub reads in spine order, not zip order')
    ok(!/stealTheSession/.test(html), 'its script never reaches the page')
    ok(!/tracker\.example/.test(html), 'nor does a remote image it wanted to fetch')
    ok((await win.locator('[data-doc-scroller] script').count()) === 0, 'and no script element survives at all')
  } finally {
    await app.close()
  }
}

async function convertScenario(fixtures) {
  console.log('video Chromium cannot decode')
  const { app, win } = await launch(join(fixtures, 'av', 'xvid.avi'))
  try {
    await win.waitForSelector('video', { timeout: 10000 })
    // The conversion panel names which kind of work is happening; on a
    // four-second clip it can be gone before this looks, so it is not asserted.
    await win.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0, undefined, {
      timeout: 60000
    })
    ok(true, 'an Xvid AVI ends up with a picture')
    ok(
      await win.evaluate(() =>
        decodeURIComponent(document.querySelector('video').getAttribute('src') ?? '').includes('converted')
      ),
      'and it is playing the converted copy, not the original'
    )
    await win.evaluate(() => document.querySelector('video')?.play().catch(() => {}))
    await win.waitForFunction(
      () => {
        const v = document.querySelector('video')
        return (v?.webkitVideoDecodedByteCount ?? 0) > 0 && (v?.webkitAudioDecodedByteCount ?? 0) > 0
      },
      undefined,
      { timeout: 15000 }
    )
    ok(true, 'with both picture and sound really decoding')
    // The element fails on the RAW url while the probe is still running, and
    // that error used to outlive the conversion: a film playing perfectly
    // under an opaque "can't be played" panel, because the panel is cleared
    // by a change of resume key and the key is the original url (2026-08-28).
    ok(
      !(await win.evaluate(() =>
        [...document.querySelectorAll('div')].some((d) =>
          d.textContent?.includes('This video can’t be played')
        )
      )),
      'and no error panel is left over the converted copy'
    )
  } finally {
    await app.close()
  }
}

async function stillsAndSubsScenario(fixtures) {
  console.log('stills and subtitles Chromium cannot read')
  {
    // A Targa: Chromium draws none of these, so a picture here means main
    // decoded it and served PNG.
    const { app, win } = await launch(join(fixtures, 'av', 'still.tga'))
    try {
      await win.waitForSelector('img', { timeout: 10000 })
      await win.waitForFunction(() => (document.querySelector('img')?.naturalWidth ?? 0) > 0, undefined, {
        timeout: 10000
      })
      ok(true, 'a Targa still is decoded and shown')
      ok(
        await win.evaluate(() => document.querySelector('img').naturalWidth === 160),
        'at its real size, not a placeholder'
      )
    } finally {
      await app.close()
    }
  }
  await sleep(700)
  {
    // SubStation Alpha: listed like any sidecar, converted on the way in.
    const { app, win } = await launch(join(fixtures, 'av', 'subbed.mp4'))
    try {
      await win.waitForSelector('video', { timeout: 10000 })
      await win.hover('video')
      await win.click('[aria-label="Player settings"]')
      await win.waitForSelector('[role="menu"][aria-label="Player settings"]', { timeout: 5000 })
      ok(
        (await win.locator('[role="menuitemradio"]:has-text("Subtitles")').count()) > 0,
        'an .ass sidecar is offered as a track'
      )
      await win.click('[role="menuitemradio"]:has-text("Subtitles")')
      await win.waitForFunction(
        () => {
          const t = document.querySelector('video')?.textTracks
          return t && t.length > 0 && t[0].cues && t[0].cues.length > 0
        },
        undefined,
        { timeout: 10000 }
      )
      ok(true, 'and its cues load, converted to WebVTT by ffmpeg')
    } finally {
      await app.close()
    }
  }
}

/**
 * A real second launch, the way an Explorer double-click arrives: Prism is
 * single-instance, so this process hands its path to the running window and
 * exits. Nothing test-only is involved, which is the point - this IS the route
 * a new tab is supposed to come in through.
 */
async function handoff(file) {
  const child = spawn(electronPath, [MAIN, `--user-data-dir=${PROFILE}`, '--e2e', file], {
    stdio: 'ignore'
  })
  await new Promise((done) => {
    child.on('exit', done)
    setTimeout(done, 6000) // it should quit on its own; never hang the suite
  })
  await sleep(600)
}

async function tabsScenario(fixtures) {
  console.log('project tabs')
  const otherRoot = OTHER_ROOT
  let { app, win } = await launch(join(fixtures, 'README.md'))
  const strip = '[role="tablist"]'
  const tabRows = () => win.locator(`${strip} [role="tab"]`)
  try {
    // The strip is there from the first tab, so the + is always reachable.
    await win.waitForSelector(strip, { timeout: 10000 })
    ok((await tabRows().count()) === 1, 'one folder still shows as a tab')
    // The + no longer opens a dialog, so the suite can actually press it: a tab
    // arrives rooted at the user's own folder, with nothing to answer first.
    await win.locator(`${strip} [aria-label="New tab"]`).click()
    await sleep(700)
    ok((await tabRows().count()) === 2, 'the + spawns a tab without a dialog')
    const home = (await tabRows().last().getAttribute('title')) ?? ''
    ok(/Users/i.test(home), `and roots it at the user folder (said: "${home}")`)
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(400)
    ok((await tabRows().count()) === 1, 'and it closes again')

    // A file from a SUBFOLDER of an open root lands in THAT root's tab, rather
    // than spawning one rooted at the subfolder (2026-09-01). Most files are
    // not sitting directly in their project's root, so the old rule - fold
    // only when the root IS the file's folder - accumulated a tab per folder
    // every time anything was opened from Explorer.
    await handoff(join(fixtures, 'code', 'bad.json'))
    await win.waitForSelector(strip, { timeout: 10000 })
    ok((await tabRows().count()) === 1, 'a file from a subfolder stays in the tab that holds it')
    ok(
      /fixtures/i.test((await tabRows().first().getAttribute('title')) ?? ''),
      'and that tab keeps ITS root, not the subfolder'
    )

    // A second root, opened deliberately - a genuine sibling, since a
    // subfolder is no longer a second root at all.
    await handoff(join(otherRoot, 'bad.json'))
    await sleep(500)
    ok((await tabRows().count()) === 2, 'a second root opens a second tab')
    const labels = await tabRows().allTextContents()
    ok(labels.some((l) => /other/.test(l)), 'the new tab is named for its folder')

    // Reordering is a POINTER drag inside the strip (2026-08-23), not an HTML5
    // one: press the second tab, travel left past the first tab's middle,
    // release. The order flips and nothing else moves.
    {
      const before = await tabRows().allTextContents()
      const a = await tabRows().first().boundingBox()
      const b = await tabRows().last().boundingBox()
      await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await win.mouse.down()
      await win.mouse.move(a.x + 6, b.y + b.height / 2, { steps: 12 })
      await win.mouse.up()
      await sleep(400)
      const after = await tabRows().allTextContents()
      ok(
        after[0] === before[before.length - 1] && after.length === before.length,
        `dragging a tab left reorders the strip (${before.join('|')} -> ${after.join('|')})`
      )
      // ...and back, so the rest of the scenario sees the order it expects.
      const a2 = await tabRows().first().boundingBox()
      const b2 = await tabRows().last().boundingBox()
      await win.mouse.move(a2.x + a2.width / 2, a2.y + a2.height / 2)
      await win.mouse.down()
      await win.mouse.move(b2.x + b2.width - 6, a2.y + a2.height / 2, { steps: 12 })
      await win.mouse.up()
      await sleep(400)
      ok(
        (await tabRows().allTextContents()).join('|') === before.join('|'),
        'and dragging it back restores the order'
      )
    }

    // Switching: the tree and the viewer both follow. Point the first tab back
    // at its README first - the subfolder handoff above legitimately moved it
    // to bad.json, which is the fold working - then switch AWAY and back, so
    // this tests the switch rather than what the last handoff happened to
    // leave on screen.
    await handoff(join(fixtures, 'README.md'))
    await sleep(400)
    await tabRows().last().click()
    await sleep(300)
    await tabRows().first().click()
    await sleep(400)
    ok(
      (await win.locator('[role="treeitem"][aria-selected="true"]').textContent())?.includes('README.md') ?? false,
      'switching back restores that tab file'
    )
    ok((await win.locator('.p-md h1').count()) >= 1, 'and its viewer')
    await win.screenshot({ path: join(SHOTS, 'tabs.png') })

    // A file from a root already open reuses its tab rather than duplicating it.
    await handoff(join(fixtures, 'notes.txt'))
    ok((await tabRows().count()) === 2, 'a file from an open root reuses its tab')

    // The new-tab Settings: a remembered folder, and a terminal-first tab.
    await win.evaluate((dir) => {
      localStorage.setItem('prism.newtab.mode', 'folder')
      localStorage.setItem('prism.newtab.folder', dir)
      localStorage.setItem('prism.newtab.show', 'terminal')
    }, join(fixtures, 'code'))
    await win.keyboard.press('Control+t')
    await sleep(800)
    ok(
      (await tabRows().count()) === 3 &&
        ((await tabRows().last().textContent()) ?? '').includes('code'),
      'a new tab roots at the remembered folder'
    )
    await win.waitForSelector('.xterm', { timeout: 15000 })
    ok(true, 'and opens showing a terminal, per the setting')
    await win.evaluate(() => {
      localStorage.setItem('prism.newtab.mode', 'home')
      localStorage.setItem('prism.newtab.show', 'file')
    })
    await win.keyboard.press('Control+`') // hide, so the close is clean
    await sleep(300)
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(500)
    ok((await tabRows().count()) === 2, 'and closes again')

    // The ask-before-closing option: on, Ctrl+W asks; Cancel keeps the tab;
    // asking again and confirming closes it. (Seeded off for every other flow.)
    await win.evaluate(() => localStorage.setItem('prism.tabs.confirmClose', '1'))
    // Aim Ctrl+W at the code tab, so the fixtures tab (which the rest of the
    // scenario leans on) stays put.
    await tabRows().last().click()
    await sleep(300)
    await win.keyboard.press('Control+w')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    ok(
      ((await win.locator('[role="dialog"]').textContent()) ?? '').includes('Close this tab?'),
      'with the option on, closing a tab asks first'
    )
    await win.locator('[role="dialog"] button:has-text("Cancel")').click()
    await sleep(300)
    ok((await tabRows().count()) === 2, 'Cancel keeps the tab')
    await win.keyboard.press('Control+w')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    await win.locator('[role="dialog"] button:has-text("Close tab")').click()
    await sleep(400)
    ok((await tabRows().count()) === 1, 'confirming closes it')
    await win.evaluate(() => localStorage.setItem('prism.tabs.confirmClose', '0'))
    // recreate the second tab, restoring the order the flow below expects.
    // The SIBLING root, not a subfolder: a subfolder folds into the tab that
    // holds it now and would leave the strip with one tab, not two.
    await handoff(join(otherRoot, 'bad.json'))
    await win.waitForSelector(strip, { timeout: 10000 })
    await sleep(400)

    // Closing back to one leaves the strip, and the tab, in place.
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(400)
    ok((await tabRows().count()) === 1, 'closing back to one tab keeps the strip')

    // The sidebar's folder button REPLACES this tab root rather than adding one.
    // The dialog it opens is native, so the reroot itself is unit-tested; what
    // is checked here is that the button is where it should be, beside search.
    ok(
      (await win.locator('[aria-label="Search files"]').count()) === 1 &&
        (await win.locator('aside [aria-label="Open folder"]').count()) === 1,
      'the folder button sits on the search row, not the title bar'
    )
    ok(
      (await win.locator('[aria-label="Open folder"]').count()) === 1,
      'and is the only one: it has left the title bar'
    )
  } finally {
    await app.close()
  }

  // ...and the strip survives a restart. Two roots, then relaunch the same
  // profile without forgetting them.
  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'README.md')))
  try {
    // Two roots means two ROOTS: the sibling, since a subfolder now folds into
    // the tab that already holds it.
    await handoff(join(otherRoot, 'bad.json'))
    await win.waitForSelector(strip, { timeout: 10000 })
    await sleep(700) // the save is on a 400ms debounce
  } finally {
    await app.close()
  }
  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'README.md'), true))
  try {
    await win.waitForSelector(strip, { timeout: 10000 })
    ok((await tabRows().count()) === 2, 'the strip comes back after a restart')
  } finally {
    await app.close()
  }

  // Explorer-opens-a-file WITH saved tabs to restore: the new tab's root must
  // survive the restore traffic. This raced once: the first restored tab's
  // report replaced main's root set while the new file's payload was still in
  // flight, its listDir was refused, and the sidebar cached "can't read".
  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'code', 'nested', 'level-two', 'buried.py'), true))
  try {
    await win.waitForSelector(strip, { timeout: 10000 })
    await sleep(800) // let the tree load (or cache a refusal, when broken)
    ok(
      await win
        .locator('[role="treeitem"]:has-text("buried.py")')
        .isVisible()
        .catch(() => false),
      'a file opened alongside restored tabs still gets its folder tree'
    )
    const note = ((await win.locator('aside').textContent()) ?? '').includes("can't read")
    ok(!note, 'and the sidebar does not claim the folder is unreadable')
    // A file two folders down is MARKED, not merely present: the tree opens
    // the folders leading to it, so the row exists to be marked at all.
    ok(
      ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes(
        'buried.py'
      ),
      'and the file it is showing is selected in the sidebar'
    )
  } finally {
    await app.close()
  }

  /**
   * The tree does not collapse when Prism closes (2026-08-31).
   *
   * A tab rooted ABOVE the file is the only shape that can show this: the
   * previous round opens a file directly, so its tab is rooted at the file's
   * own folder and there are no ancestors to keep open. Here the root is the
   * fixtures folder and the file is three deep.
   */
  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'README.md')))
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    await sleep(500)
    // Folders select on the first click and expand on the second.
    for (const name of ['code', 'nested', 'level-two']) {
      const row = win.locator(`[role="treeitem"]:has-text("${name}")`).first()
      await row.click()
      await sleep(250)
      await row.click()
      await sleep(450)
    }
    await win.locator('[role="treeitem"]:has-text("buried.py")').first().click()
    await sleep(900) // the strip save is on a 400ms debounce
    ok(
      (await win.locator('[role="treeitem"]:has-text("level-two")').count()) >= 1,
      'the tree is open three folders deep before the restart'
    )
  } finally {
    await app.close()
  }

  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'README.md'), true))
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    await sleep(1200)
    const rows = await win.locator('[role="treeitem"]').allTextContents()
    ok(
      rows.some((r) => r.includes('level-two')),
      `the folders that were open came back open (${rows.length} rows)`
    )
    ok(
      rows.some((r) => r.includes('buried.py')),
      'so the file deep inside them has a row again'
    )
    // ...and they are FILLED IN, not left spinning. Only a toggle ever
    // fetched a folder's children, so a restored tree came back open with
    // nothing in it and every row sat on "loading..." until it was collapsed
    // and reopened by hand.
    const stuck = ((await win.locator('aside').textContent()) ?? '').includes('loading')
    ok(!stuck, 'and none of them is still saying "loading"')
  } finally {
    await app.close()
  }
}

async function terminalScenario(fixtures) {
  console.log('terminal')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    // The base font size pref applies to new terminals (125% of 13 = 16px).
    await win.evaluate(() => localStorage.setItem('prism.term.fontPct', '125'))
    // A tab's width must not change when its terminal opens: the dot slot is
    // there from birth. Measure before and after.
    const tabWidth = () =>
      win.evaluate(() => document.querySelector('[role="tablist"] [role="tab"]')?.parentElement?.getBoundingClientRect().width ?? 0)
    const widthBefore = await tabWidth()
    // The button lives on the sidebar's footer row now.
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    ok(Math.abs((await tabWidth()) - widthBefore) < 1, 'opening a terminal does not widen the tab')
    ok(
      (await win.evaluate(() => document.querySelector('.xterm')?.querySelector('.xterm-rows') && getComputedStyle(document.querySelector('.xterm .xterm-rows')).fontSize)) === '16px',
      'the Settings base font size applies (125% = 16px)'
    )
    // Ctrl+scroll zooms this one session, unpersisted.
    await win.locator('.xterm').hover()
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, -240)
    await win.keyboard.up('Control')
    await sleep(400)
    ok(
      (await win.evaluate(() => getComputedStyle(document.querySelector('.xterm .xterm-rows')).fontSize)) !== '16px',
      'Ctrl+scroll zooms the session text'
    )
    await win.evaluate(() => localStorage.setItem('prism.term.fontPct', '100'))
    ok(
      !(await win.locator('.p-md h1').first().isVisible().catch(() => false)),
      'opening the terminal takes the FULL view: the document steps aside'
    )
    await sleep(3000) // a cold pwsh takes a moment to prompt
    await win.keyboard.type('echo prism-e2e-marker')
    await win.keyboard.press('Enter')
    await win.waitForFunction(
      () => (document.querySelector('.xterm')?.textContent ?? '').includes('prism-e2e-marker'),
      null,
      { timeout: 15000 }
    )
    ok(true, 'the shell echoes back through the pty')

    // Ctrl+` is three-way (2026-08-31): a SHOWING terminal that does not have
    // the keyboard gets it, and only a press from inside hides. So click
    // away first and prove the panel survives.
    await win.locator('[data-row]').first().click()
    await sleep(200)
    await win.keyboard.press('Control+`')
    await sleep(300)
    ok(
      (await win.locator('.xterm').count()) === 1,
      'Ctrl+` from outside focuses the terminal rather than hiding it'
    )
    ok(
      await win.evaluate(() => !!document.activeElement?.closest('.xterm')),
      'and the keyboard is in the terminal afterwards'
    )

    // Now from inside: same key, and this time it hides.
    await win.keyboard.press('Control+`')
    await sleep(300)
    ok((await win.locator('.xterm').count()) === 0, 'Ctrl+` from inside hides the panel')
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 10000 })
    await sleep(300)
    ok(
      ((await win.locator('.xterm').textContent()) ?? '').includes('prism-e2e-marker'),
      'reopening shows the same shell, scrollback intact'
    )

    // Find in the scrollback: the marker is up there, and the bar counts it.
    await win.keyboard.press('Control+Shift+F')
    await win.waitForSelector('[data-term-find]', { timeout: 5000 })
    await win.locator('[data-term-find] input').fill('prism-e2e-marker')
    await sleep(400)
    const findCount = (await win.locator('[data-term-find] span').first().textContent()) ?? ''
    ok(/of|\+/.test(findCount), `the find bar counts matches in the scrollback (${findCount})`)
    await win.keyboard.press('Escape')
    await sleep(200)
    ok((await win.locator('[data-term-find]').count()) === 0, 'Escape closes the terminal find bar')

    const countMarker = async () =>
      (((await win.locator('.xterm').textContent()) ?? '').match(/prism-e2e-marker/g) ?? []).length

    // PSReadLine renders the input line in colour; through the pty that
    // arrives as SGR and xterm draws it as styled spans. White-on-dark only
    // would mean the highlighting chain is broken somewhere.
    await win.locator('.xterm').click()
    await win.keyboard.type('echo hi')
    await sleep(600)
    ok(
      (await win.evaluate(() => document.querySelectorAll('.xterm [class*="xterm-fg-"]').length)) > 0,
      'the input line is syntax-highlighted (PSReadLine colours reach xterm)'
    )
    await win.keyboard.press('Escape') // RevertLine: a clean prompt again
    await sleep(300)

    // The ghost suggestion: history holds the earlier echo, so its prefix
    // summons the rest as inline text, and RightArrow accepts the whole line.
    const base = await countMarker()
    await win.keyboard.type('echo pri')
    await sleep(1200)
    ok((await countMarker()) >= base + 1, 'typing a prefix shows the history suggestion as ghost text')
    await win.keyboard.press('ArrowRight')
    await sleep(300)
    await win.keyboard.press('Enter')
    await win.waitForFunction(
      (n) => ((document.querySelector('.xterm')?.textContent ?? '').match(/prism-e2e-marker/g) ?? []).length >= n,
      base + 2,
      { timeout: 10000 }
    )
    ok(true, 'RightArrow accepts the suggestion and it runs')

    // Tab-management hotkeys pierce a focused shell: Ctrl+T spawns a tab from
    // inside the terminal, Ctrl+Tab cycles back to this one.
    await win.locator('.xterm').click()
    await win.keyboard.press('Control+t')
    await sleep(700)
    ok(
      (await win.locator('[role="tablist"] [role="tab"]').count()) === 2,
      'Ctrl+T works while the terminal is focused'
    )
    await win.keyboard.press('Control+Tab')
    await sleep(400)
    await win.locator('[role="tablist"] [aria-label^="Close"]').last().click()
    await sleep(500)
    ok(
      (await win.locator('[role="tablist"]').count()) === 0 ||
        (await win.locator('[role="tablist"] [role="tab"]').count()) === 1,
      'and the spawned tab closes again'
    )
    await win.locator('.xterm').click()
    await win.keyboard.type('echo still-here')
    await win.keyboard.press('Enter')
    await win.waitForFunction(
      () => (document.querySelector('.xterm')?.textContent ?? '').includes('still-here'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'the shell was untouched by the tab keys')

    // Ctrl+B toggles the sidebar from inside the shell too.
    await win.keyboard.press('Control+b')
    await sleep(400)
    ok((await win.locator('aside[aria-hidden="true"]').count()) === 1, 'Ctrl+B shuts the sidebar from the terminal')
    await win.keyboard.press('Control+b')
    await sleep(400)
    ok((await win.locator('aside[aria-hidden="false"]').count()) === 1, 'and brings it back')

    // Ctrl+W pierces the shell too: with the ask option on, the question
    // appears while the terminal is focused, and Cancel keeps everything.
    await win.evaluate(() => localStorage.setItem('prism.tabs.confirmClose', '1'))
    await win.locator('.xterm').click()
    await win.keyboard.press('Control+w')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    ok(
      ((await win.locator('[role="dialog"]').textContent()) ?? '').includes('Close this tab?'),
      'Ctrl+W asks from inside the terminal'
    )
    await win.locator('[role="dialog"] button:has-text("Cancel")').click()
    await sleep(300)
    await win.evaluate(() => localStorage.setItem('prism.tabs.confirmClose', '0'))
    await win.locator('.xterm').click()

    // The terminal button's own menu: split, and CLOSE (owner, 2026-09-03 -
    // Close took Clear's place and its glyph; a fresh shell is a cleared one;
    // "Open in new tab" went with it).
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Open in split view")').count()) === 1 &&
        (await win.locator('[role="menuitem"]:has-text("Close terminal")').count()) === 1 &&
        (await win.locator('[role="menuitem"]:has-text("Clear terminal")').count()) === 0 &&
        (await win.locator('[role="menuitem"]:has-text("Open in new tab")').count()) === 0,
      'right-clicking the terminal button offers split and close, and nothing retired'
    )
    await win.locator('[role="menuitem"]:has-text("Close terminal")').click()
    for (let i = 0; i < 30 && (await win.locator('.xterm').count()) > 0; i++) await sleep(100)
    ok((await win.locator('.xterm').count()) === 0, 'Close terminal from the button takes the shell away')
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await win.waitForFunction(
      () => (document.querySelector('.xterm')?.textContent ?? '').includes('PS '),
      null,
      { timeout: 15000 }
    )
    ok((await countMarker()) === 0, 'and the next open is a fresh shell: no old scrollback')
    await win.locator('.xterm').click()

    // The activity indicator: streaming output lights the tab's dot, quiet
    // turns it off. ping -n 3 emits for ~2s, like an AI CLI's spinner would.
    // The pty must be the WINDOW's size, not the 80x24 spawn default: a
    // dropped first resize is how Ink UIs end up drawing a tiny layout in the
    // middle of a maximized window.
    await win.keyboard.type('"COLS=$($Host.UI.RawUI.BufferSize.Width)"')
    await win.keyboard.press('Enter')
    await win.waitForFunction(
      () => /COLS=\d+/.test(document.querySelector('.xterm')?.textContent ?? ''),
      null,
      { timeout: 10000 }
    )
    const cols = Number(
      /COLS=(\d+)/.exec((await win.locator('.xterm').textContent()) ?? '')?.[1] ?? 0
    )
    ok(cols > 90, `the shell was born at the window's size, not 80x24 (cols=${cols})`)

    // The dots are AGENT-scoped now: a plain terminal never shows one, no
    // matter how hard it streams.
    ok(
      (await win.evaluate(() => document.querySelectorAll('[data-activity="working"]').length)) === 0,
      'a plain terminal shows no indicator'
    )
    await win.keyboard.type('ping -n 3 127.0.0.1')
    await win.keyboard.press('Enter')
    await sleep(3500)
    ok(
      (await win.evaluate(() => document.querySelectorAll('[data-activity="working"]').length)) === 0,
      'even sustained streaming lights nothing without an agent'
    )

    // A real agent: claude starts, the poll finds it in the shell's process
    // tree, a dot appears; leaving claude retires it. Nothing is submitted.
    await win.keyboard.type('claude')
    await win.keyboard.press('Enter')
    // Detection is invisible while idle now: presence is a data attribute,
    // and the tab PAINTS only while the agent genuinely works.
    // Sixty seconds, not thirty: this waits for a REAL claude CLI to start,
    // and on a busy machine thirty is not always enough - which reads as a
    // failure of the indicator rather than of the wait.
    await win.waitForSelector('[data-agent-present]', { timeout: 60000 })
    ok(true, 'claude in the shell is detected')
    await sleep(1500)
    ok(
      (await win.evaluate(() => document.querySelectorAll('[data-activity="working"]').length)) === 0,
      'and an idle claude leaves the tab looking default'
    )
    await win.keyboard.press('Escape')
    await sleep(400)
    // Exit can need more than one nudge (a double-Ctrl+C confirm, focus
    // wobble); keep nudging until the process is genuinely gone.
    let dotGone = false
    for (let i = 0; i < 6 && !dotGone; i += 1) {
      await win.locator('.xterm').click()
      await win.keyboard.press('Control+c')
      await sleep(500)
      await win.keyboard.press('Control+c')
      dotGone = await win
        .waitForFunction(() => !document.querySelector('[data-agent-present]'), null, {
          timeout: 7000
        })
        .then(() => true)
        .catch(() => false)
    }
    if (!dotGone)
      console.log(
        '  TERM TAIL:',
        JSON.stringify(((await win.locator('.xterm').textContent()) ?? '').slice(-400))
      )
    ok(dotGone, 'claude leaving clears the detection')

    // The paste rule, text half: Ctrl+V with text on the clipboard pastes it.
    await app.evaluate(({ clipboard }) => clipboard.writeText('echo paste-marker'))
    await win.locator('.xterm').click()
    await win.keyboard.press('Control+v')
    await win.waitForFunction(
      () => (document.querySelector('.xterm')?.textContent ?? '').includes('paste-marker'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'text on the clipboard becomes a bracketed paste')
    await win.keyboard.press('Escape') // clear the pasted line (PSReadLine)

    // The image half: Ctrl+V with an image forwards the ^V key instead of
    // pasting text, so nothing appears - and the shell stays healthy.
    // The previous clipboard TEXT must not reappear: with an image on the
    // clipboard the ^V key is forwarded for the TUI to read, and nothing gets
    // text-pasted. (Exact before/after equality is too strict now that
    // PSReadLine actively redraws the input line.)
    const countPaste = async () =>
      (((await win.locator('.xterm').textContent()) ?? '').match(/paste-marker/g) ?? []).length
    const beforeN = await countPaste()
    // The Windows clipboard is a shared resource and writeImage can silently
    // lose the race to whoever holds it open; write until it verifiably took.
    // A canvas-made PNG is valid by construction (hand-rolled base64 proved
    // twice today that it is not).
    const pngUrl = await win.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 8
      c.height = 8
      const g = c.getContext('2d')
      g.fillStyle = '#c0392b'
      g.fillRect(0, 0, 8, 8)
      return c.toDataURL('image/png')
    })
    let clipHasImage = false
    for (let i = 0; i < 5 && !clipHasImage; i += 1) {
      clipHasImage = await app.evaluate(({ clipboard, nativeImage }, url) => {
        // clear() first: writeImage does not reliably evict an existing text
        // format, and a text+image clipboard is a DIFFERENT (also correct)
        // path - the plain shell pastes the text half. This test wants the
        // image-only screenshot case.
        clipboard.clear()
        clipboard.writeImage(nativeImage.createFromDataURL(url))
        const f = clipboard.availableFormats()
        return f.some((x) => x.startsWith('image/')) && !f.includes('text/plain')
      }, pngUrl)
      if (!clipHasImage) await sleep(400)
    }
    ok(clipHasImage, 'the clipboard verifiably holds the image (harness precondition)')
    const screenText = () =>
      win.evaluate(() => document.querySelector('.xterm-screen')?.textContent ?? '')
    const screenBefore = await screenText()
    await win.keyboard.press('Control+v')
    await sleep(800)
    // NOT exact equality: PSReadLine's redraw may clean stale render artifacts
    // of the earlier reverted paste (observed 2 -> 0). The claim is only that
    // no NEW text appeared from a ^V with an image on the clipboard.
    void screenBefore
    const nowN = await countPaste()
    ok(nowN <= beforeN, 'an image on the clipboard pastes no text (the ^V key is forwarded)')
    await win.keyboard.type('echo still-alive')
    await win.keyboard.press('Enter')
    await win.waitForFunction(
      () => (document.querySelector('.xterm')?.textContent ?? '').includes('still-alive'),
      null,
      { timeout: 10000 }
    )
    ok(true, 'and the shell is untroubled by it')

    // The title bar belongs to what is ON SCREEN: over a full terminal the
    // markdown pencil has nothing to edit, so it goes with the file name.
    // Ctrl+scroll must zoom even while a full-screen program owns the mouse:
    // turn xterm's mouse reporting ON the way Claude Code and vim do, then
    // wheel with ctrl held. Before the capture-phase handler, xterm claimed
    // the event to forward it to the program and nothing zoomed.
    {
      const fontOf = () =>
        win.evaluate(() => {
          const el = document.querySelector('.xterm-rows') ?? document.querySelector('.xterm')
          return el ? getComputedStyle(el).fontSize : ''
        })
      await win.locator('.xterm').click()
      await win.keyboard.type("[Console]::Out.Write([char]27 + '[?1003h')")
      await win.keyboard.press('Enter')
      await sleep(900)
      const before = await fontOf()
      const box = await win.locator('.xterm').boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await win.keyboard.down('Control')
      await win.mouse.wheel(0, -240)
      await win.mouse.wheel(0, -240)
      await win.keyboard.up('Control')
      await sleep(600)
      const after = await fontOf()
      ok(
        !!before && before !== after,
        `ctrl+scroll zooms with mouse reporting on (${before} -> ${after})`
      )
      // ...and back down, so the rest of the scenario sees the size it expects.
      await win.keyboard.down('Control')
      await win.mouse.wheel(0, 240)
      await win.mouse.wheel(0, 240)
      await win.keyboard.up('Control')
      await sleep(400)
    }
    ok(
      (await win.locator('[aria-label="Edit"]').count()) === 0,
      'a full terminal hides the markdown pencil'
    )
    ok(
      (await win.locator('aside [role="treeitem"][aria-selected="true"]').count()) === 0,
      'and marks no file in the tree: nothing is on screen to mark'
    )
    await win.screenshot({ path: join(SHOTS, 'terminal.png') })

    // Clicking a file over a FULL terminal means "show me this file": the
    // shell hides (still running) and the file takes the room.
    await win.locator('[role="treeitem"]:has-text("README.md")').click()
    await sleep(500)
    ok(
      (await win.locator('.xterm').count()) === 0 &&
        (await win.locator('.p-md h1').first().isVisible().catch(() => false)),
      'clicking a file collapses a full terminal to the file'
    )

    // The terminal split is menu-only now (Ctrl+D retired): the terminal
    // button's right-click menu opens it.
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open in split view")').click()
    await sleep(500)
    ok(
      (await win.locator('.xterm').count()) === 1 &&
        (await win.locator('.p-md h1').first().isVisible().catch(() => false)),
      'the terminal menu makes the split: document AND terminal'
    )
    await win.screenshot({ path: join(SHOTS, 'terminal-split.png') })

    // (The context-menu "Remove from split view" now belongs to PINNED file
    // panes, tested in the context-menu scenario; a terminal split leaves the
    // file's menu offering "Open in split view" as usual.)

    // The file pane's X: the file steps out, the terminal takes the full view.
    await win.locator('[aria-label="Remove the file from the split"]').click()
    await sleep(400)
    ok(
      (await win.locator('.xterm').count()) === 1 &&
        !(await win.locator('.p-md h1').first().isVisible().catch(() => false)),
      'the file pane X leaves the terminal in full view'
    )

    // Back to split (via the menu), then the terminal pane's X: the file
    // gets the room.
    await win.locator('[role="treeitem"]:has-text("README.md")').click()
    await sleep(400)
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open in split view")').click()
    await sleep(400)
    await win.locator('[aria-label="Remove the terminal from the split"]').click()
    await sleep(400)
    ok(
      (await win.locator('.xterm').count()) === 0 &&
        (await win.locator('.p-md h1').first().isVisible().catch(() => false)),
      'the terminal pane X leaves the file alone'
    )

    // exit ends the shell; the panel goes with it and the window stays.
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 10000 })
    await win.locator('.xterm').click()
    await sleep(300)
    await win.keyboard.type('exit')
    await win.keyboard.press('Enter')
    await win.waitForFunction(() => !document.querySelector('.xterm'), null, { timeout: 10000 })
    ok(true, 'exit closes the panel')
    ok(!win.isClosed(), 'window survives the shell')

    // CLOSE TERMINAL MEANS CLOSE (owner, 2026-09-03): the shell dies, and the
    // next Ctrl+` is a fresh one. Hiding (the X, Ctrl+`) still keeps it.
    // The step above ended with `exit`, so open one to close.
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(800)
    await win.locator('.xterm').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Close terminal")').click()
    for (let i = 0; i < 30 && (await win.locator('.xterm').count()) > 0; i++) await sleep(100)
    ok((await win.locator('.xterm').count()) === 0, 'Close terminal takes the shell away')
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 15000 })
    ok(true, 'and the next Ctrl+` opens a fresh one')

    // SEVERAL TERMINALS (owner, 2026-09-03): a second shell, the list to pick
    // from, one pinned as a pane beside the other, and a close submenu.
    const termBtn = () => win.locator('aside [aria-label="Terminal"]')
    await termBtn().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open new terminal")').click()
    await sleep(1500)
    ok((await win.locator('.xterm').count()) === 1, 'a new terminal takes the full view alone')
    await termBtn().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Terminal 1")').count()) === 1 &&
        (await win.locator('[role="menuitem"]:has-text("Terminal 2")').count()) === 1,
      'the menu lists both terminals'
    )
    await win.hover('[role="menuitem"]:has-text("Open in split view")')
    await sleep(400)
    await win.locator('[role="menuitem"]:has-text("Terminal 1")').last().click()
    await sleep(1800)
    ok(
      (await win.locator('[data-pane="pinned"] .xterm').count()) === 1 &&
        (await win.locator('.xterm').count()) === 2,
      'the other terminal is pinned as a pane beside the current one'
    )
    // ...and TERMINALS ONLY (owner, 2026-09-03): a split built from a full
    // terminal draws no file pane - the old split does not come back.
    ok((await win.locator('[data-pane="live"]').count()) === 0, 'with no file pane drawn beside them')
    await termBtn().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.hover('[role="menuitem"]:has-text("Close terminal")')
    await sleep(400)
    await win.locator('[role="menuitem"]:has-text("Terminal 1")').last().click()
    for (let i = 0; i < 30 && (await win.locator('[data-pane="pinned"]').count()) > 0; i++) await sleep(100)
    ok((await win.locator('[data-pane="pinned"]').count()) === 0, 'closing the pinned shell removes its pane')
    ok((await win.locator('.xterm').count()) === 1, 'and the other one carries on')
  } finally {
    await app.close()
  }
}

/**
 * A FOLDER handed to Prism from outside (2026-08-25).
 *
 * This is what Explorer's "Open in Prism" on a folder, and "Open Prism here"
 * on the empty space inside one, actually do: hand over a directory as argv.
 * Main used to demand a FILE and drop it on the floor, so the menu entry was
 * there and nothing happened. The tab roots at the folder, and what it shows
 * is the "New tabs show" setting, exactly as the + decides it.
 */
/**
 * The gear, three ways (2026-08-26): settings showing -> close them; settings
 * open behind another tab -> bring them forward; not open -> open them.
 */
/**
 * A paused film stays paused across a tab switch, and the cog's
 * "pause playback" choice (2026-08-26).
 */
/**
 * The video's right-click menu (2026-08-27): VLC-shaped, and the picture modes
 * it carries.
 */
async function videoMenuScenario(fixtures) {
  console.log('the video menu')
  const { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    // PAUSE it, and not only for quiet: the shared profile has autoplay on
    // from the player-settings scenario, and these fixtures are two seconds
    // long - left running, ep1 ends and ep2 is what the menu describes.
    await win.evaluate(() => {
      const v = document.querySelector('video')
      if (v) {
        v.muted = true
        v.pause()
      }
    })
    await sleep(1000)
    const rows = () => win.locator('[role="menuitem"]').allTextContents()
    const cls = () => win.evaluate(() => document.querySelector('video')?.className ?? '')
    const openMenu = async () => {
      // Escape only when a menu is up: with none, Escape closes the WINDOW,
      // which is the app behaving correctly and the test not.
      if (await win.locator('[role="menu"]').count()) await win.keyboard.press('Escape')
      await win.locator('video').click({ button: 'right', position: { x: 200, y: 150 } })
      await sleep(400)
      return rows()
    }

    const items = await openMenu()
    ok(items.some((t) => t.startsWith('Next video')), 'the menu offers Next video')
    ok(items.some((t) => t.startsWith('Previous video')), 'and Previous video')
    ok(items.some((t) => t.startsWith('Picture')), 'and the picture modes')
    ok(items.some((t) => t.startsWith('Speed')), 'and speed')
    ok(items.some((t) => t.startsWith('Subtitles')), 'and subtitles')
    ok(items.some((t) => t.includes('Explorer')), 'and the file itself')
    // Trimmed on purpose (owner, 2026-08-27): a click and a double-click
    // already play and fullscreen.
    ok(!items.some((t) => /^(Play|Pause)/.test(t)), 'and NOT play/pause')
    ok(!items.some((t) => t.startsWith('Fullscreen')), 'and not fullscreen')

    // The speed row carries the rate the cog's slider drives.
    ok(
      items.some((t) => /^Speed1\.00/.test(t.replace(/\s/g, ''))),
      `speed shows the current rate (${JSON.stringify(items.find((t) => t.startsWith('Speed')))})`
    )

    // Picture: fit is where it starts, fill crops instead.
    ok((await cls()).includes('object-contain'), 'the picture starts fitted to the window')
    await win.locator('[role="menuitem"]', { hasText: 'Picture' }).hover()
    await sleep(400)
    const modes = await rows()
    ok(!modes.some((t) => t.startsWith('Original size')), 'original size was cut, and is gone')
    await win.locator('[role="menuitem"]', { hasText: 'Fill window' }).click()
    await sleep(400)
    ok((await cls()).includes('object-cover'), 'Fill window crops instead of letterboxing')

    // Subtitles: the sidecar is found, and a file can be added by hand.
    await openMenu()
    await win.locator('[role="menuitem"]', { hasText: 'Subtitles' }).hover()
    await sleep(400)
    const subs = await rows()
    ok(subs.some((t) => t.includes('Add subtitle file')), 'subtitles can be pointed at a file by hand')

    // Next video: ep2 is the next VIDEO, and the images in between are stepped over.
    await openMenu()
    await win.locator('[role="menuitem"]', { hasText: 'Next video' }).click()
    await win
      .waitForFunction(() => /ep2/.test(document.querySelector('video')?.getAttribute('src') ?? ''), null, { timeout: 8000 })
      .catch(() => {})
    ok(
      /ep2/.test((await win.locator('video').getAttribute('src')) ?? ''),
      'Next video moves to the next VIDEO in the folder'
    )
    await openMenu()
    await win.locator('[role="menuitem"]', { hasText: 'Previous video' }).click()
    await win
      .waitForFunction(() => /ep1/.test(document.querySelector('video')?.getAttribute('src') ?? ''), null, { timeout: 8000 })
      .catch(() => {})
    ok(
      /ep1/.test((await win.locator('video').getAttribute('src')) ?? ''),
      'and Previous video comes back'
    )

    // Escape closes the MENU, not the window.
    await openMenu()
    await win.keyboard.press('Escape')
    await sleep(400)
    ok((await win.locator('[role="menu"]').count()) === 0, 'Escape closes the menu')
    ok((await win.locator('video').count()) === 1, 'and leaves the window alone')
  } finally {
    await app.close()
  }
}

async function pauseScenario(fixtures) {
  console.log('pausing')
  const { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    await win.evaluate(() => { const v = document.querySelector('video'); v.muted = true })
    await sleep(1200)
    const paused = () => win.evaluate(() => document.querySelector('video')?.paused ?? null)
    // Opening a file does NOT start it (2026-08-28, owner decision): a folder
    // of films, or a window of restored tabs, would otherwise all play at once.
    ok((await paused()) === true, 'a film Prism has just opened is not playing')
    await win.evaluate(() => { void document.querySelector('video').play() })
    await sleep(400)
    ok((await paused()) === false, 'and it plays when told to')
    await win.evaluate(() => document.querySelector('video').pause())
    await sleep(300)
    ok((await paused()) === true, 'a film pauses when told to')

    // Settings is a TAB, and a tab renders only while it is in front - which
    // used to take the film's element with it. Every tab holding media keeps
    // its player now (lib/mediaDeck), so switching is not a handoff at all:
    // the SAME element carries on, unseen.
    await win.evaluate(() => {
      const v = document.querySelector('video')
      v.dataset.stamp = 'first'
      window.__pauses = 0
      v.addEventListener('pause', () => { window.__pauses += 1 })
    })
    await win.locator('[aria-label="Settings"]').click()
    await sleep(900)
    const hidden = await win.evaluate(() => {
      const v = document.querySelector('video')
      return v ? { stamp: v.dataset.stamp, paused: v.paused, t: v.currentTime } : null
    })
    ok(hidden?.stamp === 'first', 'the player follows you: the element is still the one you left')
    ok(hidden?.paused === true, 'a film you had stopped is still stopped')

    // ...and a film that was RUNNING keeps running, with no pause in between.
    await win.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 0.1; void v.play() })
    await sleep(500)
    const t1 = await win.evaluate(() => document.querySelector('video').currentTime)
    await win.locator('[data-tab]').first().click()
    await sleep(700)
    const t2 = await win.evaluate(() => document.querySelector('video')?.currentTime ?? -1)
    ok(t2 > t1, 'the clock ran while another tab was in front')
    ok(
      (await win.evaluate(() => window.__pauses)) === 0,
      'and it never paused once: no pause-and-unpause on the way through'
    )
    ok(
      (await win.evaluate(() => document.querySelector('video')?.crossOrigin)) === 'anonymous',
      'the video is fetched CORS-clean, so a boost over 100% is loud and not silent'
    )
    ok((await win.locator('video').count()) === 1, 'and one player, never two')

    // A CLICK on a film PLAYS it (owner, 2026-09-03), which narrows the
    // 2026-08-28 rule rather than reversing it: a launch, a restore and a
    // file Windows hands over still arrive paused. The click is the intent.
    await win.evaluate(() => document.querySelector('video')?.pause())
    await win.locator('[role="treeitem"][data-row$="ep2.mp4" i]').first().click()
    await win.waitForFunction(
      () => {
        const v = document.querySelector('video')
        return !!v && /ep2/i.test(v.currentSrc || v.src)
      },
      null,
      { timeout: 8000 }
    )
    await win.evaluate(() => { document.querySelector('video').muted = true })
    await sleep(900)
    ok(
      (await win.evaluate(() => document.querySelector('video')?.paused)) === false,
      'a film you CLICKED in the tree starts playing'
    )
    // DELETE REACHES A FILM (owner, 2026-09-03): clicking the row hands the
    // video element the keyboard, and the row's own Delete handler never
    // saw the key. The tree listens at the window now, behind the typing
    // guard - and a focused video is not typing.
    await win.evaluate(() => document.querySelector('video')?.focus())
    await win.keyboard.press('Delete')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const q = await win.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '')
    ok(/ep2/i.test(q), `Delete over a focused film asks about that film (${q.slice(0, 60)})`)
    // ...and the film that is PLAYING actually goes (owner, 2026-09-03): it
    // holds a handle through the media stream and the Recycle Bin refuses a
    // file with one open, so the player is released first and the bin
    // asked after a beat, with retries.
    await win.locator('[role="dialog"] button:has-text("Delete")').click()
    for (let i = 0; i < 40 && existsSync(join(fixtures, 'ep2.mp4')); i++) await sleep(200)
    ok(!existsSync(join(fixtures, 'ep2.mp4')), 'and a film that was playing is really in the bin')
    ok(
      (await win.locator('[role="dialog"]').count()) === 0,
      'with no "could not be moved" complaint'
    )
  } finally {
    await app.close()
  }
}

async function volumeScenario(fixtures) {
  console.log('volume')
  const { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    await win.evaluate(() => { document.querySelector('video').muted = true })
    await sleep(1000)
    const readout = () => win.evaluate(() => document.querySelector('[aria-live="polite"]')?.textContent ?? null)
    const box = await win.locator('video').boundingBox()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    // Both ways reach 200%: the column in the transport, and the wheel. The
    // column only EXISTS while it is being reached for (2026-08-28), so this
    // asks after hovering rather than of a hidden element.
    await win.locator('button[title^="Mute"]').hover()
    await sleep(350)
    ok(
      (await win.evaluate(() => document.querySelector('input[aria-label="Volume"]')?.max)) === '2',
      'the volume column runs to 200%'
    )
    await win.mouse.move(8, 380)
    await sleep(800)
    // ...and back over the picture, which is where the wheel means volume.
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 4; i++) {
      await win.mouse.wheel(0, -100)
      await sleep(80)
    }
    await sleep(200)
    ok((await readout()) === '120%', 'the wheel goes past 100%, and says so on the picture')

    // ...and no further than 200%, however long you spin it.
    for (let i = 0; i < 30; i++) await win.mouse.wheel(0, -100)
    await sleep(300)
    ok((await readout()) === '200%', 'and stops at 200%')

    for (let i = 0; i < 8; i++) {
      await win.mouse.wheel(0, 100)
      await sleep(60)
    }
    await sleep(200)
    ok((await readout()) === '160%', 'and comes back down the same way')

    // It is an indicator, not a control: it goes away on its own.
    await sleep(1600)
    ok((await readout()) === null, 'the readout leaves when it has been read')

    // The column: taller than it was, and forgiving of a wobble off its edge.
    const slider = win.locator('input[aria-label="Volume"]')
    ok((await slider.count()) === 0, 'the column is not there until you go for it')
    await win.locator('button[title^="Mute"]').hover()
    await sleep(350)
    ok((await slider.count()) === 1, 'hovering the speaker brings it up')
    const column = await slider.boundingBox()
    ok(Math.round(column.height) === 105, 'and it is a quarter taller than it was')
    // A micro-movement off the edge must not take it away mid-aim.
    await win.mouse.move(column.x + column.width / 2, column.y - 30)
    await sleep(250)
    ok((await slider.count()) === 1, 'a step off the edge does not close it')
    await win.locator('button[title^="Mute"]').hover()
    await sleep(150)
    ok((await slider.count()) === 1, 'and coming back keeps it')
    // Walking away does.
    await win.mouse.move(8, 380)
    await sleep(900)
    ok((await slider.count()) === 0, 'leaving it alone closes it')
  } finally {
    await app.close()
  }
}

async function fullscreenBlackScenario(fixtures) {
  console.log('fullscreen is black')
  const { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    await win.evaluate(() => { document.querySelector('video').muted = true })
    await sleep(800)
    const stageBg = () =>
      win.evaluate(() => {
        const v = document.querySelector('video')
        const stage = v?.parentElement
        return stage ? getComputedStyle(stage).backgroundColor : null
      })
    const windowed = await stageBg()
    await win.keyboard.press('F11')
    await sleep(900)
    // BORDERLESS, EXACT (2026-09-03): no OS fullscreen (its DWM animation is
    // what flashed), no topmost (Windows strips it). The window drops its
    // resize borders and covers the monitor exactly, which is what makes the
    // shell's own borderless-game detection put the taskbar beneath it.
    const covers = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const b = w.getBounds()
      const d = screen.getDisplayMatching(b).bounds
      return { b, d, onTop: w.isAlwaysOnTop(), osFs: w.isFullScreen(), rs: w.isResizable() }
    })
    // >= rather than ==: the frame overhang survives setResizable(false)
    // (measured), and proud of the display is the right direction - no edge
    // left uncovered. The shell's fullscreen detection engages regardless.
    ok(
      covers.b.width >= covers.d.width && covers.b.height >= covers.d.height,
      `F11 covers the whole display (${covers.b.width}x${covers.b.height} of ${covers.d.width}x${covers.d.height})`
    )
    ok(!covers.rs, 'the screen edges are not live resize handles while the picture is up')
    ok(!covers.osFs, 'no OS fullscreen - its animation is what flashed')
    ok(!covers.onTop, 'and no always-on-top for the shell to strip')
    // The letterbox is part of the picture: a theme colour behind a film is
    // the app leaking into it (2026-08-28).
    ok((await stageBg()) === 'rgb(0, 0, 0)', 'the stage behind a fullscreen film is black')

    // The `:fullscreen` rule no longer applies - there is no fullscreen element
    // in a borderless window - and the stage's own black above is what matters.
    await win.keyboard.press('F11')
    await sleep(900)
    ok((await stageBg()) === windowed, 'and the theme comes back on the way out')
    const back = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const b = w.getBounds()
      return { b, d: screen.getDisplayMatching(b).bounds, onTop: w.isAlwaysOnTop() }
    })
    ok(!back.onTop, 'the window stops floating above the taskbar')
    ok(
      back.b.width !== back.d.width || back.b.height !== back.d.height,
      `and goes back to its own size (${back.b.width}x${back.b.height})`
    )
    ok(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isResizable()),
      'and is resizable again'
    )

    // FROM A MAXIMIZED WINDOW (2026-09-03): `setBounds` on a maximized window
    // is IGNORED by Windows - the owner's window is normally maximized, and
    // F11 left it at the work area with the taskbar still showing. Main drops
    // the maximized state first and puts it back on the way out.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await sleep(600)
    await win.keyboard.press('F11')
    await sleep(900)
    const fromMax = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const b = w.getBounds()
      const d = screen.getDisplayMatching(b).bounds
      return { b, d, maxed: w.isMaximized() }
    })
    ok(
      fromMax.b.height >= fromMax.d.height,
      `F11 from maximized still covers the taskbar (${fromMax.b.height} of ${fromMax.d.height})`
    )
    ok(!fromMax.maxed, 'the maximized state is dropped, or the bounds would not stick')
    await win.keyboard.press('F11')
    await sleep(900)
    ok(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      'and comes back maximized, not restored'
    )
  } finally {
    await app.close()
  }
}

async function searchQueryScenario(fixtures) {
  console.log('search operators')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    const box = win.locator('input[aria-label="Search files"]')
    const names = async (q) => {
      await box.fill(q)
      await sleep(700)
      return win.evaluate(() =>
        [...document.querySelectorAll('[data-search-hit], [role="option"], [role="treeitem"]')]
          .map((e) => e.textContent.trim())
          .filter(Boolean)
      )
    }
    // Words in any order, which one substring could never do: "mp4 ep1" is
    // not a substring of "ep1.mp4", but both of its words are in there.
    const both = await names('mp4 ep1')
    ok(both.some((n) => n.includes('ep1.mp4')), 'both words match, in either order')
    const other = await names('ep1 mp4')
    ok(other.some((n) => n.includes('ep1.mp4')), 'and the other way round')
    ok((await names('ep1 nowhere')).length === 0, 'but ALL of them have to match')
    // A glob over the whole name.
    const globbed = await names('*.mp4')
    ok(globbed.length > 0 && globbed.every((n) => n.includes('.mp4')), '*.mp4 finds the videos')
    ok(!globbed.some((n) => n.includes('.md')), 'and only the videos')
    // ext: and exclusion.
    const all = await names('ext:mp4')
    const kept = await names('ext:mp4 -subbed')
    ok(all.some((n) => n.includes('subbed')), 'ext:mp4 finds every video')
    ok(kept.length > 0 && !kept.some((n) => n.includes('subbed')), 'and a minus leaves one out')
    await box.fill('')
  } finally {
    await app.close()
  }
}

async function gearScenario(fixtures) {
  console.log('the settings gear')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    const gear = win.locator('[aria-label="Settings"]')
    const pressed = () => gear.getAttribute('aria-pressed')
    const tabCount = () => win.locator('[data-tab]').count()
    // Wait for the state, never for a guessed number of milliseconds: this
    // scenario failed once on a 400ms sleep that was simply too short, which
    // told me about my test rather than about the gear.
    const until = async (want, what) => {
      await win
        .waitForFunction((w) => document.querySelector('[aria-label="Settings"]')?.getAttribute('aria-pressed') === w, want, { timeout: 6000 })
        .catch(() => {})
      ok((await pressed()) === want, what)
    }
    ok((await pressed()) === 'false', 'the gear starts unpressed')

    await gear.click()
    await until('true', 'a click opens settings and shows them')
    const withSettings = await tabCount()

    await gear.click()
    await until('false', 'clicking again with settings ACTIVE closes the tab')
    ok((await tabCount()) === withSettings - 1, 'and the tab is really gone')

    await gear.click()
    await until('true', 'and opens again')
    await win.locator('[data-tab]').first().click()
    await until('false', 'settings open BEHIND another tab read as unpressed')
    ok((await tabCount()) === withSettings, 'and the settings tab is still open')

    await gear.click()
    await until('true', 'and the gear brings it forward instead of closing it')
    ok((await tabCount()) === withSettings, 'never a second settings tab')
  } finally {
    await app.close()
  }
}

async function folderArgScenario(fixtures) {
  console.log('a folder from outside')
  const { app, win } = await launch(fixtures)
  try {
    const body = (await win.textContent('body')) ?? ''
    ok(/README\.md/.test(body), 'the tree lists the folder that was handed over')
    ok((await win.locator('[data-row]').count()) > 2, 'and it is rooted there, not at a file')
    // The default "New tabs show" is the folder's first file, which is what a
    // payload built from a folder already carries.
    ok(
      (await win.locator('[role="treeitem"][aria-selected="true"]').count()) === 1,
      'and one of its files is open'
    )
  } finally {
    await app.close()
  }
}

async function archiveScenario(fixtures) {
  console.log('archive viewer')
  // #68: a real zip opens as a tree of members with view/rename/delete verbs.
  const zipPath = join(fixtures, 'zips', 'bundle.zip')
  const { app, win } = await launch(zipPath)
  try {
    await win.waitForSelector('[role="listbox"][aria-label*="bundle.zip"]', { timeout: 10000 })
    const row = (name) => win.locator(`[role="listbox"] [role="option"]`, { hasText: name })
    ok((await row('readme.txt').count()) === 1, 'a top-level member is listed')
    ok((await row('notes').count()) >= 1, 'so is the folder')
    const body = (await win.textContent('body')) ?? ''
    ok(/25 B/.test(body), 'sizes ride along')
    ok(!/todo\.md/.test(body), 'the root listing shows only its own level')

    // The columns (2026-08-25): what the container knows about each member.
    // The header is UPPERCASED by CSS, so the DOM still says "Type".
    ok(/Type/.test(body) && /Packed/.test(body) && /Modified/.test(body), 'the panel has a column header')
    ok(/Markdown document|TXT text/.test(body), 'and each row says what it is')

    // Drag-select, the archive's alone: it starts on DEAD SPACE, so a row
    // drag (which moves members) can never leave a phantom band behind.
    const list = await win.locator('[role="listbox"]').boundingBox()
    const firstRow = await win.locator('[data-arc-row]').first().boundingBox()
    await win.mouse.move(firstRow.x + 40, list.y + list.height + 50)
    await win.mouse.down()
    await win.mouse.move(firstRow.x + 220, firstRow.y + 8, { steps: 10 })
    ok((await win.locator('[data-arc-band]').count()) === 1, 'a band is drawn while sweeping')
    await win.mouse.up()
    ok(
      (await win.locator('[data-arc-row][data-selected]').count()) > 1,
      'the sweep marked the rows it crossed'
    )
    // And a press on dead space puts the marks away again: what stays marked
    // is the archive itself, over in the tree.
    await win.mouse.click(firstRow.x + 40, list.y + list.height + 50)
    ok(
      (await win.locator('[data-arc-row][data-selected]').count()) === 0,
      'dead space clears the selection'
    )
    // Ctrl+A takes the folder you are looking at, from dead space or a row.
    const memberCount = await win.locator('[data-arc-row]').count()
    await win.keyboard.press('Control+a')
    ok(
      (await win.locator('[data-arc-row][data-selected]').count()) === memberCount,
      'Ctrl+A marks every member of this folder'
    )
    await win.mouse.click(firstRow.x + 40, list.y + list.height + 50)

    // Explorer-shaped: clicking a folder walks INTO it; the breadcrumb (and
    // Backspace) climbs back out.
    await row('notes').first().dblclick()
    await win.waitForSelector('text=todo.md', { timeout: 5000 })
    ok((await row('readme.txt').count()) === 0, 'entering a folder leaves the parent behind')
    await win.keyboard.press('Backspace')
    await win.waitForSelector('text=readme.txt', { timeout: 5000 })
    ok(true, 'Backspace climbs back to the root')

    // View a member; Escape backs out of the preview.
    await row('readme.txt').first().dblclick()
    await win.waitForFunction(
      () => /hello from inside the zip/.test(document.body.textContent ?? ''),
      null,
      { timeout: 15000 }
    )
    ok(true, 'viewing a member shows its content')
    await win.screenshot({ path: join(SHOTS, 'archive-member.png') })
    await win.keyboard.press('Escape')
    await win.waitForFunction(
      () => !/hello from inside the zip/.test(document.body.textContent ?? ''),
      null,
      { timeout: 5000 }
    )
    ok(true, 'Escape returns to the archive')

    // Rename in place: F2 on the focused row, Explorer-style selection means
    // typing replaces the stem and keeps the extension.
    await row('notes').first().dblclick()
    await win.waitForSelector('text=todo.md', { timeout: 5000 })
    await row('todo.md').first().focus()
    await win.keyboard.press('F2')
    await win.keyboard.type('done')
    await win.keyboard.press('Enter')
    await win.waitForSelector('text=done.md', { timeout: 5000 })
    const AdmZip = (await import('adm-zip')).default
    ok(
      new AdmZip(zipPath).getEntries().some((e) => e.entryName === 'notes/done.md'),
      'the rename landed inside the zip itself'
    )

    // Delete: confirms first (permanent - a zip has no recycle bin), then the
    // member is gone from the listing AND the container. The breadcrumb's
    // root crumb goes back up first.
    await win.locator('[data-archive-crumbs] button:has-text("bundle.zip")').click()
    await win.waitForSelector('text=readme.txt', { timeout: 5000 })
    await row('readme.txt').first().focus()
    await win.keyboard.press('Delete')
    await win.waitForSelector('text=no Recycle Bin', { timeout: 5000 })
    await win.locator('button', { hasText: 'Delete' }).last().click()
    await win.waitForFunction(
      () => !/readme\.txt/.test(document.body.textContent ?? ''),
      null,
      { timeout: 5000 }
    )
    ok(
      !new AdmZip(zipPath).getEntries().some((e) => e.entryName === 'readme.txt'),
      'the delete landed inside the zip itself'
    )
    await win.screenshot({ path: join(SHOTS, 'archive.png') })
  } finally {
    await app.close()
  }
}

async function selectionScenario(fixtures) {
  console.log('explorer selection')
  // 2026-08-22: the tree keeps its quick-look single click; shift and ctrl
  // build a multi-selection WITHOUT opening anything.
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    await sleep(700)
    await win.click('[role="treeitem"]:has-text("notes.txt")')
    await sleep(500)
    ok(
      ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('notes.txt'),
      'a plain click still opens, quick-look style'
    )
    await win.click('[role="treeitem"]:has-text("sample.pdf")', { modifiers: ['Shift'] })
    await sleep(300)
    ok((await win.locator('aside [data-selected]').count()) >= 2, 'shift-click selects the range')
    ok(
      ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('notes.txt'),
      'without opening anything else'
    )
    await win.click('[role="treeitem"]:has-text("sample.pdf")', { modifiers: ['Control'] })
    await sleep(300)
    const after = await win.locator('aside [data-selected]').count()
    ok(after >= 1, `ctrl-click toggles one row back out (${after} left selected)`)
    ok(
      ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('notes.txt'),
      'and still opens nothing'
    )

    // A FOLDER selects on the first click and expands on the second
    // (2026-08-31). Files keep their quick-look single click, above.
    const codeRow = win.locator('[role="treeitem"]:has-text("code")').first()
    await codeRow.click()
    await sleep(400)
    ok(
      (await codeRow.getAttribute('aria-expanded')) === 'false',
      'the first click on a folder does not expand it'
    )
    ok((await codeRow.getAttribute('data-selected')) !== null, 'it selects it instead')
    await codeRow.click()
    await sleep(400)
    ok(
      (await codeRow.getAttribute('aria-expanded')) === 'true',
      'and the second click expands it'
    )

    // Ctrl+A takes every row the tree is SHOWING (2026-08-25)...
    const visible = await win.locator('aside [data-row]').count()
    await win.keyboard.press('Control+a')
    await sleep(200)
    ok(
      (await win.locator('aside [data-row][data-selected]').count()) === visible,
      `Ctrl+A marks every visible row (${visible})`
    )
    // ...and the search box keeps its own, as every typing surface does.
    await win.locator('input[placeholder="Search"]').click()
    await win.keyboard.type('abc')
    await win.keyboard.press('Control+a')
    await win.keyboard.type('z')
    ok(
      (await win.locator('input[placeholder="Search"]').inputValue()) === 'z',
      'and the search box keeps Ctrl+A for its own text'
    )
  } finally {
    await app.close()
  }
}

async function dragScenario(fixtures) {
  console.log('drag and drop')
  // #70: a row dragged onto a folder MOVES; a member dragged out of an archive
  // onto a sidebar folder EXTRACTS there. Both assert on the real filesystem.
  const box = join(fixtures, 'dragbox')
  rmSync(join(box, 'into', 'movable.txt'), { force: true })
  if (!existsSync(join(box, 'movable.txt'))) writeFileSync(join(box, 'movable.txt'), 'drag me')
  {
    const { app, win } = await launch(join(box, 'anchor.txt'))
    try {
      await win.waitForSelector('[role="treeitem"]:has-text("movable.txt")', { timeout: 10000 })
      await sleep(500)
      await win
        .locator('[role="treeitem"]:has-text("movable.txt")')
        .dragTo(win.locator('[role="treeitem"]:has-text("into")').first())
      await win.waitForFunction(
        () => !/movable\.txt/.test(document.querySelector('aside')?.textContent ?? ''),
        null,
        { timeout: 8000 }
      )
      ok(existsSync(join(box, 'into', 'movable.txt')), 'the file really moved into the folder')
      // THE DROP RING CLEARS (2026-09-03): a row's drop handler stops
      // propagation, and the window-level clear used to live in the bubble
      // phase, so the accent ring around the viewer stayed up until restart.
      await sleep(300)
      const ringLeft = await win.evaluate(
        () => !!document.querySelector('main .ring-2.ring-inset, [class*="ring-[var(--p-accent)]"]')
      )
      ok(!ringLeft, 'and the drop ring around the viewer is gone')
      // The DROPPED FILE is what is marked afterwards (2026-09-03, owner -
      // Explorer's way; narrows the 2026-08-31 folder-mark rule): where it
      // arrived is what you are now looking at. Its row lives inside the
      // destination folder, which may need expanding to see - the mark is on
      // the data-selected row carrying the file's name.
      const expandInto = () =>
        win.evaluate(() => {
          const el = [...document.querySelectorAll('aside [role="treeitem"]')].find((r) =>
            (r.textContent ?? '').includes('into')
          )
          // The CHEVRON, not the row: a row click would SELECT the folder and
          // replace the very mark this asserts on.
          const collapsed = el?.getAttribute('aria-expanded') === 'false'
          if (collapsed !== undefined && el)
            el.querySelector('span')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          return collapsed
        })
      const wasCollapsed = await expandInto()
      await sleep(600)
      const marked = await win.evaluate(
        () =>
          [...document.querySelectorAll('aside [data-selected]')].map((r) => r.textContent).join('|') ?? ''
      )
      ok(
        marked.includes('movable'),
        `the dropped file is the marked row after the drop (${marked})`
      )
      // Put the folder's state back the way the steps below expect it: their
      // own select-then-toggle click pair assumes a collapsed folder.
      if (wasCollapsed) {
        await expandInto()
        await sleep(400)
      }
      ok(!existsSync(join(box, 'movable.txt')), 'and left where it was')

      // Undo (2026-08-22) puts it back, and redo sends it again.
      await win.locator('aside').click({ position: { x: 20, y: 8 } })
      await win.keyboard.press('Control+z')
      await win.waitForFunction(() => /Undid/.test(document.body.textContent ?? ''), null, { timeout: 6000 })
      await sleep(900)
      ok(existsSync(join(box, 'movable.txt')), 'Ctrl+Z moved it back')
      ok(!existsSync(join(box, 'into', 'movable.txt')), 'and it left the folder again')
      await win.keyboard.press('Control+y')
      await sleep(1200)
      ok(existsSync(join(box, 'into', 'movable.txt')), 'Ctrl+Y sent it back in')

      // DROPPING ON A FILE means dropping beside it (2026-09-01). Only FOLDER
      // rows took a drop, so this fell through to the window - which opens
      // whatever it is handed, so dropping a FOLDER on a file re-rooted the
      // tab onto it instead of moving anything. The file rows target their
      // own folder now, and the tree's dead space targets the root.
      // The file is inside `into` at this point, so open it and drag back OUT -
      // which is the owner's own case: a thing from a subfolder, dropped on a
      // file sitting in the root.
      const intoRow = win.locator('[role="treeitem"]:has-text("into")').first()
      await intoRow.click()
      await sleep(250)
      await intoRow.click() // first click selects a folder, the second opens it
      await win.waitForSelector('[role="treeitem"]:has-text("movable.txt")', { timeout: 8000 })
      await sleep(400)
      await win
        .locator('[role="treeitem"]:has-text("movable.txt")')
        .dragTo(win.locator('[role="treeitem"]:has-text("anchor.txt")').first())
      await sleep(1400)
      ok(existsSync(join(box, 'movable.txt')), 'dropping on a FILE moves into that folder')
      ok(
        !/dragbox.into/i.test((await win.locator('[role="tab"]').first().getAttribute('title')) ?? ''),
        'and the tab did not re-root onto what was dragged'
      )
    } finally {
      await app.close()
    }
  }
  await sleep(900)
  // Out of the archive, onto a folder in the sidebar.
  const out = join(fixtures, 'zips', 'out')
  rmSync(join(out, 'carry.txt'), { force: true })
  {
    const { app, win } = await launch(join(fixtures, 'zips', 'dragzip.zip'))
    try {
      await win.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 })
      await sleep(600)
      await win
        .locator('[role="listbox"] [role="option"]', { hasText: 'carry.txt' })
        .first()
        .dragTo(win.locator('aside [role="treeitem"]:has-text("out")').first())
      await sleep(1800)
      ok(existsSync(join(out, 'carry.txt')), 'a member dragged out of the zip landed in the folder')
      // A FOLDER dragged onto the tab strip opens as a tab of its own.
      const tabsBefore = await win.locator('[role="tablist"] [role="tab"]').count()
      // Aimed at the EMPTY space after the +, which is where a drop is
      // naturally made and where the window-drag region used to swallow it.
      const strip = await win.locator('[role="tablist"]').boundingBox()
      await win
        .locator('aside [role="treeitem"]:has-text("out")')
        .first()
        .dragTo(win.locator('[role="tablist"]'), {
          targetPosition: { x: strip.width - 40, y: strip.height / 2 }
        })
      await sleep(1400)
      ok(
        (await win.locator('[role="tablist"] [role="tab"]').count()) === tabsBefore + 1,
        'a folder dropped on the tab strip opens a tab'
      )

      // Dropping one of Prism's OWN rows on the viewer opens it there, and the
      // text editor no longer steals the drag to walk its caret about.
      await win.locator('[role="tablist"] [role="tab"]').first().click()
      await sleep(500)
      const viewer = await win.locator('[data-pane="live"], body').first().boundingBox()
      await win
        .locator('aside [role="treeitem"]:has-text("dragzip.zip")')
        .first()
        .dragTo(win.locator('body'), {
          targetPosition: { x: viewer.width - 220, y: viewer.height / 2 }
        })
      await sleep(1200)
      ok(
        (await win.locator('[role="listbox"][aria-label*="dragzip.zip"]').count()) === 1,
        'a row dropped on the viewer opens it there'
      )
    } finally {
      await app.close()
    }
  }
  // This scenario runs two apps back to back; give the single-instance lock
  // the same breathing room the runner leaves between scenarios, or the next
  // launch forwards its file to a window that is already going away.
  await sleep(900)
}

async function unsupportedScenario(fixtures) {
  console.log('unsupported file')
  // Windows hands Prism anything whenever someone picks it out of "More apps",
  // which lists every installed application regardless of SupportedTypes. The
  // window must say so rather than sit empty. (.zip was the original specimen,
  // then .7z; both open for real now, so the specimen is an .exe.)
  const { app, win } = await launch(join(fixtures, 'misc', 'program.exe'))
  try {
    await win.waitForFunction(
      () => /can.t show EXE files/.test(document.body.textContent ?? ''),
      null,
      { timeout: 10000 }
    )
    const text = ((await win.textContent('body')) ?? '').replace(/\s+/g, ' ')
    ok(/can.t show EXE files/.test(text), 'the panel names the format')
    ok(/program\.exe/.test(text), 'the panel names the file')
    ok(/2\.0 KB/.test(text), 'the panel carries the size')
    // The file is not viewable, so nothing lists it: the panel is all there is.
    ok(
      (await win.locator('[role="treeitem"]:not([aria-expanded])').count()) === 0,
      'an unviewable file gets no tree row'
    )
    await win.screenshot({ path: join(SHOTS, 'unsupported.png') })
    ok(!win.isClosed(), 'window survives an unopenable file')
  } finally {
    await app.close()
  }
}

// Anything left over from a killed run still holds the profile open, and the
// wipe below then fails with EBUSY before a single scenario has run.
const stale = reapStrays()
if (stale) console.log(`(reaped ${stale} process(es) left over from a previous run)`)
rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
const fixtures = buildFixtures()

/**
 * One scenario at a time, each in its own try/catch (2026-08-28).
 *
 * They all used to share one, so the FIRST crash skipped every scenario after
 * it while reporting a single failure - a launch flake in the middle of the
 * run hid twenty scenarios' worth of coverage and read as "1 failure".
 *
 * `npm run e2e -- <name>` runs only the scenarios whose name contains <name>,
 * which is what makes iterating on one of them bearable.
 */
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const chosen = (name) => !only.length || only.some((o) => name.toLowerCase().includes(o.toLowerCase()))
const results = []

async function run(fn, gap = 900) {
  const name = fn.name.replace(/Scenario$/, '')
  if (!chosen(name)) return
  const before = failures
  const started = Date.now()
  try {
    await fn(fixtures)
  } catch (e) {
    failures += 1
    console.error(`scenario crashed (${name}):`, e)
  }
  const left = reapStrays()
  if (left) console.log(`  (reaped ${left} stray process(es) from ${name})`)
  results.push({ name, failed: failures > before, ms: Date.now() - started })
  await sleep(gap) // let the single-instance lock go
}

await seedProfile()
await run(mdScenario)
await run(pdfScenario)
await run(pdfZoomScenario)
await run(sortScenario)
await run(contextMenuScenario)
await run(editScenario)
await run(reloadScenario)
await run(tailScenario)
await run(hexScenario)
await run(codeScenario)
await run(treeNavScenario)
await run(unsavedScenario)
await run(playerScenario)
await run(dolbyScenario)
await run(formatsScenario)
await run(stillsAndSubsScenario)
await run(convertScenario)
await run(sevenZipScenario)
await run(documentScenario, 2000)
await run(synthAndRawScenario)
await run(tabsScenario)
await run(terminalScenario)
await run(archiveScenario)
await run(extractScenario)
await run(flatZipScenario)
await run(comicScenario)
await run(folderArgScenario)
await run(gearScenario)
await run(pauseScenario)
await run(volumeScenario)
await run(fullscreenBlackScenario)
await run(searchQueryScenario)
await run(videoMenuScenario)
await run(selectionScenario)
await run(dragScenario)
await run(iconSchemeScenario)
await run(comicIconScenario)
await run(treeVerbsScenario)
await run(deleteAgainScenario)
await run(arrowKeysScenario)
await run(chromeHideScenario)
await run(zoomFloorScenario)
await run(rowPasteScenario)
await run(deleteLastScenario)
await run(unsupportedScenario)

// A filter that matched nothing ran nothing, and "all e2e checks passed" over
// zero scenarios is the most confident lie a suite can tell (2026-08-28).
if (only.length && !results.length) {
  failures += 1
  console.error(`no scenario matched ${only.join(' ')}`)
}

const width = Math.max(...results.map((r) => r.name.length), 8)
for (const r of results)
  console.log(`  ${r.failed ? 'FAIL' : 'ok  '}  ${r.name.padEnd(width)}  ${(r.ms / 1000).toFixed(1)}s`)

console.log(failures ? `\n${failures} failure(s)` : '\nall e2e checks passed')
process.exit(failures ? 1 : 0)
