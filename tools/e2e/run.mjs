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
import { createHash } from 'node:crypto'
import electronPath from 'electron'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { BIG, buildBigFixtures, buildFixtures, OTHER_ROOT } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = process.env.PRISM_E2E_MAIN ?? join(ROOT, 'out', 'main', 'index.js')
const PROFILE_NAME = 'prism-e2e-profile'
const PROFILE = join(tmpdir(), PROFILE_NAME)
const SHOTS = join(ROOT, '.e2e', 'shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

function seedExplorerTab() {
  const directory = join(ROOT, '.e2e', 'fixtures')
  writeFileSync(join(PROFILE, 'tabs.json'), JSON.stringify({ active: 0, tabs: [{
    id: 'fixture-explorer', role: 'explorer', pinned: true, root: directory,
    browse: { path: directory, history: [{ path: directory, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } }], cursor: 0, surface: 'folder', preview: true },
    panes: [], open: [directory]
  }] }))
}

async function launchTestApp(options) {
  const app = await electron.launch(options)
  // Teardown must release the private engine before closing the debugging
  // connection. Kill fallback is restricted to this test process tree.
  app.close = async () => {
    const child = app.process()
    await app.evaluate(async () => { await globalThis.__prismIndexer?.dispose() }).catch(() => {})
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((done) => child.once('exit', done)),
        sleep(2000)
      ])
    }
    if (child.exitCode === null && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* exited meanwhile */ }
    }
    if (child.exitCode !== null) for (const stream of child.stdio) stream?.destroy()
  }
  return app
}
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
  // Seed before the first renderer loads, so the bundled index never scans
  // the developer's home while this disposable profile is being initialized.
  const preferences = join(PROFILE, 'window-preferences')
  const directory = join(ROOT, '.e2e', 'fixtures')
  mkdirSync(preferences, { recursive: true })
  for (const [key, value] of Object.entries({
    'prism.newtab.mode': 'folder',
    'prism.newtab.folder': directory
  })) {
    writeFileSync(join(preferences, createHash('sha256').update(key).digest('hex') + '.json'), JSON.stringify({ key, value }))
  }
  seedExplorerTab()
  const app = await launchTestApp({ args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e'] })
  const win = await app.firstWindow()
  await offscreen(app)
  await win.evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, { 'prism.onboarded': '1', 'prism.sidebar': '1' })
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

/**
 * Is there a real `claude` CLI on this machine? The terminal scenario starts one
 * to prove the PROCESS POLL finds an agent in a shell's tree. A CI runner has
 * none (#164), and waiting sixty seconds for a program that is not installed is
 * a failure of the wait, not of the terminal. Where it is missing that section
 * is skipped, loudly; the agent's TITLE path, which needs no CLI, is proved by
 * `agentTitle` everywhere.
 */
const HAS_CLAUDE = (() => {
  try {
    execFileSync('where.exe', ['claude'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
})()

/** Extra environment for the NEXT launches; a scenario sets it and clears it. */
let EXTRA_ENV = {}
/** Extra command-line switches for the NEXT launches, the same way (#168:
 *  `--preview-update` is a switch, and it has to be there at launch). */
let EXTRA_ARGS = []

async function launchOnce(file, keepTabs = false) {
  // Every scenario but the tab one expects a single-root world. The profile is
  // shared across scenarios (it is wiped once, at the start), so last
  // scenario's strip would restore into this one and change what the tree
  // counts. Forgetting it is the isolation; the tab scenario opts out, because
  // surviving a restart is the thing it is checking.
  if (!keepTabs) seedExplorerTab()
  const app = await launchTestApp({
    args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e', ...EXTRA_ARGS, file],
    env: { ...process.env, ...EXTRA_ENV }
  })
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

/**
 * A second window of the app's own Chromium standing in for the phone
 * (2026-09-06, #104). The harness ships playwright-core and no browser
 * binary, so the phone page is loaded into a plain sandboxed BrowserWindow
 * with no preload, which is what a phone's browser is to the server: a
 * remote page and a fetch. Parked like the main window (opacity 0, off the
 * desktop, no taskbar entry) rather than hidden, for the same reason: a
 * hidden window stops answering clicks. Playwright drives it over CDP.
 */
async function openPhoneWindow(app, url) {
  const appeared = app.waitForEvent('window', { timeout: 15000 })
  await app.evaluate(({ BrowserWindow }, target) => {
    const w = new BrowserWindow({
      width: 390,
      height: 844,
      show: false,
      focusable: false,
      skipTaskbar: true,
      // A page that asks for fullscreen must not take the DISPLAY with it
      // (2026-09-07): the phone scenario presses the player's own fullscreen
      // button, and a parked window granted it moves to 0,0 at the size of
      // the screen - invisible at opacity 0, and still an invisible sheet
      // over whatever the owner is doing, which is the very thing parking
      // exists to prevent. Blink enters fullscreen either way, which is what
      // the assertion is about: `document.fullscreenElement` is the page's
      // own state and the window is Electron's answer to it.
      fullscreenable: false,
      webPreferences: { sandbox: true }
    })
    w.setOpacity(0)
    w.setPosition(-4000, -4000)
    w.showInactive()
    void w.loadURL(target)
  }, url)
  const page = await appeared
  await page.waitForLoadState('domcontentloaded')
  return page
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
    await sleep(900)
    // BORDERLESS (2026-09-03): fullscreen is the window covering its display
    // with its resize borders dropped, never the OS flag - see the sandwich
    // scenario for the why. The main window is the one that is resizable
    // in the ordinary state; the shroud is a second BrowserWindow.
    const fsMeasure = () =>
      app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== '' || x.getBounds().width > 200) ?? BrowserWindow.getAllWindows()[0]
        const b = w.getBounds()
        const d = screen.getDisplayMatching(b).bounds
        return { covers: b.width >= d.width && b.height >= d.height, rs: w.isResizable() }
      })
    const fsIn = await fsMeasure()
    ok(fsIn.covers && !fsIn.rs, 'clicking fullscreen goes fullscreen')
    await win.keyboard.press('f')
    await sleep(900)
    const fsOut = await fsMeasure()
    ok(fsOut.rs, 'F leaves fullscreen again')

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
      await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:has-text("Settings")').isVisible().catch(() => false),
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
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:not(:has-text("Settings"))').first().click()
    await sleep(300)
    ok(
      await win.locator('.p-md h1').first().isVisible().catch(() => false),
      'flipping to the folder tab shows the document again'
    )
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:has-text("Settings")').click()
    await sleep(300)
    ok((await win.locator('[data-term-card]').count()) >= 6, 'and back to Settings, same page')
    // Close it like any tab.
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:has-text("Settings")').locator('..').locator('[aria-label^="Close"]').click()
    await sleep(300)
    ok(
      (await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:has-text("Settings")').count()) === 0,
      'the Settings tab closes like any other'
    )
  } finally {
    await app.close()
  }
}

/**
 * THE TERMINAL'S SETTINGS ARE prism-term-core's (#154). Prism Terminal runs the
 * same check against the same list, which is what keeps the two apps' terminal
 * settings the same settings: a row in one app and not the other turns one of
 * the two suites red.
 */
async function termOptionsScenario(fixtures) {
  console.log('terminal options')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    const src = readFileSync(join(process.cwd(), 'node_modules/prism-term-core/renderer/settings/options.ts'), 'utf8')
    // Prism's window material belongs to the app STYLE, so the one row the
    // list marks as window-acrylic-only (the opacity slider) is not shown here.
    const rows = [...src.matchAll(/\{\s*id: '([a-z-]+)'[^}]*\}/g)]
    const wanted = rows.filter((m) => !m[0].includes('onlyWhere')).map((m) => m[1]).sort()
    ok(wanted.length >= 8 && rows.length === wanted.length + 1, `the core lists the terminal options (${wanted.length} of ${rows.length} apply here)`)
    await win.click('[aria-label="Settings"]')
    await sleep(400)
    await win.click('button:has-text("Terminal")')
    await win.waitForSelector('[data-terminal-settings]', { timeout: 5000 })
    // The shell row appears once main has answered with the shells it found.
    await win.waitForSelector('[data-pref="term-shell"]', { timeout: 8000 }).catch(() => {})
    // COMMAND HELP (#175) KEEPS A LIST OF ITS OWN in the core (helpOptions.ts),
    // so that adding its row there could not turn this check red before Prism
    // had wired the popup. Now that it has, the page shows BOTH lists and
    // nothing else, and each is asserted against its own file.
    const helpSrc = readFileSync(join(process.cwd(), 'node_modules/prism-term-core/renderer/settings/helpOptions.ts'), 'utf8')
    const helpWanted = [...helpSrc.matchAll(/\{\s*id: '([a-z-]+)'[^}]*\}/g)].map((m) => m[1]).sort()
    ok(helpWanted.length >= 1 && helpWanted.includes('help-enabled'), `the core lists the command help options separately (${JSON.stringify(helpWanted)})`)
    const onPage = (await win.evaluate(() =>
      [...document.querySelectorAll('[data-terminal-settings] [data-pref]')].map((e) => e.getAttribute('data-pref'))
    )).sort()
    const shown = onPage.filter((id) => !helpWanted.includes(id))
    ok(JSON.stringify(shown) === JSON.stringify(wanted), `the Terminal page shows exactly that list (shown: ${JSON.stringify(shown)})`)
    ok(
      JSON.stringify(onPage.filter((id) => helpWanted.includes(id))) === JSON.stringify(helpWanted),
      `and the command help rows beside it (${JSON.stringify(helpWanted)})`
    )
    ok((await win.locator('[data-pref="term-opacity"]').count()) === 0, 'with no opacity slider: the style owns the glass')
    await win.screenshot({ path: join(SHOTS, 'terminal-settings.png') })
    // Untouched, the indicator is MINIMAL and its colours follow the accent.
    ok(
      (await win.evaluate(() => localStorage.getItem('prism.term.agentIndicator'))) === null &&
        (await win.locator('[data-pref="agent-indicator"] [aria-pressed="true"], [data-pref="agent-indicator"] [aria-checked="true"]').first().textContent().catch(() => '') ?? '').includes('Minimal'),
      'an untouched indicator reads Minimal'
    )
    // The close question is one rule and no setting, on every page.
    let closeRows = 0
    for (const name of ['General', 'Terminal']) {
      await win.click(`button:has-text("${name}")`)
      await sleep(250)
      closeRows += await win.locator('text=/Ask before closing/i').count()
    }
    ok(closeRows === 0, 'and the close question is not a setting any more')
  } finally {
    await app.close()
  }
}

/**
 * COMMAND HELP (#175; owner, 2026-09-20: "a pop up with copy icons for easy
 * copying. searchable, natural language"). The popup is prism-term-core's and
 * Prism Terminal proves the popup itself (its search, its keyboard, its
 * layout); this proves what is PRISM's: where it exists and how it is reached.
 *
 *  - Prism is a viewer first: with NO terminal showing, F1 does nothing, over
 *    a document and over Settings alike.
 *  - F1 is heard from INSIDE a focused shell (xterm has to yield it), and the
 *    terminal's own right-click menu has a row for it.
 *  - NOTHING IS TYPED INTO THE SHELL: the terminal's text is read before the
 *    popup is touched and again after every search, copy and Enter in it.
 *  - COPY IS EXACT: what lands on the clipboard is read back through
 *    Electron's clipboard in MAIN and compared character for character.
 *    Whatever the clipboard held is put back.
 *  - Closing it, by Escape, by its X or by Ctrl+`, hands the keyboard back to
 *    the shell; a chord that changes what is in front puts it away; a close
 *    question is never underneath it.
 *  - Setting off: the key is dead and the menu row is gone.
 *
 * Runner-safe: no `claude` CLI (a shell stands in for one through its title,
 * as in agentTitle), no path outside the fixtures, waits and never sleeps.
 * Screenshots go to .e2e/shots/help-*.png, in a dark style and a light one.
 */
async function helpPanelScenario(fixtures) {
  console.log('help panel')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const shot = (name) => win.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {})
  const panel = win.locator('[data-help-panel]')
  const opened = () => until(async () => (await panel.count()) === 1, 8000, 50)
  const closed = () => until(async () => (await panel.count()) === 0, 5000, 50)
  /** A wait for something NOT to happen has to end somewhere. */
  const staysShut = async () => !(await until(async () => (await panel.count()) === 1, 1500, 50))
  const firstId = () =>
    win.evaluate(() => document.querySelector('[data-help-list] [data-help-id]')?.getAttribute('data-help-id') ?? null)
  const focusIsSearch = () => win.evaluate(() => document.activeElement?.hasAttribute('data-help-search') === true)
  const focusIsShell = () => win.evaluate(() => !!document.activeElement?.closest('.xterm'))
  const termText = () => win.evaluate(() => document.querySelector('.xterm .xterm-rows')?.textContent ?? '')
  const atPrompt = () =>
    win.waitForFunction(
      () => /PS [^>]*>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()),
      null,
      { timeout: 45000 }
    )
  const clip = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const menuRow = () => win.locator('[role="menu"] [role="menuitem"]', { hasText: 'Command help' })
  const folderTab = () => win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:not(:has-text("Settings"))').first()

  // The clipboard is the owner's: what it held is put back at the end. Text
  // (with its html and rtf forms) and an image go back through Electron.
  // Copied FILES are a CF_HDROP, which Electron's clipboard can neither read
  // nor write, so they go through PowerShell both ways, as Prism's own "Copy
  // file" does. It used to say "cannot be put back" and clear them, and a run
  // on the owner's machine did exactly that to files he had just copied.
  const held = await app.evaluate(({ clipboard }) => {
    const img = clipboard.readImage()
    return {
      formats: clipboard.availableFormats(),
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: img.isEmpty() ? '' : img.toDataURL()
    }
  })
  const PS = ['-NoProfile', '-NonInteractive', '-STA', '-Command']
  let heldFiles = ''
  if (held.formats.some((f) => /FileName|uri-list/i.test(f))) {
    try {
      heldFiles = execFileSync(
        'powershell.exe',
        [...PS, '(Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }) -join "`n"'],
        { encoding: 'utf8', windowsHide: true, timeout: 20000 }
      ).trim()
    } catch {
      heldFiles = ''
    }
  }
  let styleBefore = null

  try {
    /* ----- a viewer first: no terminal, no help ----- */
    await win.waitForSelector('.p-md h1', { timeout: 15000 })
    await win.keyboard.press('F1')
    ok(await staysShut(), 'with NO terminal showing, F1 opens nothing: Prism is a viewer first')

    // The process poll's first answer is listened for, as in agentTitle: it
    // clears a titled session's presence when it lands, and the close question
    // at the end needs that presence to hold. The listener goes up BEFORE the
    // terminal is opened.
    await win.evaluate(() => {
      window.__helpAgentSaid = 0
      window.prism.onTermAgent(() => (window.__helpAgentSaid += 1))
    })
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await atPrompt()
    await win.locator('.xterm').click()
    await win.keyboard.type('echo help-$(40+2)-ready')
    await win.keyboard.press('Enter')
    ok(await until(async () => (await termText()).includes('help-42-ready'), 20000), 'a shell is showing')
    // The prompt has to be back before the text is taken as the baseline.
    await atPrompt()
    const termBefore = await termText()

    /* ----- F1, from inside a focused shell ----- */
    ok(await until(focusIsShell, 5000, 50), 'and it has the keyboard')
    await win.keyboard.press('F1')
    ok(await opened(), 'F1 opens the popup over a FOCUSED shell (xterm yields the key)')
    ok(await until(focusIsSearch, 4000, 50), 'and the search field has the focus')
    ok(
      (await win.locator('[data-help-shell="powershell"]').getAttribute('aria-pressed')) === 'true',
      'the chip is the language of the shell in front (PowerShell)'
    )
    const browse = await win.evaluate(() => ({
      headers: [...document.querySelectorAll('[data-help-category]')].length,
      entries: document.querySelectorAll('[data-help-id]').length
    }))
    ok(browse.headers >= 2 && browse.entries >= 20, `with no question it browses by category (${browse.headers} headings, ${browse.entries} entries drawn)`)
    await shot('help-browse-dark')

    await win.keyboard.type('how do I find big files')
    ok(
      await until(async () => (await firstId()) === 'ps-biggest-files', 6000, 50),
      `a plain question finds the PowerShell answer first (${await firstId()})`
    )
    await shot('help-results-dark')

    /* ----- it is laid out in this app too ----- */
    const look = await win.evaluate(() => {
      const el = document.querySelector('[data-help-panel]')
      const code = document.querySelector('[data-help-id="ps-biggest-files"] [data-help-command]')
      void code
      const copy = document.querySelector('[data-help-copy="ps-biggest-files#0"]').getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const alpha = (c) => Number((c.match(/[\d.]+/g) ?? [])[3] ?? 1)
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        inside: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
        alpha: alpha(getComputedStyle(el).backgroundColor),
        // Tailwind generates nothing for a class it never saw: index.css names
        // the core package as a source, and these are what that buys.
        // The core is a TABLE since 2026-09-20 (PrismTerminal #34), so the
        // proof that Tailwind generated its classes moved off the old command
        // box onto the row: `h-[34px]` and `px-4` are the core's own.
        rowH: Math.round(document.querySelector('[data-help-row]').getBoundingClientRect().height),
        rowPad: parseFloat(getComputedStyle(document.querySelector('[data-help-row]')).paddingLeft),
        copyW: Math.round(copy.width),
        copyH: Math.round(copy.height)
      }
    })
    ok(look.w >= 480 && look.w <= 780 && look.h >= 320, `the popup is a popup-sized box (${look.w}x${look.h})`)
    ok(look.inside, 'wholly inside the window')
    ok(look.alpha === 1, `on an opaque surface (alpha ${look.alpha})`)
    ok(
      look.rowH >= 28 && look.rowPad >= 12 && look.copyW >= 26 && look.copyH >= 26,
      `the core's classes are styled here (row ${look.rowH}px tall, ${look.rowPad}px padding, copy button ${look.copyW}x${look.copyH})`
    )

    /* ----- copy ----- */
    const want = await win.locator('[data-help-id="ps-biggest-files"][data-help-variant="0"] [data-help-command]').textContent()
    await win.locator('[data-help-copy="ps-biggest-files#0"]').click()
    ok(
      await until(async () => (await win.locator('[data-help-copy="ps-biggest-files#0"]').getAttribute('title')) === 'Copied', 4000, 25),
      'the copy button answers in place, in the button itself'
    )
    ok(
      !!want && /Sort-Object/.test(want) && (await until(async () => (await clip()) === want, 4000, 50)),
      `the clipboard holds the EXACT command ("${await clip()}")`
    )
    // Enter copies the highlighted entry, from the search field.
    await win.locator('[data-help-search]').focus()
    const markedAt = () => win.evaluate(() => Number(document.querySelector('[data-help-active]')?.getAttribute('data-help-index') ?? -1))
    const markedBefore = await markedAt()
    await win.keyboard.press('ArrowDown')
    const to = await until(async () => {
      const n = await markedAt()
      return n >= 0 && n !== markedBefore ? n : null
    }, 4000, 50)
    ok(to === markedBefore + 1 || (markedBefore === -1 && to === 0), `Down moves the mark one row (${markedBefore} -> ${to})`)
    const wantSecond = await win.locator(`[data-help-index="${to}"] [data-help-command]`).textContent()
    await win.keyboard.press('Enter')
    ok(!!wantSecond && (await until(async () => (await clip()) === wantSecond, 4000, 50)), "Enter copies the marked row's command")

    /* ----- nothing was typed into the shell ----- */
    ok((await termText()) === termBefore, 'the terminal is EXACTLY as it was: nothing was typed or run')
    await win.keyboard.press('Escape')
    ok(await closed(), 'Escape closes it')
    ok(await until(focusIsShell, 5000, 50), 'and the keyboard is back in the shell, with no click')
    await win.keyboard.type('echo landed-$(1+1)')
    await win.keyboard.press('Enter')
    ok(await until(async () => (await termText()).includes('landed-2'), 20000), 'where the next keystroke lands')
    await atPrompt()

    /* ----- what comes to the front puts it away ----- */
    await win.keyboard.press('F1')
    ok(await opened(), 'the popup is up again')
    await win.keyboard.press('Control+Shift+f')
    ok(await until(async () => (await win.locator('[data-term-find]').count()) === 1, 5000, 50), 'Ctrl+Shift+F opens find over the popup')
    ok(await closed(), 'and the popup leaves, so the find bar is never typed into from underneath it')
    await win.keyboard.press('Escape')
    ok(await until(async () => (await win.locator('[data-term-find]').count()) === 0, 5000, 50), 'Escape closes find')
    await win.locator('.xterm').click()
    await win.keyboard.press('F1')
    ok(await opened(), 'up once more')
    await win.keyboard.press('Control+`')
    ok(await closed(), 'Ctrl+` over the popup puts it away')
    ok((await win.locator('.xterm').count()) === 1 && (await until(focusIsShell, 5000, 50)), 'and the terminal stays, with the keyboard')

    /* ----- the terminal's own menu ----- */
    await win.locator('[data-term-panel]').click({ button: 'right', position: { x: 200, y: 120 } })
    ok(await until(async () => (await menuRow().count()) === 1, 5000, 50), 'the right-click menu has a Command help row')
    await menuRow().click()
    ok(await opened(), 'which opens it')
    ok(await until(focusIsSearch, 4000, 50), 'with the focus in its search field')
    await win.locator('[data-help-close]').click()
    ok(await closed(), 'and its own X closes it')
    ok(await until(focusIsShell, 5000, 50), 'handing the keyboard back to the shell, though it was opened from a menu')

    /* ----- over a SPLIT, its keys are its own ----- */
    // A click on a copy button, which is what the popup is for, leaves the
    // focus on that button and not in the search field. Both key listeners are
    // on window in the capture phase, so the popup's stopPropagation does not
    // silence App's, and App shielded its chords only while a TEXT FIELD had the
    // keyboard: from a copy button Ctrl+W closed the tab under the popup (this
    // check failed on it before App learned that the popup is one). Driven in a
    // split, the document beside the shell, because that is where App still
    // reads the vertical keys and there is a document to lose.
    await win.locator('[role="treeitem"]:has-text("README.md")').click()
    await until(async () => (await win.locator('.xterm').count()) === 0, 8000, 50)
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open in split view")').click()
    const readmeUp = () => win.locator('.p-md h1').first().isVisible().catch(() => false)
    ok(
      await until(async () => (await win.locator('.xterm').count()) === 1 && (await readmeUp()), 15000, 50),
      'a split: the document AND the terminal'
    )
    await win.locator('.xterm').click()
    await until(focusIsShell, 5000, 50)
    await win.keyboard.press('F1')
    ok(await opened(), 'F1 opens the popup over a split terminal too')
    await win.locator('[data-help-list] [data-help-copy]').first().click()
    ok(
      await until(() => win.evaluate(() => !!document.activeElement?.hasAttribute('data-help-copy')), 4000, 50),
      'a click on a copy button leaves the focus on that button'
    )
    const activeIndex = () =>
      win.evaluate(() => Number(document.querySelector('[data-help-active]')?.getAttribute('data-help-index') ?? -1))
    const from = await activeIndex()
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('ArrowDown')
    ok(await until(async () => (await activeIndex()) === from + 2, 4000, 50), `Down moves the popup's highlight from there (${from} to ${await activeIndex()})`)
    // Opening the next file is an IPC round trip, so this is a bounded wait for
    // the document to LEAVE, which it must not.
    ok(!(await until(async () => !(await readmeUp()), 1500, 50)), 'and pages NOTHING behind it: the document is still the README')
    const tabsInSplit = await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()
    await win.keyboard.press('Control+w')
    ok(
      (await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === tabsInSplit && (await panel.count()) === 1,
      'Ctrl+W from a copy button reaches no tab either, the same as from the search field'
    )
    await win.keyboard.press('Escape')
    ok(await closed(), 'Escape closes it from a button')
    ok(await until(focusIsShell, 5000, 50), 'and the split shell has the keyboard back')
    // Back to the full terminal the rest of this scenario is written against.
    await win.locator('[aria-label="Remove the file from the split"]').click()
    await until(async () => (await win.locator('.xterm').count()) === 1 && !(await readmeUp()), 8000, 50)
    await win.locator('.xterm').click()

    /* ----- a light style, looked at ----- */
    styleBefore = await switchStyle(win, 'paper', 'light')
    await until(() => win.evaluate(() => document.documentElement.dataset.mode === 'light'), 6000, 50)
    await win.keyboard.press('F1')
    ok(await opened(), 'it opens in a light style')
    await shot('help-browse-light')
    await win.keyboard.type('delete a folder')
    ok(await until(async () => (await firstId()) === 'ps-delete-folder', 6000, 50), `"delete a folder" finds it (${await firstId()})`)
    // The warning is a MARK on the row since the core became a table: one row
    // per command, so every variant of a destructive entry carries it. The
    // sentence is still there, for the pointer and for a screen reader.
    const dangerMark = win.locator('[data-help-id="ps-delete-folder"][data-help-variant="0"] [data-help-danger]')
    const danger = ((await dangerMark.textContent()) ?? '').trim()
    ok(/^Careful\./.test(danger), 'and it carries its warning')
    ok((await dangerMark.locator('svg').count()) === 1, 'drawn as a mark, not a paragraph')
    await win.locator('[data-help-copy="ps-delete-folder#0"]').click()
    await until(async () => (await win.locator('[data-help-copy="ps-delete-folder#0"]').getAttribute('title')) === 'Copied', 4000, 25)
    await shot('help-results-light')
    const ink = await win.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
          const s = Number(v) / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const el = document.querySelector('[data-help-panel]')
      const task = document.querySelector('[data-help-id="ps-delete-folder"] [data-help-task]')
      return ratio(lum(getComputedStyle(task).color), lum(getComputedStyle(el).backgroundColor))
    })
    ok(ink >= 4.5, `on a light style the text still reads (${ink.toFixed(1)}:1)`)
    await win.keyboard.press('Escape')
    ok(await closed(), 'Escape closes it there too')
    await switchStyle(win, styleBefore[0], styleBefore[1])
    styleBefore = null

    /* ----- off means off ----- */
    await win.click('[aria-label="Settings"]')
    await win.click('button:has-text("Terminal")')
    await win.waitForSelector('[data-terminal-settings] [data-pref="help-enabled"]', { timeout: 8000 })
    await win.keyboard.press('F1')
    ok(await staysShut(), 'over Settings there is no terminal showing, so F1 opens nothing')
    const sw = win.locator('[data-pref="help-enabled"] [role="switch"]')
    ok((await sw.getAttribute('aria-checked')) === 'true', 'Settings > Terminal has the Command help switch, on by default')
    ok(
      /F1 while a terminal is showing/.test((await win.locator('[data-pref="help-enabled"]').textContent()) ?? ''),
      "and the row says what this app's way in is"
    )
    await sw.click()
    ok(await until(async () => (await sw.getAttribute('aria-checked')) === 'false', 4000, 50), 'it switches off')
    await folderTab().click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await win.locator('.xterm').click()
    await win.keyboard.press('F1')
    ok(await staysShut(), 'switched off, F1 opens nothing: the key is the shell\'s again')
    await win.locator('[data-term-panel]').click({ button: 'right', position: { x: 200, y: 120 } })
    await until(async () => (await win.locator('[role="menu"] [role="menuitem"]').count()) > 0, 5000, 50)
    ok((await menuRow().count()) === 0, 'nor does the menu offer it')
    await win.keyboard.press('Escape')
    await until(async () => (await win.locator('[role="menu"]').count()) === 0, 4000, 50)
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:has-text("Settings")').click()
    await win.waitForSelector('[data-pref="help-enabled"]', { timeout: 8000 })
    await sw.click()
    ok(await until(async () => (await sw.getAttribute('aria-checked')) === 'true', 4000, 50), 'switched back on')
    await folderTab().click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await win.locator('.xterm').click()
    await win.keyboard.press('F1')
    ok(await opened(), 'and F1 opens it again')
    await win.keyboard.press('Escape')
    await closed()

    /* ----- one question at a time ----- */
    // A shell stands in for a WORKING Claude through its title (agentTitle's
    // fixture), so closing the window asks. No CLI is involved.
    ok(
      await waitUntil(() => win.evaluate(() => window.__helpAgentSaid > 0), 45000),
      'the process poll has had its first look at the shell'
    )
    await until(focusIsShell, 5000, 50)
    // Whatever F1 did in the shell while the setting was off is cleared first.
    await win.keyboard.press('Escape')
    // Idle first: a spinner BEFORE any idle title is an agent still starting,
    // which is present and not working.
    await win.keyboard.type('$Host.UI.RawUI.WindowTitle = "$([char]0x2733) Claude Code"')
    await win.keyboard.press('Enter')
    await win.waitForSelector('[data-agent-present]', { timeout: 10000 })
    await win.keyboard.type('$Host.UI.RawUI.WindowTitle = "$([char]0x25D0) Claude Code"')
    await win.keyboard.press('Enter')
    await win.waitForSelector('[data-agent-state="working"]', { timeout: 10000 })
    await win.keyboard.press('F1')
    ok(await opened(), 'the popup is up over a tab whose agent is working')
    // Unlike Prism Terminal, Prism shields its tab chords while a text field
    // has the keyboard (the search box, a rename), and the popup's search field
    // is one: Ctrl+W there closes nothing, which is the safer of the two.
    const tabsBefore = await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()
    await win.keyboard.press('Control+w')
    ok(
      (await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === tabsBefore && (await panel.count()) === 1,
      'Ctrl+W in its search field reaches no tab'
    )
    // Closing the WINDOW is the question that can arrive from behind it
    // (Alt+F4, the taskbar): main asks the page, whatever has the focus.
    await win.evaluate(() => window.prism.close())
    const question = win.locator('[role="dialog"]:not([data-help-panel])')
    ok(await until(async () => (await question.count()) === 1, 5000, 50), 'closing the window over it raises the close question')
    ok(await closed(), 'and the popup is put away, so the question is never underneath it')
    ok(
      await until(() => win.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:not([data-help-panel])')), 4000, 50),
      'the focus is on the question, where it can be seen'
    )
    await win.keyboard.press('F1')
    ok(await staysShut(), 'and F1 does not open it over a question')
    await question.locator('button:has-text("Cancel")').click()
    ok(await until(async () => (await question.count()) === 0, 5000, 50), 'Cancel keeps the tab')
    ok((await win.locator('.xterm').count()) === 1, 'and its terminal')
  } finally {
    if (styleBefore) await switchStyle(win, styleBefore[0], styleBefore[1]).catch(() => {})
    // The profile is shared with every scenario after this one.
    await win.evaluate(() => localStorage.removeItem('prism.help.enabled')).catch(() => {})
    await app
      .evaluate(({ clipboard, nativeImage }, was) => {
        const data = {}
        if (was.text) data.text = was.text
        if (was.html) data.html = was.html
        if (was.rtf) data.rtf = was.rtf
        if (was.image) data.image = nativeImage.createFromDataURL(was.image)
        if (Object.keys(data).length) clipboard.write(data)
        else clipboard.clear()
      }, held)
      .catch(() => {})
    if (heldFiles) {
      // The list rides in the environment, so no path is ever quoted into a
      // command line. A file deleted meanwhile is left out: Set-Clipboard
      // refuses the whole list over one missing path.
      try {
        execFileSync(
          'powershell.exe',
          [...PS, '$p = @($env:PRISM_E2E_CLIP -split "`n" | Where-Object { Test-Path -LiteralPath $_ }); if ($p.Count) { Set-Clipboard -LiteralPath $p }'],
          { env: { ...process.env, PRISM_E2E_CLIP: heldFiles }, windowsHide: true, timeout: 20000 }
        )
      } catch {
        console.log('  (the clipboard held copied FILES and they could not be put back; it is empty now)')
      }
    } else if (held.formats.some((f) => /FileName|uri-list/i.test(f)))
      console.log('  (the clipboard held copied FILES that could not be read, so they are not put back; it is empty now)')
    await app.close()
  }
}

/* ---------- dictation (#162): the core's feature, proved in THIS app ---------- */

const E2E_CACHE = join(ROOT, '.e2e', 'cache')
const JFK = {
  url: 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/b0a11594aec50892a02cd8d129eee2dfe93a8bb8/samples/jfk.wav',
  sha256: '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e'
}
const CATALOG = join(ROOT, 'node_modules/prism-term-core/shared/dictationCatalog.ts')
const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
async function cachedDownload(name, url, sha256) {
  mkdirSync(E2E_CACHE, { recursive: true })
  const file = join(E2E_CACHE, name)
  if (existsSync(file) && sha256Of(file) === sha256) return file
  console.log(`  (fetching ${name} into .e2e/cache, once)`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: download failed (${res.status})`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  if (sha256Of(file) !== sha256) throw new Error(`${name}: SHA-256 mismatch`)
  return file
}
/** One catalog entry, read out of the core's own file: the e2e fetches exactly
 *  what the app would. */
function catalogItem(id) {
  const src = readFileSync(CATALOG, 'utf8')
  const commit = src.match(/const MODELS_COMMIT = '([0-9a-f]{40})'/)?.[1]
  const block = src.slice(src.indexOf(`id: '${id}'`))
  const file = block.match(/url:\s*model\('([^']+)'\)/)?.[1]
  return {
    url: file ? `https://huggingface.co/ggerganov/whisper.cpp/resolve/${commit}/${file}` : null,
    bytes: Number(block.match(/bytes:\s*(\d+)/)[1]),
    sha256: block.match(/sha256:\s*\n?\s*'([0-9a-f]{64})'/)[1]
  }
}
/** Speech servers started out of THIS checkout's engine folder, and no others:
 *  the owner's own dictation tool runs a whisper-server of its own. */
function ourSpeechServers() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='whisper-server.exe'" | Where-Object { $_.ExecutablePath -like '*\\vendor\\whisper\\*' } | Measure-Object).Count`],
      { encoding: 'utf8', windowsHide: true }
    )
    return Number(out.trim()) || 0
  } catch {
    return -1
  }
}
const waitUntil = async (fn, ms = 20000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v || Date.now() > end) return v
    await sleep(150)
  }
}

/**
 * DICTATION, REALLY. A fake microphone plays a known sentence, the real bundled
 * engine hears it with the Tiny model, and the words must arrive on the prompt
 * line of Prism's terminal with no Enter. And, because this window is a media
 * viewer first: with NO terminal showing, the key must do nothing at all.
 */
async function dictationScenario(fixtures) {
  console.log('dictation')
  const tiny = catalogItem('tiny')
  const model = await cachedDownload('ggml-tiny.bin', tiny.url, tiny.sha256)
  const clip = await cachedDownload('jfk.wav', JFK.url, JFK.sha256)
  const root = join(tmpdir(), `${PROFILE_NAME}-dictation`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'models'), { recursive: true })
  copyFileSync(model, join(root, 'models', 'tiny.bin'))
  const engine = join(ROOT, 'vendor', 'whisper')
  ok(existsSync(join(engine, 'whisper-server.exe')) && existsSync(join(engine, 'vcomp140.dll')), 'the speech engine and its C++ runtime were fetched into vendor/whisper')
  EXTRA_ENV = { PRISM_E2E_MIC: clip, PRISM_DICTATION_ROOT: root, PRISM_WHISPER_DIR: engine, PRISM_E2E_NVIDIA: '0' }
  let app
  try {
    const started = await launch(join(fixtures, 'README.md'))
    app = started.app
    const win = started.win
    const pill = () => win.locator('[data-dictation-pill]')
    await win.evaluate(() => {
      localStorage.setItem('prism.dictation.enabled', '1')
      localStorage.setItem('prism.dictation.model', 'tiny')
      localStorage.setItem('prism.dictation.sounds', '0')
    })
    // The page's own switch arms it (a bare localStorage write notifies nobody).
    await win.click('[aria-label="Settings"]')
    await sleep(400)
    await win.click('button:has-text("Dictation")')
    await win.waitForSelector('[data-dictation-settings]', { timeout: 8000 })
    ok((await win.locator('[data-pref="dictation-enabled"] [role="switch"]').getAttribute('aria-checked')) === 'true', 'Settings has a Dictation page of its own, and it reads the setting')
    await win.locator('[data-pref="dictation-enabled"] [role="switch"]').click()
    await win.locator('[data-pref="dictation-enabled"] [role="switch"]').click()
    await win.screenshot({ path: join(SHOTS, 'dictation-settings.png') })
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:not(:has-text("Settings"))').first().click()
    await sleep(400)

    // A MEDIA VIEWER FIRST: no terminal showing, so Right Alt is nobody's key.
    await win.keyboard.down('AltRight')
    await sleep(700)
    ok((await pill().count()) === 0, 'with no terminal showing, holding Right Alt does nothing')
    await win.keyboard.up('AltRight')
    ok(ourSpeechServers() === 0, 'and no speech server was started')

    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await win.waitForFunction(() => /PS [^>]*>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()), null, { timeout: 45000 })
    await win.locator('.xterm').click()
    const text = () => win.evaluate(() => document.querySelector('.xterm .xterm-rows')?.textContent ?? '')
    const rowsTop = () => win.evaluate(() => Math.round(document.querySelector('.xterm .xterm-rows')?.getBoundingClientRect().top ?? -1))
    const topBefore = await rowsTop()

    await win.keyboard.down('AltRight')
    ok(await waitUntil(async () => (await pill().getAttribute('data-dictation-pill').catch(() => null)) === 'listening', 8000), 'over a terminal, holding Right Alt opens the pill: Listening')
    ok((await win.locator('[data-dictation-mark]').count()) === 1, 'and the tab wears the mic mark')
    ok((await rowsTop()) === topBefore, 'the pill does not move the terminal')
    const live = await waitUntil(async () => ((await win.locator('[data-dictation-live]').textContent().catch(() => '')) ?? '').trim(), 15000)
    ok(!!live, `live text appears while still listening ("${live}")`)
    await sleep(4000)
    await win.screenshot({ path: join(SHOTS, 'dictation-listening.png') })
    await sleep(5000)
    const before = await text()
    await win.keyboard.up('AltRight')
    const heard = await waitUntil(async () => /ask not what your country/i.test((await text()).replace(/\s+/g, ' ')), 30000)
    ok(heard, 'the spoken sentence arrives on the prompt line')
    ok(await waitUntil(async () => (await pill().count()) === 0, 5000), 'and the pill goes away')
    ok(((await text()).match(/PS [^>]*>/g) ?? []).length === (before.match(/PS [^>]*>/g) ?? []).length, 'NO ENTER was sent: there is no new prompt')
    ok(ourSpeechServers() === 1, 'one speech server is resident while dictation is on')

    // Hiding the terminal mid-way is "not showing" again.
    await win.keyboard.press('Escape')
    await win.keyboard.press('Control+`')
    await sleep(500)
    await win.keyboard.press('Control+`')
    await sleep(500)
    if ((await win.locator('.xterm').count()) > 0) await win.keyboard.press('Control+`')
    await sleep(500)
    await win.keyboard.down('AltRight')
    await sleep(700)
    ok((await pill().count()) === 0, 'with the terminal hidden again, the key does nothing')
    await win.keyboard.up('AltRight')
  } finally {
    EXTRA_ENV = {}
    await app?.close()
  }
  ok(await waitUntil(() => ourSpeechServers() === 0, 8000), 'and no speech server outlives the app')
}

/** THE DICTATION PAGE IS THE CORE'S (#162): the same option list Prism Terminal
 *  shows, and the model manager in the states a user lives in. */
async function dictationPageScenario(fixtures) {
  console.log('dictation page')
  const root = join(tmpdir(), `${PROFILE_NAME}-dictation-page`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'models'), { recursive: true })
  const base = join(root, 'models', 'base.bin')
  writeFileSync(base, '')
  truncateSync(base, catalogItem('base').bytes)
  const gpu = catalogItem('gpu-pack')
  const pack = join(root, 'engines', `gpu-pack-${gpu.sha256.slice(0, 12)}`)
  mkdirSync(join(pack, 'Release'), { recursive: true })
  writeFileSync(join(pack, 'Release', 'whisper-server.exe'), '')
  writeFileSync(join(pack, 'prism-installed.json'), JSON.stringify({ id: 'gpu-pack', bytes: gpu.bytes, sha256: gpu.sha256 }))
  EXTRA_ENV = { PRISM_DICTATION_ROOT: root, PRISM_E2E_NVIDIA: '1' }
  let app
  try {
    const started = await launch(join(fixtures, 'README.md'))
    app = started.app
    const win = started.win
    await win.evaluate(() => localStorage.setItem('prism.dictation.model', 'base'))
    await win.click('[aria-label="Settings"]')
    await sleep(400)
    await win.click('button:has-text("Dictation")')
    await win.waitForSelector('[data-dictation-item="gpu-pack"][data-state="installed"]', { timeout: 8000 })
    const src = readFileSync(join(ROOT, 'node_modules/prism-term-core/renderer/settings/dictationOptions.ts'), 'utf8')
    const wanted = [...src.matchAll(/\{\s*id: '([a-z-]+)'/g)].map((m) => m[1]).sort()
    const shown = (await win.evaluate(() => [...document.querySelectorAll('[data-dictation-settings] [data-pref], [data-dictation-settings][data-pref]')].map((e) => e.getAttribute('data-pref')))).sort()
    ok(wanted.length >= 9 && JSON.stringify(shown) === JSON.stringify(wanted), `the Dictation page shows exactly the core's option list (${JSON.stringify(shown)})`)
    const names = await win.evaluate(() => [...document.querySelectorAll('[data-dictation-item] [data-item-name]')].map((e) => e.textContent.trim()))
    ok(names.slice(0, 4).every((n) => n.startsWith('Whisper ')), `models carry their full names (${JSON.stringify(names)})`)
    const marks = await win.evaluate(() => [...document.querySelectorAll('[data-dictation-item] [data-vendor]')].map((e) => e.getAttribute('data-vendor')))
    ok(marks.filter((m) => m === 'openai').length === 4 && marks.filter((m) => m === 'nvidia').length === 1, 'every row leads with its vendor\'s mark')
    const row = await win.evaluate(() => {
      const r = document.querySelector('[data-dictation-item="base"]')
      return { pad: parseFloat(getComputedStyle(r).paddingTop), w: Math.round(r.getBoundingClientRect().width) }
    })
    ok(row.pad >= 8 && row.w > 400, `the model manager is laid out, Tailwind saw the core (${JSON.stringify(row)})`)
    ok(((await win.locator('[data-dictation-item="base"] [data-item-badge]').textContent()) ?? '').trim() === 'Active', 'the model in use says Active')
    ok(((await win.locator('[data-dictation-item="gpu-pack"] [data-gpu-toggle]').textContent()) ?? '').trim() === 'Disable', 'the GPU engine, installed, offers Disable')
    await win.screenshot({ path: join(SHOTS, 'dictation-models.png') })
    await win.locator('[data-dictation-item="gpu-pack"] [data-gpu-toggle]').click()
    ok(await waitUntil(async () => !existsSync(pack), 8000), 'and Disable takes it off the disk')
  } finally {
    EXTRA_ENV = {}
    await app?.close()
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
        (await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 1,
      'Ctrl+W pops the pinned pane first; the tab stays'
    )

    // Open in new tab, from the same menu.
    await notesRow.click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open in new tab")').click()
    await sleep(700)
    ok(
      (await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 2,
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
    // The star clears a beat after the text lands; wait for it rather than
    // reading it on the same tick (it flaked once under a full-suite load).
    const clean = await win
      .waitForFunction(() => document.querySelectorAll('[aria-label="Unsaved changes"]').length === 0, null, { timeout: 5000 })
      .then(() => true, () => false)
    ok(clean, 'and the file is clean again afterwards')
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

    // THE ZIP KEEPS ITS COLOUR with no scheme switched on at all, and since
    // 2026-09-20 that colour is the STYLE'S: --p-tree-zip, which IS the folder
    // token (owner: "just like folders, they should follow the same setting").
    // Read as the token rather than a hex, because the point is that it moves
    // with the style; the unit tests measure what the token resolves to.
    // bundle.zip is
    // the open row, so it is selected and must be the fallback; the others are
    // not, and must be coloured.
    const open = await icon('bundle.zip')
    ok(open !== null, 'the tree draws an icon for bundle.zip')
    ok(open.selected, 'and it is the selected row')
    ok(!open.masked, 'a SELECTED zip falls back to monochrome')

    const zip = await icon('wrapped.zip')
    ok(zip !== null && zip.masked, 'an unselected zip is coloured with no scheme on')
    ok(zip.page === 'var(--p-tree-zip)', `and takes the style's own container colour (${zip.page})`)
    const sameAsFolders = await win.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return {
        zip: cs.getPropertyValue('--p-tree-zip').trim(),
        folder: cs.getPropertyValue('--p-tree-folder').trim(),
        ink: cs.getPropertyValue('--p-tree-zip-ink').trim()
      }
    })
    ok(sameAsFolders.zip === sameAsFolders.folder && !!sameAsFolders.zip, `which is the FOLDER colour, the same setting (${sameAsFolders.zip})`)
    ok(/^#[0-9a-f]{6}$/i.test(sameAsFolders.ink), `with a measured ink for the seam on it (${sameAsFolders.ink})`)
    ok(zip.band === '#000000', `on a black band (${zip.band})`)
    ok(zip.label === 'ZIP', `carrying its own extension (${zip.label})`)

    // AND NOTHING ELSE IS. A 7z is the archive KIND but not the zip identity...
    // it is, in fact, the same identity, so the honest neighbour check is a
    // file that is not an archive at all.
    const other = await icon('read-only.7z')
    ok(other !== null && other.masked, 'a .7z is an archive too, so it is coloured')

    // THE DISC (owner, 2026-09-03, round 33): a .iso is an archive by kind and
    // keeps the container in Explorer, but the tree draws a DISC - a circle,
    // which no other shape in the set is - in the archive's colour, with ISO
    // on its band.
    const disc = await icon('disc.iso')
    ok(disc !== null && disc.masked, 'a .iso is coloured like the other archives')
    ok(disc.page === 'var(--p-tree-zip)' && disc.label === 'ISO', `in the same container colour with ISO on the band (${disc?.page}, ${disc?.label})`)
    const round = await win.evaluate(() => {
      const row = [...document.querySelectorAll('[role="treeitem"]')].find((e) =>
        (e.getAttribute('data-row') ?? '').toLowerCase().endsWith('disc.iso')
      )
      const d = row?.querySelector('svg[viewBox="0 0 24 24"] path')?.getAttribute('d') ?? ''
      return /A[\d. ]+/.test(d)
    })
    ok(round, 'and its silhouette is a circle, not a page or a container')
    // The coloured disc must be BLUE with a HOLE (owner, 2026-09-03: the first
    // cut came out black): the bleed the band colour paints last is only the
    // band's strip, never the whole box, and the body carries the hole as a
    // second subpath so the mask has a hole in it.
    const discLayers = await win.evaluate(() => {
      const row = [...document.querySelectorAll('[role="treeitem"]')].find((e) =>
        (e.getAttribute('data-row') ?? '').toLowerCase().endsWith('disc.iso')
      )
      const svg = row?.querySelector('svg[viewBox="0 0 24 24"]')
      const body = svg?.querySelector('mask path')?.getAttribute('d') ?? ''
      const g = svg?.querySelector('g[mask]')
      const last = g ? [...g.querySelectorAll('path')].pop() : null
      const bleed = last?.getAttribute('d') ?? ''
      const top = parseFloat(/M[-\d.]+ ([-\d.]+)/.exec(bleed)?.[1] ?? '0')
      return { subpaths: (body.match(/M/g) ?? []).length, bleedTop: top }
    })
    ok(discLayers.subpaths === 2, `the disc body has a hole as its second subpath (${discLayers.subpaths})`)
    ok(discLayers.bleedTop > 12, `and the band colour paints only the foot strip (from y=${discLayers.bleedTop})`)

    // THE SETTINGS SWITCH IS GONE.
    await win.click('[aria-label="Settings"]')
    await win.waitForSelector('[data-tab-role]:not([data-pinned]) [role="tab"]:has-text("Settings")', { timeout: 10000 })
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
    // The extraction WINDOW (owner, 2026-09-19, #166), superseding the chip
    // of 2026-09-03: the tree row's verb is one more way in to the same
    // window every other route raises, and it is held to the same things.
    await throughTheWindow(win, 'the tree row, Extract here', 'wrapped.zip', () =>
      win.locator('[role="menu"] >> text="Extract here"').click()
    )
    ok(
      (await win.locator('[data-job-chip]').count()) === 0,
      'and it no longer reports in the job chip'
    )
    await win.waitForSelector('[role="treeitem"][data-row$="Collection" i]', { timeout: 8000 })
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
  // Its OWN folder, removed afterwards: it used to launch on dragbox and
  // bin whichever row came second, which was anchor.txt - the file the paste
  // scenario later launches on. Fixtures are built once per run.
  const dir = join(fixtures, 'deltwice')
  mkdirSync(dir, { recursive: true })
  for (const n of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(dir, n), n)
  const { app, win } = await launch(join(dir, 'a.txt'))
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
    rmSync(dir, { recursive: true, force: true })
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
    const stage = win.locator('[data-owns-arrows]')
    await stage.waitFor({ state: 'visible', timeout: 20000 })
    const wakeInside = async () => {
      const box = await stage.boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 3)
      await win.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 3 + 8)
    }
    await wakeInside()
    await win.waitForSelector('[data-viewer-chrome]', { timeout: 20000 })
    ok(true, 'the control cluster wakes inside the comic viewer')

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
    await wakeInside()
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
    await win.waitForFunction(
      () => window.prism.clipboardHasFiles(),
      undefined,
      { timeout: 10000 }
    )

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
    const copyAt = order.findIndex((t) => t.startsWith('Copy') && !t.startsWith('Copy path'))
    const renameAt = order.findIndex((t) => t.startsWith('Rename'))
    ok(
      cutAt >= 0 && copyAt === cutAt + 1 && pasteAt === copyAt + 1 && renameAt > pasteAt,
      `and Cut/Copy/Paste stay together before Rename (cut ${cutAt}, paste ${pasteAt} of ${order.length})`
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
    const tabs = () => win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()
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
    ok((await shown()) === 'page2.png', 'Right turns the page')
    ok((await shown()) === 'page2.png', `to page2, not page10 (${await shown()})`)

    await win.keyboard.press('ArrowRight')
    await sleep(400)
    ok((await shown()) === 'page10.png', `and page10 sorts last, numerically (${await shown()})`)

    // The end is the end: Right again stays put rather than wrapping.
    await win.keyboard.press('ArrowRight')
    await sleep(300)
    ok((await shown()) === 'page10.png', 'the last page is the last page')

    await win.keyboard.press('ArrowLeft')
    // The page counter auto-hides on its own clock. Assert the image being
    // shown, which is the navigation result even after the chrome has faded.
    await win.waitForFunction(() => document.querySelector('img[alt]')?.getAttribute('alt') === 'page2.png', null, { timeout: 5000 })
    ok((await shown()) === 'page2.png', 'Left goes back')

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
/* ----- the extraction window (#166) ----- */

const XWIN = '[data-extract-window]'

/**
 * Watch the extraction window from INSIDE the page, armed before the verb is
 * pressed.
 *
 * A small fixture extracts in a few milliseconds, so the window is up for its
 * minimum showing (700ms) and no longer: a test that waits for it and THEN
 * presses Escape is racing the window's own exit, and passes or fails on the
 * machine's mood. So the probe does its poking at the instant of the mount:
 * an Escape aimed at the box and one at the body, and a press on the scrim
 * outside the box, through the same listeners a real key and a real mouse
 * reach. Then it notes whether the window was still up two frames later, every
 * phase it went through, and when it left. The big-archive scenario does the
 * same with REAL input, where there is time for it.
 */
async function armExtractProbe(win) {
  await win.evaluate((sel) => {
    window.__xw?.obs?.disconnect()
    const x = (window.__xw = { phases: [], error: null })
    const look = () => {
      const el = document.querySelector(sel)
      if (el) {
        const phase = el.getAttribute('data-phase')
        if (x.phases[x.phases.length - 1] !== phase) x.phases.push(phase)
        if (phase === 'failed') x.error = el.querySelector('[data-extract-error]')?.textContent ?? ''
      }
      if (el && !x.mounted) {
        x.mounted = performance.now()
        x.title = el.querySelector('h2')?.textContent ?? ''
        x.dest = el.querySelector('[data-extract-dest]')?.textContent ?? ''
        x.inert = document.getElementById('root')?.hasAttribute('inert') ?? false
        for (const target of [el, document.body])
          target.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
          )
        const scrim = el.parentElement
        for (const type of ['mousedown', 'mouseup', 'click'])
          scrim.dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 6, clientY: 6 })
          )
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            x.survived = !!document.querySelector(sel)
          })
        )
      }
      if (!el && x.mounted && !x.gone) x.gone = performance.now()
    }
    x.obs = new MutationObserver(look)
    x.obs.observe(document.body, { childList: true, subtree: true, attributes: true })
    look()
  }, XWIN)
}

/** Wait for the probed window to have come AND gone, and say what it saw. */
async function extractProbe(win, timeout = 60000) {
  await win.waitForFunction(() => !!window.__xw?.gone, null, { timeout })
  return win.evaluate(() => {
    const { obs, ...rest } = window.__xw
    obs.disconnect()
    return { ...rest, shownFor: rest.gone - rest.mounted }
  })
}

/**
 * One route, start to finish: the window appears, cannot be dismissed, names
 * the archive, and closes BY ITSELF with no error. What landed on disk is the
 * caller's to check, since every route lands somewhere different.
 */
async function throughTheWindow(win, label, archiveName, trigger) {
  await armExtractProbe(win)
  await trigger()
  let r
  try {
    r = await extractProbe(win)
  } catch {
    const seen = await win.evaluate(() => JSON.stringify({ ...window.__xw, obs: undefined }))
    ok(false, `${label}: the extraction window appears and then leaves (${seen})`)
    return null
  }
  ok(!!r.mounted, `${label}: the extraction window appears`)
  ok(
    r.title === `Extracting ${archiveName}`,
    `${label}: and names the archive (${JSON.stringify(r.title)})`
  )
  ok(/^to .+/.test(r.dest), `${label}: and where it is going (${JSON.stringify(r.dest)})`)
  ok(r.inert === true, `${label}: the app behind it is inert`)
  ok(r.survived === true, `${label}: Escape and a press outside leave it up`)
  // 700ms is the window's own minimum showing. Dismissed by the probe it
  // would have gone inside a frame, so this is the same assertion again from
  // the other side, read off the design constant and not off a sleep.
  ok(r.shownFor >= 650, `${label}: it stayed until the work let it go (${Math.round(r.shownFor)}ms)`)
  ok(
    !r.phases.includes('failed') && !r.phases.includes('cancelling'),
    `${label}: and closed by itself, with no error (${r.phases.join(' > ')}${r.error ? ': ' + r.error : ''})`
  )
  ok((await win.locator('[role="dialog"]').count()) === 0, `${label}: finishing raises no second dialog`)
  return r
}

/** Main's folder picker, answered: "Extract to..." asks in a native dialog,
 *  which nothing can drive, so the answer is planted in main instead. */
async function answerFolderDialog(app, dir) {
  await app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
  }, dir)
}

/** The row menu of one archive member, opened. */
async function openMemberMenu(win, name) {
  await win.locator('[data-arc-row]', { hasText: name }).first().click({ button: 'right' })
  await win.waitForSelector('[role="menu"]', { timeout: 5000 })
}

/**
 * EVERY WAY OF EXTRACTING, ONE WINDOW (2026-09-19, #166).
 *
 * Owner: "there are so many options to extract, and some use different
 * methods. I would like it to just be one kind of view that appears." Each
 * route is driven through the control a person uses (the verb row, the row
 * menus, the panel's own menu, main's folder dialog answered for the two that
 * ask), on BOTH engines, and each is held to the same five things. The tree
 * row's verb is in `treeVerbs` and the drag onto a sidebar folder is in
 * `drag`, beside the rest of what those scenarios prove.
 */
async function extractWindowScenario(fixtures) {
  console.log('one extraction window, every route')
  const zips = join(fixtures, 'zips')
  const picked = join(fixtures, 'zips', 'picked')
  const leftovers = () =>
    readdirSync(zips).filter((n) => n.startsWith('.prism-extract-'))
  const clean = () => {
    rmSync(picked, { recursive: true, force: true })
    for (const n of readdirSync(zips))
      if (/^(Collection|one|sub|note|wrapped|read-only)( \(\d+\))?(\.txt)?$/.test(n))
        rmSync(join(zips, n), { recursive: true, force: true })
  }
  clean()
  mkdirSync(picked, { recursive: true })

  // ---- a zip: the in-process engine ------------------------------------
  {
    const { app, win } = await launch(join(zips, 'wrapped.zip'))
    try {
      await win.waitForSelector('[data-arc-row]', { timeout: 15000 })
      await answerFolderDialog(app, picked)

      await throughTheWindow(win, 'zip, Extract to… on the verb row', 'wrapped.zip', () =>
        win.click('button:has-text("Extract to")')
      )
      ok(
        existsSync(join(picked, 'Collection', 'sub', 'two.txt')),
        'and the archive landed in the folder that was picked'
      )

      // The panel's own menu, on its dead space.
      const list = await win.locator('[data-arc-list]').boundingBox()
      await throughTheWindow(win, "zip, Extract here on the panel's menu", 'wrapped.zip', async () => {
        await win.mouse.click(list.x + list.width / 2, list.y + list.height - 12, { button: 'right' })
        await win.waitForSelector('[role="menu"]', { timeout: 5000 })
        await win.locator('[role="menu"] >> text="Extract here"').click()
      })
      ok(existsSync(join(zips, 'Collection', 'one.txt')), 'and it landed beside the archive')

      // A FOLDER row: "Extract folder here" stages beside the archive and
      // renames across, which is a different route from the members' one.
      await throughTheWindow(win, 'zip, Extract folder here', 'wrapped.zip', async () => {
        await openMemberMenu(win, 'Collection')
        await win.locator('[role="menu"] >> text="Extract folder here"').click()
      })
      ok(
        existsSync(join(zips, 'Collection (2)', 'sub', 'two.txt')),
        'the folder landed beside the first, never over it'
      )

      // Into an EMPTY picked folder, so what is asserted is the route and not
      // how a name that is already taken gets resolved.
      rmSync(join(picked, 'Collection'), { recursive: true, force: true })
      await throughTheWindow(win, 'zip, Extract folder to…', 'wrapped.zip', async () => {
        await openMemberMenu(win, 'Collection')
        await win.locator('[role="menu"] >> text="Extract folder to…"').click()
      })
      ok(
        existsSync(join(picked, 'Collection', 'sub', 'two.txt')),
        'and the folder landed in the picked one, shape intact'
      )

      // A FILE row, both verbs. Walk into the folder first.
      await win.locator('[data-arc-row]', { hasText: 'Collection' }).first().dblclick()
      await win.waitForSelector('[data-arc-row]:has-text("one.txt")', { timeout: 5000 })
      await throughTheWindow(win, 'zip, Extract here on a member', 'wrapped.zip', async () => {
        await openMemberMenu(win, 'one.txt')
        await win.locator('[role="menu"] >> text="Extract here"').click()
      })
      ok(
        readFileSync(join(zips, 'one.txt'), 'utf8') === 'first',
        'the member landed beside the archive, byte for byte'
      )
      await throughTheWindow(win, 'zip, Extract to… on a member', 'wrapped.zip', async () => {
        await openMemberMenu(win, 'one.txt')
        await win.locator('[role="menu"] >> text="Extract to…"').click()
      })
      ok(existsSync(join(picked, 'one.txt')), 'and in the picked folder')
      ok(leftovers().length === 0, `no staging folder is left behind (${leftovers().join(', ')})`)
      ok(
        (await win.locator('[data-job-chip]').count()) === 0,
        'and none of it went near the job chip, which is for pastes now'
      )
    } finally {
      await app.close()
    }
  }
  await sleep(900)

  // ---- a 7z: the bundled 7-Zip -----------------------------------------
  clean()
  mkdirSync(picked, { recursive: true })
  {
    const { app, win } = await launch(join(zips, 'read-only.7z'))
    try {
      await win.waitForSelector('[data-arc-row]', { timeout: 15000 })
      await answerFolderDialog(app, picked)

      await throughTheWindow(win, '7z, Extract here on the verb row', 'read-only.7z', () =>
        win.click('button:has-text("Extract here")')
      )
      ok(
        existsSync(join(zips, 'read-only', 'note.txt')) &&
          existsSync(join(zips, 'read-only', 'sub', 'deep.txt')),
        'the whole 7z landed in a folder named after it'
      )

      await throughTheWindow(win, '7z, Extract to… on the verb row', 'read-only.7z', () =>
        win.click('button:has-text("Extract to")')
      )
      ok(existsSync(join(picked, 'read-only', 'sub', 'deep.txt')), 'and in the picked folder')

      await throughTheWindow(win, '7z, Extract folder here', 'read-only.7z', async () => {
        await openMemberMenu(win, 'sub')
        await win.locator('[role="menu"] >> text="Extract folder here"').click()
      })
      ok(existsSync(join(zips, 'sub', 'deep.txt')), 'the folder landed beside the archive')

      // The members' route on 7-Zip stages INSIDE the destination and lands by
      // rename, so what is checked is the file AND that the staging has gone.
      await throughTheWindow(win, '7z, Extract here on a member', 'read-only.7z', async () => {
        await openMemberMenu(win, 'note.txt')
        await win.locator('[role="menu"] >> text="Extract here"').click()
      })
      ok(
        /hello from inside a 7z/.test(readFileSync(join(zips, 'note.txt'), 'utf8')),
        'the member landed beside the archive'
      )
      await throughTheWindow(win, '7z, Extract folder to…', 'read-only.7z', async () => {
        await openMemberMenu(win, 'sub')
        await win.locator('[role="menu"] >> text="Extract folder to…"').click()
      })
      ok(existsSync(join(picked, 'sub', 'deep.txt')), 'and a folder in the picked one')
      ok(leftovers().length === 0, `no staging folder is left behind (${leftovers().join(', ')})`)
      ok(
        readdirSync(picked).filter((n) => n.startsWith('.prism-extract-')).length === 0,
        'in the picked folder either'
      )

      // The temp extraction that VIEWS a member stays silent: no window.
      await armExtractProbe(win)
      await win.locator('[data-arc-row]', { hasText: 'note.txt' }).first().dblclick()
      await win.waitForFunction(() => /hello from inside a 7z/.test(document.body.innerText), null, {
        timeout: 15000
      })
      ok(
        (await win.evaluate(() => !window.__xw.mounted)) === true,
        'viewing a member raises no extraction window: that one is not a write the user can see'
      )
    } finally {
      await app.close()
      clean()
    }
  }
}

/** Our own 7-Zip children: the ones working on the big box, not every 7z on
 *  the machine. */
function sevenZipsOnTheBox() {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='7z.exe'" | ` +
          `Where-Object { $_.CommandLine -like '*e2e*big*box*' } | Measure-Object | ` +
          '%{ $_.Count }'
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    return Number(out.trim()) || 0
  } catch {
    return -1
  }
}

/** Poll until `fn()` is truthy. A condition, never a sleep-then-look. */
async function until(fn, timeout = 15000, every = 150) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) return v
    await sleep(every)
  }
}

/** Every path under `dir`, relative, sorted: what "the disk is as it was"
 *  is compared on. */
function treeOf(dir, rel = '') {
  const out = []
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name
    out.push(p)
    if (e.isDirectory()) out.push(...treeOf(dir, p))
  }
  return out.sort()
}

/**
 * CANCEL, AND THE ERROR (2026-09-19, #166), on archives slow enough to be
 * caught in the act (`buildBigFixtures`: PPMd, twenty seconds to extract).
 *
 * Owner, of the button asked for the same day: no X, Escape and clicking
 * outside do nothing, and Cancel stops the extraction and cleans up what was
 * half written. So with REAL keys and a REAL mouse this time: the window
 * shows real progress, shrugs off Escape, a click outside and the shortcuts
 * that would have reached the app behind it; then Cancel, on each of the three
 * shapes of clean-up (a landing folder, a staging folder beside the archive, a
 * staging folder inside a picked destination) and on the in-process engine;
 * and after each one the 7-Zip process is gone and the folder is, path for
 * path, what it was before, the user's own files included.
 */
async function extractCancelScenario() {
  console.log('cancelling an extraction, and one that fails')
  const { big, many, corrupt, locked7z, lockedZip } = await buildBigFixtures()
  const box = join(BIG, 'box')
  rmSync(box, { recursive: true, force: true })
  mkdirSync(join(box, 'Big'), { recursive: true })
  mkdirSync(join(box, 'picked', 'Big'), { recursive: true })
  // The user's OWN files, under the very names the archives are about to use.
  writeFileSync(join(box, 'keep.txt'), 'mine, and staying')
  writeFileSync(join(box, 'Big', 'mine.txt'), 'in a folder the archive also has')
  writeFileSync(join(box, 'picked', 'Big', 'mine.txt'), 'and one in the picked folder')
  for (const [from, name] of [
    [big, 'big.7z'],
    [many, 'many.zip'],
    [corrupt, 'corrupt.7z'],
    [locked7z, 'locked.7z'],
    [lockedZip, 'locked.zip']
  ])
    copyFileSync(from, join(box, name))
  const before = treeOf(box)
  const untouched = (label) => {
    const now = treeOf(box)
    const extra = now.filter((p) => !before.includes(p))
    const lost = before.filter((p) => !now.includes(p))
    ok(extra.length === 0, `${label}: nothing half-written is left (${extra.slice(0, 4).join(', ')})`)
    ok(lost.length === 0, `${label}: and nothing that was there is gone (${lost.join(', ')})`)
    ok(
      readFileSync(join(box, 'keep.txt'), 'utf8') === 'mine, and staying' &&
        readFileSync(join(box, 'Big', 'mine.txt'), 'utf8') === 'in a folder the archive also has' &&
        readFileSync(join(box, 'picked', 'Big', 'mine.txt'), 'utf8') === 'and one in the picked folder',
      `${label}: the files that were there before are byte for byte what they were`
    )
  }
  const pctNow = (win) =>
    win.evaluate((sel) => Number(document.querySelector(sel)?.getAttribute('data-extract-pct') || -1), XWIN)
  /** Wait until the window is up and the bar has MOVED, then press Cancel and
   *  wait for the window to go. Answers the phases it went through. */
  const cancelMidFlight = async (win, label, { seven }) => {
    await win.waitForSelector(`${XWIN}[data-phase="running"]`, { timeout: 20000 })
    await win.waitForFunction(
      (sel) => Number(document.querySelector(sel)?.getAttribute('data-extract-pct') || 0) >= 1,
      XWIN,
      { timeout: 30000 }
    )
    if (seven)
      ok((await until(() => sevenZipsOnTheBox() > 0, 8000)) > 0, `${label}: 7-Zip is running`)
    const at = await pctNow(win)
    ok(at >= 1 && at < 100, `${label}: caught mid-flight, at ${at}%`)
    await win.locator('[data-extract-cancel]').click()
    // The window says it is cancelling until main has finished cleaning up,
    // or goes at once when that took no time at all: either is right, and
    // what must NOT appear is an error.
    await win.waitForSelector(XWIN, { state: 'detached', timeout: 30000 })
    ok(
      (await win.locator('[role="dialog"]').count()) === 0,
      `${label}: Cancel closes the window, with no error in its place`
    )
    if (seven)
      ok(
        (await until(() => sevenZipsOnTheBox() === 0, 8000)) === true,
        `${label}: and the 7-Zip process is gone (${sevenZipsOnTheBox()} left)`
      )
    untouched(label)
  }

  const { app, win } = await launch(join(box, 'big.7z'))
  try {
    await win.waitForSelector('[data-arc-row]', { timeout: 15000 })
    await answerFolderDialog(app, join(box, 'picked'))
    const tabs = () => win.locator('[role="tablist"] [role="tab"]').count()
    const tabsBefore = await tabs()

    // ---- it cannot be dismissed: real keys, a real mouse ------------------
    await win.click('button:has-text("Extract here")')
    await win.waitForSelector(`${XWIN}[data-phase="running"]`, { timeout: 20000 })
    // Progress is REAL: a number, that grows, and the member being written.
    await win.waitForFunction(
      (sel) => Number(document.querySelector(sel)?.getAttribute('data-extract-pct') || 0) >= 1,
      XWIN,
      { timeout: 30000 }
    )
    const first = await pctNow(win)
    await win.waitForFunction(
      ([sel, was]) => Number(document.querySelector(sel)?.getAttribute('data-extract-pct') || 0) > was,
      [XWIN, first],
      { timeout: 30000 }
    )
    ok(true, `the percentage is real and it grows (${first}% -> ${await pctNow(win)}%)`)
    const fileLine = (await win.locator('[data-extract-file]').textContent()) ?? ''
    ok(/part-\d+\.txt/.test(fileLine), `the member being written is named (${fileLine})`)
    const fill = await win.evaluate(() => {
      const f = document.querySelector('[data-extract-fill]').getBoundingClientRect()
      const t = document.querySelector('[role="progressbar"]').getBoundingClientRect()
      return f.width / t.width
    })
    ok(fill > 0 && fill < 1, `and the bar is part full (${(fill * 100).toFixed(0)}% of its track)`)
    await win.screenshot({ path: join(SHOTS, 'extract-window-running.png') })

    const size = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    await win.keyboard.press('Escape')
    await win.mouse.click(12, size.h - 12)
    await win.mouse.click(size.w - 12, size.h - 12)
    await win.keyboard.press('Escape')
    // The shortcuts that would have reached the app behind it: close the tab,
    // bin the row, open a new tab, hide the sidebar.
    for (const k of ['Control+w', 'Delete', 'Control+t', 'Control+b', 'Backspace'])
      await win.keyboard.press(k)
    ok(
      (await win.locator(`${XWIN}[data-phase="running"]`).count()) === 1,
      'Escape, clicks outside and the app shortcuts leave it up and running'
    )
    ok((await tabs()) === tabsBefore, 'Ctrl+W and Ctrl+T did not reach the tabs behind it')
    ok((await win.locator('aside').count()) === 1, 'and Ctrl+B did not hide the sidebar')
    ok((await win.locator('[role="dialog"]').count()) === 1, 'Delete raised no question behind it')
    ok(
      await win.evaluate(() => document.getElementById('root').hasAttribute('inert')),
      'the app behind it is inert'
    )
    // The verb row is under the scrim: a click aimed at "Extract to…" lands
    // on the scrim and starts nothing.
    const under = await win.evaluate((sel) => {
      const b = [...document.querySelectorAll('button')].find((x) => /Extract to/.test(x.textContent))
      const r = b.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return !!hit?.closest(sel)?.parentElement || !!hit?.querySelector(sel)
    }, XWIN)
    ok(under, 'a click aimed at a verb behind it lands on the window instead')
    ok(
      (await win.locator(`${XWIN} button`).count()) === 1 &&
        (await win.locator(`${XWIN} button`).textContent()) === 'Cancel',
      'and its one control is Cancel: no X'
    )

    // ---- Cancel: the landing folder (Extract here, whole archive) ---------
    await cancelMidFlight(win, 'Extract here', { seven: true })

    // ---- Cancel: staging beside the archive (Extract folder here) ---------
    await openMemberMenu(win, 'Big')
    await win.locator('[role="menu"] >> text="Extract folder here"').click()
    await win.waitForSelector(`${XWIN}[data-phase="running"]`, { timeout: 20000 })
    ok(
      (await until(() => readdirSync(box).some((n) => n.startsWith('.prism-extract-')), 8000)) === true,
      'Extract folder here: it stages beside the archive while it works'
    )
    await cancelMidFlight(win, 'Extract folder here', { seven: true })

    // ---- Cancel: staging inside the picked folder (Extract folder to…) ----
    await openMemberMenu(win, 'Big')
    await win.locator('[role="menu"] >> text="Extract folder to…"').click()
    await win.waitForSelector(`${XWIN}[data-phase="running"]`, { timeout: 20000 })
    ok(
      (await until(
        () => readdirSync(join(box, 'picked')).some((n) => n.startsWith('.prism-extract-')),
        8000
      )) === true,
      'Extract folder to…: it stages inside the destination while it works'
    )
    await cancelMidFlight(win, 'Extract folder to…', { seven: true })

    // ---- Cancel: the in-process engine, slow by count ---------------------
    await win.locator('aside [role="treeitem"]', { hasText: 'many.zip' }).first().click()
    await win.waitForSelector('[data-arc-row]:has-text("Many")', { timeout: 15000 })
    await win.click('button:has-text("Extract here")')
    await cancelMidFlight(win, 'a zip, Extract here', { seven: false })

    // ---- a FAILURE turns the same window into the error -------------------
    await win.locator('aside [role="treeitem"]', { hasText: 'corrupt.7z' }).first().click()
    await win.waitForSelector('[data-arc-row]:has-text("b-bad.txt")', { timeout: 15000 })
    await win.click('button:has-text("Extract here")')
    await win.waitForSelector(`${XWIN}[data-phase="failed"]`, { timeout: 30000 })
    const title = (await win.locator(`${XWIN} h2`).textContent()) ?? ''
    const said = (await win.locator('[data-extract-error]').textContent()) ?? ''
    ok(title === "Couldn't extract corrupt.7z", `a failure is the same window, retitled (${title})`)
    ok(/ERROR|CRC|Data Error/i.test(said), `and it carries 7-Zip's own line (${said})`)
    ok(
      (await win.locator(`${XWIN} button`).count()) === 1 &&
        (await win.locator(`${XWIN} button`).textContent()) === 'Close',
      'its one control is Close'
    )
    // Close reads as a button from the FIRST frame. The first screenshot of
    // this state showed grey text on the accent: the node had been Cancel a
    // moment before, and its colour was still fading across.
    const closeLook = await win.evaluate(() => {
      const b = document.querySelector('[data-extract-close]')
      const probe = document.createElement('span')
      probe.style.color = 'var(--p-on-accent)'
      document.body.appendChild(probe)
      const want = getComputedStyle(probe).color
      probe.remove()
      return { got: getComputedStyle(b).color, want }
    })
    ok(
      closeLook.got === closeLook.want,
      `Close wears the on-accent colour at once, not Cancel's fading out (${closeLook.got} vs ${closeLook.want})`
    )
    await win.screenshot({ path: join(SHOTS, 'extract-window-error.png') })
    await win.keyboard.press('Escape')
    await win.mouse.click(12, size.h - 12)
    ok(
      (await win.locator(`${XWIN}[data-phase="failed"]`).count()) === 1,
      'Escape and a click outside leave the error up as well'
    )
    await win.locator('[data-extract-close]').click()
    await win.waitForSelector(XWIN, { state: 'detached', timeout: 5000 })
    ok(
      !(await win.evaluate(() => document.getElementById('root').hasAttribute('inert'))),
      'Close takes it away, and the app is live again'
    )
    // A failure keeps what came out before it: that file is good.
    ok(
      existsSync(join(box, 'corrupt', 'a-good.txt')),
      'the member that extracted before the failure is kept'
    )

    // ---- and the error can be closed FROM THE KEYBOARD --------------------
    // Cancel and Close are two elements, so a failure arriving while the focus
    // was on Cancel dropped it onto `body`, where the key guard swallows Tab,
    // Enter and Space: an error only a mouse could close. The corrupt archive
    // fails inside a few milliseconds, far too fast to Tab in by hand, so the
    // focus is planted on Cancel from inside the page at the instant it
    // mounts, which is where a person's Tab would have put it.
    await win.evaluate(() => {
      window.__cancelHadFocus = false
      const obs = new MutationObserver(() => {
        const b = document.querySelector('[data-extract-cancel]')
        // Cancel has gone: that is the failure, and the last word on where
        // the focus was stays as it is.
        if (!b) return window.__cancelHadFocus ? obs.disconnect() : undefined
        if (document.activeElement !== b) b.focus()
        window.__cancelHadFocus = document.activeElement === b
      })
      obs.observe(document.body, { childList: true, subtree: true, attributes: true })
    })
    await win.click('button:has-text("Extract here")')
    await win.waitForSelector(`${XWIN}[data-phase="failed"]`, { timeout: 30000 })
    ok(
      (await win.evaluate(() => window.__cancelHadFocus)) === true,
      'the second failure arrived with the focus on Cancel'
    )
    ok(
      (await win.waitForFunction(
        (sel) => !!document.activeElement?.closest(sel),
        XWIN,
        { timeout: 5000 }
      ).then(() => true, () => false)) === true,
      'and the focus is back inside the window, not lost on the body'
    )
    await win.keyboard.press('Tab')
    ok(
      (await win.evaluate(() => document.activeElement?.hasAttribute('data-extract-close'))) === true,
      'Tab reaches Close'
    )
    await win.keyboard.press('Enter')
    await win.waitForSelector(XWIN, { state: 'detached', timeout: 5000 })
    ok(true, 'and Enter closes the error: no mouse needed')

    // ---- A PASSWORD, on both engines (found missing in review) -------------
    // The window answers a password two ways, on purpose. A route that cannot
    // ask (the verb row's Extract here) shows the ERROR, with the sentence
    // that says where a password is typed. A route that asks and tries again
    // (a member row) must see the window close QUIETLY, so the question is
    // not put up on top of an error. The 7z half is also the proof that
    // 7-Zip is never left waiting at its own "Enter password" prompt, which
    // with stdin open it did for ever: the window would sit in `running`
    // until the waits below timed out.
    const PASS = 'input[aria-label="Archive password"]'
    for (const name of ['locked.7z', 'locked.zip']) {
      const mark = treeOf(box)
      await win.locator('aside [role="treeitem"]', { hasText: name }).first().click()
      await win.waitForSelector('[data-arc-row]:has-text("vault")', { timeout: 15000 })

      await win.click('button:has-text("Extract here")')
      await win.waitForSelector(`${XWIN}[data-phase="failed"]`, { timeout: 30000 })
      const why = (await win.locator('[data-extract-error]').textContent()) ?? ''
      ok(
        /password protected/i.test(why),
        `${name}, Extract here with no password: the window says it is protected (${why})`
      )
      await win.locator('[data-extract-close]').click()
      await win.waitForSelector(XWIN, { state: 'detached', timeout: 5000 })
      const strays = treeOf(box).filter((p) => !mark.includes(p))
      ok(
        strays.length === 0,
        `${name}: and the refused extraction left nothing behind (${strays.join(', ')})`
      )

      await win.locator('[data-arc-row]', { hasText: 'vault' }).first().dblclick()
      await win.waitForSelector('[data-arc-row]:has-text("secret.txt")', { timeout: 5000 })
      await armExtractProbe(win)
      await openMemberMenu(win, 'secret.txt')
      await win.locator('[role="menu"] >> text="Extract here"').click()
      await win.waitForSelector(PASS, { timeout: 30000 })
      const seen = await win.evaluate(() => window.__xw.phases)
      ok(
        !seen.includes('failed'),
        `${name}, a member's Extract here: the password is ASKED, with no error under the question (${seen.join(' > ')})`
      )
      ok(
        (await win.locator(XWIN).count()) === 0 && (await win.locator('[role="dialog"]').count()) === 1,
        `${name}: and the question is the only thing up`
      )
      await win.fill(PASS, 'nope')
      await win.keyboard.press('Enter')
      await win.waitForFunction(() => /didn't open/.test(document.body.innerText), null, {
        timeout: 30000
      })
      ok(true, `${name}: a wrong password asks again, and says so`)
      ok(
        !existsSync(join(box, 'secret.txt')),
        `${name}: and nothing was written with the wrong one`
      )
      await win.fill(PASS, 'letmein')
      await win.keyboard.press('Enter')
      const landed = await until(
        () =>
          existsSync(join(box, 'secret.txt')) &&
          /the secret, out in the open/.test(readFileSync(join(box, 'secret.txt'), 'utf8')),
        30000
      )
      ok(landed === true, `${name}: the right password extracts the member`)
      await win.waitForSelector(XWIN, { state: 'detached', timeout: 10000 })
      ok(
        (await win.locator('[role="dialog"]').count()) === 0,
        `${name}: and the window closes by itself afterwards, with nothing in its place`
      )
      rmSync(join(box, 'secret.txt'), { force: true })
    }
  } finally {
    await app.close()
    rmSync(box, { recursive: true, force: true })
  }
}

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
    // The inline track is GONE (2026-09-03, owner), and since 2026-09-19
    // (#166) extraction progress is ONE window over the app, whichever verb
    // started it, so the layout has nothing to move. Still measured, because
    // "it looks fine" is exactly how the jump got shipped the first time.
    const listTop = async () =>
      win.evaluate(() => document.querySelector('[data-arc-row]').getBoundingClientRect().top)
    const beforeTop = await listTop()
    ok(
      (await win.locator('[role="progressbar"]').count()) === 0,
      'no inline progress track: the extraction window is the one look'
    )
    // The first row starts ON the header's hairline: no gutter above it.
    const gap = await win.evaluate(() => {
      const list = document.querySelector('[data-arc-list]')
      const row = document.querySelector('[data-arc-row]')
      return row.getBoundingClientRect().top - list.getBoundingClientRect().top
    })
    ok(Math.abs(gap) < 0.6, `the first row sits on the header hairline (${gap.toFixed(2)}px)`)
    await throughTheWindow(win, 'zip, Extract here on the verb row', 'wrapped.zip', () =>
      win.click('button:has-text("Extract here")')
    )
    ok(
      (await win.locator('button:has-text("Extracting")').count()) === 0,
      'no button reads "Extracting...": the window is the one thing that says so'
    )
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

    // A focused tree searches files; focusing the editor searches its contents.
    await win.keyboard.press('Control+f')
    ok(
      await win.locator('input[aria-label="Search files"]').evaluate((el) => document.activeElement === el),
      'Ctrl+F from the tree focuses folder search'
    )
    await win.locator('.cm-content').click()
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

    // SUBMENUS (#122): the top level is one row per setting with its value,
    // and the slider lives under Speed.
    ok((await win.locator('[data-menu-row]').count()) === 3, 'the top level is Speed, Subtitles and Aspect ratio for a one-track film')
    ok((await win.locator('[data-menu-value="subtitles"]').textContent()) === 'Off', 'and Subtitles reads Off before a pick')
    await win.click('[data-menu-row="speed"]')
    await win.waitForSelector('[data-menu-section="speed"]', { timeout: 5000 })
    await win.locator('input[aria-label="Playback speed"]').evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '2')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    ok(await win.evaluate(() => document.querySelector('video').playbackRate === 2), 'speed slider sets playbackRate')
    await win.click('[data-menu-back]')
    ok((await win.locator('[data-menu-value="speed"]').textContent()) === '2.00×', 'and the Speed row reads the new rate')

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
    await win.click('[data-menu-row="subtitles"]')
    await win.waitForSelector('[data-menu-section="subtitles"]', { timeout: 5000 })
    ok((await win.locator('[role="menuitemradio"]:has-text("English")').count()) === 1, 'sidecar srt listed as English')
    await win.click('[role="menuitemradio"]:has-text("English")')
    // A pick returns to the top, where the row now says what was chosen.
    await win.waitForSelector('[data-menu-row="subtitles"]', { timeout: 5000 })
    ok((await win.locator('[data-menu-value="subtitles"]').textContent()) === 'English', 'the Subtitles row reads the pick')
    // REMEMBERED PER FILE (#124): the pick and the ratio survive leaving the
    // file and coming back, and live in the PC's store by path.
    await win.click('[data-menu-row="picture"]')
    await win.click('[data-menu-section="picture"] [role="menuitemradio"]:has-text("16:9")')
    await win.keyboard.press('Escape')
    await win.click('[role="treeitem"]:has-text("ep2.mp4")')
    await win.waitForFunction(() => (document.querySelector('video')?.currentSrc ?? '').includes('ep2'), null, { timeout: 8000 })
    await win.click('[role="treeitem"]:has-text("ep1.mp4")')
    await win.waitForFunction(() => (document.querySelector('video')?.currentSrc ?? '').includes('ep1'), null, { timeout: 8000 })
    await sleep(600)
    await win.hover('video')
    await win.click('[aria-label="Player settings"]')
    await win.waitForSelector('[data-menu-row="subtitles"]', { timeout: 5000 })
    ok((await win.locator('[data-menu-value="subtitles"]').textContent()) === 'English', 'coming back to the file, the subtitle pick is remembered')
    ok((await win.locator('[data-menu-value="picture"]').textContent()) === '16:9', 'and so is the aspect ratio')
    const mem = await win.evaluate((p) => window.prism.memoryGet(p), join(fixtures, 'ep1.mp4'))
    ok(mem?.fit === '16:9' && typeof mem?.subs === 'string' && mem.subs.endsWith('ep1.en.srt'), `kept in the PC's store by path (${JSON.stringify(mem)})`)
    // The memory is the app's and the profile is shared across scenarios:
    // put ep1 back the way the others expect it, a fitted picture and the
    // global subtitle rule.
    // `undefined` CLEARS a field (no memory), where null would be a remembered "off".
    await win.evaluate((p) => window.prism.memorySet(p, { fit: null, subs: undefined, audio: undefined }), join(fixtures, 'ep1.mp4'))
    await sleep(600)
    ok(
      (await win.evaluate((p) => window.prism.memoryGet(p), join(fixtures, 'ep1.mp4')))?.fit === undefined,
      'and a field can be cleared to no memory at all'
    )
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
      // A track that IS open must not be told there is nothing open. Media
      // lives in the player deck, so the warm deck is empty for it by design,
      // and the empty-state notice used to be drawn underneath: invisible
      // behind a film's picture, and written across the middle of the audio
      // visualizer, which is a transparent ring (2026-09-08).
      ok(
        await win.evaluate(() => !document.body.textContent?.includes('No file selected')),
        'and the stage does not claim there is no file open'
      )
    } finally {
      await app.close()
    }
  }
  {
    // ARROWING ONTO A TRACK PLAYS IT, exactly as clicking the row does
    // (2026-09-08, owner: arrowing through an album left every track sitting
    // at 0:00). The click recorded the intent to play and the keyboard's own
    // landing did not, so the two hands disagreed about what a pick means.
    // Opened on a PICTURE so the arrows belong to the tree from the first
    // press: a freshly opened track keeps them for its own volume.
    const { app, win } = await launch(join(fixtures, 'av', 'photo.cr2'))
    try {
      await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
      await sleep(600)
      // av/ sorts arpeggio.mid, dolby.mkv, lossless.m4a, nopicture.mkv,
      // photo.cr2: two steps up from the picture is the track.
      await win.keyboard.press('ArrowUp')
      await sleep(700)
      await win.keyboard.press('ArrowUp')
      await win.waitForSelector('audio', { state: 'attached', timeout: 15000 })
      await win.waitForFunction(() => !document.querySelector('audio')?.paused, undefined, {
        timeout: 10000
      })
      ok(true, 'arrowing onto a track starts it, as clicking the row does')
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
      await win.click('[data-menu-row="subtitles"]')
      await win.waitForSelector('[data-menu-section="subtitles"]', { timeout: 5000 })
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

/**
 * A file handed over by Explorer while the tab shows a FULL terminal
 * (2026-09-04): the shell hides and the file shows, marked in the tree. It
 * used to land underneath the terminal, unseen and unmarked.
 */
async function handoffOverTermScenario(fixtures) {
  console.log('handoff over terminal')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(1500)
    ok((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 1, 'opening the terminal keeps the original project tab')
    await win.keyboard.type('echo handoff-shell-survives')
    await win.keyboard.press('Enter')
    await win.waitForFunction(() => document.querySelector('.xterm')?.textContent?.includes('handoff-shell-survives'))
    // File handoff shows the file inside the same project, keeping its shell.
    await handoff(join(fixtures, 'notes.txt'))
    await win.waitForFunction(() => document.querySelectorAll('.xterm').length === 0, null, { timeout: 8000 })
    ok(true, 'a file arriving from Explorer hides the full terminal')
    await win.waitForSelector('.cm-editor', { timeout: 8000 })
    ok(true, 'and the file is what shows')
    await win.waitForFunction(
      () => /notes\.txt$/i.test(document.querySelector('[role="treeitem"][aria-selected="true"]')?.getAttribute('data-row') ?? ''),
      null,
      { timeout: 8000 }
    )
    ok(true, 'and the tree marks it')
    ok((await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 1, 'the original project tab is reused')
    ok((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').first().getAttribute('aria-selected')) === 'true', 'the arriving file activates its original tab')
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 8000 })
    ok((await win.locator('.xterm').textContent())?.includes('handoff-shell-survives'), 'the original shell and its scrollback survive the handoff')
  } finally {
    await app.close()
  }
}

async function tabsScenario(fixtures) {
  console.log('project tabs')
  const otherRoot = OTHER_ROOT
  let { app, win } = await launch(join(fixtures, 'README.md'))
  const strip = '[role="tablist"]'
  // Keep the legacy project-flow assertions scoped to closeable tabs. The
  // pinned Explorer is always present and has its own browser scenario.
  const tabRows = () => win.locator(`${strip} [data-tab-role]:not([data-pinned]) [role="tab"]`)
  try {
    // The strip is there from the first tab, so the + is always reachable.
    await win.waitForSelector(strip, { timeout: 10000 })
    ok((await win.locator(`${strip} [data-pinned] [role="tab"]`).count()) === 1, 'one pinned Explorer stays in the strip')
    ok((await tabRows().count()) === 1, 'one folder still shows as a tab')
    // The + no longer opens a dialog, so the suite can actually press it: a tab
    // arrives rooted at the user's own folder, with nothing to answer first.
    await win.locator(`${strip} [aria-label="New tab"]`).click()
    await sleep(700)
    ok((await tabRows().count()) === 2, 'the + spawns a tab without a dialog')
    // Rooted where "New tabs open in" says. The profile is SEEDED with the
    // fixtures folder (seedProfile: so the bundled index never scans a real
    // home), so that is the folder to expect. This used to assert /Users/ and
    // call it "the user folder", which passed on the owner's machine only
    // because the repo lives under C:\Users; on a CI runner (D:\a\...) the same
    // correct behaviour failed (#164). Waited for, not slept for: the tab exists
    // at once and its folder is resolved a moment later.
    const seeded = join(ROOT, '.e2e', 'fixtures').toLowerCase()
    let where = ''
    for (let i = 0; i < 40 && where.toLowerCase() !== seeded; i += 1) {
      where = (await tabRows().last().getAttribute('title')) ?? ''
      if (where.toLowerCase() !== seeded) await sleep(250)
    }
    ok(where.toLowerCase() === seeded, `and roots it at the folder "New tabs open in" names (said: "${where}")`)
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(400)
    ok((await tabRows().count()) === 1, 'and it closes again')

    // A file from a SUBFOLDER of an open root opens a tab of its own, rooted
    // at that folder (owner, 2026-09-04, reversing 2026-09-01): separate
    // folders are separate tabs, and only the exact root folds. The tab it
    // did not land in is left exactly as it was.
    await handoff(join(fixtures, 'code', 'bad.json'))
    await win.waitForSelector(strip, { timeout: 10000 })
    ok((await tabRows().count()) === 2, 'a file from a subfolder opens a tab of its own')
    ok(
      /\\code$/i.test((await tabRows().last().getAttribute('title')) ?? ''),
      'rooted at the subfolder'
    )
    ok(
      /fixtures$/i.test((await tabRows().first().getAttribute('title')) ?? ''),
      'and the tab above it keeps ITS root'
    )
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(400)

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
    // at its README first, then switch AWAY and back, so this tests the
    // switch rather than what the last handoff happened to leave on screen.
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

    // The remembered folder still applies. Explorer ignores the legacy
    // terminal-first setting until the user explicitly opens a project.
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
    await win.waitForSelector('[data-testid="folder-browser"]', { timeout: 15000 })
    ok((await win.locator('.xterm').count()) === 0, 'and opens as Explorer despite the legacy terminal-first setting')
    await win.evaluate(() => {
      localStorage.setItem('prism.newtab.mode', 'home')
      localStorage.setItem('prism.newtab.show', 'file')
    })
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(500)
    ok((await tabRows().count()) === 2, 'and closes again')

    // The close question is one rule and no setting (#154): it protects
    // agents only. Ordinary project tabs close immediately.
    // Aim Ctrl+W at the code tab, so the fixtures tab (which the rest of the
    // scenario leans on) stays put.
    await tabRows().last().click()
    await sleep(300)
    await win.keyboard.press('Control+w')
    await sleep(400)
    ok((await win.locator('[role="dialog"]').count()) === 0, 'ordinary project tabs do not ask for confirmation')
    ok((await tabRows().count()) === 1, 'Ctrl+W closes the ordinary tab immediately')
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

/**
 * The pin on the + menu (#99): a pinned folder climbs above the recents, the
 * pin fills, the menu stays up while you do it, and the pin outlives history.
 */
async function pinRecentScenario(fixtures) {
  console.log('pin recent')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const rows = () => win.locator('[role="menuitem"]')
  const rowLabels = () => rows().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
  const pinOf = (label) => win.locator(`[role="menuitem"]:has-text("${label}") [data-pin]`)
  const openMenu = async () => {
    await win.locator('[aria-label="New tab"]').click({ button: 'right' })
    await win.waitForSelector('[role="menuitem"]', { timeout: 5000 })
  }
  try {
    await win.evaluate(
      ([a, b]) => {
        localStorage.setItem('prism.pinnedRoots', '[]')
        const recent = JSON.parse(localStorage.getItem('prism.recentRoots') ?? '[]')
        // In FRONT: the suite before this one has filled the list, and only
        // the newest five are shown.
        localStorage.setItem('prism.recentRoots', JSON.stringify([a, b, ...recent.filter((x) => x !== a && x !== b)]))
      },
      [join(fixtures, 'code'), join(fixtures, 'docs')]
    )
    await openMenu()
    const before = await rowLabels()
    ok(before.length >= 3 && before[0] !== 'docs' && before.includes('docs'), `the menu lists the recents, history order (${before.join(' | ')})`)
    ok(
      (await win.locator('[role="menuitem"] [data-pin="off"]').count()) === before.length,
      'every row carries an outlined pin'
    )
    await pinOf('docs').click()
    await sleep(200)
    // The menu stays up; the count may GROW by one, since a pin sits above
    // the five recents rather than among them.
    const count = await rows().count()
    ok(count === before.length || count === before.length + 1, `pinning keeps the menu open (${before.length} rows -> ${count})`)
    const after = await rowLabels()
    ok(after[0] === 'docs', `the pinned folder climbs to the top (${after[0]})`)
    ok((await pinOf('docs').getAttribute('data-pin')) === 'on', 'and its pin is filled')
    await win.keyboard.press('Escape')
    await sleep(200)
    // History moves on; the pin does not.
    await win.evaluate((p) => {
      const recent = JSON.parse(localStorage.getItem('prism.recentRoots') ?? '[]')
      localStorage.setItem('prism.recentRoots', JSON.stringify(recent.filter((x) => x !== p)))
    }, join(fixtures, 'docs'))
    await openMenu()
    const again = await rowLabels()
    ok(again[0] === 'docs' && (await pinOf('docs').getAttribute('data-pin')) === 'on', 'a pin outlives the recents list')
    ok(again.filter((l) => l === 'docs').length === 1, 'a pinned folder is never also a recent row')
    await pinOf('docs').click()
    await sleep(200)
    ok((await win.evaluate(() => localStorage.getItem('prism.pinnedRoots'))) === '[]', 'the pin clicked again unpins')
    ok((await rowLabels())[0] !== 'docs', 'and the row drops back into history order')
    await win.keyboard.press('Escape')
    await sleep(200)

    // Over the SETTINGS page (owner, 2026-09-04): the page is a fixed layer
    // and the menu used to open underneath it. The topmost element at a
    // row's centre must be the row.
    await win.click('[aria-label="Settings"]')
    await sleep(500)
    await openMenu()
    const hit = await win.evaluate(() => {
      // The LAST row: the page starts 68px down, and the first row can sit
      // above its top edge and prove nothing.
      const rows = document.querySelectorAll('[role="menuitem"]')
      const row = rows[rows.length - 1]
      if (!row) return 'no row'
      const r = row.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return top && row.contains(top) ? 'row' : (top?.tagName ?? 'nothing') + '.' + (top?.className?.toString().slice(0, 40) ?? '')
    })
    ok(hit === 'row', `the + menu opens ABOVE the Settings page (topmost at the row: ${hit})`)
    await win.keyboard.press('Escape')
  } finally {
    await win.evaluate(() => localStorage.removeItem('prism.pinnedRoots')).catch(() => {})
    await app.close()
  }
}

/**
 * The terminal and the sidebar in step (#99). A cd INSIDE the root expands
 * to the folder and marks it, root unchanged; a cd OUTSIDE reroots the tab.
 * Drives a real pwsh, so this also proves the prompt hook survives node-pty's
 * argv quoting and reaches xterm as OSC 9;9 rather than as text.
 */
async function termCwdScenario(fixtures) {
  console.log('terminal cwd')
  const root = join(fixtures, 'code')
  // Reassigned: this scenario relaunches to prove the shell's folder survives.
  let { app, win } = await launch(join(root, 'bad.json'))
  const rowFor = (folder) =>
    win.evaluate(
      (f) => {
        const el = [...document.querySelectorAll('[role="treeitem"]')].find((e) =>
          (e.getAttribute('data-row') ?? '').toLowerCase().endsWith(f.toLowerCase())
        )
        return el
          ? { expanded: el.getAttribute('aria-expanded'), selected: el.hasAttribute('data-selected'), tab: el.getAttribute('tabindex') }
          : null
      },
      folder
    )
  const tabText = () => win.locator('[data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]').textContent()
  const typeLine = async (s) => {
    await win.keyboard.type(s)
    await win.keyboard.press('Enter')
  }
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    ok((await rowFor('nested'))?.expanded === 'false', 'the folder starts collapsed')
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(3500) // a cold pwsh takes a moment to prompt
    ok(
      !((await win.locator('.xterm').textContent()) ?? '').includes(']9;9;'),
      'the prompt report is parsed by xterm, never drawn as text'
    )
    await typeLine('cd nested')
    await win.waitForFunction(
      () => !![...document.querySelectorAll('[role="treeitem"][data-selected]')].find((e) => /nested$/i.test(e.getAttribute('data-row') ?? '')),
      null,
      { timeout: 10000 }
    )
    const nested = await rowFor('nested')
    ok(nested?.expanded === 'true', 'cd into a folder inside the root expands it in the tree')
    ok(nested?.selected && nested?.tab === '0', 'and the cursor marks it, without opening anything')
    ok(await win.evaluate(() => !!document.activeElement?.closest('.xterm')), 'the keyboard stays in the terminal')
    ok(((await tabText()) ?? '').includes('code'), `the root did not move (${await tabText()})`)

    await typeLine('cd level-two')
    await win.waitForFunction(
      () => !![...document.querySelectorAll('[role="treeitem"][data-selected]')].find((e) => /level-two$/i.test(e.getAttribute('data-row') ?? '')),
      null,
      { timeout: 10000 }
    )
    ok(true, 'a second cd walks the mark one level down')

    // Projects retain their original tree/viewer layout. Hiding the shell
    // and opening a tree file must neither expose Explorer nor move the shell.
    ok((await win.getByRole('button', { name: 'Browse files', exact: true }).count()) === 0, 'a project terminal has no Explorer return row')
    await win.keyboard.press('Control+`')
    await win.locator('[role="treeitem"]').filter({ hasText: 'pyburied.py' }).click()
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    ok((await win.locator('[data-testid="folder-browser"]').count()) === 0, 'a project file uses the original tree and viewer')
    ok((await win.locator('nav[aria-label="Folder path"]').count()) === 0, 'and has no Explorer path bar')
    await win.keyboard.press('Control+`')
    await win.waitForFunction(() => !!document.activeElement?.closest('.xterm'), null, { timeout: 10000 })
    const termText = () => win.evaluate(() => document.querySelector('.xterm .xterm-rows')?.textContent ?? '')
    ok(/level-two>\s*$/.test((await termText()).trimEnd()), 'opening a project file leaves the used shell in place')
    ok((await win.locator('.xterm').count()) === 1, 'returning keeps the same single shell')
    await typeLine('$projectCwdProof = $PID')
    const projectTabs = await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()
    await win.locator('[role="treeitem"]').filter({ hasText: 'nested' }).first().click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Open terminal here', exact: true }).click()
    await win.waitForFunction(() => /nested>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()), null, { timeout: 10000 })
    ok((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === projectTabs, 'Open terminal here adds a session inside the same project')
    ok(
      /nested>\s*$/.test((await termText()).trimEnd()),
      'the new session starts in the explicitly selected folder'
    )
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Terminal 1', exact: true }).click()
    await win.waitForFunction(() => /level-two>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()), null, { timeout: 10000 })
    await win.locator('.xterm').click()
    await typeLine("Write-Output ('project-cwd-proof:' + $projectCwdProof + ':' + $PID)")
    await win.waitForFunction(() => /project-cwd-proof:(\d+):\1/.test(document.querySelector('.xterm .xterm-rows')?.textContent ?? ''), null, { timeout: 10000 })
    ok(true, 'the touched original shell keeps its PID, variable and cwd')
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Terminal 2', exact: true }).click()
    await win.waitForFunction(() => /nested>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()), null, { timeout: 10000 })
    await win.locator('.xterm').click()

    // Past the project root: the shell moves while browsing and identity stay put.
    await typeLine(`cd '${OTHER_ROOT}'`)
    await win.waitForFunction(
      (path) => (document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd().endsWith(path + '>'),
      OTHER_ROOT,
      { timeout: 10000 }
    )
    ok((await tabText()).includes('code'), `cd outside keeps the session's project label (${await tabText()})`)
    ok(
      await win.evaluate((path) => [...document.querySelectorAll('[role="treeitem"]')].every((e) => (e.getAttribute('data-row') ?? '').toLowerCase().startsWith(path.toLowerCase() + '\\')), root),
      'and the project tree retains its root'
    )
    ok((await win.locator('.xterm').count()) === 1, 'the shell survives moving outside the project')
  } finally {
    await app.close()
  }

  /**
   * ...AND THE SHELL COMES BACK WHERE IT WAS (2026-09-09). The tab's root is
   * not where the shell was standing: a cd inside the root moves the shell
   * and deliberately leaves the root alone, and so does "Open terminal here"
   * on a folder row. Restore spawned at the ROOT, so the folder you had
   * walked to was gone every launch - and the agent resume, which looks a
   * conversation up by the folder it was held in, went to the root's newest
   * session instead of the one down there.
   *
   * A fresh strip first: the round above ends rerooted onto another folder,
   * where the shell's cwd and the tab's root are the same thing and there is
   * nothing to prove.
   */
  await sleep(900)
  ;({ app, win } = await launch(join(root, 'bad.json')))
  const promptText = () =>
    win.evaluate(() => document.querySelector('.xterm .xterm-rows')?.textContent ?? '')
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(3500)
    await win.keyboard.type('cd nested')
    await win.keyboard.press('Enter')
    await win.waitForFunction(
      () => !![...document.querySelectorAll('[role="treeitem"][data-selected]')].find((e) => /nested$/i.test(e.getAttribute('data-row') ?? '')),
      null,
      { timeout: 10000 }
    )
    await sleep(900) // the strip is saved on a 400ms debounce
  } finally {
    await app.close()
  }
  await sleep(900)
  ;({ app, win } = await launch(join(root, 'bad.json'), true))
  try {
    // The launch file activates the same project and hides its restored shell.
    await win.waitForSelector('[data-tab-role]:not([data-pinned]) [role="tab"]', { timeout: 15000 })
    ok((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 1, 'restore retains one project owner for its file and shell')
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 15000 })
    const deadline = Date.now() + 20000
    let back = false
    while (Date.now() < deadline && !back) {
      back = /nested>\s*$/.test((await promptText()).trimEnd())
      if (!back) await sleep(300)
    }
    ok(back, `the restored shell stands in the folder it was left in${back ? '' : ` (saw: ...${(await promptText()).trimEnd().slice(-200)})`}`)
    ok(
      /(^|\W)code(\W|$)/i.test((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]').textContent()) ?? ''),
      'and the tab is still rooted where it was, not moved down with the shell'
    )
  } finally {
    await app.close()
  }
}

/**
 * The agent's own word (2026-09-04): Claude Code writes its state into the
 * terminal title, and the tab follows it at once - no sustain window, no
 * poll. A shell setting the same titles stands in for Claude here, so the
 * check is deterministic and costs no network. The glyphs are typed as code
 * points so nothing non-ASCII goes through the keyboard.
 */
async function agentTitleScenario(fixtures) {
  console.log('agent title')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  // The indicator attributes sit on the tab's WRAPPER, the button's parent.
  const attr = (name) =>
    win.evaluate((n) => document.querySelector('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]')?.parentElement?.getAttribute(n) ?? null, name)
  const state = () => attr('data-agent-state')
  const say = async (glyph, text) => {
    // The title API, not a raw [Console]::Write: that one re-encodes the
    // glyph to "?" on the way through the console (measured). Claude writes
    // its bytes straight to the pty and is not affected.
    await win.keyboard.type(`$Host.UI.RawUI.WindowTitle = "$([char]0x${glyph}) ${text}"`)
    const t = Date.now()
    await win.keyboard.press('Enter')
    return t
  }
  try {
    // THE PROCESS POLL'S FIRST ANSWER IS LISTENED FOR (2026-09-20, #168), and
    // nothing is said through the title until it has come. The poll reports a
    // session only when its answer CHANGES, and a new shell's first answer ("no
    // agent in this tree") is a change from nothing: it lands a few seconds
    // after the spawn and takes a titled session's presence and its working
    // state with it. This scenario typed its first title inside that window and
    // won or lost on how long PowerShell took to list the processes: MEASURED
    // on this machine with a second suite running beside it, 8 runs of 8 lost
    // (one poll event, `false`, and no `data-agent-present` inside ten seconds),
    // two of them on the unchanged base; 5 of 5 won with the wait. After that
    // one answer the poll has nothing more to say about a shell that hosts no
    // agent, so waiting for it is the whole fix. The listener goes up BEFORE the
    // terminal is opened.
    await win.evaluate(() => {
      window.__agentSaid = 0
      window.prism.onTermAgent(() => (window.__agentSaid += 1))
    })
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    // WAITED FOR, not slept for (#165). This slept 3.5 s "for a cold pwsh to
    // prompt" and then typed; on a slow runner the prompt was not there yet, the
    // keystrokes landed in a shell still starting, and the title was never set.
    // The gate merges core bumps by itself now, so a check that depends on how
    // fast the machine is today is a hole in it.
    await win.waitForFunction(
      () => /PS [^>]*>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()),
      null,
      { timeout: 45000 }
    )
    ok(
      await waitUntil(() => win.evaluate(() => window.__agentSaid > 0), 45000),
      'the process poll has had its first look at the shell'
    )
    await win.locator('.xterm').click()
    ok((await state()) === null, 'a plain shell shows no agent state')

    // Claude's birth title is idle; a spinner BEFORE any idle would be the
    // agent starting, which is present and not working.
    await say('2733', 'Claude Code') // ✳
    const present = await waitUntil(async () => (await attr('data-agent-present')) !== null, 10000)
    ok(present && (await state()) === null, 'the idle birth title marks the agent present and nothing else')

    const t1 = await say('25D0', 'Claude Code') // ◐
    await win.waitForFunction(
      () => document.querySelector('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]')?.parentElement?.getAttribute('data-agent-state') === 'working',
      null,
      { timeout: 5000 }
    )
    const startMs = Date.now() - t1
    ok(startMs < 800, `a working title lights the tab at once (${startMs}ms after Enter, shell latency included)`)
    ok((await attr('data-agent-present')) !== null, 'and the title alone marks the agent present, ahead of the poll')

    await sleep(300)
    const t2 = await say('2733', 'Session greeting') // ✳
    await win.waitForFunction(
      () => document.querySelector('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]')?.parentElement?.getAttribute('data-agent-state') !== 'working',
      null,
      { timeout: 5000 }
    )
    const stopMs = Date.now() - t2
    ok(stopMs < 800, `an idle title clears it at once (${stopMs}ms after Enter)`)

    // The shell's own repaints never score for a titled session: a long burst
    // of output is not an answer when the title says idle.
    await win.keyboard.type('1..400 | ForEach-Object { "line $_" }')
    await win.keyboard.press('Enter')
    await sleep(2500)
    ok((await state()) !== 'working', 'output alone does not light a session whose title says idle')

    // The Codex dialect (a braille spinner before the folder name) is common
    // currency - ora and every CLI built on it - so in a shell where the
    // process poll has found no agent it is not taken as one.
    await say('2819', 'yeah') // ⠙
    await sleep(600)
    ok((await state()) !== 'working', 'a braille spinner in a plain shell lights nothing without the poll behind it')
  } finally {
    await app.close()
  }
}

/**
 * The prompt hook must not break the prompt's layout (2026-09-04, owner
 * screenshot: "PS C:\" then fifty blank columns then the tail of the path).
 * PSReadLine redraws the prompt itself on Ctrl+L and after a resize, and
 * counts what it cannot parse as visible text.
 */
async function promptLayoutScenario(fixtures) {
  console.log('prompt layout')
  const { app, win } = await launch(join(fixtures, 'code', 'bad.json'))
  const lastRow = () =>
    win.evaluate(() => {
      const rows = [...document.querySelectorAll('.xterm .xterm-rows > div')].map((r) => r.textContent ?? '')
      return rows.filter((r) => r.trim()).pop() ?? ''
    })
  try {
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(3500)
    await win.keyboard.type('cd nested\\level-two')
    await win.keyboard.press('Enter')
    await sleep(1200)
    const fresh = await lastRow()
    ok(/^PS .*level-two>\s*$/.test(fresh) && !/\s{3,}/.test(fresh), `the prompt draws contiguous after a cd (${JSON.stringify(fresh.trim())})`)
    // Ctrl+L: PSReadLine clears and REDRAWS the prompt from its own idea of it.
    await win.keyboard.press('Control+l')
    await sleep(1200)
    const redrawn = await lastRow()
    ok(/^PS .*level-two>\s*$/.test(redrawn) && !/\s{3,}/.test(redrawn), `and still after PSReadLine redraws it (${JSON.stringify(redrawn.trim())})`)
    // A resize that WRAPS the prompt and one that unwraps it again: ConPTY
    // repaints the line on each, and xterm reflows it on each, and where the
    // two disagree the line comes back with holes (owner screenshot,
    // 2026-09-04: "PS C:\" then blank columns then the tail of the path).
    const resize = async (dx) => {
      await app.evaluate(({ BrowserWindow }, d) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle())
        const [cw, ch] = w.getSize()
        w.setSize(cw + d, ch)
      }, dx)
      await sleep(1500)
    }
    await resize(-700)
    await resize(700)
    const resized = await lastRow()
    ok(/^PS .*level-two>\s*$/.test(resized) && !/\s{3,}/.test(resized), `and after a wrap and an unwrap (${JSON.stringify(resized.trim())})`)
    // And what is typed next lands where ConPTY thinks the cursor is: right
    // after the prompt, not fifty columns along.
    await win.keyboard.type('echo ok')
    await sleep(400)
    const typed = await lastRow()
    ok(/level-two> echo ok\s*$/.test(typed), `typing after the resize lands right after the prompt (${JSON.stringify(typed.trim())})`)
    await win.keyboard.press('Enter')
    await sleep(800)
    // A folder with a Norwegian letter and one with a space.
    mkdirSync(join(fixtures, 'code', 'nested', 'level-two', 'Høst praksis'), { recursive: true })
    // Back to the full width first: the prompt below is long enough to wrap
    // at the narrowed size, and a wrap is not a layout fault.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle())
      const [cw, ch] = w.getSize()
      w.setSize(cw, ch)
    })
    await sleep(600)
    await win.keyboard.type('cd ("H" + [char]0xF8 + "st praksis")')
    await win.keyboard.press('Enter')
    await sleep(1500)
    const nordic = await lastRow()
    ok(/^PS .*praksis>\s*$/.test(nordic) && !/\s{3,}/.test(nordic), `a folder with a Norwegian letter and a space draws contiguous (${JSON.stringify(nordic.trim())})`)
    await win.keyboard.press('Control+l')
    await sleep(1200)
    const nordic2 = await lastRow()
    ok(/^PS .*praksis>\s*$/.test(nordic2) && !/\s{3,}/.test(nordic2), `and after a redraw (${JSON.stringify(nordic2.trim())})`)
  } finally {
    await app.close()
    rmSync(join(fixtures, 'code', 'nested', 'level-two', 'Høst praksis'), { recursive: true, force: true })
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
      win.evaluate(() => document.querySelector('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]')?.parentElement?.getBoundingClientRect().width ?? 0)
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

    // Ctrl+T adds an Explorer tab from inside the project shell, and reverse
    // cycling returns to the same project and terminal.
    await win.locator('.xterm').click()
    const tabsBeforeNew = await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()
    await win.keyboard.press('Control+t')
    await sleep(700)
    ok(
      (await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === tabsBeforeNew + 1,
      'Ctrl+T works while the terminal is focused'
    )
    await win.keyboard.press('Control+Shift+Tab')
    await sleep(400)
    await win.locator('[role="tablist"] [aria-label^="Close"]').last().click()
    await sleep(500)
    ok(
      (await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === tabsBeforeNew,
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

    // Ctrl+W protects an agent while its terminal is focused. The title
    // fixture is the same deterministic signal used by agentTitleScenario.
    await win.locator('.xterm').click()
    await win.keyboard.type('$Host.UI.RawUI.WindowTitle = "$([char]0x2733) Claude Code"')
    await win.keyboard.press('Enter')
    await win.waitForSelector('[data-agent-present]', { timeout: 5000 })
    await win.keyboard.press('Control+w')
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    ok(
      ((await win.locator('[role="dialog"]').textContent()) ?? '').includes('Close the tab and end the agent?'),
      'Ctrl+W asks from inside an agent terminal'
    )
    await win.locator('[role="dialog"] button:has-text("Cancel")').click()
    await sleep(300)
    // THE WINDOW is held only while an agent is MID-ANSWER (#154, the core's
    // close rule): an idle one comes back at the next launch, so closing over
    // it asks nothing - which is why this is checked with a working title.
    await win.locator('.xterm').click()
    await win.keyboard.type('$Host.UI.RawUI.WindowTitle = "$([char]0x25D0) Claude Code"')
    await win.keyboard.press('Enter')
    await win.waitForSelector('[data-agent-state="working"]', { timeout: 5000 })
    await win.evaluate(() => window.prism.close())
    await win.waitForSelector('[role="dialog"]', { timeout: 5000 })
    ok(
      ((await win.locator('[role="dialog"]').textContent()) ?? '').includes('Stop the agent and close the window?'),
      'closing the window over a working agent asks first'
    )
    await win.screenshot({ path: join(SHOTS, 'terminal-close-window.png') })
    await win.locator('[role="dialog"] button:has-text("Cancel")').click()
    await sleep(300)
    ok((await win.locator('.xterm').count()) >= 1, 'and Cancel leaves the window and its shell alone')
    await win.locator('.xterm').click()
    await win.keyboard.type('$Host.UI.RawUI.WindowTitle = "$([char]0x2733) Claude Code"')
    await win.keyboard.press('Enter')
    await win.waitForFunction(() => !document.querySelector('[data-agent-state="working"]'), null, { timeout: 5000 })
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

    if (!HAS_CLAUDE) console.log('  skip  the real-CLI agent checks: no `claude` on this machine (a CI runner)')
    else {
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
    }

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

    // Project terminals stay in the same top-level tab. Their picker and
    // split panes retain independent shells and scrollback.
    const termBtn = () => win.locator('aside [aria-label="Terminal"]')
    const beforeSeparate = await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()
    await win.keyboard.type('echo separate-terminal-survives')
    await win.keyboard.press('Enter')
    await win.waitForFunction(() => document.querySelector('.xterm')?.textContent?.includes('separate-terminal-survives'))
    await termBtn().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.locator('[role="menuitem"]:has-text("Open new terminal")').click()
    await sleep(1500)
    ok((await win.locator('.xterm').count()) === 1, 'a new terminal takes the full view alone')
    ok((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === beforeSeparate, 'the new terminal stays inside the project tab')
    await termBtn().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Terminal 1")').count()) === 1 &&
        (await win.locator('[role="menuitem"]:has-text("Terminal 2")').count()) === 1,
      'the project menu lists both terminal sessions'
    )
    await win.hover('[role="menuitem"]:has-text("Open in split view")')
    await sleep(400)
    await win.locator('[role="menuitem"]:has-text("Terminal 1")').last().click()
    await win.waitForFunction(() => document.querySelectorAll('.xterm').length === 2, null, { timeout: 10000 })
    ok((await win.locator('[data-pane="pinned"] .xterm').count()) === 1, 'the original shell pins beside the new session')
    // WAITED FOR, not read once. The pinned shell's xterm is re-attached into
    // the pane and repaints its rows a frame or two later, so read at once its
    // text is sometimes still empty. This was the suite's one intermittent
    // failure from the day the terminal gate existed (it failed on untouched
    // main too), and it BLOCKED the first automatic core bump (#165): a flaky
    // check is a broken gate. Ten seconds is generous; scrollback that is really
    // lost never comes back, so this still fails when it should.
    const kept = await win
      .waitForFunction(
        () => (document.querySelector('[data-pane="pinned"] .xterm')?.textContent ?? '').includes('separate-terminal-survives'),
        null,
        { timeout: 10000 }
      )
      .then(() => true)
      .catch(() => false)
    ok(kept, 'the original shell retains its scrollback')
    ok((await win.locator('[data-pane="live"]').count()) === 0, 'the full terminal split has no file pane')
    await termBtn().click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.hover('[role="menuitem"]:has-text("Close terminal")')
    await sleep(400)
    await win.locator('[role="menuitem"]:has-text("Terminal 1")').last().click()
    await win.waitForFunction(() => !document.querySelector('[data-pane="pinned"]'), null, { timeout: 10000 })
    ok((await win.locator('.xterm').count()) === 1, 'closing the pinned shell preserves the other project session')
  } finally {
    await app.close()
  }
}

/**
 * A FOLDER handed to Prism from outside (2026-08-25).
 *
 * This is what Explorer's "Open as project", on a folder and on the empty
 * space inside one, actually does: hand over a directory as argv. (It read
 * "Open in Prism" and "Open Prism here" until 2026-09-19, #167; the argv is
 * the same, only the words in the menu moved.)
 * Main used to demand a FILE and drop it on the floor, so the menu entry was
 * there and nothing happened. The tab roots at the folder, and what it shows
 * is the "New projects show" setting (the folder browser by default since
 * #148; it was "New tabs show", shared with the +, before that).
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
    // A FILE WINDOWS HANDS OVER PLAYS (2026-09-14, #139): the launch above is
    // Explorer's double-click, and that is a pick. What does NOT play is a
    // restore (the 2026-08-28 rule) - proved in playOnOpenScenario.
    // The fixture is two seconds long and the launch waits longer than that,
    // so what is read is whether it PLAYED - ended, or past its start.
    const ran = await win.evaluate(() => {
      const v = document.querySelector('video')
      return !!v && (!v.paused || v.ended || v.currentTime > 0.2)
    })
    ok(ran, 'a film Windows handed over played without a click')
    await win.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0 })
    await sleep(300)
    ok((await paused()) === true, 'and pauses when told to')
    await win.evaluate(() => { void document.querySelector('video').play() })
    await sleep(400)
    ok((await paused()) === false, 'and plays when told to')
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
    await win.locator('[data-tab]:not([data-pinned])').first().click()
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
    // 2026-08-28 rule rather than reversing it: a restore still arrives
    // paused. The click is the intent, and since #139 so is Explorer's.
    // Paused AT THE START: the fixtures are two seconds long and the shared
    // profile has autoplay-next on, so what is on screen here may already be
    // ep2, near its end - and a film that ENDS during the wait below reads
    // as paused, which is not what is being asked.
    await win.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0 })
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
    // AND THE ROW OF THE FILM ON SCREEN, picked again, plays it (#139): the
    // element is not remounting, so the intent has to reach the player that
    // holds it. Found by the full run, where autoplay-next had already
    // stepped onto ep2 before the click above, and the click did nothing.
    await win.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0 })
    await sleep(200)
    await win.locator('[role="treeitem"][data-row$="ep2.mp4" i]').first().click()
    await sleep(600)
    ok(
      (await win.evaluate(() => document.querySelector('video')?.paused)) === false,
      'and clicking the row of the paused film on screen plays it'
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
    // The bin is REAL, and so is the loss: the video menu scenario later in
    // the run needs ep2 as its Next video. Stash a copy in the profile (not
    // in the fixtures, where the tree would count it) and put it back once
    // the app has let go.
    copyFileSync(join(fixtures, 'ep2.mp4'), join(PROFILE, 'ep2.stash'))
    await win.locator('[role="dialog"] button:has-text("Delete")').click()
    for (let i = 0; i < 40 && existsSync(join(fixtures, 'ep2.mp4')); i++) await sleep(200)
    ok(!existsSync(join(fixtures, 'ep2.mp4')), 'and a film that was playing is really in the bin')
    ok(
      (await win.locator('[role="dialog"]').count()) === 0,
      'with no "could not be moved" complaint'
    )
  } finally {
    await app.close()
    if (existsSync(join(PROFILE, 'ep2.stash')) && !existsSync(join(fixtures, 'ep2.mp4')))
      copyFileSync(join(PROFILE, 'ep2.stash'), join(fixtures, 'ep2.mp4'))
  }
}

/**
 * Play on open, and NOT on restore (2026-09-14, #139). Explorer's double-click
 * plays (asserted at the head of the pausing scenario, whose launch is that
 * handoff); this is the other half: the same film, back in a RESTORED tab
 * after a relaunch, sits paused - a window full of restored tabs starting
 * every film at once is what the 2026-08-28 rule exists to prevent, and it
 * stands. The relaunch arrives with a file from ANOTHER root so the restored
 * tab is a background tab, and its player mounts when the tab is visited,
 * which is the moment a user meets it.
 */
async function playOnOpenScenario(fixtures) {
  console.log('play on open, not on restore')
  let { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    await win.evaluate(() => { document.querySelector('video').muted = true })
    let playing = true
    await win
      .waitForFunction(() => document.querySelector('video')?.paused === false, null, { timeout: 5000 })
      .catch(() => {
        playing = false
      })
    ok(playing, 'a film handed over by Explorer plays without a click')
    await sleep(700) // tabs.json saves on a 400ms debounce
  } finally {
    await app.close()
  }
  await sleep(900)
  ;({ app, win } = await launch(join(OTHER_ROOT, 'bad.json'), true))
  try {
    const strip = '[role="tablist"]'
    await win.waitForSelector(strip, { timeout: 10000 })
    const rows = win.locator(`${strip} [data-tab-role]:not([data-pinned]) [role="tab"]`)
    ok((await rows.count()) === 2, `the film's tab came back beside the new one (${await rows.count()})`)
    await rows.filter({ hasNotText: 'other' }).first().click()
    await win.waitForSelector('video', { timeout: 15000 })
    await win.evaluate(() => { document.querySelector('video').muted = true })
    await sleep(1500)
    const state = await win.evaluate(() => {
      const v = document.querySelector('video')
      return v ? { paused: v.paused, src: decodeURIComponent(v.currentSrc || v.src || '') } : null
    })
    // ep1 or ep2: the shared profile has autoplay-next on, and a two-second
    // film that played has handed over to the next by the time it is closed.
    ok(/ep[12]/i.test(state?.src ?? ''), `the restored tab holds the film (${state?.src.slice(-20)})`)
    ok(state?.paused === true, 'and a RESTORED film is not playing')
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
      await win.waitForFunction(() => {
        const sidebar = document.querySelector('aside[aria-hidden="false"]')
        return !!sidebar && !sidebar.textContent.includes('searching…') &&
          (!!sidebar.querySelector('[aria-label="Search results"]') || sidebar.textContent.includes('nothing matches'))
      }, null, { timeout: 15000 })
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
    const tabCount = () => win.locator('[data-tab]:not([data-pinned])').count()
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
    await win.locator('[data-tab]:not([data-pinned])').first().click()
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
  // THIS SCENARIO ASSERTS A DEFAULT, SO IT HAS TO OWN IT (2026-09-20). The
  // profile is shared, and `tabs` leaves "New projects show" on 'file' behind
  // it. MEASURED: that leftover is the only reason the old assertion ("one of
  // its files is open") passed in the full suite after #148 while failing on
  // its own, and the first rewrite of it was the mirror image, green alone and
  // red in the suite, which is the PR gate. The folder is delivered on first
  // load, so the setting cannot be put right after the launch that matters:
  // it gets a short launch of its own first, and what was there is put back
  // at the end so the scenarios after this one see what they always saw.
  const showBefore = await (async () => {
    const prep = await launch(join(fixtures, 'README.md'))
    try {
      const was = await prep.win.evaluate(() => {
        const value = localStorage.getItem('prism.newtab.show')
        localStorage.removeItem('prism.newtab.show')
        return value
      })
      // Chromium commits localStorage to disk a moment after the call, and
      // there is nothing on the page to wait on for that; seedProfile gives it
      // the same 300ms. It is not trusted: the launch below CHECKS that the
      // setting really arrived unset, so a lost write is a named failure here
      // rather than two baffling ones further down.
      await sleep(300)
      return was
    } finally {
      await prep.app.close()
    }
  })()
  const { app, win } = await launch(fixtures)
  try {
    ok(
      (await win.evaluate(() => localStorage.getItem('prism.newtab.show'))) === null,
      '"New projects show" is at its default for this launch, whatever ran before'
    )
    const body = (await win.textContent('body')) ?? ''
    ok(/README\.md/.test(body), 'the tree lists the folder that was handed over')
    ok((await win.locator('[data-row]').count()) > 2, 'and it is rooted there, not at a file')
    // It opens AS A PROJECT: a tab of its own beside the pinned Explorer tab,
    // showing what "New projects show" says. This used to assert "one of its
    // files is open", which was that setting's default until #148 made it the
    // folder browser ('none'); the assertion was left behind, failing on its
    // own and passing in the suite on another scenario's leftover setting (see
    // the top of this function). It WAITS for the settled state: a single read
    // raced the tab's first render.
    ok(
      await win
        .locator('[data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]', {
          hasText: 'fixtures'
        })
        .waitFor({ timeout: 8000 })
        .then(() => true, () => false),
      'it opens as a project tab of its own, in front'
    )
    ok(
      await win
        .getByText('No file selected')
        .waitFor({ timeout: 8000 })
        .then(() => true, () => false),
      'showing the default "New projects show": the folder, with no file picked for you'
    )
    ok(
      (await win.locator('[role="treeitem"][aria-selected="true"]').count()) === 0,
      'so nothing in the tree is marked as open'
    )

    // The Explorer menu's own words (2026-09-19, #167): "Open file" and "Open
    // as project", neither naming Prism, and Settings has to teach the words
    // the menu actually shows. The hint reads "Asking Windows…" until main has
    // answered, so this WAITS for the settled text rather than reading once.
    // Nothing here writes the registry: under --e2e the setting is not
    // `automatic`, so it only ever reports what Windows says.
    await win.click('[aria-label="Settings"]')
    // Settings opens on Style; the Explorer menu row lives on General.
    await win.click('button:has-text("General")')
    const verbRow = win.locator('label[for="explorer-verb"]')
    await verbRow.waitFor({ timeout: 10000 })
    await verbRow.scrollIntoViewIfNeeded()
    const hint = await win
      .waitForFunction(
        () => {
          const text =
            document.querySelector('label[for="explorer-verb"]')?.parentElement?.querySelector('p')
              ?.textContent ?? ''
          return /right-click menu/.test(text) ? text : false
        },
        null,
        { timeout: 10000 }
      )
      .then((h) => h.jsonValue())
      .catch(() => '')
    ok(
      /"Open file"/.test(hint) && /"Open as project"/.test(hint),
      'Settings names the two entries the Explorer menu shows'
    )
    ok(!/Open in Prism|Open Prism here/.test(hint), 'and the old labels are gone from it')
    // A Pref's hint is ONE line and TRUNCATES (`truncate`), and the new words
    // made this one a sixth longer, with the part a Windows 11 user needs most,
    // "(Shift+F10)", at the very end where an ellipsis eats first. MEASURED
    // rather than eyeballed: at the fresh profile's default window the text
    // must fit its box. The hint is settled by now, so this reads once.
    const clipped = await win.evaluate(() => {
      const p = document.querySelector('label[for="explorer-verb"]')?.parentElement?.querySelector('p')
      return p ? { text: p.scrollWidth, box: p.clientWidth } : null
    })
    ok(
      !!clipped && clipped.text <= clipped.box,
      `and the whole hint fits on its line, Shift+F10 included (${clipped?.text}px in ${clipped?.box}px)`
    )
    // The switch settles in the same render as the hint and then ANIMATES
    // there; a screenshot taken on the first frame showed a switch that read
    // as off on a machine where the verb is on. Wait for its transitions to
    // end. Which way it points is this machine's registry and is not asserted.
    await win
      .waitForFunction(
        () => {
          const sw = document.querySelector('[role="switch"][aria-label="Prism in the Explorer menu"]')
          return !!sw && sw.getAnimations({ subtree: true }).length === 0
        },
        null,
        { timeout: 5000 }
      )
      .catch(() => {})
    await win.screenshot({ path: join(SHOTS, 'explorer-verb-setting.png') })
  } finally {
    if (showBefore !== null)
      await win
        .evaluate((was) => localStorage.setItem('prism.newtab.show', was), showBefore)
        .catch(() => {})
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
      // THE DROP LINE (#126): a drag over a file row in the ROOT draws a line
      // under that row, since the root has no row to light; the space under
      // the list draws it under the last row. Synthetic dragover events, so
      // the mid-drag state can be read - a real drop is what dragTo below does.
      const lineUnder = () =>
        win.evaluate(() => {
          const line = document.querySelector('aside [data-drop-line]')
          const li = line?.closest('li')
          return line ? (li?.querySelector('[data-row]')?.getAttribute('data-row') ?? 'end') : null
        })
      await win.evaluate(() => {
        const row = [...document.querySelectorAll('aside [role="treeitem"]')].find((r) => (r.textContent ?? '').includes('anchor.txt'))
        row?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
      })
      ok(/anchor\.txt$/.test((await lineUnder()) ?? ''), `a drag over a file in the root draws the line under that row (${await lineUnder()})`)
      await win.evaluate(() => {
        const scroller = document.querySelector('aside [role="tree"]')?.parentElement ?? document.querySelector('aside')
        const rows = [...document.querySelectorAll('aside [data-dropdir]')]
        const last = rows[rows.length - 1]?.getBoundingClientRect()
        scroller?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: (last?.bottom ?? 0) + 40, dataTransfer: new DataTransfer() }))
      })
      ok((await lineUnder()) === 'end', `and beneath the list it draws under the last row (${await lineUnder()})`)
      await win.evaluate(() => {
        const scroller = document.querySelector('aside [role="tree"]')?.parentElement ?? document.querySelector('aside')
        scroller?.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))
      })
      ok((await lineUnder()) === null, 'and leaving takes the line away')
      // THE HOVERED FOLDER IS MARKED IN GREY (#140): a fill and no accent
      // ring, since the accent means selected. Read off the computed style
      // mid-drag, the same synthetic dragover as the line above.
      const findInto = () => [...document.querySelectorAll('aside [role="treeitem"]')].find((r) => (r.textContent ?? '').trim().startsWith('into'))
      await win.evaluate((find) => {
        const row = eval(find)()
        row?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
      }, findInto.toString())
      await sleep(150) // the mark is state, and lands on the next render
      const overInto = await win.evaluate((find) => {
        const row = eval(find)()
        if (!row) return null
        const marked = row.hasAttribute('data-drop') ? row : row.querySelector('[data-drop]')
        const cs = getComputedStyle(marked ?? row)
        return { drop: !!marked, shadow: cs.boxShadow, bg: cs.backgroundColor }
      }, findInto.toString())
      await win.evaluate((find) => {
        eval(find)()?.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))
      }, findInto.toString())
      ok(overInto?.drop === true, 'a drag over a folder row marks that row')
      ok(overInto?.shadow === 'none', `and the mark is a fill, with no ring (${overInto?.shadow})`)
      ok(
        !!overInto && overInto.bg !== 'rgba(0, 0, 0, 0)' && overInto.bg !== 'transparent',
        `the marked folder is filled (${overInto?.bg})`
      )
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
        !/dragbox.into/i.test((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').first().getAttribute('title')) ?? ''),
        'and the tab did not re-root onto what was dragged'
      )
    } finally {
      await app.close()
    }
  }
  await sleep(900)
  // MOVING THE FILE YOU ARE WATCHING (#127). A film being played is a file
  // Prism holds open, and Windows refuses to move a file anything holds
  // (MEASURED: EBUSY). Prism lets go first, moves, and follows the film to
  // where it landed at the second it was at, still playing.
  {
    const film = join(box, 'watching.mp4')
    const { app, win } = await launch(film)
    try {
      await win.waitForSelector('video', { timeout: 10000 })
      await win.evaluate(() => {
        const v = document.querySelector('video')
        v.muted = true
        void v.play().catch(() => {})
      })
      await win.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.6, null, { timeout: 10000 })
      const before = await win.evaluate(() => document.querySelector('video')?.currentTime ?? 0)
      await win
        .locator('[role="treeitem"]:has-text("watching.mp4")')
        .dragTo(win.locator('[role="treeitem"]:has-text("into")').first())
      let followed = true
      await win
        .waitForFunction(
          () => {
            const v = document.querySelector('video')
            return !!v && /into/i.test(decodeURIComponent(v.currentSrc || '')) && v.currentTime > 0.3 && !v.paused
          },
          null,
          { timeout: 12000 }
        )
        .catch(() => {
          followed = false
        })
      const after = await win.evaluate(() => {
        const v = document.querySelector('video')
        return { t: v?.currentTime ?? -1, src: decodeURIComponent(v?.currentSrc ?? '') }
      })
      ok(existsSync(join(box, 'into', 'watching.mp4')) && !existsSync(film), 'the film you are watching really moved into the folder')
      ok(followed, `and the viewer followed it there, playing (${after.src.split(/[\\/]/).slice(-2).join('/')})`)
      ok(after.t >= before - 0.5, `at the second it was at (was ${before.toFixed(2)}, now ${after.t.toFixed(2)})`)
      ok(!/could not be moved/.test((await win.locator('body').textContent()) ?? ''), 'and nothing complained')
    } finally {
      await app.close()
    }
  }
  await sleep(900)
  // THE OWNER'S REAL CASE: a Dolby film, whose sound is an ffmpeg of Prism's
  // own decoding the file beside the picture. That ffmpeg holds the file
  // with the CRT's share mode, and letting the element go is not enough.
  {
    const film = join(box, 'dolby-watching.mkv')
    const { app, win } = await launch(film)
    try {
      await win.waitForSelector('video', { timeout: 10000 })
      await win.evaluate(() => {
        const v = document.querySelector('video')
        v.muted = true
        void v.play().catch(() => {})
      })
      await win.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.6, null, { timeout: 10000 })
      await win.waitForFunction(() => !!document.querySelector('audio[src^="fsaudio:"]'), null, { timeout: 10000 }).catch(() => {})
      const sidecar = await win.evaluate(() => !!document.querySelector('audio[src^="fsaudio:"]'))
      ok(sidecar, 'the Dolby sound is on through the sidecar decoder')
      await win
        .locator('[role="treeitem"]:has-text("dolby-watching.mkv")')
        .dragTo(win.locator('[role="treeitem"]:has-text("into")').first())
      let followed = true
      await win
        .waitForFunction(
          () => /into/i.test(decodeURIComponent(document.querySelector('video')?.currentSrc || '')),
          null,
          { timeout: 12000 }
        )
        .catch(() => {
          followed = false
        })
      const body = (await win.locator('body').textContent()) ?? ''
      ok(existsSync(join(box, 'into', 'dolby-watching.mkv')) && !existsSync(film), `the Dolby film you are watching really moved${/could not be moved/.test(body) ? ' (but Prism said: ' + body.match(/could not be moved[^.]*\./)?.[0] + ')' : ''}`)
      ok(followed, 'and the viewer followed it there')
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
      // The drag used to show NOTHING while it extracted (#166): it is the
      // same window now as every other way of extracting.
      await throughTheWindow(win, 'a member dragged onto a sidebar folder', 'dragzip.zip', () =>
        win
          .locator('[role="listbox"] [role="option"]', { hasText: 'carry.txt' })
          .first()
          .dragTo(win.locator('aside [role="treeitem"]:has-text("out")').first())
      )
      ok(existsSync(join(out, 'carry.txt')), 'a member dragged out of the zip landed in the folder')
      // A FOLDER dragged onto the tab strip opens as a tab of its own.
      const tabsBefore = await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()
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
        (await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === tabsBefore + 1,
        'a folder dropped on the tab strip opens a tab'
      )

      // Dropping one of Prism's OWN rows on the viewer opens it there, and the
      // text editor no longer steals the drag to walk its caret about.
      await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').first().click()
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

/**
 * Prism on your phone (2026-09-06, #104): the server comes up on the switch,
 * a phone pairs with the tab's code, browses the folder and plays a picture
 * and a film over the LAN routes, and a phone the PC forgets is back on the
 * pairing screen. Under --e2e the server binds loopback only, so the
 * "phone" is a second window of the app's own Chromium on 127.0.0.1.
 *
 * The film's FULLSCREEN is proved here too (2026-09-07): the control is on
 * the player, and the standard route still puts the PAGE fullscreen, header
 * and all. Only that one route, on purpose - this host has the standard API,
 * so the prefixed and the iOS branch belong to `fullscreen.test.ts`, which
 * asks hosts written to have nothing else.
 */
/**
 * Switch the phone server on from the renderer, the way the dialog does, and
 * pair one phone over HTTP the way the phone does (2026-09-06, #105: shared
 * by the pairing scenario and the HLS one). The active tab's title attribute
 * IS its root (TabStrip's role="tab"). Returns the server's state as
 * reported, the pairing response status, and what the phone was handed.
 */
async function pairPhone(win) {
  const state = await win.evaluate(() =>
    window.prism.phoneSetOn(
      true,
      document.querySelector('[data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]')?.getAttribute('title') ?? null
    )
  )
  const base = `http://127.0.0.1:${state.port}`
  const r = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: state.code?.code ?? '', name: 'e2e phone' })
  })
  const { token, root } = r.status === 200 ? await r.json() : { token: '', root: '' }
  return { base, token, root, state, status: r.status }
}

async function phoneScenario(fixtures) {
  console.log('phone: pair, browse, play over the LAN server')
  const { app, win } = await launch(join(fixtures, 'one.png'))
  let page = null
  try {
    const { base, token, root, state, status } = await pairPhone(win)
    ok(state.on === true, 'the server reports on')
    ok(typeof state.port === 'number', 'the server has a port')
    ok(state.addresses[0] === '127.0.0.1', 'under --e2e it binds loopback only')
    ok(
      !!state.code && /^[A-Z2-9]{6}$/.test(state.code.code),
      'a six-character code is issued for the tab'
    )
    ok(!!state.code && state.code.svg.startsWith('<svg'), 'the QR renders as SVG')
    ok(status === 200, 'pairing succeeds')
    ok(root.toLowerCase() === fixtures.toLowerCase(), 'the phone is paired to the tab root')
    ok((await fetch(`${base}/api/me`)).status === 401, 'no token, no answer')
    const auth = { authorization: `Bearer ${token}` }
    const dir = await (
      await fetch(`${base}/api/dir?path=${encodeURIComponent(fixtures)}`, { headers: auth })
    ).json()
    ok(dir.files.some((f) => f.name === 'one.png'), 'the listing carries the fixture')
    const outside = await fetch(`${base}/api/dir?path=${encodeURIComponent('C:\\Windows')}`, {
      headers: auth
    })
    ok(outside.status === 403, 'a path outside the root is refused')
    const ranged = await fetch(
      `${base}/m/${encodeURIComponent(join(fixtures, 'ep1.mp4'))}?t=${token}`,
      { headers: { range: 'bytes=0-99' } }
    )
    ok(
      ranged.status === 206 && (ranged.headers.get('content-range') ?? '').startsWith('bytes 0-99/'),
      'media answers a Range with 206'
    )
    await ranged.arrayBuffer()

    // The dialog on the PC lists the phone.
    await win.click('[aria-label="Tools"]')
    await win.click('[role="menuitem"]:has-text("Phone")')
    await win.waitForSelector('[data-phone-dialog]', { timeout: 5000 })
    await win.waitForSelector('[data-phone-row]', { timeout: 5000 }).catch(() => {})
    ok((await win.locator('[data-phone-row]').count()) === 1, 'the dialog lists the paired phone')
    await win.screenshot({ path: join(SHOTS, 'phone-dialog.png') })
    await win.keyboard.press('Escape')

    // The phone page itself. A spent code lands on the pairing screen.
    page = await openPhoneWindow(app, `${base}/?code=${state.code.code}`)
    // A FINGER rather than a pointer (2026-09-08, #107): Chromium's touch
    // emulation is what flips `(pointer: coarse)` and what makes a dispatched
    // touch arrive as a touch pointer, which is the whole difference between
    // this page and the app window. Set before the page is loaded again, so
    // everything below is laid out and pressed the way a phone lays it out
    // and presses it.
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    await page.waitForSelector('[data-phone-pairing]', { timeout: 10000 })
    ok(true, 'a spent code lands on the pairing screen')
    // A second code for the same tab: the first was spent above.
    const again = await win.evaluate(() =>
      window.prism.phoneCode(
        document.querySelector('[data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]')?.getAttribute('title') ?? ''
      )
    )
    ok(!!again.code && again.code.code !== state.code.code, 'a fresh code replaces the spent one')
    await page.goto(`${base}/?code=${again.code.code}`)
    await page.waitForSelector('[data-phone-file]', { timeout: 10000 })
    ok(
      (await page.locator('[data-phone-file][data-kind="image"]').count()) >= 1,
      'the phone lists pictures'
    )

    // SIZED FOR A THUMB (2026-09-08, owner, after an iPad: the rows in the
    // file explorer are too small). 44px is the platform floor rather than a
    // taste - Apple asks for 44pt, Google for 48dp - and the ROW is deliberately
    // taller again, because a list is scrolled past as well as tapped. Measured
    // rather than read off the stylesheet: the row's height is a Tailwind class
    // reading a token in another file, and a measurement is the only thing that
    // proves the two still meet.
    ok(
      await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      'the emulated phone reports a coarse pointer'
    )
    const rowH = await page
      .locator('[data-phone-file]')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height)
    ok(rowH >= 44, `an explorer row is at least a finger tall (${rowH}px)`)

    // LIST OR GRID (#135): the header's pair switches the folder to tiles,
    // a picture tile's thumbnail arrives from the PC over /api/thumb, and
    // the choice survives a reload.
    ok((await page.locator('[data-phone-view="list"][aria-pressed="true"]').count()) === 1, 'the list is the view to begin with')
    await page.click('[data-phone-view="grid"]')
    await page.waitForSelector('[data-phone-grid]', { timeout: 5000 })
    ok((await page.locator('[data-phone-grid] [data-phone-file]').count()) >= 1, 'the grid shows the files as tiles')
    // THE NAME IS A CAPTION UNDER THE TILE, CENTRED (#143): its box starts
    // below the square's bottom edge, and its text is centred on the square.
    const tileName = await page.evaluate(() => {
      const tile = document.querySelector('[data-phone-grid] [data-phone-file]')
      const box = tile?.querySelector('span')?.getBoundingClientRect()
      const nameEl = tile?.querySelector('[data-phone-tile-name]')
      const name = nameEl?.getBoundingClientRect()
      if (!box || !name) return null
      return {
        below: name.top >= box.bottom - 1,
        centred: Math.abs(name.left + name.width / 2 - (box.left + box.width / 2)) < 2,
        align: getComputedStyle(nameEl).textAlign
      }
    })
    ok(tileName?.below === true, "a tile's name sits under its box")
    ok(tileName?.centred === true && tileName?.align === 'center', 'and is centred on it')
    // AND THE LIST/GRID PAIR IS A TOGGLE (#143): one pill, the active half
    // filled, the other not.
    const toggle = await page.evaluate(() => {
      const on = document.querySelector('[data-phone-view][aria-pressed="true"]')
      const off = document.querySelector('[data-phone-view][aria-pressed="false"]')
      const pill = document.querySelector('[data-phone-view-toggle]')
      if (!on || !off || !pill) return null
      const bg = (el) => getComputedStyle(el).backgroundColor
      return { onBg: bg(on), offBg: bg(off), samePill: on.parentElement === pill && off.parentElement === pill }
    })
    ok(toggle?.samePill === true, 'list and grid share one pill')
    ok(!!toggle && toggle.onBg !== toggle.offBg && toggle.onBg !== 'rgba(0, 0, 0, 0)', `the active half is filled (${toggle?.onBg} against ${toggle?.offBg})`)
    await page.screenshot({ path: join(SHOTS, 'phone-grid.png') })
    await page
      .waitForFunction(() => [...document.querySelectorAll('[data-phone-thumb]')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 })
      .catch(() => {})
    const thumbW = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-phone-thumb]')].map((i) => i.naturalWidth)))
    ok(thumbW > 0 && thumbW <= 320, `a picture tile's thumbnail arrives from the PC (${thumbW}px wide)`)
    await page.reload()
    await page.waitForSelector('[data-phone-grid]', { timeout: 10000 })
    ok((await page.locator('[data-phone-view="grid"][aria-pressed="true"]').count()) === 1, 'and the grid is still the view after a reload')
    await page.click('[data-phone-view="list"]')
    await page.waitForSelector('[data-phone-file]:not([data-phone-grid] *)', { timeout: 5000 })
    await page.click('[data-phone-file]:has-text("one.png")')
    await page.waitForSelector('[data-phone-viewer][data-kind="image"] img', { timeout: 10000 })
    await page
      .waitForFunction(
        () => (document.querySelector('[data-phone-viewer] img')?.naturalWidth ?? 0) > 0,
        null,
        { timeout: 10000 }
      )
      .catch(() => {})
    const natural = await page
      .locator('[data-phone-viewer] img')
      .first()
      .evaluate((el) => el.naturalWidth)
    ok(natural > 0, 'the picture loads over the LAN route')
    await page.screenshot({ path: join(SHOTS, 'phone-image.png') })
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[data-phone-file]:has-text("ep1.mp4")')
    await page.waitForSelector('[data-phone-viewer][data-kind="video"] video', { timeout: 10000 })
    let ready = true
    await page
      .waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1, null, {
        timeout: 15000
      })
      .catch(() => {
        ready = false
      })
    ok(ready, 'the video has metadata over the LAN route')
    // A TAPPED FILM PLAYS (2026-09-14, #139): the tap on the row above is the
    // pick, and nothing here has pressed play.
    let tapped = true
    await page
      .waitForFunction(() => document.querySelector('video')?.paused === false, null, { timeout: 5000 })
      .catch(() => {
        tapped = false
      })
    ok(tapped, 'a film the phone was tapped onto is playing, with no play pressed')
    await page.screenshot({ path: join(SHOTS, 'phone-video.png') })

    /*
     * A TAP ASKS FOR THE CONTROLS, AND THE NEXT ONE PAUSES (2026-09-08,
     * owner, after an iPad). A mouse has a pointer on screen, so a click on a
     * bare picture pausing is what the desktop has always done and still
     * does; a finger has none, so the first tap after the chrome hid was a
     * pause nobody asked for. Three things are asserted, and the middle one
     * is the whole point: the film is STILL PLAYING after the tap that
     * brought the controls back.
     *
     * The taps are dispatched as touches rather than clicked, because the
     * rule is the POINTER TYPE (`lib/tapChrome`): a click here would be a
     * mouse and would prove the desktop's behaviour instead.
     */
    const tapAt = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    // Out of the transport's way first: hiding is decided from what is TRUE
    // when the clock fires, the bar's own `:hover` included, and the pointer
    // was last left on the row that opened the file.
    await page.mouse.move(5, 5)
    await page.evaluate(() => {
      const v = document.querySelector('video')
      v.muted = true
      // LOOPED, because the fixture film is 1.5 seconds and the chrome hides
      // after 2.6: a film that ends is a film that is paused, and the clock
      // never hides the controls over a paused picture. Measured the hard way
      // - the first run of this asserted a hide that could not happen.
      v.loop = true
      void v.play().catch(() => {})
    })
    await page.waitForSelector('[data-transport-row] button', { timeout: 10000 })
    const btnH = await page
      .locator('[data-transport-row] button')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height)
    ok(btnH >= 44, `a transport button is at least a finger tall (${btnH}px)`)
    // The transport MOUNTS and UNMOUNTS rather than fading, so its absence is
    // the chrome being down. It only hides while the film is PLAYING.
    const hid = await page
      .waitForSelector('[data-transport-row]', { state: 'detached', timeout: 10000 })
      .then(
        () => true,
        () => false
      )
    ok(hid, 'the chrome hides itself while the film plays')
    const stage = await page.locator('[data-phone-stage]').boundingBox()
    await tapAt(stage.x + stage.width / 2, stage.y + stage.height / 2)
    const backUp = await page
      .waitForSelector('[data-transport-row]', { timeout: 5000 })
      .then(
        () => true,
        () => false
      )
    ok(backUp, 'a tap with the chrome hidden brings the controls back')
    ok(
      await page.evaluate(() => document.querySelector('video')?.paused === false),
      'and the film is still playing, which is what a phone means by that tap'
    )
    // Clear of the double-tap window (which goes fullscreen) and well inside
    // the chrome's own 2.6s clock, so the second tap is one with the controls
    // showing rather than a second reveal.
    await sleep(700)
    await tapAt(stage.x + stage.width / 2 + 40, stage.y + stage.height / 2)
    const paused = await page
      .waitForFunction(() => document.querySelector('video')?.paused === true, null, {
        timeout: 5000
      })
      .then(
        () => true,
        () => false
      )
    ok(paused, 'and a second tap, with them showing, pauses')

    // Fullscreen, on the player that could not (2026-09-07, owner: "i cant go
    // fullscreen in the player on mobile"). Two things only are asserted here,
    // and the second one is why: the control IS on a film, and the STANDARD
    // route still enters fullscreen and takes the phone's header with it, so
    // the host that every desktop and Android has behaves exactly as it did.
    // The other two routes cannot be reached from here at all - the app's own
    // Chromium standing in for the phone HAS `requestFullscreen`, and a route
    // is picked by what the host has - so the prefixed and the iOS branch are
    // `fullscreen.test.ts`'s, against hosts written to have only those. A
    // browser that has the standard API can prove nothing about an iPhone.
    const fsButton = page.locator('[data-phone-viewer] button[title="Fullscreen (F)"]')
    // The transport MOUNTS and UNMOUNTS rather than fading, so the button
    // exists only while the chrome is awake; a move wakes it either way.
    await page.mouse.move(195, 700)
    await fsButton.first().waitFor({ timeout: 10000 })
    ok(true, 'a film on the phone carries the fullscreen control')
    await fsButton.first().click()
    const wentFull = await page
      .waitForFunction(() => document.fullscreenElement === document.documentElement, null, {
        timeout: 5000
      })
      .then(
        () => true,
        () => false
      )
    ok(wentFull, 'the standard route puts the page itself fullscreen')
    // WAITED FOR, not counted: `fullscreenElement` is set the moment the host
    // says yes and the header goes one render later, so a count taken on the
    // same tick is a coin toss rather than a check.
    const headerGone = await page
      .waitForSelector('[data-phone-title]', { state: 'detached', timeout: 5000 })
      .then(
        () => true,
        () => false
      )
    ok(headerGone, 'and the header goes with it, which is what the page-first order buys')
    // Left through the DOCUMENT, which is the API's one asymmetry, and the
    // way back must come from the host rather than from the tap: a header
    // that stayed hidden is a page with no way back to the folder.
    await page.evaluate(() => document.exitFullscreen?.())
    await page.waitForSelector('[data-phone-title]', { timeout: 5000 })
    ok(true, 'leaving it again brings the header back, heard from the host')

    // The page paired with nothing in its storage, so it is a SECOND phone
    // with a token of its own beside the one Node paired above.
    const pageToken = await page.evaluate(() => localStorage.getItem('prism.phone.token'))
    ok(
      typeof pageToken === 'string' && pageToken.length > 0 && pageToken !== token,
      'the page paired as its own phone'
    )

    // Forget both from the PC: the phone's next request is a 401 and it re-pairs.
    const after = await win.evaluate(async (toks) => {
      for (const t of toks) await window.prism.phoneForget(t, null)
      return window.prism.phoneGet(null)
    }, [token, pageToken])
    ok(after.phones.length === 0, 'the dialog lists nobody once both are forgotten')
    await page.click('[aria-label="Back to the folder"]')
    await page.reload()
    await page.waitForSelector('[data-phone-pairing]', { timeout: 10000 })
    ok(true, 'a forgotten phone lands on the pairing screen')
    ok(
      (await fetch(`${base}/api/me`, { headers: auth })).status === 401,
      'the forgotten token is refused'
    )
  } finally {
    await page?.close().catch(() => {})
    // Off again, or the profile's phone.json carries the switch into every
    // scenario after this one.
    await win.evaluate(() => window.prism.phoneSetOn(false, null)).catch(() => {})
    await app.close()
  }
}

/**
 * The phone's transcode (2026-09-06, #105). The route first, from Node, with
 * a `can` list a phone without Dolby or MKV would send: the answer, the
 * playlist Prism writes up front, the first segment timed, init.mp4, the
 * last segment, and a picture that has to be re-encoded (Xvid). Then the
 * stream is PLAYED, in the app's own Chromium standing in for an Android:
 * it has no native HLS, so hls.js feeds the element through MSE, and a seek
 * has to land where the playlist says, which is what `-copyts` is for.
 */
async function phoneHlsScenario(fixtures) {
  console.log('phone: an mkv with Dolby audio plays over HLS, and seeks')
  const dolby = join(fixtures, 'av', 'dolby.mkv')
  const { app, win } = await launch(dolby)
  let page = null
  try {
    const { base, token, status } = await pairPhone(win)
    ok(status === 200, 'the phone pairs')
    const auth = { authorization: `Bearer ${token}` }
    const can = 'h264,aac,mp4,mse'
    const play = await (
      await fetch(`${base}/api/play?path=${encodeURIComponent(dolby)}&can=${can}`, { headers: auth })
    ).json()
    ok(play.mode === 'hls' && play.copyVideo === true, 'an h264 mkv with ac3 is HLS with the picture copied')
    // A file's tracks ride on the answer (#120), and a pick is its own job.
    // tracks.mkv, not dolby.mkv: the Dolby fixture's whole point is a track
    // the element cannot play, and a second, playable one would make it hear.
    const tracksFile = join(fixtures, 'av', 'tracks.mkv')
    const two = await (
      await fetch(`${base}/api/play?path=${encodeURIComponent(tracksFile)}&can=${can}`, { headers: auth })
    ).json()
    ok(Array.isArray(two.tracks) && two.tracks.length === 2 && two.tracks[1].title === 'Commentary', `the answer lists both audio tracks (${JSON.stringify(two.tracks)})`)
    const commentary = two.tracks?.[1]?.index
    const picked = await (
      await fetch(`${base}/api/play?path=${encodeURIComponent(tracksFile)}&can=${can}&audio=${commentary}`, { headers: auth })
    ).json()
    ok(picked.mode === 'hls' && picked.audio === commentary && picked.url !== two.url, 'a picked track is a different stream')
    ok(Math.abs(play.duration - 6) < 1, `the answer carries the duration (${play.duration}s)`)
    ok(/^\/hls\/[0-9a-f]{16}\/index\.m3u8\?t=/.test(play.url ?? ''), 'the stream url names a job and carries the token')
    const at = (name) => `${base}${play.url.replace('index.m3u8', name)}`
    const pl = await (await fetch(at('index.m3u8'))).text()
    ok(
      pl.includes('#EXT-X-PLAYLIST-TYPE:VOD') && pl.includes('1.m4s') && pl.trim().endsWith('#EXT-X-ENDLIST'),
      'the playlist lists every segment up front, and ends'
    )
    const t0 = Date.now()
    const seg0 = await fetch(at('0.m4s'))
    const seg0Bytes = seg0.status === 200 ? (await seg0.arrayBuffer()).byteLength : 0
    ok(seg0.status === 200 && seg0Bytes > 1000, `segment 0 arrives (${Date.now() - t0}ms, ${seg0Bytes} bytes)`)
    const init = await fetch(at('init.mp4'))
    ok(init.status === 200 && (await init.arrayBuffer()).byteLength > 0, 'init.mp4 arrives')
    const seg1 = await fetch(at('1.m4s'))
    ok(seg1.status === 200 && (await seg1.arrayBuffer()).byteLength > 0, 'the last segment arrives')
    ok((await fetch(at('9.m4s'))).status === 404, 'a segment past the film is refused')
    // A second phone, paired on a fresh code for the same tab: the job is
    // the first phone's, and the answer is 404 rather than 403, which would
    // confirm that a stream exists.
    const again = await win.evaluate(() =>
      window.prism.phoneCode(
        document.querySelector('[data-tab-role]:not([data-pinned]) [role="tab"][aria-selected="true"]')?.getAttribute('title') ?? ''
      )
    )
    const other = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: again.code?.code ?? '', name: 'e2e phone two' })
    })
    const otherToken = other.status === 200 ? (await other.json()).token : ''
    ok(
      !!otherToken && (await fetch(`${base}${play.url.replace(/t=.*$/, `t=${otherToken}`)}`)).status === 404,
      'another phone gets no stream'
    )

    const xvidFile = join(fixtures, 'av', 'xvid.avi')
    const xvid = await (
      await fetch(`${base}/api/play?path=${encodeURIComponent(xvidFile)}&can=${can}`, { headers: auth })
    ).json()
    ok(xvid.mode === 'hls' && xvid.copyVideo === false, 'xvid is re-encoded')
    const tx = Date.now()
    const xseg = await fetch(`${base}${xvid.url.replace('index.m3u8', '0.m4s')}`)
    const xBytes = xseg.status === 200 ? (await xseg.arrayBuffer()).byteLength : 0
    ok(
      xseg.status === 200 && xBytes > 1000,
      `a re-encoded segment arrives (${Date.now() - tx}ms, nvenc or openh264 if the GPU refused)`
    )

    // Playback through hls.js in the app's Chromium, which has no native
    // HLS. The page is handed Node's token, so it is the same phone and the
    // same job as above.
    page = await openPhoneWindow(app, `${base}/`)
    await page.evaluate((t) => localStorage.setItem('prism.phone.token', t), token)
    await page.reload()
    // The tab is rooted at the film's own folder, so the file is on the
    // first screen.
    await page.waitForSelector('[data-phone-file]', { timeout: 10000 })
    await page.click('[data-phone-file]:has-text("dolby.mkv")')
    await page.waitForSelector('[data-phone-viewer][data-kind="video"] video', { timeout: 10000 })
    // hls.js owns the element in two states, both of them right: no src at
    // all while the dynamic import is still in flight, and a blob: object
    // URL once attachMedia has run (a warm chunk cache attaches before this
    // evaluate does). Only a real url (http, fsmedia) would mean the page
    // handed the playlist to the element itself.
    const src = await page.evaluate(() => document.querySelector('video')?.getAttribute('src'))
    ok(src === null || src.startsWith('blob:'), `hls.js owns the element: src is ${src ?? 'none'}`)
    // play() is fired and NOT awaited: its promise settles only when playback
    // starts or the element itself errors, and with hls.js owning the source
    // a fatal hls.js error does neither, so an evaluate that returned the
    // promise parked the whole suite (measured: half an hour, on a run whose
    // job the 30s reaper had long since removed). The wait below is the
    // assertion, and it has a timeout, so a stream that never plays is a
    // recorded failure naming this step rather than a hang.
    await page.evaluate(() => {
      const v = document.querySelector('video')
      v.muted = true
      void v.play().catch(() => {})
    })
    let played = true
    await page
      .waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.5, null, {
        timeout: 20000
      })
      .catch(() => {
        played = false
      })
    ok(played, 'hls.js plays the stream')
    await page.screenshot({ path: join(SHOTS, 'phone-hls.png') })
    await page.evaluate(() => {
      document.querySelector('video').currentTime = 4.2
    })
    let landed = true
    await page
      .waitForFunction(
        () => {
          const v = document.querySelector('video')
          return !!v && v.currentTime > 4.3 && v.currentTime < 6 && !v.paused
        },
        null,
        { timeout: 20000 }
      )
      .catch(() => {
        landed = false
      })
    ok(landed, 'a seek into the second segment lands where the playlist says (copyts)')
    ok(
      await page.evaluate(() => (document.querySelector('video')?.webkitDecodedFrameCount ?? 1) > 0),
      'frames decode'
    )
    // THE COG CARRIES THE TRACKS (#120): on the phone there is no right-click
    // menu, so the audio pick lives in the settings cog, and a pick is a new
    // stream from the PC that resumes where the old one was. The two-track
    // file, opened by its place in the URL (a reload lands where it says).
    await page.goto(`${base}/?open=${encodeURIComponent(tracksFile)}`)
    await page.waitForSelector('[data-phone-viewer][data-kind="video"] video', { timeout: 15000 })
    await page.evaluate(() => {
      const v = document.querySelector('video')
      v.muted = true
      void v.play().catch(() => {})
    })
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 1.5, null, { timeout: 20000 })
    await page.mouse.move(120, 200) // wake the chrome: the transport unmounts on its idle clock
    await page.click('[aria-label="Player settings"]')
    await page.waitForSelector('[data-menu-row="audio"]', { timeout: 5000 })
    // A BOTTOM SHEET, SIZED FOR A THUMB (#145): the menu spans the stage
    // rather than hanging off the cog, its rows are at the floor, and it
    // sits above the transport rather than over it.
    const sheet = await page.evaluate(() => {
      const menu = document.querySelector('[data-player-menu]')
      const bar = document.querySelector('[data-transport-row]')
      if (!menu || !bar) return null
      const m = menu.getBoundingClientRect()
      const rows = [...menu.querySelectorAll('[role="menuitem"]')].map((r) => r.getBoundingClientRect().height)
      return { w: m.width, vw: window.innerWidth, bottom: m.bottom, barTop: bar.getBoundingClientRect().top, minRow: Math.min(...rows), font: getComputedStyle(menu.querySelector('[role="menuitem"]')).fontSize }
    })
    ok(!!sheet && sheet.w >= sheet.vw * 0.9, `the cog's menu is a sheet across the stage (${sheet?.w} of ${sheet?.vw}px)`)
    ok(!!sheet && sheet.minRow >= 44, `its rows are at the floor (${sheet?.minRow}px)`)
    ok(!!sheet && sheet.bottom <= sheet.barTop + 1, 'and it sits above the transport')
    ok(sheet?.font === '16px', `read at the phone's size (${sheet?.font})`)
    await page.screenshot({ path: join(SHOTS, 'phone-cog.png') })
    await page.click('[data-menu-row="picture"]')
    ok((await page.locator('[data-menu-section="picture"] [role="menuitemradio"]').count()) === 5, 'the cog offers the five aspect ratios')
    await page.click('[data-menu-back]')
    await page.click('[data-menu-row="subtitles"]')
    ok((await page.locator('[data-menu-section="subtitles"] [role="menuitemradio"]').count()) === 1, 'and Subtitles with Off alone, nothing found and no Add on the phone')
    await page.click('[data-menu-back]')
    await page.click('[data-menu-row="audio"]')
    await page.waitForSelector('[data-menu-section="audio"]', { timeout: 5000 })
    // Unmuted from here (#137): a pick must not silence the element, since
    // on the phone the pick IS the element's stream. The scenario muted it
    // for autoplay's sake; the film is playing now, so it may sound again.
    const before = await page.evaluate(() => {
      const v = document.querySelector('video')
      v.muted = false
      return { t: v.currentTime, src: v.getAttribute('src') }
    })
    await page.click('[data-menu-section="audio"] button:has-text("Commentary")')
    let switched = true
    await page
      .waitForFunction(
        (was) => {
          const v = document.querySelector('video')
          return !!v && v.getAttribute('src') !== was && v.currentTime > 0.5 && !v.paused
        },
        before.src,
        { timeout: 20000 }
      )
      .catch(() => {
        switched = false
      })
    const after = await page.evaluate(() => document.querySelector('video')?.currentTime ?? -1)
    ok(switched, `the pick swaps the stream and it plays (src changed, t=${after.toFixed(2)})`)
    ok(after >= before.t - 0.5, `and it resumes where the old stream was (was ${before.t.toFixed(2)}, now ${after.toFixed(2)})`)
    await sleep(400)
    ok(await page.evaluate(() => document.querySelector('video')?.muted === false), 'and the picked track is heard: the element is not muted (#137)')
    await page.keyboard.press('Escape')
    // REMEMBERED (#124): a reload of the film asks for the picked track from
    // the start, and the cog's row says so.
    await sleep(600)
    await page.goto(`${base}/?open=${encodeURIComponent(tracksFile)}`)
    await page.waitForSelector('[data-phone-viewer][data-kind="video"] video', { timeout: 15000 })
    await page.waitForFunction(() => !!document.querySelector('video')?.getAttribute('src'), null, { timeout: 20000 })
    await page.mouse.move(120, 200)
    await page.click('[aria-label="Player settings"]')
    await page.waitForSelector('[data-menu-row="audio"]', { timeout: 5000 })
    ok(((await page.locator('[data-menu-value="audio"]').textContent()) ?? '').includes('Commentary'), 'reopened on the phone, the film comes back on the picked track')
    await page.keyboard.press('Escape')
    // The phone log (2026-09-12, #116): one timeline, the server's asks and
    // the page's own player events, in userData/phone/phone.log. The page
    // posts in five-second batches, so the wait is the batch.
    await sleep(5500)
    const log = readFileSync(join(PROFILE, 'phone', 'phone.log'), 'utf8')
    ok(/ play "e2e phone" dolby\.mkv -> job [0-9a-f]{16} \(copy h264 video/.test(log), 'the log has the play answer')
    ok(/ ask [0-9a-f]{16} #0 served/.test(log), 'and the segment asks')
    ok(/ phone "e2e phone" [\d.]+ hls\.js \S+ attached/.test(log), 'and the page reports hls.js attaching')
    ok(/ phone "e2e phone" [\d.]+ (playing|sample|seeking) t=/.test(log), 'and what its player saw')
    // ONE position store (#118): what the PC's window writes for a film is
    // what the phone reads over /api/pos, by path, and the other way round.
    await win.evaluate((p) => window.prism.positionSet(p, 2400), dolby)
    await sleep(600) // the store saves on a 400ms debounce
    const posUrl = `${base}/api/pos?path=${encodeURIComponent(dolby)}`
    ok((await (await fetch(posUrl, { headers: auth })).json()).t === 2400, 'the phone reads the place the PC left a film at')
    await fetch(posUrl, { method: 'POST', headers: auth, body: JSON.stringify({ t: 3000 }) })
    ok((await win.evaluate((p) => window.prism.positionGet(p), dolby)) === 3000, 'and the PC reads the place the phone reached')
    await sleep(600) // the debounce again, before the file is read
    ok(
      JSON.parse(readFileSync(join(PROFILE, 'positions.json'), 'utf8'))[dolby.toLowerCase()]?.t === 3000,
      'kept in positions.json by lower-cased path'
    )
  } finally {
    await page?.close().catch(() => {})
    await win.evaluate(() => window.prism.phoneSetOn(false, null)).catch(() => {})
    await app.close()
  }
}

/**
 * Documents on the phone (2026-09-07, #106): markdown, code, a pdf, a comic
 * and an archive, each through the SAME viewer the PC mounts, over the
 * read-only routes. Three things are measured here that the unit tests
 * cannot: a markdown's own picture arrives (the per-phone grant, end to
 * end through the media route), a member viewed out of a zip arrives (the
 * extract grant, the same way), and the touch pass: a tap on the comic's
 * right third turns the page, and the archive's rows grow to a finger's
 * 44px under a coarse pointer, which Chromium's touch emulation supplies.
 * The heavy chunks are watched too: nothing of pdf.js or CodeMirror is
 * fetched until the file that needs it is opened.
 *
 * SEARCH ends it (2026-09-07), and this is its home because this fixture
 * tree has depth: `buried.py` is three folders down, which is the file a
 * page browsing one level at a time never reaches by tapping, and `ext:py`
 * is an operator the phone implements none of - it asks the PC, which
 * answers with the sidebar's own `searchFiles`.
 */
async function phoneDocsScenario(fixtures) {
  console.log('phone: documents, code, a pdf, a comic and an archive over the LAN server')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  let page = null
  try {
    const { base, token, status } = await pairPhone(win)
    ok(status === 200, 'the phone pairs')
    page = await openPhoneWindow(app, `${base}/`)
    // The phone page's own errors, printed as they happen: a viewer that
    // fails to mount over the wire otherwise reads as a bare timeout.
    page.on('pageerror', (e) => console.warn('  phone page error:', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') console.warn('  phone console:', m.text())
    })
    await page.evaluate((t) => localStorage.setItem('prism.phone.token', t), token)
    // A finger rather than a pointer: Chromium's touch emulation is what
    // flips `(pointer: coarse)` and what makes a dispatched touch arrive as
    // a touch pointer. Set before the reload so the page is laid out for it.
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    await page.reload()
    await page.waitForSelector('[data-phone-file]', { timeout: 10000 })
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    ok(coarse, 'the emulated phone reports a coarse pointer')
    const loadedChunks = () =>
      page.evaluate(() =>
        performance.getEntriesByType('resource').map((e) => e.name.split('/').pop() ?? '')
      )
    const before = await loadedChunks()
    ok(
      !before.some((n) => /pdf|CodeView|codemirror/i.test(n)),
      'neither pdf.js nor CodeMirror is fetched for the folder listing'
    )
    const decodes = (el) =>
      el.complete && el.naturalWidth > 0
        ? true
        : new Promise((r) => {
            el.addEventListener('load', () => r(true), { once: true })
            el.addEventListener('error', () => r(false), { once: true })
            setTimeout(() => r(false), 8000)
          })

    // Markdown, formatted, with its own picture granted to this phone.
    await page.click('[data-phone-file]:has-text("README.md")')
    await page.waitForSelector('[data-phone-viewer][data-kind="text"] .p-md h1', { timeout: 15000 })
    ok((await page.textContent('.p-md h1')) === 'Prism', 'markdown renders formatted (h1)')
    ok((await page.locator('[aria-label="Edit"]').count()) === 0, 'no pencil on the phone')
    const local = page.locator('.p-md img[src^="/m/"]').first()
    await local.waitFor({ timeout: 10000 }).catch(() => {})
    ok((await local.count()) === 1, 'a local image resolves to the /m/ route, not fsmedia://')
    ok(await local.evaluate(decodes), 'the markdown\'s own picture decodes (the per-phone grant)')
    await page.screenshot({ path: join(SHOTS, 'phone-md.png') })

    // Code, read-only, wrapped by the phone's default.
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[data-phone-folder]:has-text("code")')
    await page.waitForSelector('[data-phone-file]:has-text("main.py")', { timeout: 10000 })
    await page.click('[data-phone-file]:has-text("main.py")')
    await page.waitForSelector('[data-phone-viewer] .cm-content', { timeout: 15000 })
    ok(
      (await page.locator('.cm-content[contenteditable="false"]').count()) === 1,
      'the editor is read-only'
    )
    // WAITED for, not read once: the editor mounts empty and the text arrives
    // over the wire a moment later, so a same-tick read is a coin toss (it
    // failed one full run and passed the two after it).
    await page
      .waitForFunction(
        () => /class Greeter/.test(document.querySelector('.cm-content')?.textContent ?? ''),
        null,
        { timeout: 10000 }
      )
      .catch(() => {})
    ok(
      /class Greeter/.test((await page.textContent('.cm-content')) ?? ''),
      'the source is on screen'
    )
    ok((await page.locator('.cm-lineWrapping').count()) >= 1, 'code wraps by default on the phone')
    ok(
      (await page.evaluate(() => localStorage.getItem('prism.code.wrap'))) === 'on',
      'the wrap default was written once into the preference'
    )
    const withCode = await loadedChunks()
    ok(
      withCode.some((n) => /CodeView/i.test(n)),
      'the editor chunk was fetched for the code file and not before'
    )
    await page.screenshot({ path: join(SHOTS, 'phone-code.png') })

    // A pdf: pdf.js pages, its worker and side data over the static route.
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[aria-label="Up"]')
    await page.waitForSelector('[data-phone-file]:has-text("sample.pdf")', { timeout: 10000 })
    await page.click('[data-phone-file]:has-text("sample.pdf")')
    await page.waitForSelector('[data-phone-viewer][data-kind="pdf"] canvas', { timeout: 20000 })
    ok((await page.locator('[data-phone-viewer] canvas').count()) >= 1, 'a pdf page canvas renders')
    await page.screenshot({ path: join(SHOTS, 'phone-pdf.png') })

    // A comic: the page list around the picture viewer, turned by a tap.
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[data-phone-folder]:has-text("comics")')
    await page.waitForSelector('[data-phone-file]:has-text("story.cbz")', { timeout: 10000 })
    await page.click('[data-phone-file]:has-text("story.cbz")')
    await page.waitForSelector('[data-phone-viewer][data-kind="comic"] img[alt]', { timeout: 15000 })
    // The page is read off the picture's alt, as the PC scenario reads it:
    // the counter lives in the chrome, which nothing has woken yet.
    const shownPage = () => page.getAttribute('[data-phone-viewer] img[alt]', 'alt')
    ok((await shownPage()) === 'page1.png', `the comic opens on page one (${await shownPage()})`)
    ok(await page.locator('[data-phone-viewer] img').first().evaluate(decodes), 'the first page decodes (the comic directory grant)')
    // The chrome wakes on mount and settles a moment later, so this WAITS for
    // it to go rather than counting on the same tick, which caught it still up
    // on one cold run.
    await page
      .waitForFunction(() => !document.body.textContent?.includes('Page 1 of 3'), null, {
        timeout: 8000
      })
      .catch(() => {})
    ok(
      (await page.locator('text=Page 1 of 3').count()) === 0,
      'with nothing touched, the chrome is down'
    )
    const stage = await page.locator('[data-owns-arrows]').boundingBox()
    const tapAt = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const pageBecomes = async (alt) => {
      let got = true
      await page
        .waitForFunction((a) => document.querySelector('[data-phone-viewer] img[alt]')?.getAttribute('alt') === a, alt, {
          timeout: 5000
        })
        .catch(() => {
          got = false
        })
      return got
    }
    await tapAt(stage.x + stage.width * 0.9, stage.y + stage.height / 2)
    ok(await pageBecomes('page2.png'), 'a tap on the right third turns the page')
    ok(
      (await page.locator('text=Page 2 of 3').count()) === 1,
      'and the tap wakes the chrome, so the counter says where you are'
    )
    await tapAt(stage.x + stage.width * 0.1, stage.y + stage.height / 2)
    ok(await pageBecomes('page1.png'), 'a tap on the left third turns it back')
    await tapAt(stage.x + stage.width * 0.5, stage.y + stage.height / 2)
    await sleep(300)
    ok((await shownPage()) === 'page1.png', 'a tap in the middle turns nothing')
    await page.screenshot({ path: join(SHOTS, 'phone-comic.png') })

    // An archive: listed, no write verbs, a member viewed through its grant.
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[aria-label="Up"]')
    await page.click('[data-phone-folder]:has-text("zips")')
    await page.waitForSelector('[data-phone-file]:has-text("phone.zip")', { timeout: 10000 })
    await page.click('[data-phone-file]:has-text("phone.zip")')
    await page.waitForSelector('[data-phone-viewer][data-kind="archive"] [data-arc-row]', {
      timeout: 15000
    })
    ok((await page.locator('[data-arc-row]').count()) === 2, 'the archive lists its members')
    const rowH = await page.locator('[data-arc-row]').first().evaluate((el) => el.getBoundingClientRect().height)
    ok(rowH >= 44, `a row is a finger tall under a coarse pointer (${rowH}px)`)
    const verbs = (await page.locator('[data-phone-viewer] button').allTextContents()).join(' | ')
    ok(
      !/Extract|Add files|Rename|Delete|Copy/.test(verbs),
      `no write or clipboard verb is offered (${verbs || 'no buttons'})`
    )
    await page.locator('[data-arc-row]', { hasText: 'pic.png' }).first().dblclick()
    await page.waitForSelector('[data-phone-viewer] img', { timeout: 15000 })
    ok(
      await page.locator('[data-phone-viewer] img').first().evaluate(decodes),
      'a member viewed out of the zip decodes (the extract grant)'
    )
    await page.screenshot({ path: join(SHOTS, 'phone-archive.png') })

    // Search (2026-09-07). The whole root from wherever you are standing, so
    // this runs from the zips folder deliberately: the route names no path
    // and the phone's own root is what is walked. `ext:py` is the proof that
    // the GRAMMAR IS THE DESKTOP'S - no substring over a name answers it, and
    // the phone implements none of it: the field asks the PC, which answers
    // with the very `searchFiles` the sidebar's box gets. `buried.py` is why
    // it is worth having at all: three folders down, which a page that
    // browses one level at a time never reaches by tapping.
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[data-phone-search-open]')
    await page.fill('[data-phone-search]', 'ext:py')
    await page.waitForSelector('[data-phone-hit]', { timeout: 10000 })
    await page
      .waitForFunction(() => document.querySelectorAll('[data-phone-hit]').length === 2, null, {
        timeout: 10000
      })
      .catch(() => {})
    const pyHits = await page.locator('[data-phone-hit]').count()
    ok(pyHits === 2, `ext:py answers the two python files and nothing else (${pyHits})`)
    ok(
      (await page.locator('[data-phone-hit]', { hasText: 'buried.py' }).count()) === 1 &&
        (await page.locator('[data-phone-hit]', { hasText: 'main.py' }).count()) === 1,
      'both, from two different folders'
    )
    ok((await page.locator('[data-phone-file]').count()) === 0, 'the results replace the folder')

    /*
     * AND THE ROWS STAY WHILE THE NEXT ANSWER IS IN FLIGHT (2026-09-08,
     * owner: "search on mobile is very slow"). The walk itself answers in
     * tens of milliseconds; what was slow was the 180ms debounce plus a
     * Wi-Fi round trip with the list BLANK for all of it. So a keystroke
     * narrows the answer already on screen, locally, with the desktop's own
     * matcher, and the walk's reply replaces it whole.
     *
     * SAMPLED rather than asked once: a single count taken after typing is a
     * race against the very round trip this is about, and the failure being
     * checked for is a blank list that lasts a couple of hundred milliseconds
     * and then fills again. A frame-by-frame minimum cannot miss it.
     */
    await page.evaluate(() => {
      const w = window
      w.__phone = { min: Infinity, minPending: Infinity, pendingSeen: false }
      const tick = () => {
        const n = document.querySelectorAll('[data-phone-hit]').length
        w.__phone.min = Math.min(w.__phone.min, n)
        if (document.querySelector('[data-phone-searching]')) {
          w.__phone.pendingSeen = true
          w.__phone.minPending = Math.min(w.__phone.minPending, n)
        }
        w.__phoneRaf = requestAnimationFrame(tick)
      }
      tick()
    })
    // Typed rather than filled, so it GROWS the query: only a query that
    // contains the last one can be a narrowing of it, which is the test that
    // makes the local filter sound rather than lucky.
    await page.locator('[data-phone-search]').pressSequentially(' b')
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('[data-phone-hit]').length === 1 &&
          !document.querySelector('[data-phone-searching]'),
        null,
        { timeout: 10000 }
      )
      .catch(() => {})
    const sampled = await page.evaluate(() => {
      cancelAnimationFrame(window.__phoneRaf)
      return window.__phone
    })
    ok(sampled.pendingSeen, 'the header says a search is running')
    ok(
      sampled.minPending >= 1,
      `the rows stay on screen while it runs (fewest ${sampled.minPending})`
    )
    ok(sampled.min === 1, `and the list never went blank (fewest ${sampled.min} rows)`)
    ok(
      (await page.locator('[data-phone-hit]', { hasText: 'buried.py' }).count()) === 1 &&
        (await page.locator('[data-phone-hit]').count()) === 1,
      'the narrowing kept exactly the row the PC then agreed with'
    )

    await page.fill('[data-phone-search]', 'buried')
    await page
      .waitForFunction(() => document.querySelectorAll('[data-phone-hit]').length === 1, null, {
        timeout: 10000
      })
      .catch(() => {})
    const row = (await page.locator('[data-phone-hit]').first().textContent()) ?? ''
    ok(/buried\.py/.test(row), `a word in the name finds it (${row.trim()})`)
    ok(
      /level-two/.test(row),
      'and the row names the folder it is in, which is what tells two of a name apart'
    )
    await page.click('[data-phone-hit]:has-text("buried.py")')
    // The editor mounts BEFORE the file's text has arrived from the PC, so
    // the text is waited for, not read once: read once, this failed in
    // four full runs out of four under load and passed alone every time.
    let opened = true
    await page
      .waitForFunction(() => /VALUE = 42/.test(document.querySelector('[data-phone-viewer] .cm-content')?.textContent ?? ''), null, {
        timeout: 15000
      })
      .catch(() => {
        opened = false
      })
    ok(
      opened,
      'a hit opens exactly as a folder row does'
    )
    await page.screenshot({ path: join(SHOTS, 'phone-search.png') })

    // One X, two steps: it empties a field that holds something and closes an
    // empty one, so clearing lands you back in the folder you were in rather
    // than taking the field away mid-thought.
    await page.click('[aria-label="Back to the folder"]')
    ok((await page.locator('[data-phone-hit]').count()) === 1, 'closing the file keeps the hits')
    await page.click('[data-phone-search-clear]')
    await page.waitForSelector('[data-phone-file]', { timeout: 5000 })
    ok(
      (await page.locator('[data-phone-search]').count()) === 1,
      'the first X empties the field and the folder is back under it'
    )
    await page.click('[data-phone-search-clear]')
    await page.waitForSelector('[data-phone-search-open]', { timeout: 5000 })
    ok((await page.locator('[data-phone-search]').count()) === 0, 'the second X closes it')
  } finally {
    await page?.close().catch(() => {})
    await win.evaluate(() => window.prism.phoneSetOn(false, null)).catch(() => {})
    await app.close()
  }
}

/**
 * The phone's TABS, its PLACE, and the two rows around them (2026-09-08,
 * #107, all four from one hands-on session). Each is something only a live PC
 * can answer, which is why they are here rather than in a unit test.
 *
 * THE TABS THE PC HAS OPEN ("i should be able to switch tabs without scanning
 * a new qr code. i should be able to see the available tabs and switch"). The
 * app is launched with a SECOND ROOT open, the way the tab scenario opens one,
 * because a list of one proves nothing about a list and a switch needs
 * somewhere to go. What is asserted after the pick is not the header's text
 * but what the LISTING answers: the phone is on the other root and the first
 * root's files are not there, which is the widened wall doing exactly the one
 * thing it widened to do.
 *
 * A RELOAD COMES BACK WHERE YOU WERE ("if im in a subfolder and reload i
 * should be there, or a movie i should be on the movie"). Both halves, since
 * they are two different reads of the same URL: a folder two levels down, and
 * then a file in it, which comes back from that folder's own listing.
 *
 * THE CRUMB ROW'S SEPARATORS GO BETWEEN THE NAMES: counted rather than
 * eyeballed, at a depth where "one fewer than the levels" is more than one
 * chevron. A trailing chevron beside the Up chevron reads as a back and a
 * forward button, one of which does nothing.
 *
 * AND A FILE ROW SAYS HOW BIG IT IS, in the desktop's own units.
 */
async function phoneTabsScenario(fixtures) {
  console.log('phone: the open tabs, a reload, the crumb row and a size')
  const { app, win } = await launch(join(fixtures, 'one.png'))
  let page = null
  try {
    // A SECOND ROOT, handed over from outside the way the tab scenario opens
    // one: a genuine sibling folder, since a subfolder of an open root is no
    // longer a second root at all.
    await handoff(join(OTHER_ROOT, 'bad.json'))
    const tabs = win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]')
    ok((await tabs.count()) === 2, 'the PC has two roots open')
    // Back to the fixtures tab before pairing: the code is issued for the tab
    // that is CURRENT, so this is what decides which root the phone starts on.
    await tabs.first().click()
    await sleep(400)
    const { base, token, root, status } = await pairPhone(win)
    ok(status === 200, 'the phone pairs')
    ok(root.toLowerCase() === fixtures.toLowerCase(), 'with the tab that was current')

    page = await openPhoneWindow(app, `${base}/`)
    page.on('pageerror', (e) => console.warn('  phone page error:', e.message))
    await page.evaluate((t) => localStorage.setItem('prism.phone.token', t), token)
    await page.reload()
    await page.waitForSelector('[data-phone-file]', { timeout: 10000 })

    // The list is READ FRESH every time it is opened, so it is opened rather
    // than assumed: a tab closes on the PC without telling the phone.
    await page.click('[data-phone-tab]')
    await page.waitForSelector('[data-phone-sheet]', { timeout: 5000 })
    const rows = page.locator('[data-phone-tab-row]')
    await page.waitForFunction(
      () => document.querySelectorAll('[data-phone-tab-row]').length === 2,
      null,
      { timeout: 10000 }
    )
    const rowText = await rows.allTextContents()
    ok(rowText.length === 2, `the list names both open roots (${rowText.length})`)
    ok(
      rowText.some((t) => /fixtures/i.test(t)) && rowText.some((t) => /other/i.test(t)),
      `and names them: ${rowText.map((t) => t.trim()).join(' | ')}`
    )
    const ticked = page.locator('[data-phone-tab-row][aria-current="true"]')
    ok((await ticked.count()) === 1, 'with exactly one of them ticked')
    ok(
      /fixtures/i.test((await ticked.first().textContent()) ?? ''),
      'and it is the root the phone paired to'
    )
    // Picked by index off the text, not by a selector carrying a Windows path:
    // a backslash in a `:has-text()` is one more thing to escape wrongly.
    const otherIdx = rowText.findIndex((t) => /other/i.test(t))
    await rows.nth(otherIdx).click()
    await page.waitForSelector('[data-phone-sheet]', { state: 'detached', timeout: 10000 })
    await page.waitForSelector('[data-phone-file]:has-text("bad.json")', { timeout: 10000 })
    ok(true, 'picking the other tab lists the other root')
    ok(
      (await page.locator('[data-phone-file]:has-text("README.md")').count()) === 0,
      'and the first root is not what the listing answers any more'
    )
    // The hamburger names nothing (2026-09-09): the tab it moved to is proved
    // by the drawer's own tick, and by the crumb row, whose first name IS the
    // root the phone is on.
    ok(
      /other/i.test((await page.textContent('[aria-label="Folder"]')) ?? ''),
      'the crumb row names the tab it moved to'
    )
    await page.click('[data-phone-tab]')
    await page.waitForSelector('[data-phone-sheet]', { timeout: 5000 })
    ok(
      /other/i.test(
        (await page.textContent('[data-phone-tab-row][aria-current="true"]')) ?? ''
      ),
      'and the drawer ticks it'
    )
    // THE DRAWER'S ROWS (#145): a folder glyph, the name over its path, and
    // a DRAWN tick on the current one, at the explorer's own row height.
    const drawerRow = await page.evaluate(() => {
      const row = document.querySelector('[data-phone-tab-row][aria-current="true"]')
      if (!row) return null
      return {
        h: row.getBoundingClientRect().height,
        tick: !!row.querySelector('[data-phone-tab-tick]'),
        glyphs: row.querySelectorAll('svg').length
      }
    })
    ok(!!drawerRow && drawerRow.h >= 56, `a drawer row is a row (${drawerRow?.h}px)`)
    ok(drawerRow?.tick === true && drawerRow?.glyphs === 2, 'the current tab carries a folder and a drawn tick')
    await sleep(300) // past the slide-in, so the shot is the drawer and not its entrance
    await page.screenshot({ path: join(SHOTS, 'phone-drawer.png') })
    // The scrim is the drawer's own dismissal: a tap beside it puts it away.
    // BESIDE the panel, which is where a thumb lands: the scrim spans the
    // screen and the drawer sits on its left, so its centre is covered.
    await page.click('[data-phone-drawer-scrim]', { position: { x: 360, y: 400 } })
    await page.waitForSelector('[data-phone-sheet]', { state: 'detached', timeout: 5000 })
    ok(true, 'a tap on the ground beside the drawer closes it')
    await page.screenshot({ path: join(SHOTS, 'phone-tabs.png') })

    // And back, without a code anywhere in it.
    await page.click('[data-phone-tab]')
    await page.waitForSelector('[data-phone-sheet]', { timeout: 5000 })
    // Each drawer opening fetches its rows afresh. Reading before that answer
    // arrives gives [], and nth(-1) silently picks the current last tab.
    await page.waitForFunction(() => document.querySelectorAll('[data-phone-tab-row]').length === 2, null, { timeout: 10000 })
    const back = await page.locator('[data-phone-tab-row]').allTextContents()
    const fixtureIndex = back.findIndex((t) => /fixtures/i.test(t))
    if (fixtureIndex < 0) throw new Error(`Fixture root is absent from the phone drawer: ${back.join(' | ')}`)
    await page
      .locator('[data-phone-tab-row]')
      .nth(fixtureIndex)
      .click()
    await page.waitForSelector('[data-phone-file]:has-text("README.md")', { timeout: 10000 })
    ok(true, 'and back again, with no code scanned either way')

    ok(
      (await page.locator('[aria-label="Up"]').count()) === 0,
      'at the root there is no Up arrow to press at all'
    )

    // Two levels down, which is the depth that makes the chevron count worth
    // taking: at one level "one fewer" and "none at all" are the same number.
    await page
      .locator('[data-phone-folder]')
      .filter({ hasText: /^\s*docs\s*$/ })
      .click()
    await page.waitForSelector('[data-phone-folder]', { timeout: 10000 })
    await page
      .locator('[data-phone-folder]')
      .filter({ hasText: /^\s*media\s*$/ })
      .click()
    await page.waitForSelector('[data-phone-file]:has-text("prism.webp")', { timeout: 10000 })
    const trail = () =>
      page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Folder"]')
        const chevrons = [...(nav?.querySelectorAll('span[aria-hidden="true"]') ?? [])].filter(
          (s) => (s.textContent ?? '').trim() === '›'
        )
        return {
          levels: nav?.querySelectorAll('[data-phone-crumb]').length ?? 0,
          chevrons: chevrons.length
        }
      })
    const crumbs = await trail()
    ok(crumbs.levels === 3, `the crumb row has a level per folder (${crumbs.levels})`)
    ok(
      crumbs.chevrons === crumbs.levels - 1,
      `and one fewer chevron than levels (${crumbs.chevrons} for ${crumbs.levels})`
    )

    // HOW BIG IT IS, in the desktop's own units: a size that reads differently
    // on the phone is a second formatter nobody asked for.
    const size = (
      (await page.textContent('[data-phone-file]:has-text("prism.webp") [data-phone-size]')) ?? ''
    ).trim()
    ok(/^\d+(\.\d+)? (B|KB|MB|GB|TB)$/.test(size), `a file row says how big it is (${size})`)

    // THE RELOAD, first half: the folder. The URL is checked as well as the
    // screen, because a page that came back to the right folder by remembering
    // it somewhere else would pass the screen half and lose the file half.
    ok(
      /[\\/]docs[\\/]media$/i.test(new URL(page.url()).searchParams.get('at') ?? ''),
      'the folder is in the URL'
    )
    await page.reload()
    await page.waitForSelector('[data-phone-file]:has-text("prism.webp")', { timeout: 15000 })
    const afterReload = await trail()
    ok(
      afterReload.levels === 3,
      `a reload comes back to the folder it was in (${afterReload.levels} levels)`
    )

    // Second half: the file. It is restored from the folder's OWN LISTING, so
    // what is waited for is the viewer, not a route of its own.
    await page.click('[data-phone-file]:has-text("prism.webp")')
    await page.waitForSelector('[data-phone-viewer][data-kind="image"] img', { timeout: 15000 })
    const url = new URL(page.url())
    ok(/prism\.webp$/i.test(url.searchParams.get('open') ?? ''), 'the open file is in the URL')
    ok(url.searchParams.get('at') === null, 'and the folder is not, since one place is never two')
    await page.reload()
    await page.waitForSelector('[data-phone-viewer][data-kind="image"] img', { timeout: 15000 })
    ok(true, 'a reload with a file open comes back on that file')
    await page
      .waitForFunction(
        () => (document.querySelector('[data-phone-viewer] img')?.naturalWidth ?? 0) > 0,
        null,
        { timeout: 15000 }
      )
      .catch(() => {})
    ok(
      (await page.locator('[data-phone-viewer] img').first().evaluate((el) => el.naturalWidth)) > 0,
      'and the picture is on screen, not a folder with a viewer over it'
    )
    await page.screenshot({ path: join(SHOTS, 'phone-place.png') })
  } finally {
    await page?.close().catch(() => {})
    // Off again, or the profile's phone.json carries the switch into every
    // scenario after this one.
    await win.evaluate(() => window.prism.phoneSetOn(false, null)).catch(() => {})
    await app.close()
  }
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

/* ----- the update window (#168) ----- */

/** What main's update.ts has DONE this session (release checks, installs),
 *  read the way the suite reaches the indexer: main parks the reader on
 *  globalThis under --e2e. */
const updateCalls = (app) => app.evaluate(() => globalThis.__prismUpdateCalls())

/** A style, switched the way ANOTHER WINDOW's change arrives: the keys are
 *  written and the store's own `storage` listener repaints from them. It
 *  leaves the terminal theme and the accent schemes alone (`apply(false)`),
 *  which a click on a Settings card does not, and the profile is shared with
 *  every scenario after this one. Returns what to hand back to restore. */
async function switchStyle(win, style, mode) {
  return win.evaluate(
    ([s, m]) => {
      const before = [localStorage.getItem('prism.style'), localStorage.getItem('prism.mode')]
      const put = (k, v) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v))
      put('prism.style', s)
      put('prism.mode', m)
      window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style', storageArea: localStorage }))
      return before
    },
    [style, mode]
  )
}

/**
 * THE UPDATE WINDOW (#168; owner, 2026-09-19: "when you click the Update badge,
 * it opens like a pop window, which shows the change log or like patch notes
 * for the new update, and then you can choose cancel or install", and "make
 * like a fake update"). Modelled on Prism Terminal's scenario of the same name,
 * because the chip and the window are the same components out of
 * prism-term-core. Driven through `--preview-update`, the owner's own way in,
 * so it proves the preview and the window at once: the chip is in the title
 * bar, a click opens the window and installs NOTHING, the notes are plain text
 * (no anchor, no author tail, no url), every way out closes it, and Install
 * runs the fake progress in the chip, ends on the preview line, and leaves the
 * network, the disk and the process list exactly as they were.
 *
 * THE CHIP'S WIDTH IS MEASURED IN EVERY PHASE, sampled the whole way through
 * the install rather than read once per state: Prism's rule is that it never
 * changes (owner pick, 2026-08-24), and with the old inline chip it did, since
 * the pill was sized by a label that went from "Update 0.56.0" to "7%".
 * Screenshots go to .e2e/shots, in a dark style and in a light one.
 *
 * Runner-safe: no terminal, no CLI, no path outside the fixtures.
 */
async function updateWindowScenario(fixtures) {
  console.log('update window')
  EXTRA_ARGS = ['--preview-update']
  let launched
  try {
    launched = await launch(join(fixtures, 'README.md'))
  } finally {
    EXTRA_ARGS = []
  }
  const { app, win } = launched
  let styleBefore = null
  try {
    await win.waitForSelector('.p-md h1', { timeout: 15000 })
    const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    const [major, minor] = current.split('.').map(Number)
    const next = `${major}.${minor + 1}.0`
    const shot = (name) => win.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {})
    const chip = win.locator('[data-title-bar] [data-update-chip]')
    const dialog = win.locator('[data-update-dialog]')
    const shownLabel = () =>
      win.evaluate(() => document.querySelector('[data-update-chip] [data-update-label="shown"]')?.textContent ?? '')
    const closed = () => until(async () => (await dialog.count()) === 0, 4000, 50)
    const opened = () => until(async () => (await dialog.count()) === 1, 4000, 50)

    ok(await until(async () => (await chip.count()) === 1, 8000), 'with --preview-update the chip is in the title bar, under --e2e too')
    ok((await shownLabel()) === `Update ${next}`, `it offers the next minor after ${current} ("${await shownLabel()}")`)
    ok((await dialog.count()) === 0, 'and nothing opens by itself')
    const width0 = await chip.evaluate((el) => el.getBoundingClientRect().width)
    // FILLED IN THE ACCENT (#178; owner, 2026-09-20: "have the update available
    // button be accented colour"), read off the computed colours: the fill is
    // the style's accent family and not the grey pill it was, and the label on
    // it clears the floor for small text.
    const chipInk = () =>
      chip.evaluate((el) => {
        const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
        const lum = (c) => {
          const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
          const [r, g, b] = rgb(c)
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        }
        const resolve = (token, prop) => {
          const probe = document.createElement('span')
          probe.style[prop] = `var(${token})`
          document.body.appendChild(probe)
          const c = getComputedStyle(probe)[prop]
          probe.remove()
          return c
        }
        const bg = getComputedStyle(el).backgroundColor
        const fg = getComputedStyle(el.querySelector('[data-update-label]')).color
        const [r, g, b] = rgb(bg)
        const [la, lb] = [lum(bg), lum(fg)]
        return {
          bg,
          fg,
          selBg: resolve('--p-sel-bg', 'backgroundColor'),
          onAccent: resolve('--p-on-accent', 'color'),
          chroma: Math.max(r, g, b) - Math.min(r, g, b),
          contrast: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
        }
      })
    const inkDark = await chipInk()
    ok(inkDark.bg === inkDark.selBg && inkDark.fg === inkDark.onAccent, `the chip is filled in the accent, its label in the accent's ink (${inkDark.bg})`)
    ok(inkDark.chroma >= 40, `which is a colour and not the grey pill it was (channel spread ${inkDark.chroma})`)
    ok(inkDark.contrast >= 4.5, `and the label reads on it (${inkDark.contrast.toFixed(1)}:1)`)
    // The chip LEADS the bar's right-hand group (owner, 2026-09-20, #179: "right
    // now it has the remote button to its left"). Measured off the boxes rather
    // than read off the markup's order, since a flex `order` or a reversed row
    // would move one without the other.
    const order = await win.evaluate(() => {
      const bar = document.querySelector('[data-title-bar]')
      const box = (sel) => bar?.querySelector(sel)?.getBoundingClientRect() ?? null
      const c = box('[data-update-chip]')
      const t = box('[aria-label="Tools"]')
      const s = box('[aria-label="Settings"]')
      return c && t && s ? { chipRight: c.right, toolsLeft: t.left, toolsRight: t.right, settingsLeft: s.left } : null
    })
    ok(
      order !== null && order.chipRight <= order.toolsLeft && order.toolsRight <= order.settingsLeft,
      `the chip is the leftmost of the group: chip, then Tools, then Settings (${JSON.stringify(order)})`
    )
    await shot('update-chip-dark')
    // AND THE GROUP STAYS PUT WHEN THE CHIP COMES OR GOES, which is the reason
    // the comment in TopBar gives for the chip leading it. Measured rather
    // than argued: the chip's own flex item is taken out of the row and Tools
    // must not have moved a pixel. (The preview's chip never leaves by itself,
    // so it is hidden by hand and put back in the same breath.)
    const toolsShift = await win.evaluate(() => {
      const bar = document.querySelector('[data-title-bar]')
      const tools = bar?.querySelector('[aria-label="Tools"]')
      let item = bar?.querySelector('[data-update-chip]') ?? null
      while (item && item.parentElement !== bar) item = item.parentElement
      if (!bar || !tools || !item) return null
      const withChip = tools.getBoundingClientRect().left
      const display = item.style.display
      item.style.display = 'none'
      const without = tools.getBoundingClientRect().left
      item.style.display = display
      return { withChip, without, back: tools.getBoundingClientRect().left }
    })
    ok(
      toolsShift !== null && toolsShift.withChip === toolsShift.without && toolsShift.back === toolsShift.withChip,
      `Tools does not move when the chip goes or comes back (${JSON.stringify(toolsShift)})`
    )
    // AT THE NARROWEST WINDOW PRISM ALLOWS TOO (minWidth 560): the order holds,
    // nothing in the group overlaps, and the chip has not been pushed over the
    // "Prism" word to its left. The name is what gives way, as it should.
    const sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 400))
    await until(() => win.evaluate(() => window.innerWidth <= 600), 4000, 50)
    const narrow = await win.evaluate(() => {
      const bar = document.querySelector('[data-title-bar]')
      const box = (el) => el?.getBoundingClientRect() ?? null
      const c = box(bar?.querySelector('[data-update-chip]'))
      const t = box(bar?.querySelector('[aria-label="Tools"]'))
      const s = box(bar?.querySelector('[aria-label="Settings"]'))
      const n = box(bar?.querySelector('[data-testid="titlebar-file-name"]'))
      return c && t && s && n
        ? { inner: window.innerWidth, nameLeft: n.left, chipLeft: c.left, chipRight: c.right, toolsLeft: t.left, toolsRight: t.right, settingsLeft: s.left }
        : null
    })
    ok(
      narrow !== null &&
        narrow.nameLeft <= narrow.chipLeft &&
        narrow.chipRight <= narrow.toolsLeft &&
        narrow.toolsRight <= narrow.settingsLeft,
      `and at the minimum window width: name, chip, Tools, Settings, none overlapping (${JSON.stringify(narrow)})`
    )
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sizeBefore)
    await until(() => win.evaluate((w) => window.innerWidth >= w - 40, sizeBefore[0]), 4000, 50)
    // Read AFTER the window is back: on a scaled display a size set and read
    // back lands a pixel or two off, and what the phases below must not move
    // is the chip against THIS layout, not against the one before the resize.
    const left0 = await chip.evaluate((el) => el.getBoundingClientRect().left)

    // What an install would leave behind, read BEFORE anything is clicked.
    const updateDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith('prism-update-')).sort().join('|')
    // The hand-off a real install spawns names that temp folder on its command
    // line. The query's own PowerShell names it too, so it leaves itself out.
    const installers = () => {
      try {
        return execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*prism-update-*' }).Count"],
          { encoding: 'utf8', windowsHide: true }
        ).trim()
      } catch {
        return 'unknown'
      }
    }
    const dirsBefore = updateDirs()
    const installersBefore = installers()

    await chip.click()
    ok(await opened(), 'a click on the chip opens the window')
    ok((await updateCalls(app)).installs === 0, 'and installs nothing: the click used to download and quit')
    ok(((await dialog.locator('h2').textContent()) ?? '') === `Update to ${next}`, 'its title names the version')
    ok(
      ((await dialog.locator('[data-update-current]').textContent()) ?? '').trim() === `You have ${current}`,
      `and a quiet line says what is running, package.json's version and not Electron's (${((await dialog.locator('[data-update-current]').textContent()) ?? '').trim()})`
    )
    const entries = await dialog.locator('[data-update-entry]').allTextContents()
    ok(entries.length >= 5, `the sample notes are listed (${entries.length} entries)`)
    ok(entries[0].startsWith('The update button opens a window'), `as the pull requests' titles ("${entries[0]}")`)
    // SORTED UNDER HEADINGS, worded for a reader (owner, 2026-09-20: "headers
    // bug fixes, new features, so on... not like a git commit").
    const sections = await dialog.locator('[data-update-section]').evaluateAll((els) =>
      els.map((el) => ({ heading: el.querySelector('h3')?.textContent?.trim() ?? '', lines: [...el.querySelectorAll('[data-update-entry]')].map((li) => (li.textContent ?? '').trim()) }))
    )
    ok(sections.map((x) => x.heading).join('|') === 'New features|Bug fixes|Under the hood', `the notes are sorted under headings (${sections.map((x) => `${x.heading}: ${x.lines.length}`).join(', ')})`)
    ok(sections[1]?.lines[0] === 'A prompt survives the window getting narrower and wider again', `a fix reads as a sentence, its "fix(terminal):" gone ("${sections[1]?.lines[0]}")`)
    ok(entries.every((e) => !/\(#\d+\)\s*$/.test(e) && !/^[a-z]+(\([^)]*\))?!?:/.test(e) && e[0] === e[0].toUpperCase()), 'no line ends in a pull request number or starts with a commit type, and each starts with a capital')
    const text = (await dialog.textContent()) ?? ''
    ok(!/by @/.test(text), 'no author tail ("by @") reaches the window')
    ok(!/https?:|github\.com/.test(text), 'and no url does')
    ok(!/Full Changelog|New Contributors|first contribution|What's Changed/.test(text), 'nor the boilerplate round the list')
    ok((await dialog.locator('a').count()) === 0, 'there is no <a> element in it')
    ok(
      (await dialog
        .locator('[data-update-notes]')
        .evaluate((el) => [...el.querySelectorAll('*')].every((n) => ['SECTION', 'H3', 'UL', 'LI', 'SPAN', 'P'].includes(n.tagName)))) === true,
      'the notes are text in plain elements, nothing a body could have brought with it'
    )
    ok(
      !/This is a preview/.test((await dialog.textContent()) ?? '') && (await dialog.locator('[data-update-preview]').count()) === 0,
      'a preview is not announced up front: the window is shown as it will be'
    )
    const bare = await dialog.locator('[data-update-notes]').evaluate((el) => {
      const cs = getComputedStyle(el)
      const alpha = Number((cs.backgroundColor.match(/[\d.]+/g) ?? [])[3] ?? 1)
      return { alpha, border: ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(cs[`border${side}Width`])).reduce((a, b) => a + b, 0) }
    })
    ok(bare.alpha === 0 && bare.border === 0, `the notes sit on the window's own ground: no fill, no border (alpha ${bare.alpha}, border ${bare.border}px)`)
    const look = await dialog.evaluate((el) => {
      const notes = el.querySelector('[data-update-notes]')
      const alpha = (c) => Number((c.match(/[\d.]+/g) ?? [])[3] ?? 1)
      const box = el.getBoundingClientRect()
      return {
        alpha: alpha(getComputedStyle(el).backgroundColor),
        notesAlpha: alpha(getComputedStyle(notes).backgroundColor),
        overflow: getComputedStyle(notes).overflowY,
        maxHeight: getComputedStyle(notes).maxHeight,
        inside: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
        buttons: [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
        focused: (document.activeElement?.textContent ?? '').trim()
      }
    })
    ok(look.alpha === 1, `the window is on the opaque surface (alpha ${look.alpha})`)
    ok(look.overflow === 'auto' && look.maxHeight !== 'none', `the list scrolls inside a capped height (${look.overflow}, ${look.maxHeight})`)
    ok(look.inside, 'the whole window is on screen')
    ok(look.buttons.join('|') === 'Cancel|Install', `the choices are Cancel and Install, in that order (${look.buttons.join('|')})`)
    ok(look.focused === 'Install', 'Install is the primary, and holds the focus')
    await shot('update-dialog-dark')

    await win.keyboard.press('Escape')
    ok(await closed(), 'Escape closes it')
    ok((await chip.count()) === 1 && (await shownLabel()) === `Update ${next}`, 'and the offer is still there')
    ok(!win.isClosed() && (await win.locator('.p-md h1').count()) === 1, 'with the file still on screen: that Escape was the window\'s alone')
    await chip.click()
    await opened()
    await dialog.locator('[data-update-cancel]').click()
    ok(await closed(), 'Cancel closes it')
    await chip.click()
    await opened()
    await win.mouse.click(8, 300)
    ok(await closed(), 'and so does a press outside it')
    ok((await updateCalls(app)).installs === 0, 'none of which installed anything')

    // Install (#178): THE WINDOW STAYS and draws the bar (owner, 2026-09-20:
    // "keep me with the panel open and have the progress bar straight there,
    // kind of like the way extract works for zip files in Prism"). Sampled the
    // whole way, so a box that changed size for one frame is caught as surely
    // as one that stayed changed.
    await chip.click()
    await opened()
    const slot = await dialog
      .locator('[data-update-progress]')
      .evaluate((el) => ({ active: el.dataset.active, opacity: getComputedStyle(el).opacity, h: el.getBoundingClientRect().height }))
    ok(slot.active === 'false' && slot.opacity === '0' && slot.h > 10, `before Install the progress track is already in the layout, unseen (${slot.h.toFixed(1)}px at opacity ${slot.opacity})`)
    const startSampling = () =>
      win.evaluate(() => {
        window.__upd = []
        window.__updTimer = setInterval(() => {
          const c = document.querySelector('[data-update-chip]')
          const d = document.querySelector('[data-update-dialog]')
          const box = d?.getBoundingClientRect()
          const cancel = d?.querySelector('[data-update-cancel]')
          window.__upd.push({
            chipW: c?.getBoundingClientRect().width ?? -1,
            chipLeft: c?.getBoundingClientRect().left ?? -1,
            chipLabel: c?.querySelector('[data-update-label]')?.textContent ?? '',
            up: !!d,
            w: box?.width ?? -1,
            h: box?.height ?? -1,
            top: box?.top ?? -1,
            phase: d?.dataset.phase ?? 'gone',
            title: d?.querySelector('h2')?.textContent ?? '',
            pct: Number(d?.querySelector('[data-update-track]')?.getAttribute('aria-valuenow') ?? -1),
            status: (d?.querySelector('[data-update-status]')?.textContent ?? '').trim(),
            cancelOff: !!cancel?.disabled,
            installOff: !!d?.querySelector('[data-update-install]')?.disabled,
            underChip: !!document.querySelector('[data-update-notice]')
          })
        }, 25)
      })
    const stopSampling = () =>
      win.evaluate(() => {
        clearInterval(window.__updTimer)
        return window.__upd
      })
    const pctAtLeast = (n) =>
      until(() => win.evaluate((min) => Number(document.querySelector('[data-update-track]')?.getAttribute('aria-valuenow') ?? 0) >= min, n), 6000, 25)
    await startSampling()
    await dialog.locator('[data-update-install]').click()
    ok(await until(async () => (await dialog.getAttribute('data-phase')) === 'downloading', 6000, 25), 'Install starts the download')
    ok((await dialog.count()) === 1, 'and THE WINDOW STAYS UP: the progress is straight there')
    ok((await win.locator('[role="dialog"]:not([data-update-dialog])').count()) === 0, 'a preview asks nothing on the way: it closes nothing')
    await win.keyboard.press('Escape')
    await win.mouse.click(8, 300)
    await sleep(150)
    ok((await dialog.count()) === 1 && (await dialog.getAttribute('data-phase')) !== 'idle', 'Escape and a press outside do NOT put a running install away')
    await pctAtLeast(35)
    await shot('update-progress-dark')
    const status = dialog.locator('[data-update-status]')
    ok(
      await until(async () => (await dialog.getAttribute('data-phase')) === 'idle' && ((await status.textContent()) ?? '').trim() === 'Preview only: nothing was installed', 10000, 50),
      'the fake install ends by saying so IN the window'
    )
    await shot('update-ended-dark')
    const samples = await stopSampling()
    ok(samples.length > 40 && samples.every((x) => x.up), `the window was up in every one of ${samples.length} samples`)
    const phases = [...new Set(samples.map((x) => x.phase))]
    ok(['idle', 'downloading', 'installing'].every((ph) => phases.includes(ph)), `it went through every phase (${phases.join(', ')})`)
    const running = samples.filter((x) => x.phase !== 'idle')
    const pcts = running.map((x) => x.pct)
    ok(pcts.length > 5 && pcts.every((v, i) => v >= 0 && (i === 0 || v >= pcts[i - 1])) && pcts.at(-1) === 100, `the bar only rises, to 100 (${pcts[0]}% to ${pcts.at(-1)}%)`)
    ok(running.every((x) => x.title === `Updating to ${next}`), 'the title says what is happening while it runs')
    ok(samples.some((x) => x.phase === 'installing' && /^Installing/.test(x.status)), 'and the status line ends on "Installing"')
    ok(running.every((x) => x.installOff), 'Install cannot be pressed twice')
    ok(samples.filter((x) => x.phase === 'downloading').every((x) => !x.cancelOff), 'Cancel can be pressed for as long as it is DOWNLOADING')
    ok(samples.filter((x) => x.phase === 'installing').every((x) => x.cancelOff), 'and not once the installer has the file')
    const boxes = [...new Set(samples.map((x) => `${x.w.toFixed(2)}x${x.h.toFixed(2)}@${x.top.toFixed(2)}`))]
    ok(boxes.length === 1, `THE WINDOW NEVER CHANGED SIZE OR MOVED, from the notes to the bar to the ending (${boxes.join(', ')})`)
    const widths = [...new Set(samples.map((x) => x.chipW.toFixed(3)))]
    const lefts = [...new Set(samples.map((x) => x.chipLeft.toFixed(3)))]
    ok(widths.length === 1 && Math.abs(Number(widths[0]) - width0) < 0.01, `the chip's width is identical throughout (${widths.join(', ')}px; idle ${width0.toFixed(3)}px)`)
    ok(lefts.length === 1 && Math.abs(Number(lefts[0]) - left0) < 0.01, `and its left edge never moved (${lefts.join(', ')})`)
    ok(samples.every((x) => x.chipLabel.trim() === `Update ${next}`), "its label never changes: the bar is the window's, not the chip's")
    ok(samples.every((x) => !x.underChip), 'and nothing is hung under the chip while the window is there to say it')
    const endedButtons = await dialog.evaluate((el) => [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).join('|'))
    ok(endedButtons === 'Close|Install', `afterwards the choices are Close and Install again (${endedButtons})`)
    await win.keyboard.press('Escape')
    ok(await closed(), 'it can be closed again now, with Escape')
    ok((await chip.getAttribute('data-phase')) === 'idle' && (await shownLabel()) === `Update ${next}`, 'the chip offers the same update')

    // CANCEL, mid-download. It is not a failure and is not reported as one.
    await chip.click()
    await opened()
    await startSampling()
    await dialog.locator('[data-update-install]').click()
    await pctAtLeast(20)
    await dialog.locator('[data-update-cancel]').click()
    ok(await closed(), 'Cancel during the download stops it and the window goes')
    await sleep(1200)
    const cancelled = await stopSampling()
    const top = Math.max(...cancelled.map((x) => x.pct))
    ok(!cancelled.some((x) => x.phase === 'installing') && top < 100, `it never reached the installer (stopped at ${top}%)`)
    ok((await win.locator('[data-update-notice]').count()) === 0 && (await dialog.count()) === 0, 'nothing is said about it: the user knows what they pressed')
    ok((await chip.getAttribute('data-phase')) === 'idle', 'and the chip offers the update again')

    // What a preview must not have done.
    const calls = await updateCalls(app)
    ok(calls.checks === 0, `GitHub was never asked (${calls.checks} release checks)`)
    ok(calls.installs === 0, `no download was started (${calls.installs} installs)`)
    ok(updateDirs() === dirsBefore, 'no installer was downloaded: no update folder appeared in temp')
    ok(installers() === installersBefore, `no installer process was spawned (${installersBefore} before, ${installers()} after)`)

    // The same, in a light style.
    styleBefore = await switchStyle(win, 'paper', 'light')
    ok(await until(() => win.evaluate(() => document.documentElement.dataset.mode === 'light')), 'in a light style (Paper)')
    const widthLight = await chip.evaluate((el) => el.getBoundingClientRect().width)
    ok(Math.abs(widthLight - width0) < 0.01, `the chip is the same width (${widthLight.toFixed(3)}px)`)
    const inkLight = await chipInk()
    ok(inkLight.bg === inkLight.selBg && inkLight.contrast >= 4.5, `the chip's label reads on a light style's accent too (${inkLight.contrast.toFixed(1)}:1 on ${inkLight.bg})`)
    // Over Settings: Prism's own capture-phase Escape closes Settings, and must
    // stand down while the update window is up (data-owns-escape).
    await win.click('[aria-label="Settings"]')
    ok(await until(() => win.evaluate(() => document.querySelector('[aria-label="Settings"]')?.getAttribute('aria-pressed') === 'true'), 5000, 50), 'with Settings open')
    await shot('update-chip-light')
    await chip.click()
    ok(await opened(), 'the window opens over Settings too')
    const lightLook = await dialog.evaluate((el) => {
      const lum = (c) => {
        const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
        const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      }
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      // The notes sit on a control tint that may itself be translucent, so the
      // ground is flattened onto the box before it is measured.
      const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number)
      const [br, bg, bb] = parse(getComputedStyle(el).backgroundColor)
      const [nr, ng, nb, na = 1] = parse(getComputedStyle(el.querySelector('[data-update-notes]')).backgroundColor)
      const flat = `rgb(${nr * na + br * (1 - na)}, ${ng * na + bg * (1 - na)}, ${nb * na + bb * (1 - na)})`
      const entry = lum(getComputedStyle(el.querySelector('[data-update-entry]')).color)
      return { box: lum(getComputedStyle(el).backgroundColor), contrast: ratio(lum(flat), entry) }
    })
    ok(lightLook.box > 0.4, `its surface is light (luminance ${lightLook.box.toFixed(2)})`)
    ok(lightLook.contrast >= 4.5, `and the notes read on it (${lightLook.contrast.toFixed(1)}:1)`)
    await shot('update-dialog-light')
    await win.keyboard.press('Escape')
    ok(await closed(), 'Escape closes the window')
    ok(
      (await win.evaluate(() => document.querySelector('[aria-label="Settings"]')?.getAttribute('aria-pressed'))) === 'true',
      'and ONLY the window: Settings, which the same key closes, is still open under it'
    )
    await chip.click()
    await opened()
    await dialog.locator('[data-update-install]').click()
    await pctAtLeast(35)
    await shot('update-progress-light')
    const bar = await dialog.evaluate((el) => {
      const track = el.querySelector('[data-update-track]').getBoundingClientRect()
      const fill = el.querySelector('[data-update-fill]').getBoundingClientRect()
      return fill.width / track.width
    })
    ok(bar > 0.2 && bar <= 1, `in the light style the bar is drawn, and filled to the percentage (${Math.round(bar * 100)}%)`)
    ok(
      await until(async () => (await dialog.getAttribute('data-phase')) === 'idle' && /Preview only/.test((await status.textContent()) ?? ''), 10000, 50),
      'a second preview install runs to its end as well'
    )
    await dialog.locator('[data-update-cancel]').click()
    ok(await closed(), 'and Close closes it')
    // A real install quits the app 400ms after the download. Two whole fake
    // ones later, an app that still answers is an app the preview did not quit.
    ok((await app.windows()).length === 1 && (await win.evaluate(() => 1 + 1)) === 2, 'and the app never quit')
    const after = await updateCalls(app)
    ok(after.checks === 0 && after.installs === 0, `still nothing asked of the network or the installer (${after.checks} checks, ${after.installs} installs)`)
  } finally {
    // The profile is shared: the next scenario must get the style it expects.
    if (styleBefore) await switchStyle(win, styleBefore[0], styleBefore[1]).catch(() => {})
    await app.close().catch(() => {})
  }
}

/**
 * INSTALL STILL GOES THROUGH PRISM'S GUARD (#168). The chip used to call
 * `installUpdate` in App directly; Install in the core's window calls it now,
 * through `useUpdateFlow`'s guard, and "do not weaken it" is only true if it is
 * driven: UNSAVED TEXT is asked about first (2026-08-28), then an agent that is
 * MID-ANSWER, and only then does anything start. A preview asks nothing (it
 * quits nothing), so this scenario is handed a real-shaped offer whose url the
 * installer refuses before it sends a byte (PRISM_E2E_UPDATE_OFFER): both
 * questions, their Cancel, the go-ahead and the line a FAILED install leaves
 * are all driven with no network, no download and no installer.
 *
 * The notes of that offer are HOSTILE and over-long, so the plain-text rule is
 * proved in Prism's real page and not only in the parser's unit tests: what is
 * asserted is the DOM the body produced.
 *
 * The agent is a shell standing in for Claude through its TITLE, exactly as
 * `agentTitle` does it: no CLI, nothing of this machine.
 */
async function updateGuardScenario(fixtures) {
  console.log('update guard')
  const hostile = [
    "## What's Changed",
    '* <img src=x onerror="window.__pwned = 1"> an image tag by @a in https://github.com/o/r/pull/1',
    '* [a link](https://evil.example/login) and <a href="https://evil.example">an anchor</a> by @a in https://github.com/o/r/pull/2',
    '* <script>window.__pwned = 2</script> a script by @a in https://github.com/o/r/pull/3',
    '* <iframe src="https://evil.example"></iframe> a frame by @a in https://github.com/o/r/pull/4',
    ...Array.from({ length: 26 }, (_, i) => `* Change number ${i + 5} with a title long enough to wrap onto a second line in the window by @a in https://github.com/o/r/pull/${i + 5}`),
    '',
    '**Full Changelog**: https://github.com/o/r/compare/v1...v2'
  ].join('\n')
  EXTRA_ENV = {
    PRISM_E2E_UPDATE_OFFER: 'https://example.invalid/Prism-Setup-x64-99.0.0.exe',
    PRISM_E2E_UPDATE_NOTES: hostile
  }
  const notes = join(fixtures, 'notes.txt')
  const notesBefore = readFileSync(notes, 'utf-8')
  let launched
  try {
    launched = await launch(notes)
  } finally {
    EXTRA_ENV = {}
  }
  const { app, win } = launched
  try {
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    const chip = win.locator('[data-update-chip]')
    const updateDialog = win.locator('[data-update-dialog]')
    const question = win.locator('[role="dialog"]:not([data-update-dialog])')
    const notice = win.locator('[data-update-notice]')
    const installs = async () => (await updateCalls(app)).installs
    const openUpdate = async () => {
      await chip.click()
      return until(async () => (await updateDialog.count()) === 1, 4000, 50)
    }
    ok(await until(async () => (await chip.count()) === 1, 8000), 'a real-shaped offer shows the chip')
    ok(((await chip.textContent()) ?? '').includes('Update 99.0.0'), 'naming the version on offer')

    ok(await openUpdate(), 'the chip opens the window on a hostile body')
    const dom = await updateDialog.evaluate((el) => {
      const list = el.querySelector('[data-update-notes]')
      const install = el.querySelector('[data-update-install]').getBoundingClientRect()
      return {
        forbidden: [...el.querySelectorAll('a, img, script, iframe, [onerror], [href], [src]')].length,
        entries: el.querySelectorAll('[data-update-entry]').length,
        more: el.querySelector('[data-update-more]')?.textContent ?? '',
        text: el.textContent ?? '',
        scrolls: list.scrollHeight > list.clientHeight + 1,
        installOnScreen: install.bottom <= innerHeight && install.top >= 0,
        preview: !!el.querySelector('[data-update-preview]'),
        pwned: window.__pwned ?? null
      }
    })
    ok(dom.forbidden === 0, `nothing the body asked for is an element (${dom.forbidden} anchors, images, scripts or frames)`)
    ok(dom.pwned === null, 'and its handler never ran')
    ok(!/evil\.example|https?:|by @/.test(dom.text), 'no url or author is printed either')
    ok(/An image tag/.test(dom.text) && /A link and an anchor/.test(dom.text), 'what is left of each line is its words')
    ok(dom.entries === 20 && dom.more === '+ 10 more', `the list is capped and counts the rest (${dom.entries} shown, "${dom.more}")`)
    ok(dom.scrolls && dom.installOnScreen, 'the list scrolls inside the window, and Cancel and Install stay on screen under it')
    ok(!dom.preview, 'a real offer is not called a preview')
    await win.screenshot({ path: join(SHOTS, 'update-dialog-long.png') }).catch(() => {})
    await win.keyboard.press('Escape')
    await until(async () => (await updateDialog.count()) === 0, 4000, 50)

    // 1. UNSAVED TEXT is asked about before anything else.
    await win.locator('.cm-line').first().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type('omega')
    ok(
      await until(async () => ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('*'), 5000, 50),
      'a file holds unsaved text'
    )
    ok(await openUpdate(), 'the window opens')
    await updateDialog.locator('[data-update-install]').click()
    ok(await until(async () => (await question.count()) === 1, 4000, 50), 'Install asks about the unsaved text before it does anything')
    ok((await updateDialog.count()) === 0, 'from in front of the update window, not from behind it')
    const dirtyAsk = (await question.textContent()) ?? ''
    ok(/unsaved changes/i.test(dirtyAsk) && /notes\.txt/.test(dirtyAsk), `naming the file ("${dirtyAsk.slice(0, 60)}")`)
    ok(/Installing the update restarts Prism/.test(dirtyAsk), 'and saying why an install is asking about it')
    ok(/Cancel/.test(dirtyAsk) && /Discard/.test(dirtyAsk) && /Save all changes/.test(dirtyAsk), 'with the three answers closing has')
    await win.screenshot({ path: join(SHOTS, 'update-unsaved-question.png') }).catch(() => {})
    await win.keyboard.press('Escape')
    ok(await until(async () => (await question.count()) === 0, 4000, 50), 'Escape backs out')
    ok((await installs()) === 0 && (await chip.getAttribute('data-phase')) === 'idle', 'and nothing was started')
    ok(((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('*'), 'with the unsaved text kept')

    // The same question, answered: Discard lets the install go ahead, and the
    // refused url makes it FAIL, which is the line under the chip.
    await openUpdate()
    await updateDialog.locator('[data-update-install]').click()
    await until(async () => (await question.count()) === 1, 4000, 50)
    await question.locator('button:has-text("Discard")').click()
    ok(await until(async () => (await installs()) === 1, 6000, 50), 'once the question is answered the install starts')
    // The window stepped aside for the question; after the answer it is back
    // as the progress window, and that is where a failure is said (#178).
    const failed = updateDialog.locator('[data-update-status]')
    const closeEnded = async () => {
      await updateDialog.locator('[data-update-cancel]').click()
      return until(async () => (await updateDialog.count()) === 0, 4000, 50)
    }
    ok(
      await until(async () => (await updateDialog.count()) === 1 && /could not be downloaded/.test((await failed.textContent()) ?? ''), 8000, 50),
      'an install that fails says so IN the update window, which came back after the question'
    )
    ok((await notice.count()) === 0, 'and not a second time under the chip')
    await win.screenshot({ path: join(SHOTS, 'update-failed.png') }).catch(() => {})
    ok(((await updateDialog.locator('[data-update-cancel]').textContent()) ?? '').trim() === 'Close' && (await closeEnded()), 'the way out is called Close, and closes it')
    ok(await until(async () => (await chip.getAttribute('data-phase')) === 'idle', 4000, 50), 'and the chip offers the update again')
    ok(readFileSync(notes, 'utf-8') === notesBefore, 'Discard wrote nothing to the file')

    // 2. A WORKING AGENT is asked about next. A shell stands in for Claude
    // through its title: idle first (the birth title), then mid-answer.
    //
    // THE PROCESS POLL'S FIRST ANSWER IS WAITED FOR, before any title is set.
    // The poll reports a session only when its answer CHANGES, and a new
    // shell's first answer ("no agent in this tree") is a change from nothing:
    // it arrives a few seconds after the spawn and takes a titled session's
    // working state with it (MEASURED here: the tab lit and went dark again
    // within 400ms, and Install then asked nothing). After that one the poll
    // has nothing further to say about a shell that still hosts no agent.
    // Prism Terminal's scenario sleeps six seconds for it; this one listens.
    await win.evaluate(() => {
      window.__agentSaid = 0
      window.prism.onTermAgent(() => (window.__agentSaid += 1))
    })
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await win.waitForFunction(
      () => /PS [^>]*>\s*$/.test((document.querySelector('.xterm .xterm-rows')?.textContent ?? '').trimEnd()),
      null,
      { timeout: 45000 }
    )
    ok(await until(() => win.evaluate(() => window.__agentSaid > 0), 45000, 100), 'the process poll has had its first look at the shell')
    await win.locator('.xterm').click()
    const say = async (glyph, text) => {
      await win.keyboard.type(`$Host.UI.RawUI.WindowTitle = "$([char]0x${glyph}) ${text}"`)
      await win.keyboard.press('Enter')
    }
    const working = () =>
      win.evaluate(() => !!document.querySelector('[role="tablist"] [data-agent-state="working"]'))
    await say('2733', 'Claude Code') // ✳, idle
    ok(
      await until(() => win.evaluate(() => !!document.querySelector('[role="tablist"] [data-agent-present]')), 10000, 50),
      'a shell stands in for Claude through its title'
    )
    await say('25D0', 'Claude Code') // ◐, mid-answer
    ok(await until(working, 8000, 50), 'and is mid-answer')

    ok(await openUpdate(), 'the window opens over a working terminal')
    await updateDialog.locator('[data-update-install]').click()
    ok(await until(async () => (await question.count()) === 1, 4000, 50), 'Install asks about the agent before it does anything')
    const asked = (await question.textContent()) ?? ''
    ok(asked.includes('Stop the agent and install the update?'), `in its own words ("${asked.slice(0, 40)}")`)
    ok(/Claude/.test(asked) && /working for/.test(asked) && /Install and restart/.test(asked), 'naming the agent, how long it has worked, and what yes means')
    ok(!/Close window/.test(asked), 'and not as the window question it used to borrow')
    await win.screenshot({ path: join(SHOTS, 'update-agent-question.png') }).catch(() => {})
    await win.keyboard.press('Escape')
    ok(await until(async () => (await question.count()) === 0, 4000, 50), 'Escape backs out')
    ok((await installs()) === 1 && (await chip.getAttribute('data-phase')) === 'idle', 'and nothing more was started')

    await openUpdate()
    await updateDialog.locator('[data-update-install]').click()
    await until(async () => (await question.count()) === 1, 4000, 50)
    await question.locator('[data-primary="true"]').click()
    ok(await until(async () => (await installs()) === 2, 6000, 50), 'the go-ahead starts the install')
    ok(
      await until(async () => (await updateDialog.count()) === 1 && /could not be downloaded/.test((await failed.textContent()) ?? ''), 8000, 50),
      'which fails, and says so in the window'
    )
    await closeEnded()
    ok(await until(async () => (await chip.getAttribute('data-phase')) === 'idle', 4000, 50), 'and the chip is idle again')
    // A failed install must not leave the close question pre-answered: the
    // agent is still working, so closing the window still asks.
    await win.evaluate(() => window.prism.close())
    ok(await until(async () => (await question.count()) === 1, 5000, 50), 'closing the window still asks about the agent afterwards')
    ok(/close the window/.test((await question.textContent()) ?? ''), 'with the window question, not the install one')
    await win.keyboard.press('Escape')
    await until(async () => (await question.count()) === 0, 4000, 50)
    ok(!win.isClosed(), 'and Escape keeps the window')

    // ONE QUESTION AT A TIME: a question raised while the update window is up
    // must not mount under it with the focus where nobody can see it.
    await openUpdate()
    await win.evaluate(() => window.prism.close())
    ok(await until(async () => (await question.count()) === 1, 5000, 50), 'a close question raised over the update window is asked')
    ok(await until(async () => (await updateDialog.count()) === 0, 4000, 50), 'and the update window gives way to it')
    ok(
      await until(() => win.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:not([data-update-dialog])')), 4000, 50),
      'so the focus is on the question that can be seen'
    )
    await win.keyboard.press('Escape')
    await until(async () => (await question.count()) === 0, 4000, 50)

    const calls = await updateCalls(app)
    ok(calls.checks === 0, `GitHub was never asked (${calls.checks} release checks)`)
    // End idle, so nothing holds the teardown.
    await win.locator('.xterm').click()
    await say('2733', 'Claude Code')
    await until(async () => !(await working()), 8000, 50)
  } finally {
    await app.close().catch(() => {})
  }
}

/** Without the flag there is NO chip under --e2e, and nothing asks GitHub. The
 *  unpackaged mock used to be in every scenario's title bar, asserted by none;
 *  it is the core's preview now, and the suite only sees it when it asks. */
async function updateQuietScenario(fixtures) {
  console.log('update quiet')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    await win.waitForSelector('.p-md h1', { timeout: 15000 })
    // The page asks main to replay an offer the moment it subscribes, so a
    // chip that was coming would be here by the time the document has painted;
    // the wait below is for the bar itself, the absence is read after it.
    ok(await until(async () => (await win.locator('[data-title-bar] [aria-label="Settings"]').count()) === 1, 8000, 50), 'the title bar is up')
    ok(!(await until(async () => (await win.locator('[data-update-chip]').count()) > 0, 1500, 50)), 'without --preview-update there is no chip under --e2e')
    const calls = await updateCalls(app)
    ok(calls.checks === 0 && calls.installs === 0, `and the network was never asked (${calls.checks} checks)`)
  } finally {
    await app.close().catch(() => {})
  }
}

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
// `=name` is an exact match: the terminal gate lists scenarios, and a bare
// "terminal" or "tabs" would spill into every scenario containing the word.
const chosen = (name) =>
  !only.length ||
  only.some((o) =>
    o.startsWith('=')
      ? name.toLowerCase() === o.slice(1).toLowerCase()
      : name.toLowerCase().includes(o.toLowerCase())
  )
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
await run(updateWindowScenario)
await run(updateGuardScenario)
await run(updateQuietScenario)
await run(terminalScenario)
await run(termOptionsScenario)
await run(helpPanelScenario)
await run(dictationScenario)
await run(dictationPageScenario)
await run(pinRecentScenario)
await run(termCwdScenario)
await run(agentTitleScenario)
await run(handoffOverTermScenario)
await run(promptLayoutScenario)
await run(archiveScenario)
await run(extractScenario)
await run(extractWindowScenario)
await run(extractCancelScenario)
await run(flatZipScenario)
await run(comicScenario)
await run(folderArgScenario)
await run(gearScenario)
await run(pauseScenario)
await run(playOnOpenScenario)
await run(volumeScenario)
await run(fullscreenBlackScenario)
await run(searchQueryScenario)
await run(videoMenuScenario)
await run(selectionScenario)
await run(dragScenario)
await run(phoneScenario)
await run(phoneHlsScenario)
await run(phoneDocsScenario)
await run(phoneTabsScenario)
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
