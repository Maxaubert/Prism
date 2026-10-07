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
  statfsSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { BIG, buildBigFixtures, buildFixtures, OTHER_ROOT } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = process.env.PRISM_E2E_MAIN ?? join(ROOT, 'out', 'main', 'index.js')
// Two worktrees can run the suite at once (2026-10-04, #271: a run in one
// reaped the other's app, since both matched the same profile name). A run
// may name its own profile; it must not CONTAIN the default name, or the
// default run's reaper still matches it.
const PROFILE_NAME = process.env.PRISM_E2E_PROFILE_NAME || 'prism-e2e-profile'
const PROFILE = join(tmpdir(), PROFILE_NAME)
const SHOTS = join(ROOT, '.e2e', 'shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

function seedExplorerTab(projectFile) {
  const directory = join(ROOT, '.e2e', 'fixtures')
  const explorer = {
    id: 'fixture-explorer', role: 'explorer', pinned: true, root: directory,
    browse: { path: directory, history: [{ path: directory, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } }], cursor: 0, surface: 'folder', preview: true },
    panes: [], open: [directory]
  }
  // A FILE FROM OUTSIDE OPENS IN THE EXPLORER TAB now (2026-09-22), so a
  // launch that means "this file, in a project on its folder" - which is what
  // almost every scenario is written against - is seeded as that project,
  // saved and restored in front, rather than handed over on the command line.
  const project = projectFile
    ? [{ id: 'fixture-project', role: 'project', root: dirname(projectFile), file: projectFile, panes: [] }]
    : []
  writeFileSync(join(PROFILE, 'tabs.json'), JSON.stringify({ active: project.length, tabs: [explorer, ...project] }))
}

/** A path that is a file on disk: those open as a seeded project. */
const isFileOnDisk = (p) => {
  try {
    return !!p && statSync(p).isFile()
  } catch {
    return false
  }
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
  const seeded = !keepTabs && isFileOnDisk(file)
  if (!keepTabs) seedExplorerTab(seeded ? file : undefined)
  const app = await launchTestApp({
    args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e', ...EXTRA_ARGS, ...(seeded ? [] : [file])],
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

    // The external one leaves the app and NOT inside it. Under --e2e main
    // RECORDS it on __e2eOpenedLinks instead of handing it to the shell (#222),
    // so no run opens a browser tab; this read the old shell stub, which
    // nothing calls any more, and saw an empty list.
    const heldLinks = (await app.evaluate(() => globalThis.__e2eOpenedLinks?.length)) ?? 0
    await win.locator('[data-page="1"] .p-pdf-annots button').first().click()
    await sleep(500)
    const opened = ((await app.evaluate(() => globalThis.__e2eOpenedLinks)) ?? []).slice(heldLinks)
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

/**
 * A HUGE FOLDER IN THE TREE COSTS WHAT A SMALL ONE DOES (2026-09-28; owner:
 * "prism is super slow i click and it takes like 3 seconds for it to react").
 * MEASURED in the owner's Prism: AppData\Local\Temp open in the tree, 47,816
 * rows in the page, 382,000 elements, and a 1.2 s block of the renderer on
 * every folder switch. The tree now draws only the rows in view. Here: a
 * folder of 20,000 files, and the page must hold a window of rows, the last
 * file must be reachable by scrolling, the arrows must still walk, and a click
 * must not block the renderer.
 */
async function bigTreeScenario() {
  console.log('big tree')
  // In the repo's .e2e, beside the other big fixtures: never in %TEMP%, whose
  // pile of leftovers is what made the owner's tree huge in the first place.
  const dir = join(dirname(BIG), 'bigtree')
  const COUNT = 20000
  if (!existsSync(join(dir, `f${String(COUNT - 1).padStart(5, '0')}.txt`))) {
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < COUNT; i++) writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.txt`), 'x')
  }
  const { app, win } = await launch(join(dir, 'f00000.txt'))
  try {
    const rows = win.locator('[role="tree"] [role="treeitem"]')
    await rows.first().waitFor({ timeout: 45000 })
    const mounted = await rows.count()
    ok(mounted > 0 && mounted < 200, `a 20,000-file folder mounts a window of rows, not all of them (${mounted})`)
    // Scroll the tree to its end: the last file is drawn there.
    await win.evaluate(() => {
      const box = document.querySelector('[role="tree"]').parentElement
      box.scrollTop = box.scrollHeight
    })
    const last = win.locator('[role="treeitem"][data-row$="f19999.txt"]')
    ok(!!(await last.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)), 'scrolled to the end, the last file is there')
    ok((await rows.count()) < 200, 'and the window stays a window')
    // A click on a row must not block the renderer for long.
    await win.evaluate(() => {
      window.__long = []
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push(Math.round(e.duration))
      }).observe({ entryTypes: ['longtask'] })
    })
    await last.click()
    await sleep(800)
    const longest = await win.evaluate(() => Math.max(0, ...window.__long))
    ok(longest < 300, `a click in a huge tree blocks the renderer for at most ${longest} ms (under 300)`)
    // The arrows still walk: Up from the last file lands on the one before it.
    await win.keyboard.press('ArrowUp')
    ok(
      !!(await win
        .waitForFunction(() => document.activeElement?.getAttribute('data-row')?.endsWith('f19998.txt'), null, { timeout: 3000 })
        .then(() => true)
        .catch(() => false)),
      'the arrow keys still walk the rows'
    )
  } finally {
    await app.close().catch(() => {})
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
    // A COLD RUNNER LISTS SLOWLY. Ten seconds is plenty on this machine and
    // was not always enough on a GitHub runner, where the app boots, restores
    // its tabs and lists the folder against a cold disk (MEASURED: this timed
    // out twice on CI in one afternoon, on changes that touch nothing here).
    // A longer bound costs nothing when the row is already there, and a flaky
    // check is a bug in the gate rather than something to re-run.
    await fileRows.first().waitFor({ timeout: 45000 })
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
    await settingsPage(win, 'terminal')
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
    // The pencil lives on the SELECTED card only: select a theme, its
    // pencil appears, edit, save - the one Custom slot. Pitch, not Bright
    // Lights: that theme is retired in core-v0.15.0 (PrismTerminal #62), and
    // Pitch is in the list before and after it.
    await win.locator('button[aria-label^="Show all"]').click()
    await sleep(200)
    await win.locator('[data-term-card="pitch"]').click()
    ok(
      (await win.locator('[data-edit-theme]').count()) === 1 &&
        (await win.locator('[data-edit-theme="pitch"]').count()) === 1,
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

    await win.locator('[data-term-card="pitch"]').click()
    await win.locator('[data-edit-theme="pitch"]').click()
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
    // Prism's window material belongs to the app STYLE, so a row the list
    // marks `onlyWhere` (window-acrylic-only: the opacity slider today) is not
    // shown here. HOW MANY such rows there are is the core's business, not
    // this gate's (#253): Prism Terminal's colour picker work removes the
    // opacity row, and a count of exactly one would have held that core bump
    // red for ever. What is checked is the rule: every other row is on the
    // page in the list's order, and every `onlyWhere` row is absent.
    const rows = [...src.matchAll(/\{\s*id: '([a-z-]+)'[^}]*\}/g)]
    const wanted = rows.filter((m) => !m[0].includes('onlyWhere')).map((m) => m[1]).sort()
    const windowOnly = rows.filter((m) => m[0].includes('onlyWhere')).map((m) => m[1])
    ok(wanted.length >= 8, `the core lists the terminal options (${wanted.length} of ${rows.length} apply here)`)
    // Since the grouped cards (#292) the core's rows sit on TWO pages here:
    // Terminal (shell, text, theme) and Agents (marks, Claude Code, colours).
    // Which page holds a section is the host's; the rows and their order
    // inside each section are the core's.
    await settingsPage(win, 'terminal')
    await win.waitForSelector('[data-terminal-settings]', { timeout: 5000 })
    // The shell row appears once main has answered with the shells it found.
    await win.waitForSelector('[data-pref="term-shell"]', { timeout: 8000 }).catch(() => {})
    const readPage = () =>
      win.evaluate(() => {
        const root = document.querySelector('[data-terminal-settings], [data-agent-settings]')
        return {
          prefs: [...(root?.querySelectorAll('[data-pref]') ?? [])].map((e) => e.getAttribute('data-pref')),
          sections: [...(root?.querySelectorAll('[data-settings-section]') ?? [])].map((sec) => ({
            id: sec.getAttribute('data-settings-section'),
            panels: sec.querySelectorAll(':scope > [data-settings-panel]').length,
            prefs: [...sec.querySelectorAll('[data-pref]')].map((e) => e.getAttribute('data-pref'))
          }))
        }
      })
    const terminalPage = await readPage()
    await win.screenshot({ path: join(SHOTS, 'terminal-settings.png') })
    await settingsPage(win, 'agents')
    await win.waitForSelector('[data-agent-settings]', { timeout: 5000 })
    const agentsPage = await readPage()
    await win.screenshot({ path: join(SHOTS, 'agent-settings.png') })
    // No command help in Prism (2026-09-22): the two pages are the terminal
    // list and nothing else, the help row included.
    const onPage = [...terminalPage.prefs, ...agentsPage.prefs].sort()
    ok(JSON.stringify(onPage) === JSON.stringify(wanted), `the Terminal and Agents pages show exactly that list (shown: ${JSON.stringify(onPage)})`)
    ok(!onPage.includes('help-enabled'), 'with no command help row, which is Prism Terminal only')
    ok(
      terminalPage.prefs.every((id) => ['term-shell', 'term-font-family', 'term-font', 'term-theme', 'term-acrylic'].includes(id)) &&
        agentsPage.prefs.every((id) => id.startsWith('agent-')),
      `the terminal's rows on Terminal, the agents' on Agents (${terminalPage.prefs.join(', ')} | ${agentsPage.prefs.join(', ')})`
    )
    // ONE ORDER IN BOTH APPS (owner, 2026-09-22), read PER SECTION since the
    // grouped cards: inside each of the core's sections the rows come in the
    // list's own order, and each section is ONE panel. Prism Terminal's own
    // `options` scenario asserts the same against the same file.
    const inOrder = rows.filter((m) => !m[0].includes('onlyWhere')).map((m) => m[1])
    const sections = [...terminalPage.sections, ...agentsPage.sections]
    ok(sections.length >= 6, `the core's sections are drawn (${sections.map((x) => x.id).join(', ')})`)
    for (const sec of sections) {
      const listed = sec.prefs.filter((id) => inOrder.includes(id))
      ok(
        JSON.stringify(listed) === JSON.stringify(inOrder.filter((id) => listed.includes(id))),
        `${sec.id}: in the shared order (${listed.join(' > ')})`
      )
      ok(sec.panels === 1, `${sec.id}: one panel`)
    }
    ok((await win.locator('[data-pref="term-opacity"]').count()) === 0, 'with no opacity slider: the style owns the glass')
    const shownWindowOnly = []
    for (const id of windowOnly) if (onPage.includes(id)) shownWindowOnly.push(id)
    ok(
      shownWindowOnly.length === 0,
      `and no row the core keeps for a window-acrylic host (${windowOnly.length ? windowOnly.join(', ') : 'none listed'}; shown: ${JSON.stringify(shownWindowOnly)})`
    )
    // Untouched, the indicator is MINIMAL and its colours follow the accent.
    ok(
      (await win.evaluate(() => localStorage.getItem('prism.term.agentIndicator'))) === null &&
        (await win.locator('[data-pref="agent-indicator"] [aria-pressed="true"], [data-pref="agent-indicator"] [aria-checked="true"]').first().textContent().catch(() => '') ?? '').includes('Minimal'),
      'an untouched indicator reads Minimal'
    )
    // The close question is one rule and no setting, on every page.
    let closeRows = 0
    for (const name of ['explorer', 'terminal', 'agents']) {
      await settingsPage(win, name)
      await sleep(250)
      closeRows += await win.locator('text=/Ask before closing/i').count()
    }
    ok(closeRows === 0, 'and the close question is not a setting any more')
  } finally {
    await app.close()
  }
}

/**
 * NO COMMAND HELP IN PRISM (owner, 2026-09-22: "command help shouldn't be part
 * of Prism the normal app, only the terminal app"). It is Prism Terminal's; in
 * Prism F1 is the shell's, the terminal's menu has no row for it and Settings
 * has no switch.
 */
async function noCommandHelpScenario(fixtures) {
  console.log('no command help')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await win.locator('.xterm').click()
    await win.keyboard.press('F1')
    await sleep(800)
    ok((await win.locator('[data-help-panel]').count()) === 0, 'F1 over a focused shell opens no help popup')
    await win.locator('[data-term-panel]').click({ button: 'right', position: { x: 200, y: 120 } })
    await win.waitForSelector('[role="menu"] [role="menuitem"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]', { hasText: 'Command help' }).count()) === 0,
      "the terminal's menu offers no command help"
    )
    await win.keyboard.press('Escape')
    await settingsPage(win, 'terminal')
    await win.waitForSelector('[data-terminal-settings]', { timeout: 8000 })
    ok((await win.locator('[data-pref="help-enabled"]').count()) === 0, 'and Settings has no command help switch')
    await win.locator('[data-settings-find]').fill('command help')
    ok(
      await until(async () => ((await win.locator('[data-settings-page] [role="status"]').textContent().catch(() => '')) ?? '') === 'No results', 3000, 50),
      'nor does Find a setting know of one'
    )
    await win.locator('[data-settings-find]').fill('')
  } finally {
    await app.close()
  }
}

/**
 * ONE COLOUR PICKER, WITH ALPHA, FOR EVERY COLOUR (#253; owner, 2026-10-03:
 * "the colour pickers should be the same for both apps, i need an input field
 * for a color code and an alpha per colour on every colour setting colour
 * picker both in pt and prism, also in the terminal tab where we have things
 * like agent indicators, and terminal themes with specific colours").
 *
 * The picker is prism-term-core's (`renderer/settings/ColourPicker.tsx`), and a
 * core change reaches Prism by an AUTO-MERGED bump, so this gate is landed
 * BEFORE the core has it and runs the first time a bump carries it. Until
 * then it skips itself, by the file's presence: feature detection, never a
 * version number. Written against the DOM contract the design fixes
 * (PrismTerminal `docs/superpowers/specs/2026-10-03-colour-picker-alpha-design.md`):
 * `[data-colour-swatch]` "Pick <label>", `[data-colour-popover][role="dialog"]`,
 * sliders named `Saturation and brightness` / `Hue` / `Alpha`, the alpha's
 * `aria-valuenow` in whole percent.
 *
 * The working stand-in comes FIRST, before the popover opens: Escape must be
 * pressed with the popover still open to prove it puts back an UNSET row, and
 * the Full tab's ink is read while the see-through colour is live.
 */
async function termColourPickerScenario(fixtures) {
  console.log('terminal colour picker')
  if (!existsSync(join(ROOT, 'node_modules/prism-term-core/renderer/settings/ColourPicker.tsx'))) {
    console.log('  skipped (core has no ColourPicker)')
    return
  }
  const hexRgb = (h) => {
    const s = h.replace('#', '').trim()
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
  }
  const cssRgba = (c) => {
    const n = (c.match(/[\d.]+/g) ?? []).map(Number)
    return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }
  }
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (x, y) => {
    const [a, b] = [lum(x), lum(y)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    // 1. A shell stands in for Claude, mid-answer (updateGuard's recipe: the
    // poll's first look is waited for, or it takes the titled state away).
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
    const workingTab = win.locator('[role="tablist"] [data-agent-state="working"]')
    await say('2733', 'Claude Code') // ✳, idle
    await until(() => win.evaluate(() => !!document.querySelector('[role="tablist"] [data-agent-present]')), 10000, 50)
    await say('25D0', 'Claude Code') // ◐, mid-answer
    ok(await until(async () => (await workingTab.count()) === 1, 8000, 50), 'a working stand-in agent is on the strip')

    await settingsPage(win, 'terminal')
    await win.waitForSelector('[data-terminal-settings]', { timeout: 8000 })
    const themeBefore = await win.locator('[data-term-card][aria-pressed="true"]').first().getAttribute('data-term-card')
    // The agent rows are the Agents page's since the grouped cards (#292).
    await settingsPage(win, 'agents')
    await win.waitForSelector('[data-agent-settings]', { timeout: 8000 })
    await win.locator('[data-pref="agent-indicator"] button:has-text("Full")').click()
    ok(await until(async () => (await workingTab.getAttribute('data-agent')) === 'full', 4000, 50), 'the indicator is Full, the tab filled')

    // 2-3. Opened and closed with no change writes nothing.
    const stored = () => win.evaluate(() => localStorage.getItem('prism.term.agentColor'))
    const before = await stored()
    ok(!before, `the working colour follows the theme to begin with (${JSON.stringify(before)})`)
    const row = win.locator('[data-pref="agent-color"]')
    const swatch = row.locator('[data-colour-swatch]')
    const popover = win.locator('[data-colour-popover][role="dialog"]')
    const reset = row.locator('[data-follow-theme]')
    const escapeFromPicker = async () => {
      await popover.locator('[role="slider"]').first().focus()
      await win.keyboard.press('Escape')
    }
    ok((await swatch.getAttribute('aria-label')) === 'Pick Agent working colour', 'the row has a swatch named for it')
    await swatch.click()
    ok(await until(async () => (await popover.count()) === 1, 4000, 50), 'the swatch opens the picker')
    ok((await popover.getAttribute('aria-label')) === 'Agent working colour', "the picker is named for the row's colour")
    // The spec does not say the focus moves into the popover as it opens, and
    // an Escape left on the swatch is not the popover's: focus inside first.
    await escapeFromPicker()
    ok(await until(async () => (await popover.count()) === 0, 4000, 50), 'Escape closes it')
    ok((await stored()) === before && (await reset.count()) === 0, 'and an open and close with no change stores nothing and shows no Reset')

    // 4-5. Alpha down to 50 on the keyboard: hex8 is stored, the tab is see-through.
    await swatch.click()
    await until(async () => (await popover.count()) === 1, 4000, 50)
    const alpha = popover.locator('[role="slider"][aria-label="Alpha"]')
    ok((await alpha.count()) === 1, 'the picker has an Alpha slider')
    await alpha.focus()
    const now = async () => Number(await alpha.getAttribute('aria-valuenow'))
    for (let i = 0; i < 40 && (await now()) > 50; i++) {
      await win.keyboard.press((await now()) - 50 >= 10 ? 'Shift+ArrowLeft' : 'ArrowLeft')
    }
    ok((await now()) === 50, `Shift+Left walks the alpha to 50 percent (${await now()})`)
    ok(await until(async () => /^#[0-9a-f]{8}$/.test((await stored()) ?? ''), 3000, 50), `the working colour is stored as hex8 (${await stored()})`)
    ok(/^#[0-9a-f]{8}$/.test(await row.locator('input:not([type])').inputValue()), 'and its code field shows the eight digits')
    const tabLook = () =>
      win.evaluate(() => {
        const el = document.querySelector('[role="tablist"] [data-agent-state="working"]')
        if (!el) return null
        const cs = getComputedStyle(el)
        return {
          bg: cs.backgroundColor,
          ink: cs.color,
          ground: getComputedStyle(document.documentElement).getPropertyValue('--p-tabs-flat').trim()
        }
      })
    // The fill FADES to its new colour, so it is read once it has arrived at
    // the stored alpha: a sample mid-fade measured 0.875 and failed the ink.
    const want = parseInt(((await stored()) ?? '').slice(7, 9), 16) / 255
    const seeThrough = await until(async () => {
      const l = await tabLook()
      return l && Math.abs(cssRgba(l.bg).a - want) < 0.02 ? l : null
    }, 4000, 50)
    ok(!!seeThrough, `the Full tab's fill carries the alpha (${seeThrough?.bg ?? (await tabLook())?.bg})`)

    // 6. Its ink is chosen on the fill as laid on the strip, at 4.5:1.
    if (seeThrough) {
      const fill = cssRgba(seeThrough.bg)
      const ground = hexRgb(seeThrough.ground)
      const seen = fill.rgb.map((v, i) => ground[i] + (v - ground[i]) * fill.a)
      const r = ratio(cssRgba(seeThrough.ink).rgb, seen)
      ok(r >= 4.5, `the Full tab's text reads on the composite (${r.toFixed(1)}:1, ${seeThrough.ink} on ${seeThrough.bg} over ${seeThrough.ground})`)
    }
    await win.screenshot({ path: join(SHOTS, 'term-colour-picker.png') }).catch(() => {})

    // 7. Escape with a write behind it puts the UNSET row back.
    await win.keyboard.press('Escape')
    ok(await until(async () => (await popover.count()) === 0, 4000, 50), 'Escape closes the changed picker')
    ok(await until(async () => (await stored()) === before, 3000, 50), `and puts back a row that follows the theme (${JSON.stringify(await stored())})`)
    ok((await reset.count()) === 0, 'with no Reset showing')

    // 8-10. The theme editor: no alpha on the Background in Prism (the style
    // owns see-through), alpha on a palette colour, and no accent on a control.
    // The theme is the Terminal page's (#292).
    await settingsPage(win, 'terminal')
    await win.waitForSelector('[data-terminal-settings]', { timeout: 8000 })
    const showAll =win.locator('button[aria-expanded="false"][aria-label^="Show all"]')
    if ((await showAll.count()) === 1) await showAll.click()
    await win.locator('[data-term-card="pitch"]').click()
    await win.locator('[data-edit-theme="pitch"]').click()
    await win.waitForSelector('[data-theme-editor]', { timeout: 5000 })
    const editor = win.locator('[data-theme-editor]')
    await editor.locator('[data-colour-swatch][aria-label="Pick Background"]').click()
    ok(await until(async () => (await popover.count()) === 1, 4000, 50), "the theme's Background opens the picker")
    ok((await popover.locator('[role="slider"][aria-label="Alpha"]').count()) === 0, "with no Alpha slider: in Prism the style owns the window's see-through")
    const accentFilled = await win.evaluate(() => {
      const pop = document.querySelector('[data-colour-popover]')
      const probe = document.createElement('div')
      document.body.append(probe)
      const fills = ['--p-accent', '--p-sel-bg'].map((t) => {
        probe.style.background = `var(${t})`
        return getComputedStyle(probe).backgroundColor
      })
      probe.remove()
      return [...(pop?.querySelectorAll('button, input, [role="slider"]') ?? [])]
        .filter((e) => fills.includes(getComputedStyle(e).backgroundColor))
        .map((e) => e.getAttribute('aria-label') ?? e.textContent)
    })
    ok(accentFilled.length === 0, `no control in the picker wears the accent (${JSON.stringify(accentFilled)})`)
    await escapeFromPicker()
    ok(await until(async () => (await popover.count()) === 0, 4000, 50), "Escape closes the editor's picker")
    // Held for a while, not read once: an editor that left on a delay (an
    // exit transition) would still be counted the instant the picker went.
    ok(!(await until(async () => (await editor.count()) === 0, 600, 50)), 'and only the picker: the theme editor stays open behind it')
    await editor.locator('[data-colour-swatch][aria-label="Pick red"]').click()
    ok(await until(async () => (await popover.count()) === 1, 4000, 50), 'a palette colour opens the picker')
    ok((await popover.locator('[role="slider"][aria-label="Alpha"]').count()) === 1, 'with an Alpha slider')
    await escapeFromPicker()
    await until(async () => (await popover.count()) === 0, 4000, 50)
    await editor.locator('button:has-text("Cancel")').click()
    await until(async () => (await editor.count()) === 0, 4000, 50)

    // The profile is shared by the scenarios after this one: theme and
    // indicator go back to what they were, and the stand-in ends idle.
    if (themeBefore && themeBefore !== 'pitch') await win.locator(`[data-term-card="${themeBefore}"]`).click()
    await win.evaluate(() => localStorage.removeItem('prism.term.agentIndicator'))
    await win.locator('[role="tablist"] [data-agent-present] [role="tab"]').click()
    await win.locator('.xterm').click()
    await say('2733', 'Claude Code')
    await until(async () => (await workingTab.count()) === 0, 8000, 50)
  } finally {
    await app.close().catch(() => {})
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
    await settingsPage(win, 'dictation')
    await win.waitForSelector('[data-dictation-settings]', { timeout: 8000 })
    ok((await win.locator('[data-pref="dictation-enabled"] [role="switch"]').getAttribute('aria-checked')) === 'true', 'Settings has a Dictation page of its own, and it reads the setting')
    await win.locator('[data-pref="dictation-enabled"] [role="switch"]').click()
    await win.locator('[data-pref="dictation-enabled"] [role="switch"]').click()
    await win.screenshot({ path: join(SHOTS, 'dictation-settings.png') })
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:not(:has-text("Settings"))').first().click()
    await sleep(400)

    // A MEDIA VIEWER FIRST: no terminal showing, so Right Alt is nobody's key.
    // Arming dictation WARMS the engine on purpose (the core starts the server
    // so the first word is not a cold start), so the count is taken once that
    // has settled and the press must not ADD one. Counting from zero raced the
    // warm-up and failed the runner's gate twice (Prism #254, #264).
    let warm = ourSpeechServers()
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      const now = ourSpeechServers()
      if (now === warm && i >= 3) break
      warm = now
    }
    await win.keyboard.down('AltRight')
    await sleep(700)
    ok((await pill().count()) === 0, 'with no terminal showing, holding Right Alt does nothing')
    await win.keyboard.up('AltRight')
    await sleep(500)
    ok(ourSpeechServers() === warm, `and the press started no speech server (${ourSpeechServers()} after, ${warm} warm before)`)

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
    await win.keyboard.up('AltRight')
    const heard = await waitUntil(async () => /ask not what your country/i.test((await text()).replace(/\s+/g, ' ')), 30000)
    ok(heard, 'the spoken sentence arrives on the prompt line')
    ok(await waitUntil(async () => (await pill().count()) === 0, 5000), 'and the pill goes away')
    // NO ENTER: had one gone through, PowerShell would have run the sentence
    // and answered that its first word is not a command. Counting prompts on
    // screen was the old test, and a long sentence that wraps scrolls the
    // prompt out of view, so it read as "a prompt went missing".
    await sleep(1500)
    ok(!/is not recognized|CommandNotFoundException/i.test(await text()), 'NO ENTER was sent: the sentence was not run')
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
    await settingsPage(win, 'dictation')
    await win.waitForSelector('[data-dictation-item="gpu-pack"][data-state="installed"]', { timeout: 8000 })
    const src = readFileSync(join(ROOT, 'node_modules/prism-term-core/renderer/settings/dictationOptions.ts'), 'utf8')
    const wanted = [...src.matchAll(/\{\s*id: '([a-z-]+)'/g)].map((m) => m[1]).sort()
    const shown = (await win.evaluate(() => [...document.querySelectorAll('[data-dictation-settings] [data-pref], [data-dictation-settings][data-pref]')].map((e) => e.getAttribute('data-pref')))).sort()
    ok(wanted.length >= 9 && JSON.stringify(shown) === JSON.stringify(wanted), `the Dictation page shows exactly the core's option list (${JSON.stringify(shown)})`)
    const names = await win.evaluate(() => [...document.querySelectorAll('[data-dictation-item] [data-item-name]')].map((e) => e.textContent.trim()))
    // The core may list models of more than one family (PrismTerminal #121 adds Parakeet v3
    // between them), so the four Whisper models are counted wherever they sit.
    ok(names.filter((n) => n.startsWith('Whisper ')).length === 4 && names.every((n) => /^\S+ \S/.test(n)), `models carry their full names (${JSON.stringify(names)})`)
    const marks = await win.evaluate(() => [...document.querySelectorAll('[data-dictation-item] [data-vendor]')].map((e) => e.getAttribute('data-vendor')))
    ok(marks.filter((m) => m === 'openai').length === 4 && marks.filter((m) => m === 'nvidia').length >= 1, 'every row leads with its vendor\'s mark')
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
    await row.waitFor({ timeout: 45000 })
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
 * THE ZIP is a flat coloured page. It fell back to monochrome on a selected
 * row while a selection was an accent SLAB, an indigo page on an indigo fill
 * being the collision that fallback existed for. A marked row is a light tint
 * now (owner, 2026-10-03), so it keeps its colour there too. THE COMIC is
 * artwork - a keylined sunburst under a halftone under a splat - and never
 * fell back at all.
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
      // An archive is a folder node now (#300): its chevron comes first, so
      // the icon is the LAST such svg in the row.
      const svg = [...(row?.querySelectorAll('svg[viewBox="0 0 24 24"]') ?? [])].pop()
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
    await win.waitForSelector('[role="treeitem"]', { timeout: 45000 })
    await sleep(700)

    // THE ZIP KEEPS ITS COLOUR with no scheme switched on at all, and since
    // 2026-09-20 that colour is the STYLE'S: --p-tree-zip, which IS the folder
    // token (owner: "just like folders, they should follow the same setting").
    // Read as the token rather than a hex, because the point is that it moves
    // with the style; the unit tests measure what the token resolves to.
    // bundle.zip is
    // the open row, so it is selected; on the tint it keeps its colour like
    // the rest (a marked row is no longer an accent slab, 2026-10-03).
    const open = await icon('bundle.zip')
    ok(open !== null, 'the tree draws an icon for bundle.zip')
    ok(open.selected, 'and it is the selected row')
    ok(open.masked, 'a SELECTED zip keeps its colour on the tint')

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
      const d = [...(row?.querySelectorAll('svg[viewBox="0 0 24 24"]') ?? [])].pop()?.querySelector('path')?.getAttribute('d') ?? ''
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
      const svg = [...(row?.querySelectorAll('svg[viewBox="0 0 24 24"]') ?? [])].pop()
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
    await settingsPage(win, 'appearance')
    await sleep(400)
    ok(
      (await win.locator('label:text-is("File icons")').count()) === 0,
      'the File icons switch is hidden'
    )
    ok(
      (await win.locator('label:text-is("Folder icon colour")').count()) === 1,
      'while the Folder icon colour picker is untouched beside it'
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
    await win.waitForSelector('[role="treeitem"]', { timeout: 45000 })
    await sleep(700)
    const art = await win.evaluate(() => {
      const row = [...document.querySelectorAll('[role="treeitem"]')].find((e) =>
        (e.getAttribute('data-row') ?? '').toLowerCase().endsWith('sequel.cbz')
      )
      const svg = [...(row?.querySelectorAll('svg[viewBox="0 0 24 24"]') ?? [])].pop()
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
    await win.waitForSelector('[role="treeitem"]', { timeout: 45000 })
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
    await win.waitForSelector('[role="treeitem"]', { timeout: 45000 })
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
    await win.waitForSelector('[role="treeitem"]', { timeout: 45000 })
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

    // WAITED FOR, NOT SLEPT FOR (2026-09-21). The paste is a PowerShell read
    // of the clipboard, a copy and a tree refresh: this used to sleep a flat
    // 2.5s and then count, and it lost twice in one day under load (another
    // build running beside the suite). A flaky check is a bug in the gate, so
    // each step waits for its own condition, bounded, and says what it saw.
    const before = await win.locator('[role="treeitem"]').count()
    await win.locator('[role="menu"] >> text="Paste"').click()
    await until(async () => (await win.locator('[role="treeitem"]').count()) > before, 20000, 100)
    const after = await win.locator('[role="treeitem"]').count()
    ok(after > before, `pasting on a file row lands in ITS folder (${before} -> ${after} rows)`)
    // THE PASTED FILE IS THE MARKED ROW (2026-09-03, owner - Explorer's way).
    const markedText = () =>
      win.evaluate(() => [...document.querySelectorAll('aside [data-selected]')].map((r) => r.textContent).join('|'))
    await until(async () => /movable \(2\)/.test(await markedText()), 10000, 100)
    const markedAfterPaste = await markedText()
    ok(/movable \(2\)/.test(markedAfterPaste), `and the pasted copy is what is marked (${markedAfterPaste})`)
    // ...and it is the OPEN file too (owner, 2026-09-03): aria-selected is
    // the tree's word for what the viewer is showing.
    const openText = () =>
      win.evaluate(() => document.querySelector('aside [role="treeitem"][aria-selected="true"]')?.textContent ?? '')
    await until(async () => /movable \(2\)/.test(await openText()), 10000, 100)
    const openAfterPaste = await openText()
    ok(/movable \(2\)/.test(openAfterPaste), `and the pasted copy is what is OPEN (${openAfterPaste})`)

    // CUT AND PASTE FROM THE KEYBOARD (2026-09-03, owner): Ctrl+X dims the
    // row, Ctrl+V on a folder MOVES it there, and the mark clears.
    await rowFor('anchor.txt').click()
    await sleep(400)
    await win.keyboard.press('Control+x')
    const cutOpacity = () =>
      win.evaluate(
        () =>
          [...document.querySelectorAll('aside [role="treeitem"]')].find((r) =>
            (r.getAttribute('data-row') ?? '').toLowerCase().endsWith('anchor.txt')
          )?.style.opacity
      )
    await until(async () => (await cutOpacity()) === '0.45', 8000, 50)
    const dimmed = await cutOpacity()
    ok(dimmed === '0.45', `Ctrl+X dims the cut row (opacity ${dimmed})`)
    // EXPLORER'S RULE for Ctrl+V (owner, 2026-09-03): the target is the
    // folder CONTAINING the highlighted row. First a file INSIDE `into`, so
    // the cursor can stand there: the row menu's Paste on the folder row
    // (explicit, so it means "into this folder") puts movable.txt in.
    await rowFor('into').click({ button: 'right' })
    await win.waitForSelector('[role="menu"] >> text="Paste"', { timeout: 6000 })
    // the clipboard holds anchor.txt (cut) now; that is what lands in `into`
    await win.locator('[role="menu"] >> text="Paste"').click()
    for (let i = 0; i < 100 && !existsSync(join(dir, 'into', 'anchor.txt')); i++) await sleep(200)
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
    for (let i = 0; i < 100 && !existsSync(join(dir, 'anchor.txt')); i++) await sleep(200)
    ok(existsSync(join(dir, 'anchor.txt')), 'Ctrl+V with a folder highlighted pastes into its PARENT')
    ok(existsSync(join(dir, 'into', 'anchor.txt')), 'and a copy leaves the original where it was')
  } finally {
    await app.close()
  }
}

/**
 * THE WINDOW APPEARS FAST (#189). Every launch used to spend about 900 ms with
 * the main process's UI thread blocked, before the first frame: the window
 * border helper was a PowerShell started with a held-open stdin pipe, and the
 * first such start in Electron's main process stalls that long. Measured on
 * this machine: 1,188 ms from process start to a visible window before, 369 ms
 * after. The bound below sits between the two with room either side, so it
 * does not flake on a slower day and still fails the moment anything puts a
 * stall like that back on the startup path. What is measured is the app's own
 * clocks: process creation (main) to first contentful paint (the page).
 */
async function startupScenario(fixtures) {
  console.log('startup time')
  const times = []
  for (let i = 0; i < 3; i++) {
    const { app, win } = await launch(join(fixtures, 'README.md'))
    try {
      const t0 = await app.evaluate(() => process.getCreationTime())
      await win.waitForFunction(() => !!document.querySelector('[role="treeitem"]'), null, { timeout: 45000 })
      const p = await win.evaluate(() => ({
        origin: performance.timeOrigin,
        fcp: performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1
      }))
      if (p.fcp >= 0) times.push(Math.round(p.origin - t0 + p.fcp))
    } finally {
      await app.close()
    }
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  ok(times.length === 3, `three launches measured (${times.join(', ')} ms)`)
  ok(median < 800, `the window shows its first frame within 800 ms of the process starting (median ${median} ms; it was about 1,190 before #189)`)
}

/** Deleting the last file leaves the tab open and empty, not closed. */
async function deleteLastScenario(fixtures) {
  console.log('delete the last file')
  const dir = join(fixtures, 'lastfile')
  const { app, win } = await launch(join(dir, 'only.txt'))
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 45000 })
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

/**
 * INTO AN ARCHIVE THE WAY A PERSON GOES NOW (#300): the pinned Explorer,
 * the address, and the strip naming it once its listing is in. The old
 * panel (ArchiveView) is the phone's alone.
 */
async function inZip(win, zipPath) {
  await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
  await win.waitForSelector('[data-testid="browse-list"]', { timeout: 10000 })
  await win.locator('[data-testid="browse-edit-path"]').click()
  await win.locator('.browse-path-form input').fill(zipPath)
  await win.keyboard.press('Enter')
  const name = zipPath.split(/[\\/]/).pop()
  await until(
    async () => ((await win.locator('[data-archive-strip]').textContent().catch(() => '')) ?? '').includes(name),
    15000
  )
  await sleep(200)
}

/** The row menu of one archive member, opened. */
async function openMemberMenu(win, name) {
  await win.locator('[data-testid="browse-list"] .browse-row', { hasText: name }).first().click({ button: 'right' })
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
      await inZip(win, join(zips, 'wrapped.zip'))
      await answerFolderDialog(app, picked)

      await throughTheWindow(win, 'zip, Extract to… on the verb row', 'wrapped.zip', () =>
        win.click('[data-archive-strip] [data-archive-verb="extract-to"]')
      )
      ok(
        existsSync(join(picked, 'Collection', 'sub', 'two.txt')),
        'and the archive landed in the folder that was picked'
      )

      // The panel's own menu, on its dead space.
      const list = await win.locator('[data-testid="browse-list"]').boundingBox()
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
        await win.locator('[role="menu"] >> text="Extract this folder"').click()
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
        await win.locator('[role="menu"] >> text="Extract this folder to..."').click()
      })
      ok(
        existsSync(join(picked, 'Collection', 'sub', 'two.txt')),
        'and the folder landed in the picked one, shape intact'
      )

      // A FILE row, both verbs. Walk into the folder first.
      await win.locator('[data-testid="browse-list"] .browse-row', { hasText: 'Collection' }).first().dblclick()
      await win.waitForSelector('[data-testid="browse-list"] .browse-row:has-text("one.txt")', { timeout: 5000 })
      await throughTheWindow(win, 'zip, Extract here on a member', 'wrapped.zip', async () => {
        await openMemberMenu(win, 'one.txt')
        await win.locator('[role="menu"] >> text="Extract this file"').click()
      })
      ok(
        readFileSync(join(zips, 'one.txt'), 'utf8') === 'first',
        'the member landed beside the archive, byte for byte'
      )
      await throughTheWindow(win, 'zip, Extract to… on a member', 'wrapped.zip', async () => {
        await openMemberMenu(win, 'one.txt')
        await win.locator('[role="menu"] >> text="Extract this file to..."').click()
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
      await inZip(win, join(zips, 'read-only.7z'))
      await answerFolderDialog(app, picked)

      await throughTheWindow(win, '7z, Extract here on the verb row', 'read-only.7z', () =>
        win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
      )
      ok(
        existsSync(join(zips, 'read-only', 'note.txt')) &&
          existsSync(join(zips, 'read-only', 'sub', 'deep.txt')),
        'the whole 7z landed in a folder named after it'
      )

      await throughTheWindow(win, '7z, Extract to… on the verb row', 'read-only.7z', () =>
        win.click('[data-archive-strip] [data-archive-verb="extract-to"]')
      )
      ok(existsSync(join(picked, 'read-only', 'sub', 'deep.txt')), 'and in the picked folder')

      await throughTheWindow(win, '7z, Extract folder here', 'read-only.7z', async () => {
        await openMemberMenu(win, 'sub')
        await win.locator('[role="menu"] >> text="Extract this folder"').click()
      })
      ok(existsSync(join(zips, 'sub', 'deep.txt')), 'the folder landed beside the archive')

      // The members' route on 7-Zip stages INSIDE the destination and lands by
      // rename, so what is checked is the file AND that the staging has gone.
      await throughTheWindow(win, '7z, Extract here on a member', 'read-only.7z', async () => {
        await openMemberMenu(win, 'note.txt')
        await win.locator('[role="menu"] >> text="Extract this file"').click()
      })
      ok(
        /hello from inside a 7z/.test(readFileSync(join(zips, 'note.txt'), 'utf8')),
        'the member landed beside the archive'
      )
      await throughTheWindow(win, '7z, Extract folder to…', 'read-only.7z', async () => {
        await openMemberMenu(win, 'sub')
        await win.locator('[role="menu"] >> text="Extract this folder to..."').click()
      })
      ok(existsSync(join(picked, 'sub', 'deep.txt')), 'and a folder in the picked one')
      ok(leftovers().length === 0, `no staging folder is left behind (${leftovers().join(', ')})`)
      ok(
        readdirSync(picked).filter((n) => n.startsWith('.prism-extract-')).length === 0,
        'in the picked folder either'
      )

      // The temp extraction that VIEWS a member stays silent: no window.
      await armExtractProbe(win)
      await win.locator('[data-testid="browse-list"] .browse-row', { hasText: 'note.txt' }).first().dblclick()
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
    await inZip(win, join(box, 'big.7z'))
    await answerFolderDialog(app, join(box, 'picked'))
    const tabs = () => win.locator('[role="tablist"] [role="tab"]').count()
    const tabsBefore = await tabs()
    // The Explorer's places panel, which Ctrl+B toggles there (#300: the archive is
    // walked in the Explorer now, where the project's aside is not drawn).
    const panelsBefore = await win.locator('aside, .browse-places').count()

    // ---- it cannot be dismissed: real keys, a real mouse ------------------
    await win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
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
    ok((await win.locator('aside, .browse-places').count()) === panelsBefore, 'and Ctrl+B did not hide the sidebar')
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
    await win.locator('[role="menu"] >> text="Extract this folder"').click()
    await win.waitForSelector(`${XWIN}[data-phase="running"]`, { timeout: 20000 })
    ok(
      (await until(() => readdirSync(box).some((n) => n.startsWith('.prism-extract-')), 8000)) === true,
      'Extract folder here: it stages beside the archive while it works'
    )
    await cancelMidFlight(win, 'Extract folder here', { seven: true })

    // ---- Cancel: staging inside the picked folder (Extract folder to…) ----
    await openMemberMenu(win, 'Big')
    await win.locator('[role="menu"] >> text="Extract this folder to..."').click()
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
    await inZip(win, join(box, 'many.zip'))
    await win.waitForSelector('[data-testid="browse-list"] .browse-row:has-text("Many")', { timeout: 15000 })
    await win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
    await cancelMidFlight(win, 'a zip, Extract here', { seven: false })

    // ---- a FAILURE turns the same window into the error -------------------
    await inZip(win, join(box, 'corrupt.7z'))
    await win.waitForSelector('[data-testid="browse-list"] .browse-row:has-text("b-bad.txt")', { timeout: 15000 })
    await win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
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
    await win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
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
      await inZip(win, join(box, name))
      await win.waitForSelector('[data-testid="browse-list"] .browse-row:has-text("vault")', { timeout: 15000 })

      await win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
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

      await win.locator('[data-testid="browse-list"] .browse-row', { hasText: 'vault' }).first().dblclick()
      await win.waitForSelector('[data-testid="browse-list"] .browse-row:has-text("secret.txt")', { timeout: 5000 })
      await armExtractProbe(win)
      await openMemberMenu(win, 'secret.txt')
      await win.locator('[role="menu"] >> text="Extract this file"').click()
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
    await inZip(win, zip)
    ok(
      (await win.locator('[data-archive-strip] [data-archive-verb="extract-here"]').count()) === 1,
      'the verb row offers a one-click Extract here'
    )
    ok(
      (await win.locator('[data-archive-strip] [data-archive-verb="extract-to"]').count()) === 1,
      'and Extract to... beside it'
    )
    // The inline track is GONE (2026-09-03, owner), and since 2026-09-19
    // (#166) extraction progress is ONE window over the app, whichever verb
    // started it, so the layout has nothing to move. Still measured, because
    // "it looks fine" is exactly how the jump got shipped the first time.
    const listTop = async () =>
      win.evaluate(() => document.querySelector('[data-testid="browse-list"] .browse-row').getBoundingClientRect().top)
    const beforeTop = await listTop()
    ok(
      (await win.locator('[role="progressbar"]').count()) === 0,
      'no inline progress track: the extraction window is the one look'
    )
    await throughTheWindow(win, 'zip, Extract here on the verb row', 'wrapped.zip', () =>
      win.click('[data-archive-strip] [data-archive-verb="extract-here"]')
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
    await inZip(win, join(fixtures, 'zips', 'nodirs.zip'))
    const names = async () =>
      (await win.locator('[data-testid="browse-list"] .browse-row').allTextContents()).join(' | ')
    ok((await win.locator('[data-testid="browse-list"] .browse-row').count()) > 0, 'the archive does not read as empty')
    ok((await names()).includes('Deep'), 'the folder its member names imply is listed')
    await win.locator('[data-testid="browse-list"] .browse-row:has-text("Deep")').first().dblclick()
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
    // A 7z is a read-only FOLDER in the Explorer now (#300).
    await inZip(win, join(fixtures, 'zips', 'read-only.7z'))
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
    ok(/Open/.test(items) && /Copy file/.test(items), 'open and copy are offered')
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
 * A WINDOWLESS PRISM IS NOT A STATE PRISM CAN STAY IN (#265; owner,
 * 2026-10-03: "prism suddenly stopped opening, not sure why, but that should
 * never happen"). Found: a Prism alive 45 minutes after launch with no
 * renderer and no window, holding the single-instance lock, so every later
 * double-click handed over to it and vanished. Each net is driven on its own:
 * a page that dies is reloaded, one that keeps dying gets a new window and
 * then a quit (the lock freed), a page that dies BEFORE the window was shown
 * comes back, the watchdog shows and reloads a page left dead, and a second
 * launch into a dead page brings back a working window with the file in it.
 *
 * The page is read from MAIN (`executeJavaScript`), never through
 * Playwright's page object, which is the thing a crash takes away.
 */
async function neverWindowlessScenario(fixtures) {
  console.log('never windowless')
  const readme = join(fixtures, 'README.md')
  const logFile = join(PROFILE, 'window-crashes.log')
  const readLog = () => {
    try {
      return readFileSync(logFile, 'utf8')
    } catch {
      return ''
    }
  }
  const clearLog = () => rmSync(logFile, { force: true })
  /** The one window, its page, and whether `sel` is in it. */
  const state = (app, sel) =>
    app
      .evaluate(async ({ BrowserWindow }, sel) => {
        const all = BrowserWindow.getAllWindows()
        if (all.length !== 1) return { n: all.length }
        const w = all[0]
        const wc = w.webContents
        const base = { n: 1, id: w.id, visible: w.isVisible(), crashed: wc.isCrashed() }
        if (base.crashed || wc.isLoading()) return base
        const found = await Promise.race([
          wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => null),
          new Promise((r) => setTimeout(() => r(null), 1500))
        ])
        return { ...base, found }
      }, sel)
      .catch(() => ({ n: -1 }))
  const live = async (app, sel = '.p-md h1', ms = 20000) =>
    until(async () => {
      const s = await state(app, sel)
      return s.n === 1 && s.visible && !s.crashed && s.found === true ? s : null
    }, ms, 200)
  const deaths = () => (readLog().match(/ gone /g) ?? []).length
  /** Kill the page, and wait until main has HEARD it died (its log line), so
   *  the next look cannot be at the page from before. */
  const crash = async (app) => {
    const before = deaths()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer())
    return until(() => deaths() > before, 8000, 50)
  }
  // A page killed WHILE Playwright is still attaching to it makes Playwright
  // throw "Target crashed" from inside its own session handler, out of reach
  // of any await (MEASURED: it took the whole suite down). Only that, and only
  // while a scenario here kills pages at launch, is swallowed; the checks
  // below read the page from main, which needs no Playwright page at all.
  const swallowAttachCrash = (e) => {
    if (!/Target crashed/.test(String(e?.message ?? e))) throw e
  }
  const start = async (env = {}) => {
    seedExplorerTab(readme)
    const app = await launchTestApp({
      args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e'],
      env: { ...process.env, ...env }
    })
    return app
  }

  // 1-3: a page that dies is reloaded; the third death in two minutes gets a
  // new window; the same run on the new window ends the process.
  clearLog()
  let app = await start()
  try {
    const first = await live(app)
    ok(!!first, 'the window comes up with its page')
    await offscreen(app)
    await crash(app)
    const back = await live(app)
    ok(!!back, 'a page that dies is reloaded, and its tab is back')
    ok(back?.id === first?.id, 'in the same window')
    ok(/ gone reason=\S+ .*action=reload/.test(readLog()), 'the death is logged with its reason and the reload')
    ok(!/ restore tabs=skipped/.test(readLog()), 'one death keeps the saved tabs')

    // From the second death in a run the page comes back WITHOUT its saved
    // tabs (one of them may be what kills it): the Explorer, not the README.
    const EXPLORER = '[data-testid="browse-list"]'
    await crash(app)
    const strained = await live(app, EXPLORER)
    ok(!!strained, 'a second death brings the page back too')
    ok(/ restore tabs=skipped reason=repeated-deaths/.test(readLog()), 'without its saved tabs, and the log says so')
    ok((await state(app, '.p-md h1')).found === false, 'the restored README tab is left out')
    await crash(app)
    const rebuilt = await until(async () => {
      const s = await live(app, EXPLORER, 2000)
      return s && s.id !== first?.id ? s : null
    }, 20000, 200)
    ok(!!rebuilt, 'the third death in two minutes gets a NEW window, working, and only one')
    ok(/action=recreate/.test(readLog()), 'the rebuild is logged')

    const child = app.process()
    const exited = new Promise((done) => child.once('exit', () => done(true)))
    await crash(app)
    await live(app, EXPLORER)
    await crash(app)
    await live(app, EXPLORER)
    await crash(app)
    ok(await Promise.race([exited, sleep(15000).then(() => false)]), 'when the new window dies as fast, Prism quits rather than sit windowless')
    ok(/action=give-up/.test(readLog()), 'the give-up is logged')
  } finally {
    await app.close().catch(() => {})
  }
  reapStrays()
  await sleep(900)

  process.on('uncaughtException', swallowAttachCrash)
  try {
    // 4: the page dies as it commits, before the window was ever shown: the
    // shape of the 2026-10-03 failure. The reload shows it.
    clearLog()
    app = await start({ PRISM_E2E_CRASH_AT_START: '1' })
    try {
      ok(!!(await live(app)), 'a page that dies before the window is shown comes back, and the window shows')
      ok(/ gone .*shown=false .*action=reload/.test(readLog()), 'logged as a death before the window was shown')
    } finally {
      await app.close().catch(() => {})
    }
    reapStrays()
    await sleep(900)

    // 5: the same death with recovery HELD, as the bug left it: the watchdog
    // alone must show the window and reload the page.
    clearLog()
    app = await start({ PRISM_E2E_CRASH_AT_START: '1', PRISM_E2E_HOLD_RECOVERY: '1' })
    try {
      ok(!!(await live(app, '.p-md h1', 25000)), 'with nothing else acting, the watchdog shows the window and brings its page back')
      ok(/ watchdog .*gone=true/.test(readLog()), 'the watchdog logs what it found')
    } finally {
      await app.close().catch(() => {})
    }
    reapStrays()
    await sleep(900)
  } finally {
    process.off('uncaughtException', swallowAttachCrash)
  }

  // 6: a page left dead (recovery held, the watchdog long past), then a
  // second launch with a file: the handoff brings the page back and opens it.
  clearLog()
  app = await start({ PRISM_E2E_HOLD_RECOVERY: '1' })
  const launched = Date.now()
  try {
    ok(!!(await live(app)), 'the window comes up')
    await offscreen(app)
    await sleep(Math.max(0, 9000 - (Date.now() - launched))) // past the watchdog
    ok(await crash(app), 'the page dies')
    await sleep(1000)
    ok((await state(app, 'body')).crashed === true, 'and stays dead, recovery held')
    await handoff(join(OTHER_ROOT, 'bad.json'))
    ok(/ handoff window=dead action=reload/.test(readLog()), 'the second launch found the dead page and reloaded it')
    ok(
      !!(await live(app, '[data-testid="browse-list"] [aria-selected="true"][data-browse-path$="bad.json" i]', 25000)),
      'and the handed file is open, selected in the Explorer'
    )
  } finally {
    await app.close().catch(() => {})
  }
}

/**
 * A FILE FROM OUTSIDE OPENS IN THE EXPLORER TAB (owner, 2026-09-22: "that file
 * opened in prism's explorer rather than as a project ... a setting to choose
 * whether to open files maximized or as previews ... default should be
 * preview"). Driven through the real second-instance handoff, the route a
 * double-click, "Open with" and the Explorer menu's "Open file" all take - they
 * carry the same command line. A folder still makes a project.
 */
async function openInExplorerScenario(fixtures) {
  console.log('files open in the Explorer')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const projects = () => win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()
  const explorerFront = () =>
    win.evaluate(() => document.querySelector('[role="tablist"] [data-pinned] [role="tab"]')?.getAttribute('aria-selected') === 'true')
  const selectedRow = () =>
    win.evaluate(() => document.querySelector('[data-testid="browse-list"] [aria-selected="true"]')?.getAttribute('data-browse-path') ?? '')
  const visible = (sel) => win.evaluate((s) => !!document.querySelector(s)?.getClientRects().length, sel)
  const waitFor = async (fn, ms = 10000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await fn()) return true
    return false
  }
  try {
    ok((await projects()) === 1, 'the launch file is a project, the Explorer behind it')
    const before = await projects()

    // PREVIEW, the default: the list, walked to the file's folder, the file
    // selected and in the preview pane.
    await handoff(join(OTHER_ROOT, 'bad.json'))
    ok(await waitFor(explorerFront), 'a file handed over brings the Explorer tab to the front')
    ok(await waitFor(async () => /other[\\/]bad\.json$/i.test(await selectedRow())), 'walked to its folder with the file selected')
    ok(await waitFor(() => visible('[data-browse-preview]')), 'and shown in the preview pane (the default)')
    ok((await projects()) === before, 'no project tab was made')

    // Back returns to where the Explorer was.
    await win.keyboard.press('Alt+ArrowLeft')
    ok(
      await waitFor(() => win.evaluate(() => !!document.querySelector('[data-testid="browse-list"] [data-browse-path$="README.md" i]'))),
      'Back returns to the folder the Explorer was showing before'
    )

    // FULL VIEW, once chosen: the file fills the Explorer; Backspace returns
    // to its folder with it selected.
    await win.evaluate(() => localStorage.setItem('prism.open.external', 'full'))
    await handoff(join(fixtures, 'notes.txt'))
    ok(
      await waitFor(async () => (await visible('.cm-editor')) && !(await visible('[data-testid="folder-browser"]'))),
      'with Full view chosen, the file fills the Explorer'
    )
    ok(await explorerFront(), 'still in the Explorer tab')
    await win.locator('[data-testid="browse-toolbar"]').first().click({ position: { x: 4, y: 4 } }).catch(() => {})
    await win.keyboard.press('Alt+ArrowLeft')
    ok(
      await waitFor(async () => (await visible('[data-testid="folder-browser"]')) && /notes\.txt$/i.test(await selectedRow())),
      'Back shows its folder with the file selected'
    )

    // A film plays, both ways: it was picked.
    await win.evaluate(() => localStorage.setItem('prism.open.external', 'preview'))
    await handoff(join(fixtures, 'ep1.mp4'))
    ok(
      await waitFor(() => win.evaluate(() => {
        const v = document.querySelector('[data-browse-preview] video')
        return !!v && /ep1/i.test(v.currentSrc || v.src) && !v.paused
      })),
      'a film handed over plays in the preview pane'
    )
    await win.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()))
    ok((await projects()) === before, 'and still no project tab was made')

    // A FOLDER is unchanged: "Open as project".
    await handoff(OTHER_ROOT)
    ok(await waitFor(async () => (await projects()) === before + 1), 'a folder handed over still becomes a project tab')
  } finally {
    await app.close()
  }
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
    // A file from outside goes to the Explorer tab now (2026-09-22), even from
    // the project's own folder: the file is SEEN, and the project and its
    // shell are left exactly as they were.
    await handoff(join(fixtures, 'notes.txt'))
    await win.waitForFunction(
      () => document.querySelector('[role="tablist"] [data-pinned] [role="tab"]')?.getAttribute('aria-selected') === 'true',
      null,
      { timeout: 8000 }
    )
    ok(true, 'a file arriving from Explorer comes up in the Explorer tab, over the terminal')
    await win.waitForFunction(
      () => /notes\.txt$/i.test(document.querySelector('[data-testid="browse-list"] [aria-selected="true"]')?.getAttribute('data-browse-path') ?? ''),
      null,
      { timeout: 8000 }
    )
    ok(true, 'and the file is what it shows, selected')
    ok((await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 1, 'no second project tab is made')
    await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').first().click()
    await win.waitForSelector('.xterm', { timeout: 8000 })
    ok((await win.locator('.xterm').textContent())?.includes('handoff-shell-survives'), 'the project still shows its shell, scrollback and all')
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

    // A SUBFOLDER of an open root, opened as a project, is a tab of its own,
    // rooted there (owner, 2026-09-04, reversing 2026-09-01): separate folders
    // are separate tabs, and only the exact root folds. The tab it did not
    // land in is left exactly as it was. A FOLDER, since 2026-09-22: a file
    // from outside goes to the Explorer tab and makes no project at all.
    await handoff(join(fixtures, 'code'))
    await win.waitForSelector(strip, { timeout: 10000 })
    ok(await until(async () => (await tabRows().count()) === 2), 'a subfolder opened as a project is a tab of its own')
    ok(
      /\\code$/i.test((await tabRows().last().getAttribute('title')) ?? ''),
      'rooted at the subfolder'
    )
    ok(
      /fixtures$/i.test((await tabRows().first().getAttribute('title')) ?? ''),
      'and the tab above it keeps ITS root'
    )
    // TAB WIDTH (#216; owner, 2026-09-23: "fixed size or dynamic ... the user
    // can pick", then "call it dynamic ... have dynamic be the default"). Three
    // tabs are up here - the pinned Explorer, "fixtures" and "code" - with
    // labels of different lengths; what is measured is each tab's box.
    const measureTabs = (attr) =>
      win.evaluate(
        ([s, a]) => [...document.querySelectorAll(`${s} [${a}]`)].map((el) => ({ w: Math.round(el.getBoundingClientRect().width * 10) / 10, label: el.textContent ?? '' })),
        [strip, attr]
      )
    // DYNAMIC, the default: each tab as wide as its label.
    const dyn = await measureTabs('data-tab-dynamic')
    const fixturesTab = dyn.find((b) => /fixtures/i.test(b.label))
    const codeTab = dyn.find((b) => /\bcode\b/i.test(b.label))
    ok(
      !!fixturesTab && !!codeTab && fixturesTab.w > codeTab.w + 10,
      `by default each tab is as wide as its name (${JSON.stringify(dyn)})`
    )
    // Picked at the top of Settings > Style as a user would; Settings is a tab
    // here, so Ctrl+W puts it away again. Prism's rows are marked by their
    // label (`for="tab-width"`), and the two segment names are unique there.
    const pickTabWidth = async (name) => {
      const seg = (await gotoPref(win, 'tab-width')).getByRole('button', { name, exact: true })
      await seg.scrollIntoViewIfNeeded()
      await seg.click()
      await win.keyboard.press('Control+w')
      await sleep(400)
    }
    await pickTabWidth('Fixed')
    const fixed = (await measureTabs('data-tab-fixed')).map((b) => b.w)
    ok(
      fixed.length >= 3 && new Set(fixed).size === 1,
      `with Fixed every tab is the same width, the pinned one included (${fixed.join(' / ')})`
    )
    ok(fixed[0] >= 104 && fixed[0] <= 124, `a fixed width, not a content one (${fixed[0]}px)`)
    await pickTabWidth('Dynamic')
    ok((await measureTabs('data-tab-dynamic')).length >= 3, 'and Dynamic puts the names back in charge')
    await win.locator(`${strip} [aria-label^="Close"]`).last().click()
    await sleep(400)

    // A second root, opened deliberately - a genuine sibling, since a
    // subfolder is no longer a second root at all.
    await handoff(otherRoot)
    ok(await until(async () => (await tabRows().count()) === 2), 'a second root opens a second tab')
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
    // (By its tree row: a file handed over goes to the Explorer tab now.)
    await tabRows().first().click()
    await win.locator('[role="treeitem"][data-row$="README.md" i]').first().click()
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

    // A file from a root already open makes no tab either (2026-09-22): it is
    // the Explorer's, and the project is left as it was.
    await handoff(join(fixtures, 'notes.txt'))
    ok(
      await until(async () => (await win.locator(`${strip} [data-pinned] [role="tab"]`).getAttribute('aria-selected')) === 'true'),
      'a file from an open root comes up in the Explorer tab'
    )
    ok((await tabRows().count()) === 2, 'and no project tab is made for it')
    await tabRows().first().click()
    await sleep(300)

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
    await handoff(otherRoot)
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
    await handoff(otherRoot)
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

  // Explorer-opens-a-file WITH saved tabs to restore: the file's folder must
  // REMEMBER TABS, OFF (owner, 2026-09-22: "Prism should also have the option
  // to not remember tabs"). Written where main reads it at startup, the window
  // preferences store; a cold start then opens the Explorer tab alone, and the
  // saved strip is left as it was, so switching it back on loses nothing.
  const prefDir = join(PROFILE, 'window-preferences')
  const prefFile = join(prefDir, `${createHash('sha256').update('prism.tabs.remember').digest('hex')}.json`)
  mkdirSync(prefDir, { recursive: true })
  writeFileSync(prefFile, JSON.stringify({ key: 'prism.tabs.remember', value: 'off' }))
  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'code'), true))
  try {
    await win.waitForSelector(strip, { timeout: 10000 })
    await sleep(1200)
    const roots = await tabRows().evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''))
    ok(
      roots.length === 1 && /[\\/]code$/i.test(roots[0]),
      `with Remember tabs off, only what Prism was opened with comes back (${JSON.stringify(roots)})`
    )
    ok((await win.locator(`${strip} [data-pinned] [role="tab"]`).count()) === 1, 'beside the Explorer tab')
    const saved = JSON.parse(readFileSync(join(PROFILE, 'tabs.json'), 'utf8'))
    ok(saved.tabs.length >= 2, `and last time's tabs are still saved (${saved.tabs.length})`)
    await settingsPage(win, 'explorer')
    await win.waitForSelector('[role="switch"][aria-label="Reopen tabs at start"]', { timeout: 8000 })
    ok(
      (await win.locator('[role="switch"][aria-label="Reopen tabs at start"]').getAttribute('aria-checked')) === 'false',
      'Settings > Explorer shows Reopen tabs at start switched off'
    )
    // Back on, the way a user would, so the scenarios after this one restore
    // as they always did: the window's own store mirrors every prism.* key back
    // into main's at the next launch, so deleting the file alone undoes nothing.
    await win.locator('[role="switch"][aria-label="Reopen tabs at start"]').click()
    ok(
      await until(async () => {
        try {
          return JSON.parse(readFileSync(prefFile, 'utf8')).value === 'on'
        } catch {
          return false
        }
      }, 5000),
      'and switching it back on is written where main reads it'
    )
  } finally {
    await app.close()
  }

  // Explorer-opens-a-file WITH saved tabs to restore: the new tab's root must
  // survive the restore traffic. This raced once: the first restored tab's
  // report replaced main's root set while the file was still in flight, its
  // listing was refused, and the sidebar cached "can't read". Since
  // 2026-09-22 the file lands in the Explorer tab, which grants its folder per
  // tab as it walks there - the same race, a different grant, so the same
  // question: is the folder listed and the file selected in it.
  await sleep(900)
  ;({ app, win } = await launch(join(fixtures, 'code', 'nested', 'level-two', 'buried.py'), true))
  try {
    await win.waitForSelector(strip, { timeout: 10000 })
    ok(
      await until(async () =>
        /buried\.py$/i.test(
          (await win.evaluate(() => document.querySelector('[data-testid="browse-list"] [aria-selected="true"]')?.getAttribute('data-browse-path') ?? '')) ?? ''
        )
      ),
      'a file opened alongside restored tabs is listed in its folder, and selected'
    )
    ok(
      !((await win.locator('[data-testid="folder-browser"]').first().textContent()) ?? '').includes("can't read"),
      'and the Explorer does not claim the folder is unreadable'
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

  // The FOLDER comes back through the door, not a file: a file goes to the
  // Explorer tab now (2026-09-22), and a folder whose tab is open brings that
  // tab forward as it was left.
  await sleep(900)
  ;({ app, win } = await launch(fixtures, true))
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
    const stuck = (await win.locator('aside').allTextContents()).some((t) => t.includes('loading'))
    ok(!stuck, 'and none of them is still saying "loading"')
  } finally {
    await app.close()
  }
}

/**
 * The pin on the + menu (#99): a pinned folder climbs above the recents, the
 * pin fills, the menu stays up while you do it, and the pin outlives history.
 */
/**
 * SETTINGS SINCE THE GROUPED CARDS (#292): pages by `data-settings-tab`, rows by
 * `data-pref`. Which page holds a row is Prism's (`settings/appOptions.ts` and
 * the core's lists); these are the rows the scenarios reach.
 */
const SETTINGS_PAGE_OF = {
  'style-theme': 'appearance', 'see-through': 'appearance', 'theme-edits': 'appearance', 'c-bg': 'appearance', 'c-accent': 'appearance', 'c-font': 'appearance',
  'tree-size': 'appearance', 'title-bar': 'appearance', 'tab-width': 'appearance', 'c-edges': 'appearance', 'c-corners': 'appearance',
  'explorer-side': 'explorer', 'tree-side': 'project', 'explorer-size': 'explorer', 'drive-style': 'explorer', 'newtab-mode': 'explorer', 'newtab-show': 'project',
  'open-external': 'explorer', 'remember-tabs': 'explorer', 'remember-folders': 'explorer', 'explorer-verb': 'explorer', 'default-apps': 'explorer',
  'term-shell': 'terminal', 'term-theme': 'terminal', 'agent-indicator': 'agents', 'agent-color': 'agents',
  'dictation-enabled': 'dictation', 'transport-bg': 'media', 'app-version': 'about'
}

/** Open Settings if it is not up, and go to one of its pages. */
async function settingsPage(win, page) {
  if ((await win.locator('[data-settings-page]').count()) === 0) await win.click('[aria-label="Settings"]')
  const tab = win.locator(`[data-settings-tab="${page}"]`)
  await tab.waitFor({ timeout: 10000 })
  await tab.click()
}

/** Open Settings at the page that holds a row, and wait for the row (Media's
 *  rows on its Progress bar half are switched to). Returns its locator. */
async function gotoPref(win, id) {
  const page = SETTINGS_PAGE_OF[id]
  if (!page) throw new Error(`gotoPref: no page known for ${id}`)
  await settingsPage(win, page)
  if (id === 'transport-bg') await win.locator('[data-seg="progress"]').click()
  const row = win.locator(`[data-pref="${id}"]`).first()
  await row.waitFor({ timeout: 10000 })
  return row
}

/** Pick a segment of a settings row the way a user would: the cog, the row's
 *  page, the segment by name; then the cog again puts Settings away (clicking
 *  it while Settings is in front closes the tab). */
async function pickStyleSegment(win, rowId, name) {
  const row = await gotoPref(win, rowId)
  const seg = row.getByRole('button', { name, exact: true })
  await seg.scrollIntoViewIfNeeded()
  await seg.click()
  await win.click('[aria-label="Settings"]')
  await sleep(400)
}

/** Show title bar, a switch since #292 over the same store (`shown` / `hidden`). */
async function setTitleBar(win, mode) {
  const row = await gotoPref(win, 'title-bar')
  const sw = row.locator('[role="switch"]')
  await sw.scrollIntoViewIfNeeded()
  if ((await sw.getAttribute('aria-checked')) !== String(mode === 'shown')) await sw.click()
  await win.click('[aria-label="Settings"]')
  await sleep(400)
}

/** Which app region a point of the window is: the nearest element at or above
 *  it that says, as Chromium resolves drag over no-drag. */
const regionAt = (win, x, y) =>
  win.evaluate(
    ([px, py]) => {
      for (let el = document.elementFromPoint(px, py); el; el = el.parentElement) {
        const r = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim()
        if (r === 'drag' || r === 'no-drag') return r
      }
      return 'none'
    },
    [x, y]
  )

async function titleBarScenario(fixtures) {
  // NO TITLE BAR (#250; owner, 2026-10-02: "normal prism should also have no
  // titlebar option", Prism Terminal's #91): Hidden puts the panel toggle, the
  // tabs and the bar's buttons in ONE row, and Shown is the window as it was.
  console.log('the title bar setting')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const box = (sel) =>
    win.evaluate((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null
    }, sel)
  try {
    await win.waitForSelector('[role="tablist"]', { timeout: 10000 })
    // SHOWN, the default: the bar, its wordmark, and the strip under it.
    const shownBar = await box('[data-title-bar]')
    const shownStrip = await box('[role="tablist"]')
    const shownWork = await box('.browse-workspace')
    ok(
      (await win.locator('[data-title-bar]:not([data-title-bar="tabs"])').count()) === 1 &&
        (await win.locator('[data-title-bar] [data-wordmark]').count()) === 1,
      'by default the title bar is shown, wordmark and all'
    )
    ok(!!shownBar && !!shownStrip && shownStrip.y >= shownBar.b - 1, `and the tabs sit under it (bar ${JSON.stringify(shownBar)}, strip ${JSON.stringify(shownStrip)})`)
    ok(
      (await win.locator('[data-title-bar] [data-panel-toggle]').count()) === 1,
      'the panel toggle is in the bar'
    )

    await setTitleBar(win, 'hidden')
    ok(
      (await win.evaluate(() => localStorage.getItem('prism.window.titleBar'))) === 'hidden',
      'Hidden is remembered under prism.window.titleBar'
    )
    // HIDDEN: one row, toggle first, the strip, the buttons last.
    const row = '[data-title-bar="tabs"]'
    ok(await until(async () => (await win.locator(row).count()) === 1, 5000), 'Hidden draws one row')
    ok((await win.locator('[data-title-bar]').count()) === 1, 'and no title bar beside it')
    ok((await win.locator('[data-wordmark]').count()) === 0, 'with no wordmark')
    const rowBox = await box(row)
    const toggle = await box(`${row} [data-panel-toggle]`)
    const strip = await box(`${row} [role="tablist"]`)
    const winButtons = await win.evaluate((s) =>
      [...document.querySelectorAll(`${s} [data-window-button]`)].map((b) => b.getBoundingClientRect().right), row)
    const cog = await box(`${row} [aria-label="Settings"]`)
    const width = await win.evaluate(() => window.innerWidth)
    ok(!!toggle && !!strip && toggle.r <= strip.x + 1 && toggle.x < 16, `the toggle comes first (${JSON.stringify(toggle)})`)
    ok(!!strip && strip.y <= 1 && strip.b <= rowBox.b + 1, `the tabs are in the top row (${JSON.stringify(strip)})`)
    ok(
      winButtons.length === 3 && Math.max(...winButtons) > width - 20 && !!cog && cog.r <= Math.min(...winButtons),
      `the cog and then the window buttons end the row (${winButtons.join(', ')} of ${width})`
    )
    // The settings page starts right under the row: it kept the 68px of title
    // bar plus tabs and left a band (owner, 2026-10-03).
    await win.click(`${row} [aria-label="Settings"]`)
    const page = await until(async () => {
      const p = await box('[data-settings-page]')
      return p && Math.abs(p.y - rowBox.b) <= 1 ? p : null
    }, 3000, 50)
    ok(!!page, `the settings page starts under the one row (${JSON.stringify(await box('[data-settings-page]'))} vs row bottom ${rowBox.b})`)
    await win.click(`${row} [aria-label="Settings"]`)
    await until(async () => !(await box('[data-settings-page]')), 3000, 50)
    const hiddenWork = await box('.browse-workspace')
    ok(
      !!hiddenWork && !!shownWork && hiddenWork.y < shownWork.y - 20,
      `the workspace gains the bar's height (${shownWork?.y} -> ${hiddenWork?.y})`
    )
    // The handle: the strip's empty space drags the window; a tab, the + and
    // every button do not.
    const plus = await box(`${row} [aria-label="New tab"]`)
    const emptyX = Math.round((plus.r + (cog?.x ?? width)) / 2)
    const emptyY = Math.round(rowBox.y + rowBox.h / 2)
    ok(
      (await win.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="tablist"]'), [emptyX, emptyY])) &&
        (await regionAt(win, emptyX, emptyY)) === 'drag',
      'the row\'s empty space is the window\'s drag handle'
    )
    const firstTab = await box(`${row} [data-tab-role] [role="tab"]`)
    const regions = {
      tab: await regionAt(win, firstTab.x + firstTab.w / 2, firstTab.y + firstTab.h / 2),
      plus: await regionAt(win, plus.x + plus.w / 2, plus.y + plus.h / 2),
      toggle: await regionAt(win, toggle.x + toggle.w / 2, toggle.y + toggle.h / 2),
      cog: await regionAt(win, cog.x + cog.w / 2, cog.y + cog.h / 2),
      close: await regionAt(win, Math.max(...winButtons) - 10, emptyY)
    }
    ok(Object.values(regions).every((r) => r === 'no-drag'), `tabs and buttons are not handles (${JSON.stringify(regions)})`)
    // However many tabs fill the strip, a handle is left before the buttons.
    const spacer = await box(`${row} [data-drag-spacer]`)
    ok(
      !!spacer && spacer.w >= 40 && (await regionAt(win, spacer.x + spacer.w / 2, emptyY)) === 'drag',
      `a handle that tabs never fill sits before the buttons (${JSON.stringify(spacer)})`
    )
    await win.screenshot({ path: join(SHOTS, 'titlebar-hidden.png') })

    // The toggle and Ctrl+B still pin the tree, from the row.
    const sidebarHidden = () => win.locator('[data-project-sidebar]').getAttribute('aria-hidden')
    const pressed = () => win.locator(`${row} [data-panel-toggle]`).getAttribute('aria-pressed')
    ok((await sidebarHidden()) === 'false' && (await pressed()) === 'true', 'the tree starts pinned open')
    await win.click(`${row} [data-panel-toggle]`)
    ok(await until(async () => (await sidebarHidden()) === 'true'), 'the row\'s toggle collapses it')
    ok((await pressed()) === 'false', 'and says so (aria-pressed)')
    await win.keyboard.press('Control+b')
    ok(await until(async () => (await sidebarHidden()) === 'false'), 'Ctrl+B pins it open again')
    ok((await pressed()) === 'true', 'and the toggle follows')

    // Reordering still works with the strip in the title row.
    await handoff(OTHER_ROOT)
    const tabRows = () => win.locator(`${row} [data-tab-role]:not([data-pinned]) [role="tab"]`)
    ok(await until(async () => (await tabRows().count()) === 2), 'a second project tab arrives in the row')
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
      ok(after[0] === before[1] && after[1] === before[0], `dragging a tab in the title row reorders it (${before.join('|')} -> ${after.join('|')})`)
    }

    // SHOWN again is the window exactly as before.
    await setTitleBar(win, 'shown')
    ok(await until(async () => (await win.locator(row).count()) === 0, 5000), 'Shown takes the one row away')
    ok((await win.locator('[data-title-bar] [data-wordmark]').count()) === 1, 'and the bar and its wordmark come back')
    const backWork = await box('.browse-workspace')
    ok(!!backWork && Math.abs(backWork.y - shownWork.y) < 1, `with the workspace where it was (${backWork?.y} vs ${shownWork.y})`)
  } finally {
    // The profile is shared: never leave a later scenario a hidden bar.
    await win.evaluate(() => localStorage.removeItem('prism.window.titleBar')).catch(() => {})
    await app.close()
  }
}

async function moreMenuScenario(fixtures) {
  // THE TITLE BAR'S MENU TOGGLES, WEARS THREE DOTS, AND NOTHING HAS A FOCUS BOX
  // (#272; owner, 2026-10-04, of the old Tools button: "clicking this button
  // opens the menu each time, it should open then close open close. also
  // remove the focus effect. go through the ui and remove focus effects like
  // this. also remote should be where it is but the icon should be a 3
  // vertical dot menu").
  console.log('the More menu and focus without a box')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const button = '[data-title-bar] [data-more-button]'
  const menus = () => win.locator('[role="menu"]').count()
  const expanded = () => win.locator(button).getAttribute('aria-expanded')
  /** Keyboard focus on an element, as Chromium decides it: a key first, so
   *  the focus that follows is :focus-visible, which is where a ring was.
   *  Measured AGAINST the same element unfocused: "it has a fill" proved
   *  nothing on a control that is always filled (#272 review), so what is
   *  reported is which of its paints CHANGED with the focus. */
  const look = (s) =>
    win.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        focused: document.activeElement === el,
        visible: el.matches(':focus-visible'),
        outline: cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 ? 'none' : `${cs.outlineStyle} ${cs.outlineWidth}`,
        paint: {
          backgroundImage: cs.backgroundImage,
          backgroundColor: cs.backgroundColor,
          borderColor: cs.borderTopColor,
          boxShadow: cs.boxShadow
        }
      }
    }, s)
  const keyFocus = async (sel) => {
    await win.mouse.move(2, 400)
    await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await sleep(300)
    const before = await look(sel)
    await win.keyboard.press('Shift')
    await win.evaluate((s) => document.querySelector(s)?.focus(), sel)
    await sleep(300)
    const after = await look(sel)
    if (!before || !after) return null
    const changed = Object.keys(after.paint).filter((k) => after.paint[k] !== before.paint[k])
    return { focused: after.focused, visible: after.visible, outline: after.outline, changed, before: before.paint, after: after.paint }
  }
  /** No box, and SOMETHING other than a ring shows the focus. `shadowOk` is
   *  for a swatch, whose edge IS a hairline ring that brightens as on hover. */
  const noBoxButShown = (f, shadowOk = false) =>
    !!f &&
    f.focused &&
    f.visible &&
    f.outline === 'none' &&
    f.changed.length > 0 &&
    (shadowOk || !f.changed.includes('boxShadow'))
  try {
    await win.waitForSelector(button, { timeout: 10000 })

    // THREE VERTICAL DOTS, where Tools was and the size it was.
    const glyph = await win.evaluate((s) => {
      const b = document.querySelector(s)
      const dots = [...(b?.querySelectorAll('[data-more-glyph] circle') ?? [])].map((c) => c.getBoundingClientRect())
      const r = b?.getBoundingClientRect()
      const cog = document.querySelector('[data-title-bar] [aria-label="Settings"]')?.getBoundingClientRect()
      const min = document.querySelector('[data-title-bar] [aria-label="Minimize"]')?.getBoundingClientRect()
      return {
        label: b?.getAttribute('aria-label'),
        title: b?.getAttribute('title'),
        dots: dots.map((d) => ({ x: Math.round(d.x + d.width / 2), y: Math.round(d.y + d.height / 2) })),
        size: r ? [Math.round(r.width), Math.round(r.height)] : null,
        cog: cog ? [Math.round(cog.width), Math.round(cog.height)] : null,
        // More sits INSIDE, between the cog and the window buttons (owner,
        // 2026-10-04), close to the cog and a wider step from minimize.
        afterCog: !!r && !!cog && r.left >= cog.right && r.left - cog.right <= 4,
        beforeMin: !!r && !!min && min.left - r.right >= 8
      }
    }, button)
    const d = glyph.dots
    ok(
      d.length === 3 && d.every((p) => Math.abs(p.x - d[0].x) <= 1) && d[0].y < d[1].y && d[1].y < d[2].y,
      `the button is three dots in a column (${JSON.stringify(d)})`
    )
    ok(glyph.label === 'More' && glyph.title === 'More', `and is called More (${glyph.label}, ${glyph.title})`)
    ok(
      JSON.stringify(glyph.size) === JSON.stringify(glyph.cog) && glyph.afterCog && glyph.beforeMin,
      `the size of its neighbours, right beside the cog and apart from the window buttons (${JSON.stringify(glyph)})`
    )
    ok((await win.locator('[aria-label="Tools"]').count()) === 0, 'and there is no Tools button any more')

    // OPEN, CLOSE, OPEN, CLOSE.
    ok((await menus()) === 0 && (await expanded()) === 'false', 'no menu to begin with')
    await win.click(button)
    ok(await until(async () => (await menus()) === 1, 3000, 50), 'a click opens the menu')
    ok((await expanded()) === 'true', 'and the button says so (aria-expanded)')
    const rows = await win.locator('[role="menu"] [role="menuitem"]').allTextContents()
    ok(rows[0]?.trim() === 'Phone', `Phone is the menu's first row (${JSON.stringify(rows)})`)
    await win.screenshot({ path: join(SHOTS, 'more-menu-open.png') })
    await win.click(button)
    await sleep(400)
    ok((await menus()) === 0, 'a second click on the button closes it, and it stays closed')
    ok((await expanded()) === 'false', 'and the button says so')
    await win.click(button)
    ok(await until(async () => (await menus()) === 1, 3000, 50), 'a third click opens it again')
    await win.click(button)
    await sleep(400)
    ok((await menus()) === 0, 'and a fourth closes it')
    // A press elsewhere still dismisses it, and Escape does too.
    await win.click(button)
    await until(async () => (await menus()) === 1, 3000, 50)
    await win.mouse.click(400, 300)
    ok(await until(async () => (await menus()) === 0, 3000, 50), 'a press elsewhere still closes it')
    // The keys: Enter on the focused button opens it, Escape closes it, Enter
    // again opens it.
    await keyFocus(button)
    await win.keyboard.press('Enter')
    ok(await until(async () => (await menus()) === 1, 3000, 50), 'Enter on the focused button opens it')
    // AND THE ROWS ARE REACHABLE (#272 review: the focus stayed on the
    // button, and the menu, drawn at the end of the page, was a window of
    // Tabs away): a keyboard open puts the focus on the first row, Down and
    // Up walk the rows, Escape gives the focus back to the button.
    const active = () =>
      win.evaluate(() => ({
        role: document.activeElement?.getAttribute('role') ?? null,
        text: document.activeElement?.textContent?.trim() ?? '',
        more: document.activeElement?.hasAttribute('data-more-button') ?? false
      }))
    const first = await active()
    ok(first.role === 'menuitem' && first.text === 'Phone', `the focus is on the first row, Phone (${JSON.stringify(first)})`)
    await win.keyboard.press('ArrowDown')
    const walked = await active()
    ok(walked.role === 'menuitem', `Down keeps the focus on a row (${JSON.stringify(walked)})`)
    await win.keyboard.press('Escape')
    ok(await until(async () => (await menus()) === 0, 3000, 50), 'Escape closes it')
    ok(await until(async () => (await active()).more, 2000, 50), `and hands the focus back to the button (${JSON.stringify(await active())})`)
    // A click open does not take the focus off the button.
    await win.click(button)
    await until(async () => (await menus()) === 1, 3000, 50)
    ok((await active()).role !== 'menuitem', 'a click open leaves the focus where it was')
    await win.click(button)
    await until(async () => (await menus()) === 0, 3000, 50)

    // NO FOCUS BOX on the title bar's buttons: the focus is a fill.
    for (const sel of [button, '[data-title-bar] [aria-label="Settings"]', '[data-title-bar] [aria-label="Minimize"]']) {
      const f = await keyFocus(sel)
      ok(
        noBoxButShown(f) && f.changed.includes('backgroundImage'),
        `a keyboard-focused ${sel.replace('[data-title-bar] ', '')} has no outline and gains the fill (${JSON.stringify(f)})`
      )
    }
    await keyFocus(button)
    const bar = await win.locator('[data-title-bar]').boundingBox()
    await win.screenshot({
      path: join(SHOTS, 'more-focus.png'),
      clip: { x: Math.max(0, bar.x + bar.width - 320), y: bar.y, width: 320, height: bar.height }
    })

    // A SETTINGS CONTROL too: a segment and a dropdown.
    await win.click('[data-title-bar] [aria-label="Settings"]')
    await settingsPage(win, 'appearance')
    await win.locator('label[for="tab-width"]').waitFor({ timeout: 8000 })
    await win.evaluate(() => {
      const seg = document.querySelector('[data-pref="tab-width"] [data-seg="fixed"]')
      seg?.setAttribute('data-e2e-seg', '')
      document.querySelector('[data-settings-page] [aria-haspopup="listbox"]')?.setAttribute('data-e2e-select', '')
    })
    for (const [name, sel] of [['segment', '[data-e2e-seg]'], ['dropdown', '[data-e2e-select]']]) {
      const f = await keyFocus(sel)
      ok(noBoxButShown(f), `a keyboard-focused settings ${name} has no outline and its focus shows (${JSON.stringify(f)})`)
    }
    await win.locator('[data-e2e-seg]').scrollIntoViewIfNeeded()
    await keyFocus('[data-e2e-seg]')
    await win.screenshot({ path: join(SHOTS, 'more-settings-focus.png') })

    // WHAT SHOWED NO FOCUS AT ALL in the review of #272, each measured
    // focused against unfocused.
    // A TEXT FIELD whose edge colour is a class, as Explorer's rename field
    // is: the field's focus edge must beat the class (it lost to it from the
    // base layer). The rename field's own classes, on a probe field.
    await win.evaluate(() => {
      const f = document.createElement('input')
      f.className = 'mt-2 block w-full rounded border border-[var(--p-divider)] bg-[var(--p-bg)] p-2 text-[var(--p-text)]'
      f.setAttribute('data-e2e-field', '')
      document.querySelector('[data-settings-page]')?.prepend(f)
    })
    const field = await keyFocus('[data-e2e-field]')
    ok(
      noBoxButShown(field) && field.changed.includes('borderColor'),
      `a focused text field with a border class shows it on its edge, no ring (${JSON.stringify(field)})`
    )
    await win.evaluate(() => document.querySelector('[data-e2e-field]')?.remove())
    // A SLIDER (Progress bar > Behind the controls): its track takes the fill.
    await gotoPref(win, 'transport-bg')
    await win.locator('input#transport-bg').waitFor({ timeout: 8000 })
    // A colour swatch (Progress bar > Colour), painted by an inline background: its hairline edge
    // brightens, as on hover.
    const marked = await win.evaluate(() => {
      const sw = [...document.querySelectorAll('[data-settings-page] button[aria-pressed="false"]')].find(
        (b) => b instanceof HTMLElement && b.style.background && b.className.includes('ring-1')
      )
      sw?.setAttribute('data-e2e-swatch', '')
      return !!sw
    })
    ok(marked, 'found an unpicked colour swatch')
    await win.locator('[data-e2e-swatch]').scrollIntoViewIfNeeded()
    const sw = await keyFocus('[data-e2e-swatch]')
    ok(noBoxButShown(sw, true), `a keyboard-focused swatch has no outline and its edge shows the focus (${JSON.stringify(sw)})`)
    await win.locator('input#transport-bg').scrollIntoViewIfNeeded()
    const slider = await keyFocus('input#transport-bg')
    ok(
      noBoxButShown(slider) && slider.changed.includes('backgroundImage'),
      `a keyboard-focused slider has no outline and gains the fill (${JSON.stringify(slider)})`
    )
    await win.click('[data-title-bar] [aria-label="Settings"]')
    await sleep(300)

    // WITH THE TITLE BAR HIDDEN the button lives at the end of the tab row,
    // and toggles there too.
    await setTitleBar(win, 'hidden')
    const rowButton = '[data-title-bar="tabs"] [data-more-button]'
    ok(await until(async () => (await win.locator(rowButton).count()) === 1, 5000), 'Hidden: More is in the tab row')
    await win.click(rowButton)
    ok(await until(async () => (await menus()) === 1, 3000, 50), 'a click there opens the menu')
    await win.click(rowButton)
    await sleep(400)
    ok((await menus()) === 0, 'and a second click there closes it')
    await setTitleBar(win, 'shown')
  } finally {
    await app.close()
  }
}

async function sidebarPeekScenario(fixtures) {
  // THE COLLAPSED SIDEBAR PEEKS (#250; owner, 2026-10-02: "shows when cursor
  // hits the edge on the side, but it would collapse again once the cursor
  // moves away"). Over the content, never moving it; held while a menu in it
  // is open; pinned by its own header toggle.
  console.log('the sidebar peek')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const side = '[data-project-sidebar]'
  const content = () =>
    win.evaluate((s) => {
      const r = document.querySelector(s)?.nextElementSibling?.getBoundingClientRect()
      return r ? { x: Math.round(r.x), w: Math.round(r.width) } : null
    }, side)
  const peeking = () => win.locator(side).getAttribute('data-peek')
  const hidden = () => win.locator(side).getAttribute('aria-hidden')
  try {
    await win.waitForSelector(side, { timeout: 10000 })
    // A pass that starts on the toggle, away from the edge.
    await win.mouse.move(400, 300)
    await win.keyboard.press('Control+b')
    ok(await until(async () => (await hidden()) === 'true'), 'Ctrl+B collapses the tree')
    await sleep(400)
    const work = await win.evaluate(() => {
      const r = document.querySelector('.browse-workspace').getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    const before = await content()
    const edgeY = Math.round(work.y + work.h / 2)
    const away = { x: Math.round(work.x + work.w * 0.7), y: edgeY }

    // A pointer that only crosses the edge brings nothing out.
    await win.mouse.move(2, edgeY)
    await sleep(60)
    await win.mouse.move(away.x, away.y, { steps: 3 })
    await sleep(400)
    ok((await peeking()) === null, 'crossing the edge on the way somewhere peeks nothing')

    // A press that began in the content (selecting text) and drifts onto the
    // edge is not a rest on it (review of #250).
    await win.mouse.down()
    await win.mouse.move(2, edgeY, { steps: 4 })
    await sleep(500)
    ok((await peeking()) === null, 'a drag from the content onto the edge peeks nothing')
    await win.mouse.up()
    await win.mouse.move(away.x, away.y, { steps: 3 })
    await sleep(100)

    // Resting on it does.
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'resting on the left edge brings the tree out')
    await sleep(250)
    const over = await win.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect()
      return { x: Math.round(r.x), w: Math.round(r.width), position: getComputedStyle(document.querySelector(s)).position, shadow: getComputedStyle(document.querySelector(s)).boxShadow }
    }, side)
    const during = await content()
    ok(over.w > 120 && over.x === Math.round(work.x), `it is out at its own width (${JSON.stringify(over)})`)
    ok(over.position === 'absolute' && over.shadow !== 'none', 'laid over the content, with a shadow')
    ok(JSON.stringify(during) === JSON.stringify(before), `the content did not move or resize (${JSON.stringify(before)} -> ${JSON.stringify(during)})`)
    ok((await hidden()) === 'false', 'and a screen reader can reach it while it is out')
    await win.screenshot({ path: join(SHOTS, 'sidebar-peek.png') })

    // On the panel it stays; away, it goes.
    await win.mouse.move(over.x + over.w / 2, edgeY, { steps: 4 })
    await sleep(700)
    ok((await peeking()) === 'in', 'it stays while the pointer is on it')
    await win.mouse.move(away.x, away.y, { steps: 4 })
    ok(await until(async () => (await peeking()) === null, 2000, 25), 'and goes once the pointer leaves it')
    ok((await hidden()) === 'true', 'back to a collapsed tree')
    ok(JSON.stringify(await content()) === JSON.stringify(before), 'with the content still where it was')

    // A context menu inside it holds it.
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'it comes out again')
    await sleep(250)
    const rowBox = await win.locator(`${side} [data-row]`).first().boundingBox()
    await win.mouse.move(rowBox.x + 30, rowBox.y + rowBox.height / 2, { steps: 4 })
    await win.mouse.click(rowBox.x + 30, rowBox.y + rowBox.height / 2, { button: 'right' })
    ok(await until(async () => (await win.locator('[role="menu"]').count()) > 0, 3000), 'a right-click opens the row menu')
    await win.mouse.move(away.x + 100, work.y + work.h - 20, { steps: 4 })
    await sleep(1000)
    ok((await peeking()) === 'in', 'with a menu open it stays, though the pointer left')
    await win.keyboard.press('Escape')
    ok(await until(async () => (await win.locator('[role="menu"]').count()) === 0, 3000), 'Escape takes the menu')
    ok((await peeking()) === 'in', 'and that Escape was the menu\'s, not the peek\'s')
    await win.mouse.move(away.x, away.y, { steps: 2 })
    ok(await until(async () => (await peeking()) === null, 2000, 25), 'once nothing holds it, it goes')

    // A drag whose dragend never reached the window (its row unmounted under
    // it) does not hold the peek for good: the next pointer move ends it.
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'out for a lost drag')
    await win.evaluate(() => window.dispatchEvent(new DragEvent('dragstart')))
    await win.mouse.move(away.x, away.y, { steps: 4 })
    ok(await until(async () => (await peeking()) === null, 2000, 25), 'a drag that never ended does not keep it out')

    // A click in it puts the focus there; its going does not drop the focus
    // on the body, where no key reaches anything (review of #250).
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'out for a click')
    await sleep(250)
    const folderRow = await win.locator(`${side} [role="treeitem"][aria-expanded]`).first().boundingBox()
    await win.mouse.move(folderRow.x + 30, folderRow.y + folderRow.height / 2, { steps: 4 })
    await win.mouse.click(folderRow.x + 30, folderRow.y + folderRow.height / 2)
    ok(
      await win.evaluate((s) => !!document.querySelector(s)?.contains(document.activeElement), side),
      'the click put the focus in the tree'
    )
    await win.mouse.move(away.x, away.y, { steps: 4 })
    ok(await until(async () => (await peeking()) === null, 2000, 25), 'it goes as the pointer leaves')
    await sleep(100)
    const focused = await win.evaluate(
      (s) => {
        const a = document.activeElement
        return {
          body: !a || a === document.body,
          inTree: !!document.querySelector(s)?.contains(a),
          tag: a?.tagName ?? null
        }
      },
      side
    )
    ok(!focused.body && !focused.inTree, `and the focus went back into the window (${JSON.stringify(focused)})`)
    // Put the folder back as it was.
    await win.keyboard.press('Control+b')
    await until(async () => (await hidden()) === 'false')
    await win.locator(`${side} [role="treeitem"][aria-expanded]`).first().click()
    await win.keyboard.press('Control+b')
    await until(async () => (await hidden()) === 'true')
    await sleep(300)

    // Escape ends a peek.
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'out once more')
    await win.keyboard.press('Escape')
    ok(await until(async () => (await peeking()) === null, 2000, 25), 'Escape puts it away')

    // Its header toggle pins it: the content moves over and the peek ends.
    await win.mouse.move(away.x, away.y)
    await sleep(100)
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'and out again')
    await sleep(250)
    await win.locator(`${side} [data-peek-pin]`).click()
    ok(await until(async () => (await hidden()) === 'false' && (await peeking()) === null, 3000), 'its header toggle pins it')
    await sleep(400)
    const pinned = await content()
    ok(pinned.x >= before.x + over.w - 2 && pinned.w <= before.w - over.w + 2, `and the content moved over (${JSON.stringify(before)} -> ${JSON.stringify(pinned)})`)
    ok((await win.locator('[data-panel-toggle]').getAttribute('aria-pressed')) === 'true', 'the bar\'s toggle reads pinned')

    // The toggle and the keybind still pin and unpin, as before.
    await win.click('[data-panel-toggle]')
    ok(await until(async () => (await hidden()) === 'true'), 'the bar\'s toggle collapses it')
    await win.keyboard.press('Control+b')
    ok(await until(async () => (await hidden()) === 'false'), 'Ctrl+B pins it open')
    await win.keyboard.press('Control+b')
    ok(await until(async () => (await hidden()) === 'true'), 'and collapses it')

    // Opening a file from a peeking tree ends the peek.
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await peeking()) === 'in', 2000, 25), 'out for a file, straight after a Ctrl+B while the tree slides shut')
    await sleep(250)
    const fileRow = win.locator(`${side} [role="treeitem"][data-row$=".txt" i], ${side} [role="treeitem"][data-row$=".md" i]`).first()
    await fileRow.click()
    ok(await until(async () => (await peeking()) === null, 2000, 25), 'opening a file from it puts it away')
    // Leave the profile as the suite expects it: the tree open.
    await win.keyboard.press('Control+b')
    await until(async () => (await hidden()) === 'false')

    // THE EXPLORER'S PLACES PEEK THE SAME WAY, over the list.
    await win.locator('[data-tab-role][data-pinned] [role="tab"]').click()
    const browser = '[data-testid="folder-browser"]'
    await win.waitForSelector(`${browser} .browse-places`, { timeout: 10000 })
    await win.click('[data-panel-toggle]')
    ok(await until(async () => (await win.locator(`${browser} .browse-places`).count()) === 0), 'the toggle hides the places in the Explorer')
    await sleep(300)
    const list = () => win.evaluate((s) => {
      const r = document.querySelector(`${s} .browse-list`)?.getBoundingClientRect()
      return r ? { x: Math.round(r.x), w: Math.round(r.width) } : null
    }, browser)
    const listBefore = await list()
    await win.mouse.move(away.x, away.y)
    await sleep(50)
    await win.mouse.move(2, edgeY)
    ok(
      await until(async () => (await win.locator(`${browser}[data-places-peek="in"] .browse-places`).count()) === 1, 2000, 25),
      'resting on the edge brings the places out'
    )
    await sleep(250)
    ok(JSON.stringify(await list()) === JSON.stringify(listBefore), `over the list, which did not move (${JSON.stringify(listBefore)})`)
    const placesBox = await win.evaluate((s) => {
      const r = document.querySelector(`${s} .browse-places`).getBoundingClientRect()
      return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }
    }, browser)
    ok(placesBox.w >= 150 && placesBox.x === 0 && placesBox.h > 200, `at the width it has when shown (${JSON.stringify(placesBox)})`)
    await win.screenshot({ path: join(SHOTS, 'places-peek.png') })
    await win.mouse.move(away.x, away.y, { steps: 4 })
    ok(await until(async () => (await win.locator(`${browser} .browse-places`).count()) === 0, 2000, 25), 'and they go when the pointer leaves')
    await win.mouse.move(2, edgeY)
    ok(await until(async () => (await win.locator(`${browser}[data-places-peek="in"]`).count()) === 1, 2000, 25), 'out again')
    await sleep(250)
    await win.locator(`${browser} [data-peek-pin]`).click()
    ok(
      await until(async () => (await win.locator(`${browser}[data-places-peek]`).count()) === 0 && (await win.locator(`${browser} .browse-places`).count()) === 1),
      'and the header toggle pins them'
    )
  } finally {
    await win
      .evaluate(() => {
        localStorage.setItem('prism.sidebar', '1')
        localStorage.setItem('prism.explorer.places', '1')
      })
      .catch(() => {})
    await app.close()
  }
}

async function pinRecentScenario(fixtures) {
  console.log('pin recent')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const rows = () => win.locator('[role="menuitem"]')
  const rowLabels = () => rows().evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
  // The WHOLE label: the recents are whatever the scenarios before this one
  // left, and "docs" is also the start of "docs2".
  const pinOf = (label) =>
    win.locator('[role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).locator('[data-pin]')
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
    // The launch file goes to the Explorer tab (2026-09-22) and makes no
    // second project; the restored project is picked to reach its shell.
    await win.waitForSelector('[data-tab-role]:not([data-pinned]) [role="tab"]', { timeout: 15000 })
    await sleep(800)
    ok((await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').count()) === 1, 'restore retains one project owner for its file and shell')
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]').first().click()
    await sleep(600)
    // The project may come back WITH its shell showing; Ctrl+` there would
    // hide it, so the key is pressed only when it is not.
    if (!(await win.locator('.xterm').count())) await win.keyboard.press('Control+`')
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
/**
 * THE TERMINAL MENU FITS WHAT WAS CLICKED (#210; owner, 2026-09-23, asked in
 * Prism Terminal and agreed for Prism: "if i click it on a link it shows copy
 * link, if i click it with text marked it says copy"). And Backspace over a
 * selection on the line being edited deletes it (the core's, core-v0.11.0).
 * A real pwsh, a real drag, the clipboard read back in main and put back.
 */
async function termMenuCopyScenario(fixtures) {
  console.log('terminal menu copy')
  const { app, win } = await launch(join(fixtures, 'code', 'bad.json'))
  const clip = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const held = await clip()
  const box = (needle, offset) =>
    win.evaluate(
      ([n, off]) => {
        const rows = [...document.querySelectorAll('.xterm-rows > div')]
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const at = rows[i].textContent.lastIndexOf(n)
          if (at < 0) continue
          const walker = document.createTreeWalker(rows[i], NodeFilter.SHOW_TEXT)
          let left = at + off
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (left < node.textContent.length) {
              const range = document.createRange()
              range.setStart(node, left)
              range.setEnd(node, left + 1)
              const b = range.getBoundingClientRect()
              return { left: b.left, right: b.right, y: b.top + b.height / 2 }
            }
            left -= node.textContent.length
          }
        }
        return null
      },
      [needle, offset]
    )
  const select = async (needle, from, to) => {
    const a = await box(needle, from)
    const b = await box(needle, to)
    await win.mouse.move(a.left + 1, a.y)
    await win.mouse.down()
    await win.mouse.move(b.right - 1, b.y, { steps: 6 })
    await win.mouse.up()
    await sleep(250)
  }
  const rows = async () => {
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    return win.locator('[role="menu"] [role="menuitem"]').allTextContents()
  }
  const text = () => win.evaluate(() => document.querySelector('.xterm .xterm-rows')?.textContent ?? '')
  try {
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(3500)
    await win.locator('.xterm').click()
    const url = 'https://example.com/some/path?q=1'
    await win.keyboard.type(`echo ${url}`)
    await win.keyboard.press('Enter')
    await sleep(1200)
    const onLink = await box(url, 12)
    await win.mouse.click(onLink.left + 2, onLink.y, { button: 'right' })
    let items = await rows()
    ok(items[0]?.includes('Copy link'), `right-click on a link leads with Copy link (${JSON.stringify(items)})`)
    await win.locator('[role="menuitem"]:has-text("Copy link")').click()
    ok(!!(await until(async () => (await clip()) === url, 4000)), 'and it copies the whole link')
    await select('example.com', 0, 6)
    const mark = await box('example.com', 2)
    await win.mouse.click(mark.left + 2, mark.y, { button: 'right' })
    items = await rows()
    ok(items.some((r) => /^Copy(?! link)/.test(r)), `with text marked it offers Copy (${JSON.stringify(items)})`)
    await win.locator('[role="menu"] [role="menuitem"]', { hasText: /^Copy(?! link)/ }).first().click()
    ok(!!(await until(async () => (await clip()) === 'example', 4000)), `and it copies the selection exactly (${JSON.stringify(await clip())})`)
    // THE "COPIED" BADGE (#215): shown at the bottom centre, then gone.
    const badge = () =>
      win.evaluate(() => {
        const el = document.querySelector('[data-copied-badge]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { state: el.getAttribute('data-copied-badge'), cx: r.left + r.width / 2, w: innerWidth, up: innerHeight - r.bottom }
      })
    const shown = await until(async () => {
      const b = await badge()
      return b?.state === 'shown' ? b : null
    }, 3000, 25)
    ok(!!shown && Math.abs(shown.cx - shown.w / 2) <= 2 && shown.up < 60, `a copy shows "Copied" at the bottom centre (${JSON.stringify(shown)})`)
    ok(!!(await until(async () => (await badge())?.state === 'hidden', 3000, 50)), 'and it leaves by itself')
    // THE SCROLLBAR (#215): no empty native gutter, xterm's slider 6px.
    const bar = await win.evaluate(() => {
      const v = document.querySelector('.xterm .xterm-viewport')
      const s = document.querySelector('.xterm .xterm-scrollable-element > .scrollbar.vertical')
      return { gutter: v ? v.offsetWidth - v.clientWidth : -1, slider: s ? Math.round(s.getBoundingClientRect().width) : -1 }
    })
    ok(bar.gutter === 0 && bar.slider === 6, `the terminal's scrollbar is one 6px slider, no gutter (${JSON.stringify(bar)})`)
    // Backspace over a selected word on the line being edited deletes it.
    await win.locator('.xterm').click()
    await win.keyboard.type('echo hello world')
    await sleep(400)
    await select('hello world', 6, 10)
    await win.keyboard.press('Backspace')
    await win.keyboard.type('there')
    await win.keyboard.press('Enter')
    ok(!!(await until(async () => (await text()).includes('echo hello there'), 8000)), 'Backspace over a selected word deletes it')
    // A CLICKED LINK NEVER REACHES THE OWNER'S BROWSER UNDER --e2e (#222;
    // owner, 2026-09-24: "make sure that future runs don't do that in my real
    // browser"). Clicked for real: main records it and opens nothing.
    const linkAgain = await box(url, 12)
    await win.mouse.click(linkAgain.left + 2, linkAgain.y)
    ok(
      !!(await until(async () => ((await app.evaluate(() => globalThis.__e2eOpenedLinks)) ?? []).includes(url), 4000)),
      'a clicked link is recorded under --e2e, and no browser is opened'
    )
    // A FILE DROPPED ON THE TERMINAL is quoted for its shell (core-v0.15.1):
    // single quotes in PowerShell, so `$x` in a name is not expanded. A real
    // drop, Chromium's own drag events carrying the path.
    const dropped = join(fixtures, 'code', 'drop $x.txt')
    writeFileSync(dropped, 'x')
    const term = await win.locator('.xterm').boundingBox()
    const at = { x: Math.round(term.x + term.width / 2), y: Math.round(term.y + term.height / 2) }
    const cdp = await win.context().newCDPSession(win)
    const data = { items: [], files: [dropped], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...at, data })
    const typed = await until(async () => (await text()).includes('drop $x.txt'), 8000)
    ok(!!typed && (await text()).includes(`'${dropped}'`), `a dropped path is single-quoted for PowerShell (${(await text()).slice(-120)})`)
    await win.keyboard.press('Escape')
  } finally {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), held).catch(() => {})
    await app.close().catch(() => {})
  }
}

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
    // The base font size pref applies to new terminals (120% of 13 = 16px). The
    // sizes are 50% to 200% in tens since core-v0.16.0; 125% is no step now.
    await win.evaluate(() => localStorage.setItem('prism.term.fontPct', '120'))
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
      'the Settings base font size applies (120% = 16px)'
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
    // Not 80, the size a shell is born at when the first resize is dropped. A
    // number, not a floor: the first window is 1164px since #269, 84 columns
    // here, where the old floor of 90 assumed the wider window it replaced.
    ok(cols > 0 && cols !== 80, `the shell was born at the window's size, not 80x24 (cols=${cols})`)

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
    // The launch is the harness's seeded project (2026-09-22). That a film
    // Windows hands over PLAYS (#139) is proved where it now lands, in the
    // Explorer tab: openInExplorerScenario.
    ok(await win.evaluate(() => !!document.querySelector('video')), 'the film is on screen')
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
 * Play on open, and NOT on restore (2026-09-14, #139). A pick plays - here the
 * film's row in the tree; a file Windows hands over is proved to play in
 * openInExplorerScenario, where it lands since 2026-09-22 - and this is the
 * other half: the same film, back in a RESTORED tab
 * after a relaunch, sits paused - a window full of restored tabs starting
 * every film at once is what the 2026-08-28 rule exists to prevent, and it
 * stands. The relaunch arrives with ANOTHER root (a folder) so the restored
 * tab is a background tab, and its player mounts when the tab is visited,
 * which is the moment a user meets it.
 */
async function playOnOpenScenario(fixtures) {
  console.log('play on open, not on restore')
  let { app, win } = await launch(join(fixtures, 'ep1.mp4'))
  try {
    await win.waitForSelector('video', { timeout: 15000 })
    await win.evaluate(() => { document.querySelector('video').muted = true })
    await win.locator('[role="treeitem"][data-row$="ep1.mp4" i]').first().click()
    let playing = true
    await win
      .waitForFunction(() => document.querySelector('video')?.paused === false, null, { timeout: 5000 })
      .catch(() => {
        playing = false
      })
    ok(playing, 'a film picked in the tree plays without another click')
    await sleep(700) // tabs.json saves on a 400ms debounce
  } finally {
    await app.close()
  }
  await sleep(900)
  ;({ app, win } = await launch(OTHER_ROOT, true))
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
    // THE WINDOW'S STATE IS SAVED IN THE SHARED PROFILE: left maximized, every
    // later launch came up maximized, where `setSize` is ignored, and the
    // narrow-window checks of `columnHeaders` and `panelsAlign` measured a full
    // screen (MEASURED in the #292 review: those two fail after this one alone).
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()).catch(() => {})
    await sleep(300)
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
    // The Explorer menu row lives on Explorer, under Windows (#292), and its
    // SUBTEXT says what it does, or what Windows is being asked.
    await gotoPref(win, 'explorer-verb')
    const verbRow = win.locator('label[for="explorer-verb"]')
    await verbRow.waitFor({ timeout: 10000 })
    await verbRow.scrollIntoViewIfNeeded()
    const hint = await win
      .waitForFunction(
        () => {
          const text = document.querySelector('label[for="explorer-verb"]')?.nextElementSibling?.textContent ?? ''
          return text && text !== 'Checking with Windows.' ? text : false
        },
        null,
        { timeout: 10000 }
      )
      .then((h) => h.jsonValue())
      .catch(() => '')
    // Plain words since 2026-09-22 (owner: descriptions say what a setting
    // does, with no symbols but commas and full stops, no keys, no tips), and
    // eight words at most since the grouped cards.
    ok(hint === 'Open files and folders in Prism.', `Settings says what the Explorer menu row does, in plain words (${hint})`)
    // A subtext is ONE line and TRUNCATES. MEASURED rather than eyeballed: at
    // the fresh profile's default window the text must fit its box.
    const clipped = await win.evaluate(() => {
      const p = document.querySelector('label[for="explorer-verb"]')?.nextElementSibling
      return p ? { text: p.scrollWidth, box: p.clientWidth } : null
    })
    ok(!!clipped && clipped.text <= clipped.box, `and the whole subtext fits on its line (${clipped?.text}px in ${clipped?.box}px)`)
    // The switch settles in the same render as the subtext and then ANIMATES
    // there; a screenshot taken on the first frame showed a switch that read
    // as off on a machine where the verb is on. Wait for its transitions to
    // end. Which way it points is this machine's registry and is not asserted.
    await win
      .waitForFunction(
        () => {
          const sw = document.querySelector('[role="switch"][aria-label="Add to the Explorer menu"]')
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

/**
 * THE SWEEP RECTANGLE AND ONE ROW SIZE (#257; owner, 2026-10-03: "let me
 * highlight files by holding down left click ... that transparent quadrant",
 * and "the rows are too big in explorer ... matching the ide sizing").
 * Real pointer presses, in the tree and in the Explorer's list: a sweep from
 * blank space marks what it covers live and leaves no rectangle behind; Ctrl
 * adds; Escape puts back what was marked; a press on a name is still the
 * file's drag. And the Explorer's row is MEASURED against the tree's.
 */
async function marqueeScenario(fixtures) {
  console.log('sweep rectangle and row size')
  const dir = join(fixtures, 'marquee')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const names = ['a1.txt', 'a2.txt', 'a3.txt', 'a4.txt', 'a5.txt', 'a6.txt', 'a7.txt', 'a8.txt']
  for (const n of names) writeFileSync(join(dir, n), `sweep ${n}\n`)
  const { app, win } = await launch(join(dir, 'a1.txt'))
  /** Press, travel in steps, optionally do something mid-way, release. */
  const sweep = async (from, to, { ctrl = false, mid } = {}) => {
    if (ctrl) await win.keyboard.down('Control')
    await win.mouse.move(from.x, from.y)
    await win.mouse.down()
    await win.mouse.move(to.x, to.y, { steps: 12 })
    await sleep(120)
    const during = mid ? await mid() : undefined
    await win.mouse.up()
    if (ctrl) await win.keyboard.up('Control')
    await sleep(200)
    return during
  }
  const band = (scope) => win.evaluate((s) => document.querySelectorAll(`${s} [data-sweep-band]`).length, scope)
  try {
    /* ---------- the tree ---------- */
    await win.waitForSelector('aside [data-row]', { timeout: 10000 })
    await sleep(500)
    const treeRow = async (i) => {
      const r = win.locator('aside [data-row]').nth(i)
      return { box: await r.boundingBox(), path: await r.getAttribute('data-row') }
    }
    const treeMarked = () =>
      win.evaluate(() =>
        [...document.querySelectorAll('aside [data-row][data-selected]')].map((r) => /[^\\]*$/.exec(r.getAttribute('data-row') ?? '')?.[0])
      )
    const r0 = await treeRow(0)
    const r2 = await treeRow(2)
    const r4 = await treeRow(4)
    const r5 = await treeRow(5)
    const r6 = await treeRow(6)
    const r7 = await treeRow(7)
    ok(!!r0.box && !!r7.box, 'the tree shows the eight files')
    const blankX = r0.box.x + r0.box.width - 12
    // From the space under the last row, up to the third: a3..a8.
    const treeMid = await sweep(
      { x: blankX, y: r7.box.y + r7.box.height + 40 },
      { x: r0.box.x + 30, y: r2.box.y + 6 },
      {
        mid: async () => {
          await win.screenshot({ path: join(SHOTS, 'marquee-tree.png') })
          return { band: await band('aside'), marked: await treeMarked() }
        }
      }
    )
    ok(treeMid.band === 1, `the tree draws the rectangle while sweeping (${treeMid.band})`)
    ok(['a3.txt', 'a8.txt'].every((n) => treeMid.marked.includes(n)), `and marks rows live (${treeMid.marked})`)
    ok((await band('aside')) === 0, 'the rectangle is gone after the release')
    let marked = await treeMarked()
    ok(
      ['a3.txt', 'a4.txt', 'a5.txt', 'a6.txt', 'a7.txt', 'a8.txt'].every((n) => marked.includes(n)) && !marked.includes('a2.txt'),
      `a sweep from the space under the rows marks what it covered (${marked})`
    )
    ok(!(await win.locator('.cm-editor').textContent().catch(() => '')).includes('sweep a8'), 'and opened nothing')
    // Plain sweep from a row's blank space replaces: a5..a6.
    await sweep({ x: blankX, y: r4.box.y + r4.box.height / 2 }, { x: blankX - 10, y: r5.box.y + r5.box.height / 2 })
    marked = await treeMarked()
    ok(marked.includes('a5.txt') && marked.includes('a6.txt') && !marked.includes('a8.txt'), `a plain sweep from a row's blank space replaces the marks (${marked})`)
    // Ctrl adds: a7..a8 on top.
    await sweep({ x: blankX, y: r6.box.y + r6.box.height / 2 }, { x: blankX - 10, y: r7.box.y + r7.box.height / 2 }, { ctrl: true })
    marked = await treeMarked()
    ok(['a5.txt', 'a6.txt', 'a7.txt', 'a8.txt'].every((n) => marked.includes(n)), `Ctrl+sweep adds to them (${marked})`)
    // Escape mid-sweep puts them back.
    const before = (await treeMarked()).sort().join()
    const escMid = await sweep({ x: blankX, y: r7.box.y + r7.box.height + 30 }, { x: blankX - 20, y: r0.box.y + 4 }, {
      mid: async () => {
        const during = (await treeMarked()).length
        await win.keyboard.press('Escape')
        await sleep(150)
        return { during, band: await band('aside') }
      }
    })
    ok(escMid.during >= 8, `the sweep had marked every row (${escMid.during})`)
    ok(escMid.band === 0, 'Escape takes the rectangle away at once')
    ok((await treeMarked()).sort().join() === before, `and puts back what was marked (${await treeMarked()})`)
    // A press on a NAME is the file's drag, never a sweep.
    await win.evaluate(() => {
      globalThis.__sweepDrag = 0
      window.addEventListener('dragstart', () => (globalThis.__sweepDrag += 1), { once: true, capture: true })
    })
    const nameBox = await win.locator('aside [data-row]').nth(1).locator('span.truncate').boundingBox()
    await win.mouse.move(nameBox.x + 6, nameBox.y + nameBox.height / 2)
    await win.mouse.down()
    await win.mouse.move(nameBox.x + 6, nameBox.y + 60, { steps: 10 })
    await sleep(150)
    const treeNameBand = await band('aside')
    await win.mouse.up()
    await sleep(300)
    await win.keyboard.press('Escape')
    ok(treeNameBand === 0, 'a press on a name never draws the rectangle')
    ok((await win.evaluate(() => globalThis.__sweepDrag)) === 1, 'it starts the file drag instead')
    // The gap between the icon and the name is the row's too (review of #257:
    // a drag from there drew a rectangle and marked rows).
    const treeGap = await win.evaluate(() => {
      const row = document.querySelectorAll('aside [data-row]')[1]
      const icon = row?.querySelector('svg')?.getBoundingClientRect()
      const name = row?.querySelector('span.truncate')?.getBoundingClientRect()
      return icon && name ? { x: (icon.right + name.left) / 2, y: name.top + name.height / 2 } : null
    })
    await win.evaluate(() => {
      globalThis.__sweepDrag = 0
      window.addEventListener('dragstart', () => (globalThis.__sweepDrag += 1), { once: true, capture: true })
    })
    await win.mouse.move(treeGap.x, treeGap.y)
    await win.mouse.down()
    await win.mouse.move(treeGap.x, treeGap.y + 60, { steps: 10 })
    await sleep(150)
    const treeGapBand = await band('aside')
    await win.mouse.up()
    await sleep(300)
    await win.keyboard.press('Escape')
    ok(treeGapBand === 0, 'a press between the icon and the name never draws the rectangle')
    ok((await win.evaluate(() => globalThis.__sweepDrag)) === 1, 'it drags the file as the name does')
    // A right press on the space under the rows clears the marks, as any press
    // there did before the sweep.
    await sweep({ x: blankX, y: r4.box.y + r4.box.height / 2 }, { x: blankX - 10, y: r6.box.y + r6.box.height / 2 })
    ok((await treeMarked()).length >= 3, `marks are lit before the right press (${await treeMarked()})`)
    await win.mouse.click(blankX, r7.box.y + r7.box.height + 40, { button: 'right' })
    await sleep(250)
    await win.keyboard.press('Escape')
    await sleep(150)
    marked = await treeMarked()
    ok(!marked.includes('a5.txt') && !marked.includes('a7.txt'), `a right press under the rows clears the marks (${marked})`)

    // The tree's row, for the Explorer to be measured against.
    const treeLook = await win.evaluate(() => {
      const row = document.querySelector('aside [data-row]')
      const icon = row?.querySelector('svg')
      const cs = row ? getComputedStyle(row) : null
      return { h: row?.getBoundingClientRect().height, font: cs?.fontSize, icon: icon?.getBoundingClientRect().height, gap: cs?.columnGap }
    })

    /* ---------- the Explorer ---------- */
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    await win.locator('[data-testid="browse-list"] [data-browse-path$="marquee"]').dblclick()
    ok(
      await until(async () => (await win.locator('[data-testid="browse-list"] [data-browse-path$=".txt"]').count()) === 8, 10000),
      'the Explorer walked into the folder of eight'
    )
    await sleep(400)
    const list = win.locator('[data-testid="browse-list"]')
    const rowAt = (i) => list.locator(`[data-browse-index="${i}"]`)
    const exLook = await win.evaluate(() => {
      const row = document.querySelector('[data-testid="browse-list"] .browse-row[data-browse-path]')
      const icon = row?.querySelector('.browse-name > svg')
      const cs = row ? getComputedStyle(row) : null
      const name = row?.querySelector('.browse-name')
      return {
        h: row?.getBoundingClientRect().height,
        font: cs?.fontSize,
        icon: icon?.getBoundingClientRect().height,
        gap: name ? getComputedStyle(name).columnGap : null
      }
    })
    ok(exLook.h === treeLook.h, `an Explorer row is the tree's height (${exLook.h} and ${treeLook.h})`)
    ok(exLook.font === treeLook.font, `in the tree's text size (${exLook.font} and ${treeLook.font})`)
    ok(exLook.icon === treeLook.icon, `with the tree's icon size (${exLook.icon} and ${treeLook.icon})`)
    ok(exLook.gap === treeLook.gap, `and the tree's gap after it (${exLook.gap} and ${treeLook.gap})`)
    await win.screenshot({ path: join(SHOTS, 'explorer-rows.png') })

    const exMarked = () =>
      win.evaluate(() =>
        [...document.querySelectorAll('[data-testid="browse-list"] [data-browse-path][aria-selected="true"]')].map(
          (r) => /[^\\]*$/.exec(r.getAttribute('data-browse-path') ?? '')?.[0]
        )
      )
    const listBox = await list.boundingBox()
    const e0 = await rowAt(0).boundingBox()
    const e2 = await rowAt(2).boundingBox()
    const e7 = await rowAt(7).boundingBox()
    ok(e7.y + e7.height + 60 < listBox.y + listBox.height, 'there is blank space under the rows')
    const exMid = await sweep(
      { x: listBox.x + listBox.width * 0.6, y: e7.y + e7.height + 40 },
      { x: e0.x + 40, y: e2.y + 6 },
      {
        mid: async () => {
          await win.screenshot({ path: join(SHOTS, 'marquee-explorer.png') })
          return { band: await band('[data-testid="browse-list"]'), marked: await exMarked() }
        }
      }
    )
    ok(exMid.band === 1, `the Explorer draws the rectangle while sweeping (${exMid.band})`)
    ok(exMid.marked.length === 6, `and marks rows live (${exMid.marked})`)
    ok((await band('[data-testid="browse-list"]')) === 0, 'the rectangle is gone after the release')
    let ex = await exMarked()
    ok(ex.sort().join() === 'a3.txt,a4.txt,a5.txt,a6.txt,a7.txt,a8.txt', `a sweep from the space under the rows marks what it covered (${ex})`)
    ok(/6 selected/.test((await win.locator('.browse-status').textContent()) ?? ''), 'and the status line counts them')
    ok(
      !(await win.evaluate(() => !!document.querySelector('[data-browse-preview]')?.getClientRects().length)),
      'and opened no preview pane (#263)'
    )
    let f0 = await rowAt(0).boundingBox()
    let exBlank = f0.x + f0.width - 30
    // A plain click on a row's blank space, without moving, is still a click.
    await win.mouse.click(exBlank, f0.y + f0.height / 2)
    await sleep(250)
    ex = await exMarked()
    ok(ex.join() === 'a1.txt', `a plain click on a row's blank space selects that row alone (${ex})`)
    // That click previewed the file, and the pane beside the list made it
    // narrower: every point after this is measured again.
    await sleep(400)
    const box2 = await list.boundingBox()
    f0 = await rowAt(0).boundingBox()
    const f3 = await rowAt(3).boundingBox()
    const f4 = await rowAt(4).boundingBox()
    const f7 = await rowAt(7).boundingBox()
    exBlank = f0.x + f0.width - 30
    // Ctrl adds: a4..a5 swept from a row's blank space.
    await sweep({ x: exBlank, y: f3.y + f3.height / 2 }, { x: exBlank - 10, y: f4.y + f4.height / 2 }, { ctrl: true })
    ex = await exMarked()
    ok(ex.sort().join() === 'a1.txt,a4.txt,a5.txt', `Ctrl+sweep adds to what was marked (${ex})`)
    // Escape restores.
    const exEsc = await sweep({ x: box2.x + box2.width * 0.6, y: f7.y + f7.height + 40 }, { x: exBlank, y: f0.y + 4 }, {
      mid: async () => {
        const during = (await exMarked()).length
        await win.keyboard.press('Escape')
        await sleep(150)
        return { during, band: await band('[data-testid="browse-list"]') }
      }
    })
    ok(exEsc.during === 8, `the sweep had marked every row (${exEsc.during})`)
    ok(exEsc.band === 0, 'Escape takes the rectangle away at once')
    ex = await exMarked()
    ok(ex.sort().join() === 'a1.txt,a4.txt,a5.txt', `and puts back what was marked (${ex})`)
    // A right press on one of several marked rows: the menu acts on all of
    // them and offers nothing that is one row's (review of #257).
    await rowAt(3).click({ button: 'right', position: { x: 30, y: f3.height / 2 } })
    const multiMenu = await win
      .locator('[role="menu"]')
      .last()
      .textContent({ timeout: 3000 })
      .catch(() => '')
    ok(/Delete 3 items/.test(multiMenu) && /Copy 3 items/.test(multiMenu), `the menu names all three marked rows (${multiMenu})`)
    ok(!/Rename|Open|Properties/.test(multiMenu), 'and offers nothing that acts on one row')
    await win.keyboard.press('Escape')
    await sleep(200)
    ex = await exMarked()
    ok(ex.sort().join() === 'a1.txt,a4.txt,a5.txt', `the marks are still the three (${ex})`)
    // A press in the gap between a file's icon and its name drags the file.
    const exGap = await win.evaluate(() => {
      const row = document.querySelector('[data-testid="browse-list"] [data-browse-index="2"]')
      const icon = row?.querySelector('.browse-name > svg')?.getBoundingClientRect()
      const name = row?.querySelector('.browse-name-text')?.getBoundingClientRect()
      return icon && name ? { x: (icon.right + name.left) / 2, y: name.top + name.height / 2 } : null
    })
    await win.evaluate(() => {
      globalThis.__sweepDrag = 0
      window.addEventListener('dragstart', () => (globalThis.__sweepDrag += 1), { once: true, capture: true })
    })
    await win.mouse.move(exGap.x, exGap.y)
    await win.mouse.down()
    await win.mouse.move(exGap.x, exGap.y + 80, { steps: 10 })
    await sleep(150)
    const exGapBand = await band('[data-testid="browse-list"]')
    await win.mouse.up()
    await sleep(300)
    await win.keyboard.press('Escape')
    ok(exGapBand === 0, 'a press between the icon and the name never draws the rectangle')
    ok((await win.evaluate(() => globalThis.__sweepDrag)) === 1, 'it drags the file as the name does')
    // A press on a file's name drags the file.
    await win.evaluate(() => {
      globalThis.__sweepDrag = 0
      window.addEventListener('dragstart', () => (globalThis.__sweepDrag += 1), { once: true, capture: true })
    })
    const exName = await rowAt(1).locator('.browse-name-text').boundingBox()
    await win.mouse.move(exName.x + 6, exName.y + exName.height / 2)
    await win.mouse.down()
    await win.mouse.move(exName.x + 6, exName.y + 80, { steps: 10 })
    await sleep(150)
    const exNameBand = await band('[data-testid="browse-list"]')
    await win.mouse.up()
    await sleep(300)
    await win.keyboard.press('Escape')
    ok(exNameBand === 0, 'a press on a name never draws the rectangle')
    ok((await win.evaluate(() => globalThis.__sweepDrag)) === 1, 'it starts the file drag instead')
    // No button held, no rectangle: the failure that took the old sweep away.
    await win.mouse.move(box2.x + 50, f7.y + f7.height + 40)
    await win.mouse.move(box2.x + 80, f0.y + 4, { steps: 8 })
    ok((await band('[data-testid="browse-list"]')) === 0, 'moving with no button held draws nothing')
  } finally {
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * MARKING IS NOT PICKING (#263; owner, 2026-10-03, with a sweep over three
 * films while the preview played one: "when you multiselect like this it picks
 * a file so here this drag starts one of the videos, and if the preview is not
 * open it will open. it shouldnt, im just selecting, same is the case if i
 * ctrl select it shouldnt start or preview anything"). A sweep and a Ctrl or
 * Shift click mark rows and leave the preview alone: a shut pane stays shut,
 * an open one keeps its film, and nothing starts. A plain click still previews
 * and plays, as before.
 */
async function marqueeQuietScenario(fixtures) {
  console.log('marking rows previews and plays nothing')
  const dir = join(fixtures, 'marqueequiet')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const names = ['v1.mp4', 'v2.mp4', 'v3.mp4', 'v4.mp4']
  for (const n of names) copyFileSync(join(fixtures, 'ep1.mp4'), join(dir, n))
  const { app, win } = await launch(join(fixtures, 'README.md'))
  const sweep = async (from, to) => {
    await win.mouse.move(from.x, from.y)
    await win.mouse.down()
    await win.mouse.move(to.x, to.y, { steps: 12 })
    await sleep(120)
    await win.mouse.up()
    await sleep(400)
  }
  const paneShown = () => win.evaluate(() => !!document.querySelector('[data-browse-preview]')?.getClientRects().length)
  /** The film in the pane, and every film in the window that is playing. */
  const films = () =>
    win.evaluate(() => {
      const name = (v) => /[^\\/]*$/.exec(decodeURIComponent(v.currentSrc || v.src || ''))?.[0] ?? ''
      const pane = document.querySelector('[data-browse-preview] video')
      return {
        pane: pane ? name(pane) : null,
        playing: [...document.querySelectorAll('video,audio')].filter((v) => !v.paused).map(name)
      }
    })
  const exMarked = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('[data-testid="browse-list"] [data-browse-path][aria-selected="true"]')].map(
        (r) => /[^\\]*$/.exec(r.getAttribute('data-browse-path') ?? '')?.[0]
      )
    )
  const status = async () => (await win.locator('.browse-status').textContent()) ?? ''
  try {
    await win.waitForSelector('aside [data-row]', { timeout: 10000 })
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    await win.locator('[data-testid="browse-list"] [data-browse-path$="marqueequiet"]').dblclick()
    const list = win.locator('[data-testid="browse-list"]')
    const rowAt = (i) => list.locator(`[data-browse-index="${i}"]`)
    ok(
      await until(async () => (await list.locator('[data-browse-path$=".mp4"]').count()) === 4, 10000),
      'the Explorer walked into the folder of four films'
    )
    await sleep(400)
    ok(!(await paneShown()), 'nothing is previewed yet, so the pane is shut')

    /* ---------- the pane shut ---------- */
    let box = await list.boundingBox()
    let r0 = await rowAt(0).boundingBox()
    let r3 = await rowAt(3).boundingBox()
    let blank = r0.x + r0.width - 30
    await sweep({ x: box.x + box.width * 0.6, y: r3.y + r3.height + 40 }, { x: blank, y: r0.y + r0.height / 2 + 4 })
    let ex = await exMarked()
    ok(ex.sort().join() === 'v1.mp4,v2.mp4,v3.mp4,v4.mp4', `a sweep marks the four films (${ex})`)
    ok(/4 selected/.test(await status()), `and the status line counts them (${await status()})`)
    await sleep(600)
    ok(!(await paneShown()), 'a sweep leaves the shut pane shut')
    ok((await films()).playing.length === 0, `and plays nothing (${(await films()).playing})`)
    // A sweep that catches one row is still marking.
    const r1 = await rowAt(1).boundingBox()
    await sweep({ x: blank, y: r1.y + r1.height / 2 }, { x: blank - 10, y: r1.y + r1.height / 2 + 3 })
    await sleep(600)
    ok(!(await paneShown()), 'a sweep over one row leaves the pane shut too')
    await rowAt(1).click({ modifiers: ['Control'], position: { x: 30, y: r1.height / 2 } })
    await rowAt(3).click({ modifiers: ['Control'], position: { x: 30, y: r1.height / 2 } })
    await sleep(600)
    ok(!(await paneShown()), 'a Ctrl click leaves the pane shut')
    await rowAt(0).click({ modifiers: ['Shift'], position: { x: 30, y: r1.height / 2 } })
    await sleep(600)
    ex = await exMarked()
    ok(ex.length >= 2, `a Shift click marks a run (${ex})`)
    ok(!(await paneShown()), 'a Shift click leaves the pane shut')
    ok((await films()).playing.length === 0, `and nothing plays (${(await films()).playing})`)

    /* ---------- the pane open on a film ---------- */
    await rowAt(0).click({ position: { x: 30, y: r1.height / 2 } })
    ok(
      await until(async () => {
        const f = await films()
        return (await paneShown()) && f.pane === 'v1.mp4' && f.playing.includes('v1.mp4')
      }, 10000),
      'a plain click still previews the film and plays it'
    )
    // The fixture is 1.5 s long: loop it, so a film still playing after the
    // marks below was not paused by them (a pause stops a looping film too).
    await win.evaluate(() => document.querySelectorAll('[data-browse-preview] video').forEach((v) => { v.loop = true; void v.play() }))
    await sleep(500)
    // The pane took room from the list: measure again.
    box = await list.boundingBox()
    r0 = await rowAt(0).boundingBox()
    r3 = await rowAt(3).boundingBox()
    blank = r0.x + r0.width - 30
    await sweep({ x: box.x + box.width * 0.6, y: r3.y + r3.height + 40 }, { x: blank, y: (await rowAt(1).boundingBox()).y + 4 })
    await sleep(600)
    let f = await films()
    ex = await exMarked()
    ok(ex.sort().join() === 'v2.mp4,v3.mp4,v4.mp4', `a sweep marks three films (${ex})`)
    ok(/3 selected/.test(await status()), 'and the status line counts them')
    ok(f.pane === 'v1.mp4', `the pane still shows what it showed (${f.pane})`)
    ok(f.playing.join() === 'v1.mp4', `its film plays on and nothing else starts (${f.playing})`)
    await rowAt(1).click({ modifiers: ['Control'], position: { x: 30, y: r1.height / 2 } })
    await sleep(600)
    f = await films()
    ok(f.pane === 'v1.mp4' && f.playing.join() === 'v1.mp4', `a Ctrl click changes neither (${f.pane}, ${f.playing})`)
    await rowAt(2).click({ modifiers: ['Shift'], position: { x: 30, y: r1.height / 2 } })
    await sleep(600)
    f = await films()
    ok(f.pane === 'v1.mp4' && f.playing.join() === 'v1.mp4', `a Shift click changes neither (${f.pane}, ${f.playing})`)
    ok((await exMarked()).length >= 2, 'and the marks are lit')
    // The arrows are a plain pick: they preview, as before.
    await win.keyboard.press('ArrowDown')
    ok(
      await until(async () => (await films()).pane === 'v4.mp4', 10000),
      `the arrow keys still preview (${(await films()).pane})`
    )
    await rowAt(1).click({ position: { x: 30, y: r1.height / 2 } })
    ok(
      await until(async () => {
        const g = await films()
        return g.pane === 'v2.mp4' && g.playing.includes('v2.mp4')
      }, 10000),
      'and a plain click previews and plays the film clicked'
    )
    // A click on the list's EMPTY space clears the pick and leaves the film
    // alone (owner, 2026-10-03: "i can pause a video by clicking empty space in
    // the file list, i should have to click the video or the pause icon").
    const space = await list.boundingBox()
    await win.mouse.click(space.x + space.width / 2, space.y + space.height - 12)
    await sleep(600)
    f = await films()
    ok(f.pane === 'v2.mp4' && f.playing.includes('v2.mp4'), `a click on empty space keeps the film playing (${f.pane}, ${f.playing})`)
    ok((await exMarked()).length === 0, 'and clears the pick')
    await win.evaluate(() => document.querySelectorAll('video,audio').forEach((v) => v.pause()))
  } finally {
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * TWO HIGHLIGHTS FROM ONE ACCENT (owner, 2026-10-03, with a screenshot of an
 * opaque grey slab in the Explorer: "i want more saturated" for the settings
 * page that is chosen, and "more transparent like selecting files in file
 * explorer" for files). A marked file row is a light accent TINT with a faint
 * edge and keeps its own text colours, in the Explorer and the tree, on a dark
 * style and a light one; the Settings rail's chosen page is the accent SOLID
 * even with the accent's alpha turned down. Measured off computed styles.
 */
async function markTintScenario(fixtures) {
  console.log('marked rows are a tint, the chosen page is solid')
  const dir = join(fixtures, 'marktint')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const n of ['m1.txt', 'm2.txt', 'm3.txt', 'm4.txt', 'm5.txt', 'm6.txt']) writeFileSync(join(dir, n), `tint ${n}\n`)
  const { app, win } = await launch(join(dir, 'm1.txt'))
  let styleBefore
  let draftBefore = null
  const alphaOf = (c) => {
    const n = (c.match(/[\d.]+/g) ?? []).map(Number)
    return n.length > 3 ? n[3] : 1
  }
  const token = (name) =>
    win.evaluate((n) => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = `var(${n})`
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).backgroundColor
      probe.remove()
      return c
    }, name)
  /** The marked Explorer row against a plain one: fill, edge and inks. */
  const explorerLook = () =>
    win.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path]')]
      const sel = rows.find((r) => r.hasAttribute('data-selected') && !r.hasAttribute('data-menu'))
      const plain = rows.find((r) => !r.hasAttribute('data-selected') && !r.hasAttribute('data-menu'))
      if (!sel || !plain) return null
      const ink = (r, s) => getComputedStyle(r.querySelector(s)).color
      return {
        bg: getComputedStyle(sel).backgroundColor,
        shadow: getComputedStyle(sel).boxShadow,
        name: [ink(sel, '.browse-name'), ink(plain, '.browse-name')],
        size: [ink(sel, '.browse-column-size'), ink(plain, '.browse-column-size')],
        type: [ink(sel, '.browse-column-type'), ink(plain, '.browse-column-type')]
      }
    })
  const checkExplorer = async (label) => {
    const look = await explorerLook()
    ok(look !== null, `${label}: a marked row and a plain one are on screen`)
    if (!look) return
    const a = alphaOf(look.bg)
    ok(a >= 0.18 && a <= 0.25, `${label}: the marked row is a light tint (${look.bg})`)
    ok(look.shadow !== 'none' && /inset/.test(look.shadow), `${label}: with a faint edge (${look.shadow.slice(0, 60)})`)
    ok(look.name[0] === look.name[1], `${label}: its name keeps the plain row's colour (${look.name.join(' / ')})`)
    ok(look.size[0] === look.size[1] && look.type[0] === look.type[1], `${label}: and so do its quiet columns (${look.size.join(' / ')})`)
  }
  try {
    draftBefore = await win.evaluate(() => localStorage.getItem('prism.style.draft'))
    styleBefore = await switchStyle(win, 'aurora')
    await sleep(400)

    /* ---------- the tree ---------- */
    await win.waitForSelector('aside [data-row]', { timeout: 10000 })
    const treeRow = win.locator('aside [data-row]').nth(2)
    await treeRow.click()
    // Away from the rows: a hovered row wears the hover ink.
    await win.mouse.move(5, 5)
    await sleep(300)
    const tree = await win.evaluate(() => {
      const rows = [...document.querySelectorAll('aside [data-row]')]
      const sel = rows.find((r) => r.hasAttribute('data-selected'))
      const plain = rows.find((r) => !r.hasAttribute('data-selected'))
      return sel && plain
        ? { bg: getComputedStyle(sel).backgroundColor, ink: [getComputedStyle(sel).color, getComputedStyle(plain).color] }
        : null
    })
    ok(tree !== null, 'the tree has a marked row and a plain one')
    if (tree) {
      const a = alphaOf(tree.bg)
      ok(a >= 0.18 && a <= 0.25, `a marked tree row is a light tint too (${tree.bg})`)
      ok(tree.ink[0] === tree.ink[1], `and keeps the plain row's text colour (${tree.ink.join(' / ')})`)
    }
    await win.screenshot({ path: join(SHOTS, 'marktint-tree-dark.png') })

    /* ---------- the Explorer, dark ---------- */
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    await win.locator('[data-testid="browse-list"] [data-browse-path$="marktint"]').dblclick()
    ok(
      await until(async () => (await win.locator('[data-testid="browse-list"] [data-browse-path$=".txt"]').count()) === 6, 10000),
      'the Explorer walked into the folder of six'
    )
    await sleep(300)
    const list = win.locator('[data-testid="browse-list"]')
    await list.locator('[data-browse-index="1"] .browse-name-text').click()
    await list.locator('[data-browse-index="2"] .browse-name-text').click({ modifiers: ['Control'] })
    await win.mouse.move(5, 5)
    await sleep(300)
    await checkExplorer('dark')
    // NO STRIPES (owner, 2026-10-03: "try no alternating row bg for
    // explorer"): every unmarked row is the plain ground, odd and even alike.
    const grounds = await win.evaluate(() =>
      [...document.querySelectorAll('[data-testid="browse-list"] .browse-row')]
        .filter((r) => !r.hasAttribute('data-selected') && !r.hasAttribute('data-menu'))
        .map((r) => getComputedStyle(r).backgroundColor)
    )
    ok(grounds.length >= 4, `there are plain rows to compare (${grounds.length})`)
    ok(
      grounds.every((g) => alphaOf(g) === 0 || g === 'transparent'),
      `no Explorer row carries a stripe (${[...new Set(grounds)].join(' / ')})`
    )
    // THE EDGE IS SOFTER (same day: "the border i think contrast is slightly
    // too much"): it was the accent at 0.5, it is a hint now.
    const lineA = alphaOf(await token('--p-sel-line'))
    ok(lineA > 0.2 && lineA < 0.32, `the marked block's edge is a hint, alpha ${lineA} where it was 0.5`)
    // Two marked neighbours are one block: no edge between them.
    const join2 = await win.evaluate(() => {
      const r = (i) => document.querySelector(`[data-testid="browse-list"] [data-browse-index="${i}"]`)
      return { first: r(1)?.hasAttribute('data-join-down'), second: r(2)?.hasAttribute('data-join-up'), shadow: r(2) ? getComputedStyle(r(2)).boxShadow : '' }
    })
    ok(join2.first && join2.second, 'two marked neighbours join into one block')
    ok((join2.shadow.match(/inset/g) ?? []).length === 3, `and the second draws its sides and foot, no edge along the first (${join2.shadow})`)
    await win.screenshot({ path: join(SHOTS, 'marktint-explorer-dark.png') })

    /* ---------- the Explorer, light ---------- */
    await switchStyle(win, 'paper')
    ok(await until(() => win.evaluate(() => document.documentElement.dataset.mode === 'light')), 'in a light style (Paper)')
    await sleep(400)
    await checkExplorer('light')
    await win.screenshot({ path: join(SHOTS, 'marktint-explorer-light.png') })
    await switchStyle(win, 'aurora')
    await sleep(400)

    /* ---------- the Settings rail, accent alpha below 1 ---------- */
    await win.evaluate((d) => {
      const v = { ...JSON.parse(d ?? '{}'), accentAlpha: 0.4 }
      localStorage.setItem('prism.style.draft', JSON.stringify(v))
      window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
    }, draftBefore)
    await sleep(300)
    ok(alphaOf(await token('--p-sel-bg')) < 1, `the accent's alpha is down: its fills are see-through (${await token('--p-sel-bg')})`)
    // THE CHOSEN SETTINGS PAGE IS A GREY FILL (#292; owner, 2026-10-05: no
    // accent bar on the chosen rail item): `--p-hover-hi`, whatever the
    // accent or its alpha, never the accent.
    const rail = win.locator('[data-settings-tab="appearance"]')
    await settingsPage(win, 'appearance')
    await win.mouse.move(5, 5)
    await sleep(300)
    const railBg = await rail.evaluate((el) => getComputedStyle(el).backgroundColor)
    const grey = await token('--p-hover-hi')
    const solid = await token('--p-accent-solid')
    ok((await rail.getAttribute('aria-current')) === 'page', 'the chosen Settings page says so')
    ok(railBg === grey, `and wears the grey fill (${railBg} and ${grey})`)
    ok(railBg !== solid && railBg !== (await token('--p-accent')), `not the accent (${railBg}, accent ${solid})`)
    await win.screenshot({ path: join(SHOTS, 'marktint-settings-rail.png') })
    // Explorer marks still a tint at this alpha, the same one.
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await sleep(400)
    await checkExplorer('accent alpha 40%')
    // THE SELECTION IS ITS OWN COLOUR (owner, 2026-10-03: "the settings accent
    // colour for the tab should be separated from the explorer accent colour").
    // A green Selection at 22% tints the marks; the rail keeps the accent.
    await win.evaluate((d) => {
      const v = { ...JSON.parse(d ?? '{}'), accentAlpha: 0.4, selection: '#2ecc7138' }
      localStorage.setItem('prism.style.draft', JSON.stringify(v))
      window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
    }, draftBefore)
    await sleep(300)
    const green = await explorerLook()
    ok(green !== null && /^rgba\(46, 204, 113, 0\.2\d*\)$/.test(green.bg), `a picked Selection is the marked row's tint (${green?.bg})`)
    ok(green !== null && green.name[0] === green.name[1], 'and the row keeps its own text colour')
    ok((await token('--p-accent-solid')) === solid, `the accent is untouched (${await token('--p-accent-solid')})`)
    await win.screenshot({ path: join(SHOTS, 'marktint-selection-picked.png') })
    // Quick access's "you are here" wears the selection's tint (owner,
    // 2026-10-03: "i want that colour for the sidebar on the explorer page too").
    // Walking into a place is only a listing: nothing there is touched.
    await win.locator('.folder-browser .browse-place').first().click()
    await win.mouse.move(5, 5)
    const placeOn = await until(async () => (await win.locator('.folder-browser .browse-place[aria-current]').count()) > 0, 8000)
    ok(placeOn, 'a Quick access place is the current one')
    if (placeOn) {
      await sleep(300)
      const place = await win.locator('.folder-browser .browse-place[aria-current]').first().evaluate((el) => {
        const cs = getComputedStyle(el)
        return { bg: cs.backgroundColor, ink: cs.color, plain: getComputedStyle(document.querySelector('.folder-browser .browse-place:not([aria-current])')).color }
      })
      const a = Number((/rgba\([^)]*,\s*([0-9.]+)\)/.exec(place.bg) ?? [])[1] ?? 1)
      ok(a > 0.1 && a < 0.4, `the Explorer's current place is the selection tint, not a solid block (${place.bg})`)
      ok(/^rgba\(46, 204, 113,/.test(place.bg), `in the picked Selection colour (${place.bg})`)
      ok(place.ink !== place.plain || place.ink.length > 0, `and its text keeps a text colour (${place.ink})`)
    }
    // The Settings rail keeps its grey, as before the pick.
    await settingsPage(win, 'appearance')
    await win.mouse.move(5, 5)
    await sleep(300)
    const railAfter = await rail.evaluate((el) => getComputedStyle(el).backgroundColor)
    ok(railAfter === railBg, `the Settings rail keeps its grey (${railAfter}, was ${railBg})`)
  } finally {
    await win
      .evaluate((d) => {
        if (d === null) localStorage.removeItem('prism.style.draft')
        else localStorage.setItem('prism.style.draft', d)
        window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
      }, draftBefore)
      .catch(() => {})
    if (styleBefore !== undefined) await switchStyle(win, styleBefore).catch(() => {})
    await app.close().catch(() => {})
  }

  /* ---------- a zip's list is a file selection too ---------- */
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  for (const n of ['z1.txt', 'z2.txt', 'z3.txt', 'z4.txt']) zip.addFile(n, Buffer.from(`zip ${n}`))
  zip.writeZip(join(dir, 'tint.zip'))
  const z = await launch(join(dir, 'tint.zip'))
  try {
    await switchStyle(z.win, 'aurora')
    // Inside a zip the rows are the Explorer's own (#300).
    await inZip(z.win, join(dir, 'tint.zip'))
    const zr = (n) => z.win.locator(`[data-testid="browse-list"] [data-browse-path$="${n}"]`)
    await zr('z1.txt').click()
    await zr('z2.txt').click({ modifiers: ['Control'] })
    await z.win.mouse.move(5, 5)
    await sleep(300)
    const arc = await z.win.evaluate(() => {
      const r = (n) => document.querySelector(`[data-testid="browse-list"] [data-browse-path$="${n}"]`)
      const name = (el) => getComputedStyle(el.querySelector('.browse-name-text')).color
      return {
        bg: getComputedStyle(r('z1.txt')).backgroundColor,
        names: [name(r('z1.txt')), name(r('z3.txt'))],
        joined: getComputedStyle(r('z2.txt')).boxShadow
      }
    })
    const a = alphaOf(arc.bg)
    ok(a >= 0.18 && a <= 0.25, `a marked row in a zip is the same light tint (${arc.bg})`)
    ok(arc.names[0] === arc.names[1], `and keeps the plain row's name colour (${arc.names.join(' / ')})`)
    ok((arc.joined.match(/inset/g) ?? []).length === 3, `two marked neighbours in a zip are one block (${arc.joined})`)
    await z.win.screenshot({ path: join(SHOTS, 'marktint-archive-dark.png') })
  } finally {
    if (styleBefore !== undefined) await switchStyle(z.win, styleBefore).catch(() => {})
    await z.app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * EXPLORER SIZE (owner, 2026-10-03: "size options for explorer in the
 * appearance menu, let the current be medium the old be big, and make a
 * slightly smaller version too"). Settings > Style > Explorer size, Small /
 * Medium / Large: 22, 26 and 40px rows with their text and icon, picked the way
 * a user picks, measured off the rows, and remembered across a restart. The
 * tree keeps its own size.
 */
/**
 * THE FILE LIST'S SCROLLBAR (#267; owner, 2026-10-04: "its visibility is
 * buggy ... it disappears too abruptly, it should fade quickly but not
 * instantly"). Prism draws its own over the list: hidden at rest, shown while
 * the list scrolls, gone again once it has been still a moment, and it FADES
 * (an opacity transition), where the native one was simply cut.
 */
async function listScrollbarScenario(fixtures) {
  console.log('the file list scrollbar')
  const dir = join(fixtures, 'scrollbar')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 80; i++) writeFileSync(join(dir, `s${String(i).padStart(2, '0')}.txt`), 'x\n')
  const { app, win } = await launch(join(dir, 's00.txt'))
  try {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await win.locator('[data-testid="browse-list"] [data-browse-path$="s00.txt"]').count()) === 0)
      await win.locator('[data-testid="browse-list"] [data-browse-path$="scrollbar"]').dblclick()
    ok(await until(async () => (await win.locator('[data-testid="browse-list"] [data-browse-path$="s00.txt"]').count()) === 1, 10000), 'the Explorer shows the folder of 80')
    const bar = '.folder-browser .browse-overlay-scroll'
    const look = () =>
      win.evaluate((s) => {
        const el = document.querySelector(s)
        const list = document.querySelector('[data-testid="browse-list"]')
        if (!el || !list) return null
        const cs = getComputedStyle(el)
        return { shown: el.hasAttribute('data-shown'), opacity: Number(cs.opacity), fade: cs.transitionDuration, native: getComputedStyle(list).scrollbarWidth }
      }, bar)
    await win.mouse.move(5, 5)
    await sleep(1500)
    let l = await look()
    ok(!!l && !l.shown && l.opacity === 0, `at rest the scrollbar is hidden (${JSON.stringify(l)})`)
    ok(l?.native === 'none', `and the native one is never drawn (${l?.native})`)
    await win.evaluate(() => { document.querySelector('[data-testid="browse-list"]').scrollTop = 400 })
    ok(await until(async () => (await look())?.shown === true, 2000, 25), 'scrolling shows it')
    l = await look()
    ok(/ms|s/.test(l.fade) && l.fade !== '0s', `and it fades in rather than popping (${l.fade})`)
    ok(await until(async () => (await look())?.shown === false, 3000, 50), 'still a moment, it hides again')
    l = await look()
    ok(l.fade !== '0s', `and fades out rather than being cut (${l.fade})`)
    // The pointer over the list keeps it up; leaving lets it go.
    const box = await win.locator('[data-testid="browse-list"]').boundingBox()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    ok(await until(async () => (await look())?.shown === true, 2000, 25), 'the pointer over the list shows it')
    await sleep(1500)
    ok((await look())?.shown === true, 'and keeps it while the pointer stays')
    await win.mouse.move(5, 5)
    ok(await until(async () => (await look())?.shown === false, 3000, 50), 'leaving the list lets it go')
  } finally {
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/** What a This PC row shows (#296), whatever its Drive style: its style, its
 *  warning, the glyph and badge, the name, the free words, and the used share
 *  as each style draws it (the bar's width, the ring's arc, the lit steps). */
const driveLookAt = (win, path) =>
  win.evaluate((p) => {
    const el = [...document.querySelectorAll('.folder-browser .browse-places .browse-drive')].find((b) => b.getAttribute('title') === p)
    if (!el) return null
    const q = (s) => el.querySelector(s)
    const box = (s) => q(s)?.getBoundingClientRect()
    const style = ['tiles', 'ring', 'gauge'].find((s) => el.classList.contains(`browse-drive-${s}`)) ?? null
    const out = {
      style,
      warn: el.hasAttribute('data-warn'),
      glyph: q('[data-drive-glyph]')?.getAttribute('data-drive-glyph') ?? null,
      icon: q('[data-place-icon]')?.getAttribute('data-place-icon') ?? null,
      badge: !!q('[data-windows-badge]'),
      chip: !!q('.browse-drive-chip'),
      name: q('.browse-drive-name')?.textContent ?? '',
      free: q('.browse-drive-free')?.textContent ?? '',
      pct: q('.browse-drive-pct')?.textContent ?? null,
      height: el.getBoundingClientRect().height,
      font: parseFloat(getComputedStyle(el).fontSize),
      chipW: box('.browse-drive-chip')?.width ?? null,
      bar: !!q('.browse-drive-bar'),
      ring: !!q('.browse-drive-donut'),
      seg: q('.browse-drive-seg') ? q('.browse-drive-seg').children.length : 0,
      fraction: null,
      fill: null,
      ink: null
    }
    if (style === 'tiles' && q('.browse-drive-bar > i')) {
      out.fraction = box('.browse-drive-bar > i').width / box('.browse-drive-bar').width
      out.barH = box('.browse-drive-bar').height
      out.fill = getComputedStyle(q('.browse-drive-bar > i')).backgroundColor
      out.ink = getComputedStyle(q('.browse-drive-pct')).color
    } else if (style === 'ring' && q('.browse-drive-ring-used')) {
      const dash = parseFloat(q('.browse-drive-ring-used').getAttribute('stroke-dasharray'))
      out.fraction = dash / (2 * Math.PI * 10)
      out.fill = getComputedStyle(q('.browse-drive-ring-used')).stroke
      out.ink = getComputedStyle(q('.browse-drive-pct')).color
    } else if (style === 'gauge' && q('.browse-drive-seg')) {
      out.lit = el.querySelectorAll('.browse-drive-seg > i[data-on]').length
      out.fraction = out.lit / 20
      out.nums = [q('.browse-drive-nums > :first-child')?.textContent, q('.browse-drive-total')?.textContent]
      const on = q('.browse-drive-seg > i[data-on]')
      out.fill = on ? getComputedStyle(on).backgroundColor : null
      out.ink = getComputedStyle(q('.browse-drive-nums em')).color
    }
    return out
  }, path)

/** A CSS colour as the page resolves it, for comparing with a computed one. */
const cssColour = (win, value) =>
  win.evaluate((v) => {
    const probe = document.createElement('i')
    probe.style.color = v
    document.body.append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, value)

/**
 * A FRAME RECORDER for a look that must never flash (#296; owner, 2026-10-06:
 * "when you right click multiple times the highlight goes from the one you
 * right clicked -> the actually selected folder -> the new one you right
 * clicked"). Each element is tagged by name, and every animation frame until
 * `stopFrames` the page writes down what each one paints. A frame is what the
 * eye can see, so a state that lasts no frame is no flash.
 */
const watchAs = (loc, name) => loc.evaluate((e, n) => e.setAttribute('data-e2e-watch', n), name)
const startFrames = (win) =>
  win.evaluate(() => {
    const w = window
    w.__frames = []
    w.__framesOn = true
    const tick = () => {
      if (!w.__framesOn) return
      const f = {}
      for (const e of document.querySelectorAll('[data-e2e-watch]'))
        f[e.getAttribute('data-e2e-watch')] = getComputedStyle(e).backgroundColor
      w.__frames.push(f)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
const stopFrames = (win) =>
  win.evaluate(() => {
    window.__framesOn = false
    for (const e of document.querySelectorAll('[data-e2e-watch]')) e.removeAttribute('data-e2e-watch')
    return window.__frames
  })
/** A right-click as a hand makes one: the button held a moment, so the
 *  frames between the press and the release (where Windows sends the
 *  contextmenu) are there to be seen. It lands near the row's left end: the
 *  open menu starts where the last right-click was, mid-row, and may cover
 *  the middle of the rows below. */
const slowRightClick = async (win, loc) => {
  const b = await loc.boundingBox()
  await win.mouse.move(b.x + Math.min(24, b.width / 4), b.y + b.height / 2)
  await win.mouse.down({ button: 'right' })
  await sleep(150)
  await win.mouse.up({ button: 'right' })
}
/** Frames where A and B are not exactly one lit (in `tint`), or A is lit
 *  again after B was: the highlight must go straight from A to B. */
const flashFrames = (frames, tint) => {
  let seenB = false
  const bad = []
  frames.forEach((f, i) => {
    const a = f.a === tint
    const b = f.b === tint
    if (a === b || (seenB && a)) bad.push(i)
    if (b) seenB = true
  })
  return { bad, seenB }
}

/** How full a drive really is, by Node's own statfs; null when it will not say. */
function usedShare(root) {
  try {
    const fs = statfsSync(root)
    return fs.blocks > 0 ? (fs.blocks - fs.bavail) / fs.blocks : null
  } catch {
    return null
  }
}

/** Whether a drive style's drawing of a share matches the real one. The
 *  Gauge lights whole twentieths, at least one for anything in use. */
function drawsShare(look, want) {
  if (look?.fraction == null || want == null) return false
  if (look.style === 'gauge') return look.lit === (want > 0 ? Math.max(1, Math.round(want * 20)) : 0) || Math.abs(look.lit - want * 20) <= 0.51
  return Math.abs(look.fraction - want) < 0.01
}

const DRIVE_STYLE_NAMES = { tiles: 'Tiles', ring: 'Ring', gauge: 'Gauge' }

/**
 * A RIGHT-CLICK SELECTS, AS FILE EXPLORER DOES (#296; owner, 2026-10-06: "when
 * you right click something in the main view it gets highlighted, but not in
 * the sidebar ... and it gets highlighted grey ... i see file explorer uses the
 * same highlight if you select a file with left or rightclick. we should
 * probably do the same"). Measured off computed backgrounds: a right-click on
 * an unmarked file makes it THE selection, in exactly a left click's tint, and
 * the old selection goes; one inside a multi-selection keeps all of it. A
 * place (a pin, a drive in each of its three styles) and a project tree row
 * wear the same tint while their menu is open and lose it when it shuts.
 * Screenshots of each on a dark and a light style.
 */
async function rightClickSelectScenario(fixtures) {
  console.log('right-click selects')
  const dir = join(fixtures, 'rclick')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'sub', 'deeper'), { recursive: true })
  writeFileSync(join(dir, 'sub', 'deeper', 'x.txt'), 'x\n')
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) writeFileSync(join(dir, name), `${name}\n`)
  const { app, win } = await launch(join(dir, 'a.txt'))
  const list = win.locator('[data-testid="browse-list"]')
  const row = (name) => list.locator(`[data-browse-path$="\\\\${name}" i]`).first()
  const places = win.locator('.folder-browser .browse-places')
  const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
  const marked = () =>
    list.locator('.browse-row[data-selected]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-browse-path').split('\\').pop()).sort()
    )
  const menuOpen = async () => (await win.locator('[role="menu"]').count()) > 0
  // The pointer off every row, so a hover's fill is never read as a mark.
  const away = async () => {
    const size = await win.evaluate(() => [innerWidth, innerHeight])
    await win.mouse.move(size[0] / 2, size[1] - 2)
    await sleep(250)
  }
  const shut = async () => {
    await win.keyboard.press('Escape')
    await until(async () => !(await menuOpen()), 3000)
    await away()
  }
  let styleBefore = null
  try {
    // 0. THE PROJECT TREE: a right-clicked row wears the selection tint while
    // its menu is open, not the grey.
    const treeRow = win.locator('[data-row$="\\\\b.txt" i]').first()
    if (await until(async () => (await treeRow.count()) === 1, 8000)) {
      const tint = await cssColour(win, 'var(--p-sel-tint)')
      await away()
      const before = await bg(treeRow)
      await treeRow.click({ button: 'right' })
      ok(await until(menuOpen, 3000), 'a tree row answers a right-click with its menu')
      await sleep(250)
      const during = await bg(treeRow)
      ok(during === tint, `the right-clicked tree row wears the selection tint (${during}, tint ${tint})`)
      await win.screenshot({ path: join(SHOTS, 'rightclick-tree.png') })
      // A second right-click, on c.txt while b.txt's menu is open: the tint
      // goes straight from one to the other, no frame with neither lit.
      const treeC = win.locator('[data-row$="\\\\c.txt" i]').first()
      await watchAs(treeRow, 'a')
      await watchAs(treeC, 'b')
      await startFrames(win)
      await slowRightClick(win, treeC)
      ok(await until(menuOpen, 3000), 'c.txt answers the second right-click with its menu')
      await sleep(200)
      const treeFrames = await stopFrames(win)
      const treeFlash = flashFrames(treeFrames, tint)
      ok(treeFrames.length >= 5 && treeFlash.seenB && treeFlash.bad.length === 0, `the tree's tint goes straight from b.txt to c.txt (${treeFrames.length} frames, bad ${JSON.stringify(treeFlash.bad.slice(0, 5).map((i) => treeFrames[i]))})`)
      await shut()
      ok((await bg(treeRow)) === before, `and loses it when the menu shuts (${await bg(treeRow)}, was ${before})`)
    } else ok(false, 'the project tree lists b.txt')

    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await row('b.txt').count()) === 0) await row('rclick').dblclick()
    ok(await until(async () => (await row('b.txt').count()) === 1, 10000), 'the Explorer shows the fixture folder')
    // A pinned folder with a folder in it, for the one-mark checks (3).
    await row('sub').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    const subPin = places.locator('section[aria-label="Pinned"] .quick-access-pin[data-quick-access-path$="\\\\sub" i]')
    ok(await until(async () => (await subPin.count()) === 1, 5000), 'sub is pinned')
    await shut().catch(() => {})
    const goByAddress = async (path, landed) => {
      const pathBox = win.locator('.folder-browser [data-testid="browse-toolbar"] nav.browse-path')
      const box = await pathBox.boundingBox()
      await pathBox.click({ position: { x: Math.round(box.width) - 12, y: Math.round(box.height / 2) } })
      const editing = win.locator('.folder-browser input[aria-label="Folder path"]')
      await until(async () => (await editing.count()) === 1, 5000)
      await editing.fill(path)
      await editing.press('Enter')
      ok(await until(async () => (await row(landed).count()) === 1, 10000), `the address field goes to ${path}`)
      await away()
    }
    const currentRows = () =>
      places.locator('.browse-place[aria-current]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-quick-access-path') ?? e.getAttribute('title'))
      )
    const subPath = join(dir, 'sub')

    for (const [style, mode] of [['aurora', 'dark'], ['paper', 'light']]) {
      const was = await switchStyle(win, style, mode)
      styleBefore ??= was
      await sleep(500)
      const tint = await cssColour(win, 'var(--p-sel-tint)')

      // 1. THE LIST. A left click's look, measured on a.txt.
      await row('a.txt').click()
      ok(await until(async () => JSON.stringify(await marked()) === '["a.txt"]', 3000), `${style}: a click selects a.txt`)
      await sleep(300)
      const leftLook = await bg(row('a.txt'))
      const plain = await bg(row('c.txt'))
      ok(leftLook !== plain, `${style}: a selected row is not a plain one (${leftLook}, ${plain})`)
      // A right-click on unmarked b.txt: b.txt IS the selection now, a.txt not.
      await row('b.txt').click({ button: 'right' })
      ok(await until(menuOpen, 3000), `${style}: b.txt's menu opens`)
      await sleep(300)
      ok(JSON.stringify(await marked()) === '["b.txt"]', `${style}: the right-click made b.txt the selection (${await marked()})`)
      const rightLook = await bg(row('b.txt'))
      ok(rightLook === leftLook, `${style}: in a left click's look, not grey (${rightLook}, left ${leftLook})`)
      ok((await bg(row('a.txt'))) === plain, `${style}: and a.txt went back to plain`)
      ok((await row('b.txt').getAttribute('data-menu')) === null, `${style}: there is no second, grey mark`)
      await win.screenshot({ path: join(SHOTS, `rightclick-list-${style}.png`) })
      await shut()
      ok(JSON.stringify(await marked()) === '["b.txt"]', `${style}: it stays selected after the menu shuts`)
      // Inside a multi-selection: all of it stays.
      await row('d.txt').click({ modifiers: ['Control'] })
      ok(await until(async () => JSON.stringify(await marked()) === '["b.txt","d.txt"]', 3000), `${style}: Ctrl adds d.txt`)
      await row('d.txt').click({ button: 'right' })
      const multi = await win.locator('[role="menu"]').last().textContent({ timeout: 3000 }).catch(() => '')
      ok(/2 items/.test(multi), `${style}: a right-click inside the two acts on both (${multi})`)
      ok(JSON.stringify(await marked()) === '["b.txt","d.txt"]', `${style}: and keeps both marked (${await marked()})`)
      await shut()

      // 2. THE PLACES. A Quick access pin.
      const pin = places.locator('section[aria-label="Quick access"] .quick-access-pin').first()
      await away()
      const pinBefore = await bg(pin)
      await pin.click({ button: 'right' })
      ok(await until(menuOpen, 3000), `${style}: a pin's menu opens`)
      await sleep(300)
      ok((await bg(pin)) === tint, `${style}: the right-clicked pin wears the selection tint (${await bg(pin)}, tint ${tint})`)
      await win.screenshot({ path: join(SHOTS, `rightclick-place-${style}.png`) })
      await shut()
      ok((await bg(pin)) === pinBefore, `${style}: and loses it when the menu shuts (${await bg(pin)}, was ${pinBefore})`)

      // A drive, in each of its three styles.
      const c = places.locator('section[aria-label="This PC"] .browse-drive').first()
      for (const id of ['tiles', 'ring', 'gauge']) {
        await pickStyleSegment(win, 'drive-style', DRIVE_STYLE_NAMES[id])
        await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
        await places.waitFor({ timeout: 10000 })
        await until(async () => (await places.locator('section[aria-label="This PC"]').getAttribute('data-drive-style')) === id, 5000)
        await sleep(350)
        await away()
        const driveBefore = await bg(c)
        await c.click({ button: 'right' })
        ok(await until(menuOpen, 3000), `${style} ${id}: a drive's menu opens`)
        await sleep(300)
        const on = await bg(c)
        ok(on === tint, `${style} ${id}: the right-clicked drive wears the selection tint (${on}, tint ${tint}, was ${driveBefore})`)
        const box = await places.boundingBox()
        await win.screenshot({ path: join(SHOTS, `rightclick-drive-${id}-${style}.png`), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 640) } })
        await shut()
        ok((await bg(c)) === driveBefore, `${style} ${id}: and loses it when the menu shuts (${await bg(c)}, was ${driveBefore})`)
      }
      await pickStyleSegment(win, 'drive-style', 'Tiles')
      await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
      await places.waitFor({ timeout: 10000 })

      // 3. ONE MARK, AND IT DIMS WHERE THE USER IS NOT (#296; owner,
      // 2026-10-06: "right now both are equally highlighted which makes it
      // seem like the right click action is targeting both", and of File
      // Explorer: "the sidebar item gets fully highlighted when you click it
      // but as soon as you click something in the main view after that it
      // gets dimmed, still highlighted but dimmed").
      const tintDim = await cssColour(win, 'var(--p-sel-tint-dim)')
      ok(tintDim !== tint && !/rgba\(0, 0, 0, 0\)/.test(tintDim), `${style}: there is a dimmed mark apart from the tint (${tintDim}, ${tint})`)
      const lit = () =>
        places.locator('.browse-place').evaluateAll(
          (els, marks) =>
            els
              .filter((e) => marks.includes(getComputedStyle(e).backgroundColor))
              .map((e) => e.getAttribute('data-quick-access-path') ?? e.getAttribute('title')),
          [tint, tintDim]
        )
      // A Tiles drive: full when clicked, dimmed after a click in the list,
      // and the dimmed mark is not the tile's own fill.
      const cTile = places.locator('section[aria-label="This PC"] .browse-drive[title="C:\\\\"]')
      await away()
      const tilePlain = await bg(cTile)
      await cTile.click()
      ok(await until(async () => (await cTile.getAttribute('aria-current')) === 'location', 8000), `${style}: a click on C: opens it`)
      await away()
      ok((await bg(cTile)) === tint, `${style}: the clicked drive tile is full (${await bg(cTile)}, tint ${tint})`)
      // Under another place's menu the tile is dimmed, not its plain fill.
      const firstPin = places.locator('section[aria-label="Quick access"] .quick-access-pin').first()
      await firstPin.click({ button: 'right' })
      ok(await until(menuOpen, 3000), `${style}: a pin's menu opens over a marked drive`)
      await sleep(250)
      ok((await bg(cTile)) === tintDim && (await bg(firstPin)) === tint, `${style}: the marked tile is dimmed under it (${await bg(cTile)}, dim ${tintDim}), the pin full`)
      const tbox = await places.boundingBox()
      await win.screenshot({ path: join(SHOTS, `place-mark-tile-menu-${style}.png`), clip: { x: tbox.x, y: tbox.y, width: tbox.width, height: Math.min(tbox.height, 640) } })
      await shut()
      ok((await bg(cTile)) === tint, `${style}: and full again when it shuts (${await bg(cTile)})`)
      await list.locator('.browse-row').first().click()
      await away()
      const tileDim = await bg(cTile)
      ok(tileDim === tintDim && tileDim !== tilePlain, `${style}: after a click in the list the tile is dimmed, not plain (${tileDim}, dim ${tintDim}, plain ${tilePlain})`)
      const pbox = await places.boundingBox()
      await win.screenshot({ path: join(SHOTS, `place-mark-tile-dim-${style}.png`), clip: { x: pbox.x, y: pbox.y, width: pbox.width, height: Math.min(pbox.height, 640) } })

      // A pinned folder: full on the click, dimmed after one in the list.
      await subPin.click()
      ok(await until(async () => (await row('deeper').count()) === 1, 8000), `${style}: a click on the pinned sub opens it`)
      await away()
      const subPinPath = await subPin.getAttribute('data-quick-access-path')
      ok(JSON.stringify(await currentRows()) === JSON.stringify([subPinPath]), `${style}: one place is current, the pin (${await currentRows()})`)
      ok((await bg(subPin)) === tint, `${style}: the clicked pin is full (${await bg(subPin)})`)
      ok((await bg(cTile)) === tilePlain, `${style}: and C: is a plain tile again (${await bg(cTile)}, ${tilePlain})`)
      await row('deeper').click()
      await away()
      const dimLook = await bg(subPin)
      ok(dimLook === tintDim, `${style}: a click in the list dims the pin (${dimLook}, dim ${tintDim}, full ${tint})`)
      await win.screenshot({ path: join(SHOTS, `place-mark-dim-${style}.png`) })
      // The list's own mark dims while the sidebar is where the user acts.
      ok((await bg(row('deeper'))) === tint, `${style}: the list's selection is full while the list is active`)
      await places.locator('section[aria-label="Pinned"] h2').click()
      await away()
      ok((await bg(subPin)) === tint, `${style}: a press in the sidebar makes the pin full again (${await bg(subPin)})`)
      ok((await bg(row('deeper'))) === tintDim, `${style}: and the list's selection dimmed (${await bg(row('deeper'))})`)
      await win.screenshot({ path: join(SHOTS, `place-mark-list-dim-${style}.png`) })
      await row('deeper').click()
      await away()
      ok((await bg(row('deeper'))) === tint && (await bg(subPin)) === tintDim, `${style}: a click in the list swaps them back`)

      // (a) A right-click on another place: it wears the full tint, and the
      // marked place stays marked, DIMMED, while the menu is open (owner,
      // 2026-10-06: "think it would look better if the selected folder is
      // dimmed rather than not highlighted when you right click a different
      // folder"); its full mark is back when the menu shuts.
      const home = places.locator('section[aria-label="Quick access"] .quick-access-pin[data-known="home"]')
      const homePath = await home.getAttribute('data-quick-access-path')
      await home.click({ button: 'right' })
      ok(await until(menuOpen, 3000), `${style}: Home's menu opens`)
      await sleep(300)
      ok((await bg(home)) === tint, `${style}: the right-clicked place wears the full tint (${await bg(home)}, tint ${tint})`)
      ok((await bg(subPin)) === tintDim, `${style}: the marked place is dimmed under another place's menu (${await bg(subPin)}, dim ${tintDim})`)
      ok(JSON.stringify((await lit()).sort()) === JSON.stringify([subPinPath, homePath].sort()), `${style}: those two and no other are lit (${JSON.stringify(await lit())})`)
      ok(JSON.stringify(await currentRows()) === JSON.stringify([subPinPath]), `${style}: the pin is still the current place for a screen reader`)
      await win.screenshot({ path: join(SHOTS, `place-mark-menu-${style}.png`) })
      // (a2) Right-click a second place while Home's menu is open: the tint
      // goes straight from Home to it, and the marked place never returns to
      // full in between (owner, same message: "when you right click multiple
      // times the highlight goes from the one you right clicked -> the
      // actually selected folder -> the new one you right clicked").
      const other = places.locator('section[aria-label="Quick access"] .quick-access-pin:not([data-known="home"])').first()
      await watchAs(home, 'a')
      await watchAs(other, 'b')
      await watchAs(subPin, 'mark')
      await startFrames(win)
      await slowRightClick(win, other)
      ok(await until(menuOpen, 3000), `${style}: the second place's menu opens`)
      await sleep(200)
      const frames = await stopFrames(win)
      const flash = flashFrames(frames, tint)
      ok(frames.length >= 5 && flash.seenB && flash.bad.length === 0, `${style}: the tint goes straight from Home to the next place (${frames.length} frames, bad ${JSON.stringify(flash.bad.slice(0, 5).map((i) => frames[i]))})`)
      const markOff = frames.filter((f) => f.mark !== tintDim)
      ok(markOff.length === 0, `${style}: the marked place stays dimmed in every frame (${markOff.length} frames otherwise, ${JSON.stringify(markOff.slice(0, 3))})`)
      ok((await bg(other)) === tint && (await bg(home)) !== tint && (await bg(subPin)) === tintDim, `${style}: after it, only the second place is full and the mark dimmed`)
      await win.screenshot({ path: join(SHOTS, `place-mark-menu-switch-${style}.png`) })
      await shut()
      ok(JSON.stringify(await lit()) === JSON.stringify([subPinPath]), `${style}: the pin's mark is back when the menu shuts (${JSON.stringify(await lit())})`)
      ok((await bg(subPin)) === tint, `${style}: full, the sidebar being where the user acted (${await bg(subPin)})`)

      // (b) Into a subfolder keeps the clicked place; the address field to
      // somewhere else lets it go; to the place itself marks it again.
      await subPin.click()
      ok(await until(async () => (await row('deeper').count()) === 1, 8000), `${style}: back in sub`)
      await row('deeper').dblclick()
      ok(await until(async () => (await row('x.txt').count()) === 1, 8000), `${style}: into sub\\deeper`)
      ok(JSON.stringify(await currentRows()) === JSON.stringify([subPinPath]), `${style}: in a subfolder the pin stays marked (${await currentRows()})`)
      await goByAddress(dir, 'a.txt')
      ok((await currentRows()).length === 0, `${style}: the address field outside it clears the mark (${await currentRows()})`)
      await goByAddress(join(subPath, 'deeper'), 'x.txt')
      ok((await currentRows()).length === 0, `${style}: and coming back without a click marks nothing (${await currentRows()})`)
      await goByAddress(subPath, 'deeper')
      ok(JSON.stringify(await currentRows()) === JSON.stringify([subPinPath]), `${style}: a place's own path marks it (${await currentRows()})`)
      await goByAddress(dir, 'a.txt')
    }
  } finally {
    if (styleBefore) await switchStyle(win, styleBefore[0], styleBefore[1]).catch(() => {})
    await win.evaluate(() => localStorage.removeItem('prism.sidebar.driveStyle')).catch(() => {})
    await app.close().catch(() => {})
  }
}

/**
 * THE PLACES PANEL IS THE MOCKUP'S (#296; owner, 2026-10-06, of the themes
 * mockup: "i really like the sidebar from here, so use that, with the icons
 * and the disks with a bar showing how much is in use"). Quick access is the
 * Known Folders, each with its own glyph; Pinned is what the user pinned;
 * This PC is each drive with a bar whose used part is used / total (checked
 * against Node's own statfs of C:) and a free line. What the rows did before
 * still works: a click goes there, the menu pins, unpins and moves within a
 * section, Shift+F10 opens it, a drag reorders a section and cannot cross into
 * the other. Screenshots of the panel at Small, Medium and Large on a dark, a
 * light and a see-through style, for the side by side with the mockup.
 *
 * THIS PC IN THREE LOOKS (owner, 2026-10-06, of the drive row mockups: "I want
 * option A, D and E as options in settings, with A being default"). Tiles is
 * the default; Settings > Explorer > Drive style switches to Ring and Gauge
 * live, and each draws the real used share its own way (bar, arc, lit steps).
 * The system drive wears the Windows badge, and a drive from 90% used wears
 * the warning colour: a second launch puts C: at 95% (`PRISM_E2E_DRIVE_USED`)
 * and checks all three. Screenshots of each style on a dark and a light style.
 */
async function sidebarPlacesScenario(fixtures) {
  console.log('sidebar places')
  const dir = join(fixtures, 'sideplaces')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'pinme'), { recursive: true })
  mkdirSync(join(dir, 'pintoo'), { recursive: true })
  writeFileSync(join(dir, 'one.txt'), 'one\n')
  const { app, win } = await launch(join(dir, 'one.txt'))
  const places = win.locator('.folder-browser .browse-places')
  const list = win.locator('[data-testid="browse-list"]')
  const row = (name) => list.locator(`[data-browse-path$="\\\\${name}" i]`).first()
  const sections = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('.folder-browser .browse-places nav > section')].map((s) => ({
        label: s.getAttribute('aria-label'),
        heading: s.querySelector('h2')?.textContent ?? '',
        rows: [...s.querySelectorAll('.browse-place')].map((b) => ({
          path: b.getAttribute('data-quick-access-path') ?? b.getAttribute('title'),
          known: b.getAttribute('data-known'),
          icon: b.querySelector('svg[data-place-icon]')?.getAttribute('data-place-icon') ?? null,
          text: b.textContent
        }))
      }))
    )
  const section = async (label) => (await sections()).find((s) => s.label === label)
  const pinRow = (section, name) =>
    places.locator(`section[aria-label="${section}"] .quick-access-pin[data-quick-access-path$="\\\\${name}" i]`)
  let styleBefore = null
  try {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await row('pinme').count()) === 0) await row('sideplaces').dblclick()
    ok(await until(async () => (await row('pinme').count()) === 1, 10000), 'the Explorer shows the fixture folder')

    // 1. THE SECTIONS, in the mockup's order.
    ok(await until(async () => (await sections()).some((s) => s.label === 'This PC'), 10000), 'the places panel lists This PC')
    const order = (await sections()).map((s) => s.label)
    // Nothing pinned yet, so no Pinned section at all (owner, 2026-10-06).
    ok(JSON.stringify(order) === JSON.stringify(['Quick access', 'This PC']), `with nothing pinned the sections are Quick access, This PC (${order})`)

    // 2. QUICK ACCESS: the Known Folders, each with its own glyph, Home by
    // the user's own folder name.
    const quick = await section('Quick access')
    const known = ['home', 'desktop', 'downloads', 'documents', 'pictures', 'music', 'videos']
    ok(
      quick.rows.length >= 5 && quick.rows.every((r) => known.includes(r.known) && r.icon === r.known),
      `every Quick access row is a Known Folder wearing its own icon (${JSON.stringify(quick.rows.map((r) => [r.known, r.icon]))})`
    )
    ok(new Set(quick.rows.map((r) => r.icon)).size === quick.rows.length, 'and no two share an icon')
    const home = quick.rows.find((r) => r.known === 'home')
    const homeName = homedir().split(/[\\/]/).pop()
    ok(home?.text === homeName, `Home reads as the user's folder, "${homeName}" (${home?.text})`)
    ok((await places.locator('section[aria-label="Pinned"]').count()) === 0, 'an empty Pinned is not shown')

    // 3. PIN two folders: they land under Pinned with the folder icon, never
    // under Quick access.
    for (const name of ['pinme', 'pintoo']) {
      await row(name).click({ button: 'right' })
      await win.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
      ok(await until(async () => (await pinRow('Pinned', name).count()) === 1, 5000), `${name} is pinned under Pinned`)
    }
    ok((await places.locator('section[aria-label="Quick access"] .quick-access-pin[data-quick-access-path$="\\\\pinme" i]').count()) === 0, 'and not under Quick access')
    ok((await pinRow('Pinned', 'pinme').locator('svg[data-place-icon]').count()) === 0 && (await pinRow('Pinned', 'pinme').locator('svg').count()) === 1, 'a pinned folder wears the folder icon')
    const order2 = (await sections()).map((s) => s.label)
    ok(JSON.stringify(order2) === JSON.stringify(['Quick access', 'Pinned', 'This PC']), `with pins the sections are Quick access, Pinned, This PC (${order2})`)

    // 4. THIS PC, as Tiles until somebody chooses: name, percent, pill bar,
    // free line, and the bar's width is used / total.
    const thisPc = places.locator('section[aria-label="This PC"]')
    const c = places.locator('section[aria-label="This PC"] .browse-drive[title="C:\\\\"]')
    ok(await until(async () => (await c.locator('.browse-drive-bar > i').count()) === 1, 15000), 'C: has its usage bar')
    ok((await thisPc.getAttribute('data-drive-style')) === 'tiles' && (await win.evaluate(() => localStorage.getItem('prism.sidebar.driveStyle'))) === null, 'with nothing chosen the drives are Tiles')
    const want = usedShare('C:\\')
    const system = `${(process.env.SystemDrive || 'C:').toUpperCase()}\\`
    let drive = await driveLookAt(win, 'C:\\')
    ok(/\(C:\)$/.test(drive.name), `the drive is named as File Explorer names it (${drive.name})`)
    ok(/^[\d.]+ [KMGT]?B free of [\d.]+ [KMGT]?B$/.test(drive.free), `and says what is free of what (${drive.free})`)
    ok(drive.pct === `${Math.round(want * 100)}%`, `the name line ends in the percent used (${drive.pct}, statfs ${(want * 100).toFixed(1)})`)
    ok(drawsShare(drive, want), `the bar's used part is used / total (${drive.fraction?.toFixed(4)} against statfs ${want.toFixed(4)})`)
    ok(drive.chip && drive.glyph === 'drive' && drive.icon === 'drive', `the glyph sits in its chip (${JSON.stringify([drive.chip, drive.glyph])})`)
    ok(drive.badge === (system === 'C:\\'), `the system drive wears the Windows badge (${drive.badge}, system ${system})`)
    ok(Math.abs(drive.barH - 5) < 0.6, `the pill is 5px at Medium (${drive.barH})`)
    const accent = await cssColour(win, 'var(--p-accent-solid)')
    const warnFill = await cssColour(win, 'var(--p-warn)')
    ok(drive.fill === (drive.warn ? warnFill : accent), `the used part is the accent as picked, or the warning past 90% (${drive.fill}, ${accent})`)
    // Every drive with sizes: warned exactly when it is 90% used or more.
    const drivePaths = await thisPc.locator('.browse-drive').evaluateAll((els) => els.map((e) => e.getAttribute('title')))
    for (const path of drivePaths) {
      const share = usedShare(path)
      if (share === null) continue
      const look = await driveLookAt(win, path)
      if (look.fraction === null) continue
      ok(look.warn === share >= 0.9, `${path} warns only from 90% used (${look.warn}, ${(share * 100).toFixed(1)}%)`)
      ok(look.badge === (path.toUpperCase() === system), `${path} wears the Windows badge only as the system drive (${look.badge})`)
    }

    // 4b. THE SETTING: Ring and Gauge, live, each drawing the same share.
    for (const id of ['ring', 'gauge', 'tiles']) {
      await pickStyleSegment(win, 'drive-style', DRIVE_STYLE_NAMES[id])
      await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
      await places.waitFor({ timeout: 10000 })
      ok(await until(async () => (await thisPc.getAttribute('data-drive-style')) === id, 5000), `Drive style ${DRIVE_STYLE_NAMES[id]} applies at once`)
      ok((await win.evaluate(() => localStorage.getItem('prism.sidebar.driveStyle'))) === id, `and is stored (${id})`)
      drive = await driveLookAt(win, 'C:\\')
      ok(drive.style === id && drawsShare(drive, want), `${id}: C: draws its used share (${drive.fraction?.toFixed(4)}${drive.lit !== undefined ? `, ${drive.lit} of 20 lit` : ''}, statfs ${want.toFixed(4)})`)
      ok(drive.badge === (system === 'C:\\') && drive.glyph === 'drive', `${id}: the glyph and the Windows badge stay`)
      ok(drive.fill === (drive.warn ? warnFill : accent), `${id}: in the accent (${drive.fill})`)
      // A screen reader hears the share in words in every style: the donut's
      // bare number and the meter's steps are drawings, not text.
      const said = await c.ariaSnapshot()
      ok(said.includes(`${Math.round(want * 100)}% used`) && /free/.test(said), `${id}: the row's name says the share used (${said.trim()})`)
      if (id === 'ring') {
        ok(drive.ring && !drive.bar && !drive.chip && drive.seg === 0, `ring: a donut, no bar and no chip (${JSON.stringify(drive)})`)
        ok(drive.pct === `${Math.round(want * 100)}%`, `ring: the percent inside it, with its sign (${drive.pct})`)
        ok(/^[\d.]+ [KMGT]?B free of [\d.]+ [KMGT]?B$/.test(drive.free), `ring: the free line under the name (${drive.free})`)
      } else if (id === 'gauge') {
        ok(drive.seg === 20 && drive.chip && !drive.bar && !drive.ring, `gauge: twenty steps and the glyph in a chip (${JSON.stringify(drive)})`)
        ok(/^[\d.]+ [KMGT]?B free$/.test(drive.nums?.[0] ?? '') && /^[\d.]+ [KMGT]?B$/.test(drive.nums?.[1] ?? ''), `gauge: free at the left end, the total at the right (${drive.nums})`)
      } else {
        ok(drive.bar && drive.chip && !drive.ring && drive.seg === 0, 'tiles again: the pill and the chip')
      }
      // The row still behaves: a click opens the drive.
      await c.click()
      ok(await until(async () => (await c.getAttribute('aria-current')) === 'location', 8000), `${id}: a click on a drive opens it`)
      await pinRow('Pinned', 'pinme').click()
      ok(await until(async () => (await c.getAttribute('aria-current')) === null, 8000), `${id}: and leaving it lets it go`)
    }

    // 5. WHAT THE ROWS DID BEFORE. A click goes there.
    await pinRow('Pinned', 'pinme').click()
    ok(await until(async () => (await pinRow('Pinned', 'pinme').getAttribute('aria-current')) === 'location', 8000), 'a click on a pin opens that folder and marks it current')
    ok(await until(async () => (await list.locator('[data-browse-path]').count()) === 0, 8000), 'the list is the empty folder')
    await c.click()
    ok(await until(async () => (await c.getAttribute('aria-current')) === 'location', 8000), 'a click on a drive opens it')
    // The menu moves a pin within ITS section: pintoo up past pinme.
    await pinRow('Pinned', 'pintoo').click({ button: 'right' })
    ok((await win.getByRole('menuitem', { name: 'Move down', exact: true }).isDisabled()), 'the last Pinned row cannot move down')
    await win.getByRole('menuitem', { name: 'Move up', exact: true }).click()
    const pinnedOrder = async () => (await section('Pinned')).rows.map((r) => r.path.split('\\').pop())
    ok(await until(async () => JSON.stringify(await pinnedOrder()) === '["pintoo","pinme"]', 5000), `Move up reorders Pinned (${await pinnedOrder()})`)
    const quickOrder = async () => (await section('Quick access')).rows.map((r) => r.known)
    ok(JSON.stringify(await quickOrder()) === JSON.stringify(quick.rows.map((r) => r.known)), 'and leaves Quick access as it was')
    // Move down on Quick access's first row moves it within Quick access.
    const firstKnown = quick.rows[0].known
    await places.locator('section[aria-label="Quick access"] .quick-access-pin').first().click({ button: 'right' })
    ok(await win.getByRole('menuitem', { name: 'Move up', exact: true }).isDisabled(), 'the first Quick access row cannot move up')
    await win.getByRole('menuitem', { name: 'Move down', exact: true }).click()
    ok(await until(async () => (await quickOrder())[1] === firstKnown, 5000), `Move down moves it within Quick access (${await quickOrder()})`)
    ok(JSON.stringify(await pinnedOrder()) === '["pintoo","pinme"]', 'Pinned is untouched by it')
    // The keyboard: Shift+F10 on a focused place opens its menu.
    await places.locator('section[aria-label="Quick access"] .quick-access-pin').first().focus()
    await win.keyboard.press('Shift+F10')
    ok(await until(async () => (await win.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).count()) === 1, 3000), 'Shift+F10 opens a place menu')
    await win.keyboard.press('Escape')
    // A drag reorders Pinned and cannot carry a pin into Quick access.
    await pinRow('Pinned', 'pinme').dragTo(pinRow('Pinned', 'pintoo'), { targetPosition: { x: 20, y: 3 } })
    ok(await until(async () => JSON.stringify(await pinnedOrder()) === '["pinme","pintoo"]', 5000), `a drag reorders Pinned (${await pinnedOrder()})`)
    const quickNow = await quickOrder()
    await pinRow('Pinned', 'pintoo').dragTo(places.locator('section[aria-label="Quick access"] .quick-access-pin').first(), { targetPosition: { x: 20, y: 3 } })
    await sleep(400)
    ok(JSON.stringify(await quickOrder()) === JSON.stringify(quickNow) && JSON.stringify(await pinnedOrder()) === '["pinme","pintoo"]', 'a pin dragged onto Quick access stays where it was')
    // A drive's menu offers to pin it; pinned, it is a Pinned row.
    await c.click({ button: 'right' })
    ok((await win.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).count()) === 1, 'a drive offers Pin to Quick access')
    await win.keyboard.press('Escape')

    // 6. THE LOOK, at each size on a dark, a light and a see-through style.
    // A drive follows the Explorer size: its text is the rows' text and the
    // Tiles chip is the mockup's 2.4 times it.
    await pinRow('Pinned', 'pinme').click()
    for (const [style, mode] of [['aurora', 'dark'], ['paper', 'light'], ['default', 'dark']]) {
      const was = await switchStyle(win, style, mode)
      styleBefore ??= was
      await sleep(500)
      for (const size of ['Small', 'Medium', 'Large']) {
        await pickStyleSegment(win, 'explorer-size', size)
        await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
        await places.waitFor({ timeout: 10000 })
        await sleep(400)
        const look = await win.evaluate(() => {
          const q = document.querySelector('.folder-browser .browse-places section[aria-label="Quick access"] .browse-place')
          return {
            row: q?.getBoundingClientRect().height,
            icon: q?.querySelector('svg')?.getBoundingClientRect().height
          }
        })
        const tile = await driveLookAt(win, 'C:\\')
        const want = { Small: [22, 12, 11.5], Medium: [26, 14, 12.5], Large: [40, 18, 15] }[size]
        ok(look.row === want[0] && look.icon === want[1], `${style} ${size}: rows ${want[0]}px with ${want[1]}px icons (${JSON.stringify(look)})`)
        ok(tile.font === want[2] && Math.abs(tile.chipW - 2 * want[2]) < 0.6, `${style} ${size}: a drive's text is ${want[2]}px and its chip grows with it (${tile.font}, ${tile.chipW})`)
        const box = await places.boundingBox()
        await win.screenshot({ path: join(SHOTS, `sidebar-${style}-${size.toLowerCase()}.png`), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 560) } })
        if (size === 'Medium') await win.screenshot({ path: join(SHOTS, `sidebar-${style}-window.png`) })
      }
    }
    await pickStyleSegment(win, 'explorer-size', 'Medium')
    // Each drive style on a dark and a light style, at Medium, for the side by
    // side with the mockup's A, D and E. The drive rows only: the panel's
    // This PC section, clipped.
    for (const [style, mode] of [['aurora', 'dark'], ['paper', 'light']]) {
      await switchStyle(win, style, mode)
      await sleep(400)
      for (const id of ['tiles', 'ring', 'gauge']) {
        await pickStyleSegment(win, 'drive-style', DRIVE_STYLE_NAMES[id])
        await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
        await places.waitFor({ timeout: 10000 })
        await until(async () => (await thisPc.getAttribute('data-drive-style')) === id, 5000)
        await sleep(300)
        const box = await places.boundingBox()
        await win.screenshot({ path: join(SHOTS, `sidebar-drives-${id}-${style}.png`), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 640) } })
      }
    }
    await pickStyleSegment(win, 'drive-style', 'Tiles')

    // 7. Unpin puts the hint back.
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    for (const name of ['pinme', 'pintoo']) {
      await pinRow('Pinned', name).click({ button: 'right' })
      await win.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).click()
      ok(await until(async () => (await pinRow('Pinned', name).count()) === 0, 5000), `${name} is unpinned`)
    }
    ok(await until(async () => (await places.locator('section[aria-label="Pinned"]').count()) === 0, 3000), 'and the empty Pinned section is gone again')
  } finally {
    // The shared profile: Quick access back in its own order, the style back.
    await win
      .evaluate(() => localStorage.removeItem('prism.quickAccess'))
      .catch(() => {})
    if (styleBefore) await switchStyle(win, styleBefore[0], styleBefore[1]).catch(() => {})
    await win.evaluate(() => localStorage.removeItem('prism.explorer.size')).catch(() => {})
    await win.evaluate(() => localStorage.removeItem('prism.sidebar.driveStyle')).catch(() => {})
    await app.close().catch(() => {})
  }

  // 8. FROM 90% USED, THE WARNING. C: at 95% used (the e2e-only override in
  // main), each style: the warned row, its fill in --p-warn and its number in
  // --p-warn-ink, the Gauge at 19 of 20.
  EXTRA_ENV = { PRISM_E2E_DRIVE_USED: '0.95' }
  const second = await launch(join(dir, 'one.txt'))
  EXTRA_ENV = {}
  const w2 = second.win
  let style2 = null
  try {
    style2 = await switchStyle(w2, 'aurora', 'dark')
    await w2.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await w2.waitForSelector('.folder-browser .browse-places section[aria-label="This PC"]', { timeout: 15000 })
    const sysRoot = `${(process.env.SystemDrive || 'C:').toUpperCase()}\\`
    const fill = await cssColour(w2, 'var(--p-warn)')
    const ink = await cssColour(w2, 'var(--p-warn-ink)')
    const accent = await cssColour(w2, 'var(--p-accent-solid)')
    ok(fill !== accent && ink !== accent, `the warning is not the accent (${fill}, ${ink}, ${accent})`)
    for (const id of ['tiles', 'ring', 'gauge']) {
      await pickStyleSegment(w2, 'drive-style', DRIVE_STYLE_NAMES[id])
      await w2.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
      ok(await until(async () => (await driveLookAt(w2, sysRoot))?.style === id && (await driveLookAt(w2, sysRoot))?.fraction !== null, 15000), `${id}: the system drive is drawn`)
      const look = await driveLookAt(w2, sysRoot)
      ok(look.warn && drawsShare(look, 0.95), `${id}: at 95% used it warns and draws 95% (${look.warn}, ${look.fraction?.toFixed(3)}${look.lit !== undefined ? `, ${look.lit} lit` : ''})`)
      ok(look.fill === fill && look.ink === ink, `${id}: the mark in --p-warn, the number in --p-warn-ink (${look.fill}, ${look.ink})`)
      if (id === 'gauge') ok(look.lit === 19, `gauge: 19 of 20 steps lit (${look.lit})`)
      const box = await w2.locator('.folder-browser .browse-places').boundingBox()
      await w2.screenshot({ path: join(SHOTS, `sidebar-drives-${id}-warn.png`), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 640) } })
    }
  } finally {
    if (style2) await switchStyle(w2, style2[0], style2[1]).catch(() => {})
    await w2.evaluate(() => localStorage.removeItem('prism.sidebar.driveStyle')).catch(() => {})
    await second.app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
/**
 * THE EXPLORER'S SIDEBAR WEARS THE SIDEBAR COLOUR, AND THE COLOURS ARE HEADED
 * "COLOURS" (#302; owner, 2026-10-06: "from your mockups i think the sidebar
 * in explorer was supposed to be distinctly colored from the main bg right ...
 * i see that in settings the sidebar is distinctly colored correctly", and of
 * "Colours of Volt": "dont have this show the theme name, just call that
 * section colours"). On a dark, a light and a see-through theme the places
 * panel's ground is not the list's and IS the Settings rail's: both are
 * --p-side, the "Sidebar and tab bar colour". Before, the places panel was
 * the folder browser's --p-bg. The see-through count of coats is seeThrough's.
 */
async function sidebarGroundScenario(fixtures) {
  console.log('sidebar ground')
  const dir = join(fixtures, 'sideground')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'inner'), { recursive: true })
  writeFileSync(join(dir, 'one.txt'), 'one\n')
  const { app, win } = await launch(join(dir, 'one.txt'))
  let styleBefore
  const explorer = async () => {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('.folder-browser .browse-places', { timeout: 10000 })
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
  }
  const groundOf = (sel) => win.evaluate((q) => {
    const el = document.querySelector(q)
    return el ? getComputedStyle(el).backgroundColor : null
  }, sel)
  try {
    await explorer()
    // 1. THE HEADING: "Colours", whatever the theme.
    for (const style of ['new-void', 'paper']) {
      const was = await switchStyle(win, style)
      if (styleBefore === undefined) styleBefore = was
      await settingsPage(win, 'appearance')
      const heading = win.locator('[data-settings-section="style-colours"] h3')
      await heading.waitFor({ timeout: 10000 })
      const text = (await heading.textContent())?.trim()
      ok(text === 'Colours', `${style}: the Appearance colours section is headed "Colours" (${text})`)
      await win.click('[aria-label="Settings"]')
      await sleep(300)
    }

    // 2. THE GROUNDS: places against the list, the Settings rail and --p-side.
    for (const style of ['new-void', 'paper', 'aurora', 'glacier']) {
      await switchStyle(win, style)
      await sleep(400)
      await explorer()
      const side = await cssColour(win, 'var(--p-side)')
      let places = null
      let list = null
      await until(async () => {
        places = await groundOf('.folder-browser > .browse-places')
        list = await groundOf('.folder-browser > .browse-list-area')
        return places === side
      }, 4000, 100)
      ok(places !== null && places !== list, `${style}: the places panel's ground is not the list's (${places} vs ${list})`)
      ok(places === side, `${style}: the places panel wears the sidebar colour (${places}, --p-side ${side})`)
      await win.mouse.move(2, 400)
      await sleep(300)
      await win.screenshot({ path: join(SHOTS, `sidebar-ground-${style}.png`) })
      await settingsPage(win, 'appearance')
      await win.waitForSelector('[data-settings-page] > nav', { timeout: 10000 })
      const rail = await groundOf('[data-settings-page] > nav')
      ok(rail === places, `${style}: and that is the Settings rail's ground (${rail})`)
      await win.click('[aria-label="Settings"]')
      await sleep(300)
    }
  } finally {
    if (styleBefore !== undefined) await switchStyle(win, styleBefore).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
async function explorerSizeScenario(fixtures) {
  console.log('explorer size')
  const dir = join(fixtures, 'exsize')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const n of ['z1.txt', 'z2.txt', 'z3.txt']) writeFileSync(join(dir, n), `size ${n}\n`)
  let { app, win } = await launch(join(dir, 'z1.txt'))
  const intoFolder = async () => {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await win.locator('[data-testid="browse-list"] [data-browse-path$=".txt"]').count()) !== 3)
      await win.locator('[data-testid="browse-list"] [data-browse-path$="exsize"]').dblclick()
    return until(async () => (await win.locator('[data-testid="browse-list"] [data-browse-path$=".txt"]').count()) === 3, 10000)
  }
  const rowLook = () =>
    win.evaluate(() => {
      const row = document.querySelector('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"]')
      const icon = row?.querySelector('.browse-name > svg')
      return {
        h: row?.getBoundingClientRect().height,
        font: row ? getComputedStyle(row).fontSize : null,
        icon: icon?.getBoundingClientRect().height,
        tree: document.querySelector('aside [data-row]')?.getBoundingClientRect().height ?? null,
        place: document.querySelector('.folder-browser .browse-place')?.getBoundingClientRect().height ?? null,
        placeIcon: document.querySelector('.folder-browser .browse-place > svg')?.getBoundingClientRect().height ?? null,
        placeFont: (() => {
          const el = document.querySelector('.folder-browser .browse-place')
          return el ? getComputedStyle(el).fontSize : null
        })()
      }
    })
  try {
    ok(await intoFolder(), 'the Explorer shows the folder of three')
    const medium = await rowLook()
    ok(medium.h === 26 && medium.font === '12.5px' && medium.icon === 14, `Medium is the default: 26px rows of 12.5px text, a 14px icon (${JSON.stringify(medium)})`)
    const want = { Small: [22, '11.5px', 12], Medium: [26, '12.5px', 14], Large: [40, '15px', 18] }
    for (const name of ['Small', 'Large', 'Medium', 'Large']) {
      await pickStyleSegment(win, 'explorer-size', name)
      ok(await intoFolder(), `${name}: back in the Explorer`)
      await sleep(250)
      const got = await rowLook()
      const [h, font, icon] = want[name]
      ok(got.h === h && got.font === font && got.icon === icon, `${name}: ${h}px rows of ${font} text, a ${icon}px icon (${JSON.stringify(got)})`)
      ok(got.tree === medium.tree, `${name}: and the tree's rows stay as they were (${got.tree})`)
      // Quick access follows the same one setting (owner, 2026-10-03).
      ok(
        got.place === h && got.placeIcon === icon && got.placeFont === font,
        `${name}: Quick access has the same rows (${got.place}px, ${got.placeFont}, a ${got.placeIcon}px icon)`
      )
      await win.screenshot({ path: join(SHOTS, `explorer-size-${name.toLowerCase()}.png`) })
    }
    ok((await win.evaluate(() => localStorage.getItem('prism.explorer.size'))) === 'large', 'the choice is stored')
    await app.close()
    await sleep(900)
    ;({ app, win } = await launch(join(dir, 'z1.txt')))
    ok(await intoFolder(), 'after a restart the Explorer shows the folder again')
    await sleep(250)
    const again = await rowLook()
    ok(again.h === 40 && again.font === '15px', `and remembers Large (${JSON.stringify(again)})`)
    await pickStyleSegment(win, 'explorer-size', 'Medium')
  } finally {
    await win.evaluate(() => localStorage.removeItem('prism.explorer.size')).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
/**
 * THE THREE PANELS START AT ONE HEIGHT (#283; owner, 2026-10-04: "the position
 * of the sorting bar with name, type, size etc. that's the height I want the
 * txt files to start at and the sidebar to start at, that way all three
 * panels contents align at the same height"). Measured on the TEXT, not the
 * boxes: the middle of the column header's "Name", of the sidebar's first
 * heading and of the preview's first line (its number and its words) are one
 * line across the window, at every Explorer size. The full view button sits
 * in that band at the pane's right and never lies over a word of text.
 */
async function panelsAlignScenario(fixtures) {
  console.log('panels align')
  const dir = join(fixtures, 'panelsalign')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const long =
    'The first line of these notes runs long on purpose, so that it wraps in the preview pane and the alignment is measured on its first visual line. '.repeat(2)
  writeFileSync(join(dir, 'notes.txt'), [long, ...Array.from({ length: 60 }, (_, i) => `line ${i + 2} of the notes`)].join('\n'))
  writeFileSync(join(dir, 'main.ts'), ['export const first = 1', ...Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i}`)].join('\n'))
  writeFileSync(join(dir, 'other.txt'), 'other\n')
  // A picture and a film, to show they start at the list's top too.
  copyFileSync(join(fixtures, 'one.png'), join(dir, 'one.png'))
  copyFileSync(join(fixtures, 'ep1.mp4'), join(dir, 'ep1.mp4'))
  const { app, win } = await launch(join(dir, 'other.txt'))
  // The middle of the first text node's glyph box, and its rects, by a Range.
  const measure = () =>
    win.evaluate(() => {
      const textBox = (el) => {
        if (!el) return null
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(n)
          const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
          if (!rects.length) continue
          const r = rects[0]
          // The BASELINE, which is what the eye lines up (owner, 2026-10-04,
          // measuring two screenshots: centres matched, baselines did not). A
          // text rect is the font's content area, so the baseline is its
          // bottom less the font's own descent, measured on a canvas in the
          // computed font. (A zero-height inline-block on the baseline read
          // wrong inside CodeMirror: 4.5px off what the pixels show.)
          const cs = getComputedStyle(n.parentElement)
          const ctx = (window.__baseCtx ??= document.createElement('canvas').getContext('2d'))
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
          const base = r.bottom - ctx.measureText('Hg').fontBoundingBoxDescent
          return {
            top: r.top,
            base,
            mid: (r.top + r.bottom) / 2,
            rects: rects.map((q) => ({ l: q.left, r: q.right, t: q.top, b: q.bottom }))
          }
        }
        return null
      }
      const head = document.querySelector('.browse-list-area .browse-columns')
      const pane = document.querySelector('[data-browse-preview]')
      const numEl = [...(pane?.querySelectorAll('.cm-lineNumbers .cm-gutterElement') ?? [])].find(
        (g) => g.textContent.trim() === '1'
      )
      const lineEl = pane?.querySelector('.cm-line')
      return {
        headTop: head?.getBoundingClientRect().top,
        headBottom: head?.getBoundingClientRect().bottom,
        name: textBox(head?.querySelector('.browse-column-name')),
        heading: textBox(document.querySelector('.folder-browser .browse-places h2')),
        // The first rows under the band, side by side (owner, 2026-10-04,
        // a screenshot of Home beside the list's first row: "still like a px
        // off"): their tops and their text baselines, three of each.
        places: [...document.querySelectorAll('.folder-browser .browse-places .browse-place')].slice(0, 3).map((el) => ({
          top: el.getBoundingClientRect().top,
          base: textBox(el)?.base
        })),
        rows: [...document.querySelectorAll('[data-testid="browse-list"] [data-browse-path]')].slice(0, 3).map((el) => ({
          top: el.getBoundingClientRect().top,
          base: textBox(el.querySelector('.browse-name') ?? el)?.base
        })),
        line: textBox(lineEl),
        number: textBox(numEl),
        paneTop: pane?.getBoundingClientRect().top,
        button: !!document.querySelector('[data-open-full]')
      }
    })
  /** The baseline of an element's words AS DRAWN, in device pixels from
   *  the window's top: a screenshot of its box, decoded in the page, and the
   *  lowest ink row most columns reach (a descender or an icon reaches past
   *  it in only a few). Ink is whatever differs from the box's commonest
   *  shade, so a dark and a light theme read the same way. */
  const inkBaseline = async (sel) => {
    const box = await win.evaluate((q) => {
      const r = document.querySelector(q)?.getBoundingClientRect()
      return r ? { x: r.left, y: r.top, width: r.width, height: r.height, dpr: window.devicePixelRatio } : null
    }, sel)
    if (!box) return null
    const png = await win.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } })
    const row = await win.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const lum = (i) => (d[i] + d[i + 1] + d[i + 2]) / 3
      const shades = new Map()
      for (let i = 0; i < d.length; i += 4) {
        const k = Math.round(lum(i) / 8)
        shades.set(k, (shades.get(k) ?? 0) + 1)
      }
      const ground = [...shades.entries()].sort((a, b) => b[1] - a[1])[0][0] * 8
      const bottoms = new Map()
      for (let x = 0; x < c.width; x += 1) {
        let low = -1
        for (let y = 0; y < c.height; y += 1) if (Math.abs(lum((y * c.width + x) * 4) - ground) > 60) low = y
        if (low >= 0) bottoms.set(low, (bottoms.get(low) ?? 0) + 1)
      }
      if (!bottoms.size) return null
      return [...bottoms.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }, png.toString('base64'))
    return row === null ? null : Math.round(box.y * box.dpr) + row
  }
  const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n)
  const say = (m) =>
    JSON.stringify({
      head: [r1(m.headTop), r1(m.headBottom)],
      name: r1(m.name?.base),
      heading: r1(m.heading?.base),
      places: m.places?.map((q) => [r1(q.top), r1(q.base)]),
      rows: m.rows?.map((q) => [r1(q.top), r1(q.base)]),
      line: r1(m.line?.base),
      number: r1(m.number?.base),
      paneTop: r1(m.paneTop),
      button: m.button
    })
  const selected = () =>
    win.evaluate(() => document.querySelector('[data-testid="browse-list"] [aria-selected="true"]')?.getAttribute('data-browse-path') ?? '')
  const shown = (name) =>
    until(async () => {
      const m = await measure()
      return !!m.line && !!m.name && !!m.heading && (await selected()).endsWith(name)
    }, 12000)
  const check = async (label, shot, numbered = false) => {
    await sleep(400)
    const m = await measure()
    console.log(`  ${label}: ${say(m)}`)
    const ref = m.name?.base ?? NaN
    ok(Math.abs((m.heading?.base ?? -99) - ref) <= 0.5, `${label}: the sidebar's first heading is on the header's line (${say(m)})`)
    ok(Math.abs((m.line?.base ?? -99) - ref) <= 0.5, `${label}: the preview's first line of text is on the header's line`)
    if (numbered) ok(Math.abs((m.number?.base ?? -99) - ref) <= 0.5, `${label}: and so is its line number`)
    ok(
      m.places?.length === 3 && m.rows?.length === 3 && m.places.every((q, i) => Math.abs(q.top - m.rows[i].top) <= 0.5),
      `${label}: the sidebar's first rows start where the list's do (${JSON.stringify([m.places, m.rows])})`
    )
    // And their words share a baseline IN THE PIXELS. The font-metric measure
    // above read the list's text wrong by 1-4 device px (its face is one the
    // canvas does not resolve), so these rows are judged the way the owner
    // judged them: by where the ink sits.
    const home = await inkBaseline('.folder-browser .browse-places .browse-place')
    const file = await inkBaseline('[data-testid="browse-list"] [data-browse-path] .browse-name')
    ok(
      home !== null && file !== null && Math.abs(home - file) <= 1,
      `${label}: Home's words sit on the first file's baseline in the pixels (device rows ${home}, ${file})`
    )
    // NO FULL VIEW BUTTON over the preview (owner, 2026-10-04: "remove the
    // fullscreen icon in preview ... it gets confusing"): a double click on
    // the item opens it, and the pane starts at the list's own top.
    ok(!m.button, `${label}: there is no full view button over the preview`)
    ok(Math.abs((m.paneTop ?? -99) - (m.headTop ?? 99)) < 1, `${label}: and the pane starts at the list's top (${r1(m.paneTop)}, ${r1(m.headTop)})`)
    await win.screenshot({ path: join(SHOTS, `panels-align-${shot}.png`) })
    return m
  }
  try {
    await handoff(join(dir, 'notes.txt'))
    ok(await shown('notes.txt'), 'the Explorer shows notes.txt in the preview pane')
    await check('Medium, notes.txt', 'medium-txt')
    await win.locator('[data-testid="browse-list"] [data-browse-path$="main.ts"]').click()
    ok(await shown('main.ts'), 'main.ts in the preview pane')
    await check('Medium, main.ts', 'medium-ts', true)
    for (const size of ['Small', 'Large']) {
      await pickStyleSegment(win, 'explorer-size', size)
      await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
      await win.locator('[data-testid="browse-list"] [data-browse-path$="notes.txt"]').click()
      ok(await shown('notes.txt'), `${size}: notes.txt in the preview pane`)
      await check(`${size}, notes.txt`, `${size.toLowerCase()}-txt`)
    }
    await pickStyleSegment(win, 'explorer-size', 'Medium')
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.locator('[data-testid="browse-list"] [data-browse-path$="notes.txt"]').click()
    ok(await shown('notes.txt'), 'Medium again: notes.txt in the preview pane')

    // A NARROW WINDOW: the three still share a line, and the sidebar, which
    // lost its top padding to the band, still scrolls.
    const sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 400))
    await until(() => win.evaluate(() => window.innerWidth <= 800), 4000, 50)
    await check('Narrow, notes.txt', 'narrow-txt')
    const scroll = await win.evaluate(async () => {
      const box = document.querySelector('.folder-browser .browse-places nav')
      if (!box || box.scrollHeight <= box.clientHeight + 4)
        return { overflows: false, inner: window.innerHeight, client: box?.clientHeight, content: box?.scrollHeight }
      box.scrollTop = 60
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const moved = box.scrollTop
      box.scrollTop = 0
      return { overflows: true, moved }
    })
    ok(scroll.overflows && scroll.moved > 0, `Narrow: the sidebar overflows and still scrolls (${JSON.stringify(scroll)})`)
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sizeBefore)
    await until(() => win.evaluate((w) => window.innerWidth >= w - 40, sizeBefore[0]), 4000, 50)

    // A LIGHT THEME draws the same line.
    const styleBefore = await switchStyle(win, 'paper')
    await check('Paper, notes.txt', 'paper-txt')
    await switchStyle(win, styleBefore)

    // A PICTURE AND A FILM: no button and no strip either; the pane starts at
    // the list's top like the text's.
    for (const name of ['one.png', 'ep1.mp4']) {
      await win.locator(`[data-testid="browse-list"] [data-browse-path$="${name}"]`).click()
      ok(
        await until(() => win.evaluate(() => !!document.querySelector('[data-browse-preview] :is(img, video, canvas)')), 10000),
        `${name} in the preview pane`
      )
      await sleep(400)
      const m = await win.evaluate(() => {
        const pane = document.querySelector('[data-browse-preview]')
        return {
          button: !!document.querySelector('[data-open-full]'),
          paneTop: pane?.getBoundingClientRect().top,
          headTop: document.querySelector('.browse-list-area .browse-columns')?.getBoundingClientRect().top
        }
      })
      ok(
        !m.button && Math.abs(m.paneTop - m.headTop) < 1,
        `${name}: no full view button, and the pane starts at the list's top (${JSON.stringify(m)})`
      )
      await win.screenshot({ path: join(SHOTS, `panels-align-${name.replace('.', '-')}.png`) })
    }

    // Full view is a double click on the item, the way the owner opens it.
    await win.locator('[data-testid="browse-list"] [data-browse-path$="notes.txt"]').click()
    ok(await shown('notes.txt'), 'notes.txt back in the preview pane')
    await win.locator('[data-testid="browse-list"] [data-browse-path$="notes.txt"]').dblclick()
    ok(
      await until(
        () =>
          win.evaluate(
            () =>
              !!document.querySelector('.cm-editor')?.getClientRects().length &&
              !document.querySelector('[data-testid="folder-browser"]')?.getClientRects().length
          ),
        8000
      ),
      'a double click on the item opens it in full view'
    )
  } finally {
    await app.close()
  }
}

/**
 * DOWNLOADS SORTS NEWEST FIRST IN FILE EXPLORER'S DATE GROUPS (#285; owner,
 * 2026-10-04: "make the downloads folder in prism in the explorer not have
 * that folders first rule, just like file explorer ... it could have some
 * dividers like today ... or do it like file explorer"). A fixture stands in
 * for Downloads (`PRISM_E2E_DOWNLOADS`, e2e only), filled with files AND
 * folders dated across every group the day allows, named so that name order
 * and date order disagree. Each item's group is set by construction from this
 * run's own calendar (the week starting on the day the app says), never by
 * asking the code under test. Held: Quick access's Downloads is the fixture;
 * the rows are newest first with folders among the files; a divider stands
 * before each group's first row and nowhere else, with File Explorer's names;
 * dividers are not options and take no focus; Down walks every row and never
 * lands on a divider, Home lands on the first row; a sweep across a divider
 * marks only rows; type-ahead finds a row in a later group; Name puts folders
 * first with no dividers, and Date modified brings Downloads' view back,
 * newest first; another folder sorted by date keeps folders first and has no
 * dividers. Shots: .e2e/shots/downloads-date.png and downloads-name.png.
 */
async function downloadsDateScenario(fixtures) {
  console.log('downloads by date')
  const dl = join(fixtures, 'dl-date')
  rmSync(dl, { recursive: true, force: true })
  mkdirSync(dl, { recursive: true })
  EXTRA_ENV = {
    PRISM_E2E_DOWNLOADS: dl,
    PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index')
  }
  // Launched on a file elsewhere: the Explorer has to go to Downloads itself.
  const elsewhere = join(fixtures, 'dl-date-other')
  rmSync(elsewhere, { recursive: true, force: true })
  mkdirSync(join(elsewhere, 'zz-folder'), { recursive: true })
  writeFileSync(join(elsewhere, 'a-file.txt'), 'x\n')
  // Older than the file: by date alone it would come second.
  utimesSync(join(elsewhere, 'zz-folder'), new Date(2020, 0, 1), new Date(2020, 0, 1))
  const { app, win } = await launch(join(elsewhere, 'a-file.txt'))
  EXTRA_ENV = {}
  const list = '[data-testid="browse-list"]'
  try {
    // THE CALENDAR, from the app's own first day of the week.
    const weekStart = await win.evaluate(() => window.prism.weekStart?.()).catch(() => undefined)
    const ws = typeof weekStart === 'number' ? weekStart : 1
    const now = new Date()
    const dayAt = (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).getTime()
    const today = dayAt(0)
    const back = (now.getDay() - ws + 7) % 7
    const week = dayAt(-back)
    const lastWeek = dayAt(-back - 7)
    const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    const year = new Date(now.getFullYear(), 0, 1).getTime()
    const H = 3600000
    // [name, folder?, time, group]; a group whose window is empty today is left out.
    const plan = [
      ['m-today.txt', false, Math.max(today + 1000, now.getTime() - 60000), 'Today'],
      ['b-yesterday folder', true, today - 12 * H, 'Yesterday'],
      ['k-yesterday.zip', false, today - 13 * H, 'Yesterday'],
      ...(week + H < today - 24 * H ? [['j-this-week.txt', false, week + H, 'Earlier this week']] : []),
      ['c-last-week folder', true, lastWeek + 3 * 24 * H, 'Last week'],
      ['i-last-week.txt', false, lastWeek + 3 * 24 * H - H, 'Last week'],
      ...(month + H < lastWeek ? [['h-this-month.txt', false, month + H, 'Earlier this month']] : []),
      ['g-last-month.txt', false, Math.min(lastMonth + 14 * 24 * H, lastWeek - H, month - H), 'Last month'],
      ...(year + 24 * H < lastMonth ? [['d-this-year folder', true, year + 24 * H, 'Earlier this year']] : []),
      ['a-long-ago.txt', false, new Date(2023, 4, 1, 12).getTime(), 'A long time ago'],
      ['e-long-ago folder', true, new Date(2022, 1, 1, 12).getTime(), 'A long time ago']
    ]
    for (const [name, folder, t] of plan) {
      const p = join(dl, name)
      if (folder) mkdirSync(p)
      else writeFileSync(p, 'x\n')
      utimesSync(p, new Date(t), new Date(t))
    }
    const order = [...plan].sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0])).map((p) => p[0])
    const groups = []
    for (const [, , , g] of [...plan].sort((a, b) => b[2] - a[2])) if (groups.at(-1) !== g) groups.push(g)
    // What the list draws, top to bottom: '#Label' for a divider, else a name.
    const drawn = () =>
      win.evaluate((sel) => {
        const space = document.querySelector(`${sel} .browse-row-space > div`)
        return space
          ? [...space.children].map((el) =>
              el.classList.contains('browse-divider')
                ? `#${el.textContent}`
                : (el.getAttribute('data-browse-path') ?? '').split(/[\\/]/).pop()
            )
          : []
      }, list)
    const expected = []
    {
      let last = null
      for (const name of order) {
        const g = plan.find((p) => p[0] === name)[3]
        if (g !== last) expected.push(`#${g}`)
        last = g
        expected.push(name)
      }
    }

    // TO DOWNLOADS: the Known Folder main reports (Quick access's own source;
    // the profile's pins were seeded on an earlier run, so they name the real
    // one), reached by typing its path, as a user would.
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector(`${list} .browse-row`, { timeout: 10000 })
    const reported = await win.evaluate(async () => (await window.prism.browseLocations()).find((l) => l.known === 'downloads')?.path ?? null)
    ok(reported === dl, `main reports the Known Folder Downloads as the fixture (${reported})`)
    // The preview pane narrows the list past the width that shows Date
    // modified; this scenario needs the header, so the pane stays shut.
    const pane = win.locator('[aria-label="Preview pane"]')
    if ((await pane.getAttribute('aria-pressed')) === 'true') await pane.click()
    await typePath(win, dl)
    const settled = await until(async () => (await drawn()).join('|') === expected.join('|'), 10000, 100)
    ok(settled, `newest first, files and folders mixed, a divider before each group (${(await drawn()).join(' | ')})`)
    ok(
      JSON.stringify((await drawn()).filter((x) => x.startsWith('#'))) === JSON.stringify(groups.map((g) => `#${g}`)),
      `the groups, in order, only those with items: ${groups.join(', ')}`
    )
    const rowsShown = (await drawn()).filter((x) => !x.startsWith('#'))
    const firstFolder = rowsShown.findIndex((n) => / folder$/.test(n))
    const firstFile = rowsShown.findIndex((n) => !/ folder$/.test(n))
    ok(
      firstFile >= 0 && firstFolder >= 0 && firstFile < firstFolder && rowsShown.slice(firstFolder).some((n) => !/ folder$/.test(n)),
      'a file comes before a folder, and files follow folders: no folders-first rule'
    )
    const head = await win.locator(`${list} .browse-divider`).first().evaluate((d) => ({
      role: d.getAttribute('role'),
      hidden: d.getAttribute('aria-hidden'),
      tab: d.getAttribute('tabindex'),
      h: d.getBoundingClientRect().height,
      row: document.querySelector('[data-testid="browse-list"] .browse-row')?.getBoundingClientRect().height
    })).catch(() => null)
    ok(!!head && head.hidden === 'true' && head.tab === null && head.role === null, `a divider is not an option and takes no focus (${JSON.stringify(head)})`)
    const told = await win.locator(`${list} [data-browse-path$="${order[0]}"]`).getAttribute('aria-description')
    ok(told === 'Today', `a row tells a screen reader its group instead (${told})`)
    ok(!!head && Math.abs(head.h - head.row) < 0.5, `a divider is one row high, so the virtual list's rows stay where they belong (${head?.h} / ${head?.row})`)
    const listBox = await win.locator(list).boundingBox()
    await win.screenshot({ path: join(SHOTS, 'downloads-date.png'), clip: { x: listBox.x - 4, y: listBox.y - 40, width: listBox.width + 8, height: Math.min(listBox.height + 44, 520) } })

    // THE ARROWS walk the rows and never stop on a divider.
    const selectedName = () =>
      win.evaluate((sel) => (document.querySelector(`${sel} [aria-selected="true"]`)?.getAttribute('data-browse-path') ?? '').split(/[\\/]/).pop(), list)
    await win.locator(`${list} [data-browse-path$="${order[0]}"] .browse-name-text`).click()
    const walked = [await selectedName()]
    for (let i = 1; i < order.length; i++) {
      await win.keyboard.press('ArrowDown')
      await until(async () => (await selectedName()) !== walked.at(-1), 2000, 30)
      walked.push(await selectedName())
    }
    ok(walked.join('|') === order.join('|'), `Down walks every row in order, over the dividers (${walked.join(' | ')})`)
    for (let i = 0; i < order.length; i++) await win.keyboard.press('ArrowUp')
    await sleep(150)
    ok((await selectedName()) === order[0], `Up stops on the first row, not the divider above it (${await selectedName()})`)
    await win.keyboard.press('End')
    await sleep(150)
    await win.keyboard.press('Home')
    await sleep(150)
    ok((await selectedName()) === order[0], 'Home lands on the first row')
    const focusIsRow = await win.evaluate(() => !!document.activeElement?.matches('[role="option"]'))
    ok(focusIsRow, 'and the focus is on a row')
    // TYPE-AHEAD finds a row under a later group.
    await win.keyboard.press('a')
    await until(async () => (await selectedName()) === 'a-long-ago.txt', 2000, 30)
    ok((await selectedName()) === 'a-long-ago.txt', `type-ahead jumps past the dividers to its row (${await selectedName()})`)

    // THE SWEEP across a divider marks rows only.
    const rowsTop = await win.locator(`${list} [data-browse-path$="${order[0]}"]`).boundingBox()
    const rowsBottom = await win.locator(`${list} [data-browse-path$="${order[3]}"]`).boundingBox()
    const x = rowsTop.x + rowsTop.width - 30
    await win.mouse.move(x, rowsTop.y + rowsTop.height / 2)
    await win.mouse.down()
    await win.mouse.move(x - 10, rowsTop.y + 20, { steps: 3 })
    await win.mouse.move(x - 20, rowsBottom.y + rowsBottom.height / 2, { steps: 8 })
    await win.mouse.up()
    await sleep(200)
    const marked = await win.evaluate((sel) => ({
      rows: [...document.querySelectorAll(`${sel} [data-selected]`)].map((r) => (r.getAttribute('data-browse-path') ?? '').split(/[\\/]/).pop()),
      dividers: document.querySelectorAll(`${sel} .browse-divider[data-selected]`).length
    }), list)
    ok(
      marked.dividers === 0 && marked.rows.join('|') === order.slice(0, 4).join('|'),
      `a sweep over a divider marks the four rows and nothing else (${JSON.stringify(marked)})`
    )
    await win.keyboard.press('Escape')

    // NAME: any folder's view. DATE MODIFIED: Downloads' again, newest first.
    const cell = (key) => win.locator(`.browse-list-area .browse-columns .browse-column-${key}`)
    await cell('name').click()
    const byName = [...plan.filter((p) => p[1]), ...plan.filter((p) => !p[1])]
      .map((p) => p[0])
    const nameOrder = [
      ...byName.filter((n) => / folder$/.test(n)).sort((a, b) => a.localeCompare(b)),
      ...byName.filter((n) => !/ folder$/.test(n)).sort((a, b) => a.localeCompare(b))
    ]
    ok(
      await until(async () => (await drawn()).join('|') === nameOrder.join('|'), 5000, 100),
      `Name puts folders first, by name, with no dividers (${(await drawn()).join(' | ')})`
    )
    await win.screenshot({ path: join(SHOTS, 'downloads-name.png'), clip: { x: listBox.x - 4, y: listBox.y - 40, width: listBox.width + 8, height: Math.min(listBox.height + 44, 520) } })
    await cell('modified').click()
    ok(
      await until(async () => (await drawn()).join('|') === expected.join('|'), 5000, 100),
      `Date modified brings Downloads' view back, newest first on the first click (${(await drawn()).join(' | ')})`
    )

    // ANOTHER FOLDER by date: folders first, no dividers.
    await win.locator(`${list}`).focus()
    await win.keyboard.press('Alt+ArrowUp')
    await until(async () => (await win.locator(`${list} [data-browse-path$="dl-date-other"]`).count()) === 1, 8000, 100)
    await win.locator(`${list} [data-browse-path$="dl-date-other"]`).dblclick()
    await until(async () => (await win.locator(`${list} [data-browse-path$="a-file.txt"]`).count()) === 1, 8000, 100)
    await cell('modified').click()
    await sleep(400)
    const other = await drawn()
    ok(
      other.join('|') === 'zz-folder|a-file.txt' && !other.some((x) => x.startsWith('#')),
      `another folder by date keeps folders first and has no dividers (${other.join(' | ')})`
    )
  } finally {
    await app.close().catch(() => {})
    rmSync(dl, { recursive: true, force: true })
    rmSync(elsewhere, { recursive: true, force: true })
  }
}
/**
 * THE COLUMN HEADER IS FILE EXPLORER'S (#274; owner, 2026-10-04, of the
 * Explorer list's header: "if I highlight over name, it doesn't reach all the
 * way out to the edges ... that highlight effect should be inside the whole
 * box", "the size column should also have its name aligned to the left", and
 * of the arrows, "that arrow shows only when you hover over them while the
 * currently sorted item has an arrow at all times"). MEASURED: the visible
 * cells tile the header from its left edge to its right with no gap, each as
 * tall as the header; the hover fill is the cell's own box; Size's label
 * starts where the other labels do; an unsorted column's arrow shows only
 * while hovered and the sorted one's always; a hover never moves a label;
 * focus is the fill and no box. Held at Medium, Small and Large, in the
 * search results' columns and at a narrow window. A screenshot of the header
 * with Type hovered goes to .e2e/shots/column-header-hover.png.
 */
async function columnHeadersScenario(fixtures) {
  console.log('column headers')
  const dir = join(fixtures, 'colhead')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'b-small.txt'), 'x\n')
  writeFileSync(join(dir, 'a-big.txt'), 'y'.repeat(4000))
  writeFileSync(join(dir, 'c-mid.txt'), 'z'.repeat(400))
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'b-small.txt'))
  EXTRA_ENV = {}
  const intoFolder = async () => {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await win.locator('[data-testid="browse-list"] [data-browse-path$=".txt"]').count()) !== 3)
      await win.locator('[data-testid="browse-list"] [data-browse-path$="colhead"]').dblclick()
    return until(async () => (await win.locator('[data-testid="browse-list"] [data-browse-path$=".txt"]').count()) === 3, 10000)
  }
  const head = '.browse-list-area .browse-columns'
  const cell = (key) => win.locator(`${head} .browse-column-${key}`)
  // The visible cells, left to right, against the header's own box (inside
  // its bottom rule, which the cells sit on).
  const geometry = () =>
    win.evaluate((sel) => {
      const h = document.querySelector(sel)
      if (!h) return null
      const hr = h.getBoundingClientRect()
      const cs = getComputedStyle(h)
      const inner = hr.height - parseFloat(cs.borderBottomWidth)
      const cells = [...h.querySelectorAll('button')]
        .filter((b) => getComputedStyle(b).display !== 'none')
        .map((b) => {
          const r = b.getBoundingClientRect()
          const text = [...b.childNodes].find((n) => n.nodeType === 3)
          const range = document.createRange()
          if (text) range.selectNodeContents(text)
          const t = text ? range.getBoundingClientRect() : null
          return {
            key: b.className.replace('browse-column-', ''),
            left: r.left,
            right: r.right,
            top: r.top,
            h: r.height,
            label: t ? t.left - r.left : null,
            labelX: t ? t.left : null
          }
        })
      return { left: hr.left, right: hr.right, top: hr.top, inner, cells }
    }, head)
  const tiles = (g) => {
    if (!g || !g.cells.length) return false
    const near = (a, b) => Math.abs(a - b) <= 0.6
    return (
      near(g.cells[0].left, g.left) &&
      near(g.cells[g.cells.length - 1].right, g.right) &&
      g.cells.every((c, i) => i === 0 || near(c.left, g.cells[i - 1].right)) &&
      g.cells.every((c) => near(c.h, g.inner) && near(c.top, g.top))
    )
  }
  const say = (g) => JSON.stringify(g?.cells.map((c) => [c.key, Math.round(c.left), Math.round(c.right), c.h]))
  const arrow = (key) =>
    win.evaluate(
      ([sel, k]) => {
        const a = document.querySelector(`${sel} .browse-column-${k} .browse-sort-arrow`)
        return a ? Number(getComputedStyle(a).opacity) : -1
      },
      [head, key]
    )
  const away = async () => {
    const list = await win.locator('[data-testid="browse-list"]').boundingBox()
    await win.mouse.move(list.x + list.width / 2, list.y + list.height - 4)
    await sleep(250)
  }
  const names = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('[data-testid="browse-list"] [data-browse-path$=".txt"]')].map((r) =>
        r.getAttribute('data-browse-path').split(/[\\/]/).pop()
      )
    )
  try {
    ok(await intoFolder(), 'the Explorer shows the folder of three')
    await away()
    const g = await geometry()
    ok(tiles(g), `the cells tile the header edge to edge, each its full height (${say(g)}; header ${g?.left}-${g?.right}, ${g?.inner}px)`)
    const labels = Object.fromEntries(g.cells.map((c) => [c.key, c.label]))
    ok(
      labels.size !== null && Math.abs(labels.size - labels.type) <= 0.6 && Math.abs(labels.size - labels.modified) <= 0.6,
      `Size's label starts where Type's and Date modified's do (${JSON.stringify(labels)})`
    )
    const sizeHead = await cell('size').evaluate((b) => getComputedStyle(b).justifyContent)
    ok(sizeHead !== 'flex-end', `and the Size header is not pushed right (${sizeHead})`)
    const sizeValue = await win
      .locator('[data-testid="browse-list"] .browse-row .browse-column-size')
      .first()
      .evaluate((s) => getComputedStyle(s).textAlign)
    ok(sizeValue === 'right', `the size VALUES stay right-aligned so digits line up (${sizeValue})`)

    // THE ARROWS: Name is sorted, so its arrow shows; Type's only while hovered.
    ok((await arrow('name')) === 1, 'the sorted column shows its arrow without a hover')
    ok((await arrow('type')) === 0 && (await arrow('size')) === 0, 'an unsorted column shows none')
    const before = await geometry()
    await cell('type').hover()
    await sleep(250)
    ok((await arrow('type')) === 1, 'hovering Type shows its arrow')
    const hovered = await geometry()
    ok(
      hovered.cells.every((c, i) => Math.abs(c.labelX - before.cells[i].labelX) <= 0.1),
      'and no label moves for it'
    )
    // The fill is the cell's own box: the button paints it, and the button is
    // the whole cell, so every corner of the cell is the hovered button.
    const fill = await win.evaluate((sel) => {
      const b = document.querySelector(`${sel} .browse-column-type`)
      const r = b.getBoundingClientRect()
      const at = (x, y) => document.elementFromPoint(x, y)?.closest('button') === b
      return {
        bg: getComputedStyle(b).backgroundColor,
        corners: [at(r.left + 0.5, r.top + 0.5), at(r.right - 0.5, r.top + 0.5), at(r.left + 0.5, r.bottom - 0.5), at(r.right - 0.5, r.bottom - 0.5)]
      }
    }, head)
    ok(
      !/rgba\(0, 0, 0, 0\)|transparent/.test(fill.bg) && fill.corners.every(Boolean),
      `the hover fill covers the whole cell, corner to corner (${JSON.stringify(fill)})`
    )
    const box = await win.locator(head).boundingBox()
    await win.screenshot({
      path: join(SHOTS, 'column-header-hover.png'),
      clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 60 }
    })
    // The right-most cell reaches the list's own right edge: no strip of
    // header past Date modified that a hover cannot fill.
    await cell('modified').hover()
    await sleep(250)
    const right = await win.evaluate((sel) => {
      const h = document.querySelector(sel).getBoundingClientRect()
      const hit = document.elementFromPoint(h.right - 1, h.top + h.height / 2)?.closest('button')
      return hit?.className ?? null
    }, head)
    ok(right === 'browse-column-modified', `the header's last pixel on the right is Date modified's (${right})`)

    // CLICKS STILL SORT: Size ascending, then descending, then back to Name.
    await cell('size').click()
    ok(await until(async () => (await names()).join() === 'b-small.txt,c-mid.txt,a-big.txt', 5000), `a click on Size sorts smallest first (${await names()})`)
    await away()
    ok((await arrow('size')) === 1 && (await arrow('name')) === 0, 'and the arrow moves to Size, held without a hover')
    await cell('size').click()
    ok(await until(async () => (await names()).join() === 'a-big.txt,c-mid.txt,b-small.txt', 5000), `a second click flips it (${await names()})`)
    ok(
      (await cell('size').locator('.browse-sort-arrow').getAttribute('data-descending')) === 'true',
      'and the arrow turns for descending'
    )
    await cell('name').click()
    ok(await until(async () => (await names()).join() === 'a-big.txt,b-small.txt,c-mid.txt', 5000), 'Name puts the order back')

    // NO FOCUS BOX: a key-driven focus wears the fill, and no outline.
    await win.keyboard.press('Shift')
    await cell('type').focus()
    await away()
    const focus = await cell('type').evaluate((b) => ({
      outline: getComputedStyle(b).outlineStyle,
      bg: getComputedStyle(b).backgroundColor,
      visible: b.matches(':focus-visible')
    }))
    ok(
      focus.visible && focus.outline === 'none' && !/rgba\(0, 0, 0, 0\)/.test(focus.bg),
      `a focused header cell shows the fill and no box (${JSON.stringify(focus)})`
    )
    await win.locator('[data-testid="browse-list"]').focus()

    // EVERY EXPLORER SIZE tiles the same way.
    for (const size of ['Small', 'Large', 'Medium']) {
      await pickStyleSegment(win, 'explorer-size', size)
      ok(await intoFolder(), `${size}: back in the Explorer`)
      await away()
      const gs = await geometry()
      ok(tiles(gs), `${size}: the cells tile the header (${say(gs)}, ${gs?.inner}px tall)`)
    }

    // A NARROW WINDOW hides columns; whatever is last still reaches the edge.
    const sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 560))
    await until(() => win.evaluate(() => window.innerWidth <= 800), 4000, 50)
    await sleep(300)
    const gn = await geometry()
    ok(gn.cells.length < 4 && tiles(gn), `at a narrow window the fewer cells still tile (${say(gn)})`)
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sizeBefore)
    await until(() => win.evaluate((w) => window.innerWidth >= w - 40, sizeBefore[0]), 4000, 50)
    await sleep(300)

    // THE SEARCH RESULTS' columns (Name, Path, Size) tile too, Size last.
    await win.locator('[data-testid="browse-search-button"]').click()
    const popup = win.locator('[data-testid="browse-search-popup"]')
    await popup.locator('input[role="combobox"]').fill('txt')
    await until(async () => (await popup.locator('[data-show-more]').count()) === 1, 15000)
    await popup.locator('[data-show-more]').click()
    ok(await until(async () => (await win.locator('.browse-list-area[data-searching]').count()) === 1, 15000), 'the full search shows its own columns')
    await away()
    const gq = await geometry()
    ok(
      gq.cells.map((c) => c.key).join() === 'name,path,size' && tiles(gq),
      `and they tile the header, Size reaching the edge (${say(gq)})`
    )
    await win.locator('[data-testid="browse-search-clear"]').click()
  } finally {
    await win.evaluate(() => localStorage.removeItem('prism.explorer.size')).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
/**
 * THE ADDRESS IS A DOLPHIN FIELD, AND A FIELD ON BLACK IS A DARK GREY (#267;
 * owner, 2026-10-04, of the Explorer toolbar on Void: "make the url box more
 * visible and for the black theme make the grey colours used in search and in
 * the url bar darker grey", then, showing KDE Dolphin: "the url bar in the
 * image looks really clean too so copy that style"). One rounded, bordered
 * field across the toolbar's middle: a chevron LEADS every name, the folder
 * you are in is bold, a click on a name goes there and a click on the empty
 * part edits the path. On a near-black ground (MEASURED, not read off the
 * style's name) the fill is --p-field's dark step; anywhere else it is
 * --p-control. The toolbar is back, forward, up, refresh, the field, the
 * preview toggle and the search button, in that order. Screenshots of the
 * toolbar on Void and on Paper go to .e2e/shots.
 */
async function addressFieldScenario(fixtures) {
  console.log('address field')
  const dir = join(fixtures, 'addrfield')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const n of ['a1.txt', 'a2.txt']) writeFileSync(join(dir, n), `field ${n}\n`)
  // Deep enough that the path cannot fit the field.
  const deep = join(dir, 'a-rather-long-folder-name-one', 'another-quite-long-folder-two', 'and-a-third-long-folder-three', 'four-is-also-long', 'five')
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'end.txt'), 'deep\n')
  const { app, win } = await launch(join(dir, 'a1.txt'))
  let before
  const rgb = (c) => (c.match(/[\d.]+/g) ?? []).map(Number)
  const lum = ([r, g, b]) => {
    const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const look = () =>
    win.evaluate(() => {
      const tb = document.querySelector('.folder-browser [data-testid="browse-toolbar"]')
      const nav = tb?.querySelector('nav.browse-path')
      const s = nav ? getComputedStyle(nav) : null
      const r = nav?.getBoundingClientRect()
      const crumbs = [...(nav?.querySelectorAll('.browse-crumb') ?? [])]
      const current = nav?.querySelector('button[aria-current]')
      const other = nav?.querySelector('.browse-crumb button:not([aria-current])')
      return {
        path: s && r ? { h: r.height, w: r.width, radius: s.borderTopLeftRadius, fill: s.backgroundColor, edge: s.borderTopColor, edgeW: s.borderTopWidth } : null,
        ground: tb ? getComputedStyle(tb).backgroundColor : null,
        // Each name is led by its chevron: the first child of every crumb.
        leading: crumbs.length > 0 && crumbs.every((c) => c.firstElementChild?.tagName.toLowerCase() === 'svg'),
        crumbs: crumbs.length,
        currentWeight: current ? getComputedStyle(current).fontWeight : null,
        current: current?.textContent ?? null,
        crumb: other ? getComputedStyle(other).color : null,
        // The toolbar's own order, left to right.
        order: [...(tb?.children ?? [])].flatMap((el) =>
          el.classList.contains('browse-history')
            ? [...el.children].map((b) => b.getAttribute('aria-label'))
            : el.matches('nav.browse-path')
              ? ['address']
              : [el.getAttribute('aria-label') ?? el.className]
        ),
        inputs: tb?.querySelectorAll('input').length ?? -1
      }
    })
  const intoFolder = async () => {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    // By NAME, not by counting two .txt rows: the reload scenario leaves
    // reload.txt beside notes.txt, so the fixtures folder has two as well and
    // the old test stayed there (seen in a full gate run, review of #271).
    const inside = async () =>
      (await win.locator('[data-testid="browse-list"] [data-browse-path$="addrfield\\\\a1.txt"]').count()) === 1
    if (!(await inside())) await win.locator('[data-testid="browse-list"] [data-browse-path$="addrfield"]').dblclick()
    return until(inside, 10000)
  }
  const shoot = (name) =>
    win.locator('.folder-browser [data-testid="browse-toolbar"]').first().screenshot({ path: join(SHOTS, `address-field-${name}.png`) })
  try {
    ok(await intoFolder(), 'the Explorer shows the folder')
    before = await switchStyle(win, 'new-void')
    await sleep(500)
    const v = await look()
    console.log('  void', JSON.stringify(v))
    await shoot('void')
    await switchStyle(win, 'paper')
    await sleep(500)
    const p = await look()
    console.log('  paper', JSON.stringify(p))
    await shoot('paper')
    ok(
      JSON.stringify(v.order) === JSON.stringify(['Back', 'Forward', 'Up', 'Refresh folder', 'address', 'Preview pane', 'Search this folder and subfolders']),
      `the toolbar runs back, forward, up, refresh, the field, preview, search (${v.order.join(', ')})`
    )
    ok(v.inputs === 0, 'the toolbar holds no search field any more')
    for (const [name, l] of [['Void', v], ['Paper', p]]) {
      // One CSS pixel, which Chromium reports in device pixels at 112.5%.
      ok(l.path && l.path.h === 36 && parseFloat(l.path.edgeW) > 0.5 && parseFloat(l.path.edgeW) <= 1, `${name}: the address is a 36px field with a 1px edge (${l.path?.h}, ${l.path?.edgeW})`)
      ok(parseFloat(l.path.radius) > 0, `${name}: its corners are rounded (${l.path.radius})`)
      ok(l.leading, `${name}: a chevron leads every name (${l.crumbs} names)`)
      ok(Number(l.currentWeight) >= 600 && l.current === 'addrfield', `${name}: the folder you are in is bold (${l.current}, ${l.currentWeight})`)
      const cr = contrast(rgb(l.crumb), rgb(l.path.fill))
      ok(cr >= 4.5, `${name}: a name reads on the field (${cr.toFixed(2)}:1)`)
    }
    // On Void the fill is DARKER than the old control step (rgb 8,8,8), still
    // a step off the black, and a quiet edge carries the box (owner,
    // 2026-10-04: "the white border stands out too much on the black theme").
    ok(lum(rgb(v.path.fill)) < lum([8, 8, 8]) && lum(rgb(v.path.fill)) > 0, `Void: the field is a darker grey than before (${v.path.fill})`)
    const edge = contrast(rgb(v.path.edge), rgb(v.ground))
    ok(edge >= 1.5 && edge < 1.9, `Void: the field's edge is a quiet line, not a white frame (${edge.toFixed(2)}:1)`)
    ok(p.path.fill === 'rgb(231, 231, 232)', `Paper: the field wears the control fill (${p.path.fill})`)
    ok(v.path.fill !== p.path.fill, 'Void and Paper fill the field differently')
    // A hover strengthens the edge and leaves the fill alone.
    const pathBox = win.locator('.folder-browser [data-testid="browse-toolbar"] nav.browse-path')
    await pathBox.hover({ position: { x: Math.round(p.path.w) - 12, y: 18 } })
    await sleep(150)
    const hovered = await look()
    ok(hovered.path.fill === p.path.fill && hovered.path.edge !== p.path.edge, `Paper: a hover strengthens the edge only (${hovered.path.edge}, ${hovered.path.fill})`)
    // A name goes there; the field's empty part edits the path.
    await win.locator('.folder-browser nav.browse-path .browse-crumb button').nth(v.crumbs - 2).click()
    ok(await until(async () => (await look()).current !== 'addrfield', 8000), 'a click on a name goes to that folder')
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await look()).current === 'addrfield', 8000), 'and Back returns')
    await pathBox.click({ position: { x: Math.round(p.path.w) - 12, y: 18 } })
    const editing = win.locator('.folder-browser input[aria-label="Folder path"]')
    ok(await until(async () => (await editing.count()) === 1, 5000), 'a click on the empty part edits the path')
    await editing.fill(deep)
    await editing.press('Enter')
    ok(await until(async () => (await look()).current === 'five', 8000), 'and a typed path is gone to')
    const clip = await win.evaluate(() => {
      const row = document.querySelector('.folder-browser .browse-crumbs')
      const field = document.querySelector('.folder-browser nav.browse-path').getBoundingClientRect()
      const last = row.querySelector('button[aria-current]').getBoundingClientRect()
      return { clipped: row.hasAttribute('data-clipped'), over: row.scrollWidth > row.clientWidth, inside: last.right <= field.right + 0.5 && last.left >= field.left }
    })
    ok(clip.over && clip.clipped && clip.inside, `a long path keeps its end in view and fades its start (${JSON.stringify(clip)})`)
    await shoot('long-path')
  } finally {
    if (before !== undefined) await switchStyle(win, before).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * NO ACTION ROW (#267; owner, 2026-10-04: "i think we should remove our quick
 * action buttons"). Open, Open as project, Copy, Rename, Delete and the "..."
 * are gone from above the list, which takes their height; every one of them
 * is still on the row's right-click menu and its key, and this proves each.
 */
async function explorerVerbsScenario(fixtures) {
  console.log('explorer verbs without the action row')
  const dir = join(fixtures, 'verbs')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'sub'), { recursive: true })
  for (const n of ['alpha.txt', 'beta.txt']) writeFileSync(join(dir, n), `verbs ${n}\n`)
  writeFileSync(join(dir, 'sub', 'inner.txt'), 'inner\n')
  const { app, win } = await launch(join(dir, 'alpha.txt'))
  const row = (suffix) => win.locator(`[data-testid="browse-list"] [data-browse-path$="${suffix}" i]`).first()
  const current = () => win.evaluate(() => document.querySelector('.folder-browser nav.browse-path button[aria-current]')?.textContent ?? '')
  const menu = async (suffix, label) => {
    await row(suffix).locator('.browse-name-text').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    await win.getByRole('menuitem', { name: new RegExp(`^${label}`) }).first().click()
  }
  const projects = () => win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()
  try {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if (!(await row('alpha.txt').count())) await row('\\verbs').dblclick()
    ok(await until(async () => (await row('alpha.txt').count()) === 1, 10000), 'the Explorer shows the folder')

    const shape = await win.evaluate(() => {
      const tb = document.querySelector('.folder-browser [data-testid="browse-toolbar"]').getBoundingClientRect()
      const list = document.querySelector('.folder-browser .browse-list-area').getBoundingClientRect()
      return {
        row: document.querySelectorAll('.folder-browser .browse-actions, .folder-browser [aria-label="File actions"], .folder-browser [aria-label="More file actions"]').length,
        gap: list.top - tb.bottom
      }
    })
    ok(shape.row === 0, 'no action row and no "..." button')
    ok(Math.abs(shape.gap) <= 1, `the list starts right under the toolbar (${shape.gap}px)`)

    // ENTER opens: a folder is gone into.
    await row('\\sub').locator('.browse-name-text').click()
    await win.locator('[data-testid="browse-list"]').focus()
    await win.keyboard.press('Enter')
    ok(await until(async () => (await current()) === 'sub', 8000), 'Enter on a folder goes into it')
    await win.keyboard.press('Alt+ArrowUp')
    ok(await until(async () => (await current()) === 'verbs', 8000), 'Alt+Up comes back')

    // F2 renames.
    await row('beta.txt').locator('.browse-name-text').click()
    await win.keyboard.press('F2')
    const name = win.locator('[role="dialog"] input[aria-label="New name"]')
    ok(await until(async () => (await name.count()) === 1, 5000), 'F2 asks for a new name')
    await name.fill('gamma.txt')
    await name.press('Enter')
    ok(await until(() => existsSync(join(dir, 'gamma.txt')) && !existsSync(join(dir, 'beta.txt')), 8000), 'and the file is renamed')
    ok(await until(async () => (await row('gamma.txt').count()) === 1, 8000), 'and the list shows the new name')

    // Ctrl+C copies the file; Ctrl+V pastes a copy beside it.
    await row('alpha.txt').locator('.browse-name-text').click()
    await win.keyboard.press('Control+c')
    ok(await until(() => win.evaluate(() => window.prism.clipboardHasFiles()), 8000), 'Ctrl+C puts the file on the clipboard')
    await win.keyboard.press('Control+v')
    ok(await until(() => existsSync(join(dir, 'alpha (2).txt')), 15000), 'Ctrl+V pastes a copy')
    // Ctrl+X marks it cut.
    await row('gamma.txt').locator('.browse-name-text').click()
    await win.keyboard.press('Control+x')
    ok(await until(async () => (await row('gamma.txt').getAttribute('data-cut')) !== null, 8000), 'Ctrl+X marks the row cut')

    // Del asks before anything goes to the Recycle Bin; Cancel keeps it.
    await row('alpha (2).txt').locator('.browse-name-text').click()
    await win.keyboard.press('Delete')
    ok(await until(async () => (await win.getByRole('dialog', { name: 'Move to the Recycle Bin?' }).count()) === 1, 5000), 'Del asks to delete')
    await win.getByRole('button', { name: 'Cancel', exact: true }).click()
    ok(existsSync(join(dir, 'alpha (2).txt')), 'and Cancel keeps the file')

    // The same verbs from the right-click menu.
    await menu('alpha (2).txt', 'Delete')
    ok(await until(async () => (await win.getByRole('dialog', { name: 'Move to the Recycle Bin?' }).count()) === 1, 5000), 'the menu\'s Delete asks too')
    await win.keyboard.press('Escape')
    await menu('gamma.txt', 'Rename')
    ok(await until(async () => (await name.count()) === 1, 5000), 'the menu\'s Rename asks for a name')
    await win.keyboard.press('Escape')
    await win.evaluate(() => navigator.clipboard.writeText('').catch(() => {}))
    await menu('gamma.txt', 'Copy')
    ok(await until(() => win.evaluate(() => window.prism.clipboardHasFiles()), 8000), 'the menu\'s Copy puts the file on the clipboard')
    const before = await projects()
    // COPY PATH SITS RIGHT UNDER COPY (#286; owner, 2026-10-04: "copy and
    // copy path should be right under each other not spread out across the
    // menu"), on a file's row and a folder's, and Show in File Explorer is
    // still there below.
    for (const suffix of ['alpha.txt', '\\sub']) {
      await row(suffix).locator('.browse-name-text').click({ button: 'right' })
      await win.waitForSelector('[role="menu"]', { timeout: 5000 })
      const order = await win.evaluate(() =>
        [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => (e.textContent ?? '').trim())
      )
      const copyAt = order.findIndex((t) => t.startsWith('Copy') && !t.startsWith('Copy path'))
      const pathAt = order.findIndex((t) => t.startsWith('Copy path'))
      ok(
        copyAt >= 0 && pathAt === copyAt + 1 && order.some((t) => t.startsWith('Show in File Explorer')),
        `${suffix}: Copy path is right under Copy (${JSON.stringify(order)})`
      )
      await win.keyboard.press('Escape')
      await until(() => win.evaluate(() => !document.querySelector('[role="menu"]')), 3000)
    }

    await menu('\\sub', 'Open as project')
    ok(await until(async () => (await projects()) === before + 1, 8000), 'the menu\'s Open as project opens a project tab')
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    await menu('alpha.txt', 'Open')
    ok(await until(() => win.evaluate(() => !!document.querySelector('.cm-editor')?.getClientRects().length), 10000), 'the menu\'s Open opens the file')
  } finally {
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * SEARCH IS A POPUP (#267; owner, 2026-10-04, showing PowerToys Run: "the
 * search field should be a search icon only that displays a search pop up on
 * click like this but centered on screen and blurred background behind ... the
 * most likely ones, and at the bottom there's a show more which essentially
 * does a normal search like before"). The button and Ctrl+F open it centred
 * over a blurred window; typing lists the likely names first, the arrows and
 * Enter open one, Escape puts it away and gives the focus back, and Show more
 * (or Ctrl+Enter) runs the list's full search. Ctrl+F in an editor or a shell
 * is still theirs, and the popup leaves when what is in front changes.
 */
// A SEARCH ENDS WHEN YOU GO SOMEWHERE, AND BACK RETURNS TO IT (#281; owner,
// 2026-10-04: "if you click into a folder from a search you're not in search
// anymore, and if you click back then you're back to the search results. if
// you click something in the sidebar you're not in search anymore, but if you
// click back arrow you go to the search list again"). It used to stay on: the
// query lived on the folder's history entry, so the sidebar place of the
// folder searched (the C drive, in the owner's case) came back filtered.
async function searchNavScenario(fixtures) {
  console.log('search nav')
  const dir = join(fixtures, 'searchnav')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'alpha'), { recursive: true })
  mkdirSync(join(dir, 'beta'), { recursive: true })
  writeFileSync(join(dir, 'alpha-root.txt'), 'a\n')
  writeFileSync(join(dir, 'other.txt'), 'o\n')
  writeFileSync(join(dir, 'alpha', 'inside.txt'), 'i\n')
  writeFileSync(join(dir, 'beta', 'alpha-deep.txt'), 'd\n')
  // The walk, not the index: see searchPopupScenario.
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'other.txt'))
  EXTRA_ENV = {}
  const popup = win.locator('[data-testid="browse-search-popup"]')
  const field = popup.locator('input[role="combobox"]')
  const list = win.locator('[data-testid="browse-list"]')
  const status = win.locator('[data-testid="browse-search-status"]')
  const button = win.locator('[data-testid="browse-search-button"]')
  const back = win.locator('.folder-browser [data-testid="browse-toolbar"] button[aria-label="Back"]')
  const forward = win.locator('.folder-browser [data-testid="browse-toolbar"] button[aria-label="Forward"]')
  const current = () => win.evaluate(() => document.querySelector('.folder-browser nav.browse-path button[aria-current]')?.textContent ?? '')
  const rows = () => list.locator('[data-browse-path]').evaluateAll((els) => els.map((el) => el.getAttribute('data-browse-path').split('\\').pop()).sort())
  // A CSS backslash is itself escaped: `\a` and `\b` would be hex escapes.
  const row = (name) => list.locator(`[data-browse-path$="\\\\${name}" i]`).first()
  // In the folder named, unfiltered: no search status, the button unlit, and
  // the rows exactly the folder's own.
  const plain = async (name, want) =>
    until(async () => (await current()) === name && (await status.count()) === 0 && (await button.getAttribute('data-active')) === null && JSON.stringify(await rows()) === JSON.stringify(want), 10000)
  const searching = async () =>
    until(async () => (await current()) === 'searchnav' && (await status.count()) === 1 && (await button.getAttribute('data-active')) !== null && JSON.stringify(await rows()) === JSON.stringify(['alpha', 'alpha-deep.txt', 'alpha-root.txt']), 15000)
  const own = ['alpha', 'alpha-root.txt', 'beta', 'other.txt']
  try {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await current()) !== 'searchnav') await row('searchnav').dblclick()
    ok(await plain('searchnav', own), 'the Explorer shows the folder')

    // The folder the search runs in, pinned in the sidebar: the owner's C drive.
    await win.locator('.folder-browser [data-testid="browse-toolbar"] button[aria-label="Up"]').click()
    await until(async () => (await current()) !== 'searchnav', 8000)
    await row('searchnav').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    const pin = win.locator('.browse-places .quick-access-pin[data-quick-access-path$="\\\\searchnav" i]')
    ok(await until(async () => (await pin.count()) === 1, 5000), 'the folder is pinned in the sidebar')
    await row('searchnav').dblclick()
    ok(await plain('searchnav', own), 'and is shown again')

    // The list's full search.
    await button.click()
    await field.fill('alpha')
    await field.press('Control+Enter')
    ok(await searching(), `a search shows its results (${JSON.stringify(await rows())})`)

    // 1. A FOLDER OPENED FROM THE RESULTS is shown unfiltered.
    await row('alpha').dblclick()
    ok(await plain('alpha', ['inside.txt']), `a folder opened from the results is not searched (${JSON.stringify(await rows())})`)
    await button.click()
    await popup.waitFor({ timeout: 5000 })
    ok((await field.inputValue()) === '', `and the search box is empty there (${await field.inputValue()})`)
    await field.press('Escape')
    await until(async () => (await popup.count()) === 0, 5000)
    // 3. BACK is the search again.
    await back.click()
    ok(await searching(), 'Back returns to the search results')

    // 2. THE SIDEBAR leaves search, even for the folder the search ran in.
    await pin.click()
    ok(await plain('searchnav', own), `a sidebar place shows the folder unfiltered (${JSON.stringify(await rows())})`)
    await back.click()
    ok(await searching(), 'Back returns to the search results again')
    await forward.click()
    ok(await plain('searchnav', own), 'and Forward to the folder')

    // The search is a place: Back from the results is the folder as it was
    // before the search, and Clear search goes there too.
    await back.click()
    ok(await searching(), 'Back to the results')
    await back.click()
    ok(await plain('searchnav', own), 'Back from the results is the folder before the search')
    await forward.click()
    ok(await searching(), 'Forward is the search')
    await win.locator('[data-testid="browse-search-clear"]').click()
    ok(await plain('searchnav', own), 'Clear search shows the folder')
    await win.screenshot({ path: join(SHOTS, 'search-nav.png') })

    await pin.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).click()
  } finally {
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

async function searchPopupScenario(fixtures) {
  console.log('search popup')
  const dir = join(fixtures, 'searchpop')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'sub', 'deep'), { recursive: true })
  mkdirSync(join(dir, 'reports'), { recursive: true })
  writeFileSync(join(dir, 'report-final.txt'), 'final\n')
  writeFileSync(join(dir, 'quarterly report.md'), '# q\n')
  writeFileSync(join(dir, 'notes.txt'), 'notes\n')
  writeFileSync(join(dir, 'sub', 'report.txt'), 'report\n')
  writeFileSync(join(dir, 'sub', 'deep', 'old-report-draft.txt'), 'draft\n')
  writeFileSync(join(dir, 'reports', 'q1.txt'), 'q1\n')
  // THE WALK, NOT THE INDEX. Under --e2e the index is a private engine built
  // on demand, and MEASURED here its first build had not listed these files
  // (only the folder 'reports') after 60 s, for the list's full search as much
  // as the popup's; a later run found them in 270 ms. A root it may not index
  // sends main's search to its bounded walk, which is the same search the
  // popup and the list share, and answers the same way every run.
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'notes.txt'))
  EXTRA_ENV = {}
  const popup = win.locator('[data-testid="browse-search-popup"]')
  const field = popup.locator('input[role="combobox"]')
  const options = popup.locator('[role="option"]:not([data-show-more])')
  const names = () => popup.locator('[role="option"]:not([data-show-more]) .browse-search-popup-name').allTextContents()
  const current = () => win.evaluate(() => document.querySelector('.folder-browser nav.browse-path button[aria-current]')?.textContent ?? '')
  const open = () => win.locator('[data-testid="browse-search-button"]').click()
  const intoFolder = async () => {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector('[data-testid="browse-list"] .browse-row', { timeout: 10000 })
    if ((await current()) !== 'searchpop') await win.locator('[data-testid="browse-list"] [data-browse-path$="\\searchpop" i]').dblclick()
    return until(async () => (await current()) === 'searchpop', 10000)
  }
  try {
    ok(await intoFolder(), 'the Explorer shows the folder')

    // THE BUTTON: centred, over a blurred window, no shadow, the field focused.
    await open()
    ok(await until(async () => (await popup.count()) === 1, 5000), 'the search button opens the popup')
    const shape = await win.evaluate(() => {
      const box = document.querySelector('[data-testid="browse-search-popup"]')
      const r = box.getBoundingClientRect()
      const scrim = getComputedStyle(box.parentElement)
      return {
        centre: r.left + r.width / 2 - window.innerWidth / 2,
        blur: scrim.backdropFilter,
        shadow: getComputedStyle(box).boxShadow,
        role: box.getAttribute('role'),
        modal: box.getAttribute('aria-modal'),
        focused: document.activeElement?.getAttribute('aria-label')
      }
    })
    ok(Math.abs(shape.centre) <= 1, `it is centred in the window (${shape.centre.toFixed(1)}px off)`)
    ok(/blur\(/.test(shape.blur), `the window behind is blurred (${shape.blur})`)
    ok(shape.shadow === 'none', `no shadow on it (${shape.shadow})`)
    ok(shape.role === 'dialog' && shape.modal === 'true', 'it is a modal dialog')
    ok(shape.focused === 'Search this folder and subfolders', 'and its labelled field has the focus')

    // TYPING lists the likely names, the closest first, each with its folder.
    await field.fill('report')
    ok(await until(async () => (await options.count()) >= 4, 15000), `typing lists the likely matches (${await options.count()})`)
    const listed = await names()
    console.log('  listed', JSON.stringify(listed))
    ok(listed[0] === 'report.txt', `the whole name comes first (${listed[0]})`)
    ok(listed.indexOf('notes.txt') === -1, 'a name that does not match is not listed')
    ok(listed.indexOf('quarterly report.md') > listed.indexOf('report-final.txt'), 'a name that starts with it comes before one with it inside')
    const where = await popup.locator('[role="option"]').first().locator('.browse-search-popup-where').textContent()
    ok(where === 'sub', `each row says its folder (${where})`)
    ok((await popup.locator('[role="listbox"]').count()) === 1 && (await popup.locator('[data-show-more]').count()) === 1, 'a listbox, with Show more at its foot')
    const announced = await popup.locator('[role="status"]').textContent()
    ok(/match/.test(announced ?? ''), `the count is announced (${announced})`)
    await win.screenshot({ path: join(SHOTS, 'search-popup.png') })

    // A PRESS ANYWHERE IN IT keeps the field's focus (review of #268,
    // measured: a press on the magnifier sent the focus to the page, where
    // Escape did nothing and Ctrl+T opened a tab under the popup).
    await popup.locator('.browse-search-popup-field > svg').click()
    await popup.click({ position: { x: 4, y: 4 } })
    ok(await win.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 'a press on the magnifier or the edge keeps the field focused')

    // A MARK BELONGS TO THE WORDS it was made under: one more letter and the
    // old rows, still on screen until the new answer, are marked no more, so
    // Enter cannot open a row picked for the text before.
    await field.press('ArrowDown')
    ok((await popup.locator('[aria-selected="true"]').count()) === 1, 'Down marks a row')
    await field.press('s')
    ok((await popup.locator('[aria-selected="true"]').count()) === 0 && (await field.getAttribute('aria-activedescendant')) === null, 'a letter typed takes the mark away at once')
    await field.press('Backspace')
    ok((await popup.locator('[aria-selected="true"]').count()) === 0, 'and taking the letter back does not bring the old mark back')
    ok(await until(async () => (await popup.locator('.browse-search-popup-spin').count()) === 0 && (await names())[0] === 'report.txt', 15000), 'and the list comes back for the old words')

    // THE ARROWS AND ENTER open the marked file, as a plain open does.
    ok((await popup.locator('[aria-selected="true"]').count()) === 0, 'nothing is marked before the arrows')
    await field.press('ArrowDown')
    ok((await options.first().getAttribute('aria-selected')) === 'true', 'Down marks the first row')
    ok((await field.getAttribute('aria-activedescendant')) === (await options.first().getAttribute('id')), 'and the field points at it')
    await field.press('Enter')
    ok(await until(async () => (await popup.count()) === 0, 5000), 'Enter closes the popup')
    ok(await until(() => win.evaluate(() => /report/.test(document.querySelector('.cm-editor')?.textContent ?? '')), 10000), 'and opens the file')
    // A file opens in its own folder, as a double click there would.
    await win.locator('[data-testid="browse-toolbar"] button[aria-label="Back"]').first().click()
    ok(await until(async () => (await current()) === 'sub', 10000), 'Back shows the file in its own folder')
    await win.locator('.folder-browser [data-testid="browse-toolbar"] button[aria-label="Back"]').click()
    ok(await until(async () => (await current()) === 'searchpop', 10000), 'and Back again returns to where the search began')

    // CTRL+F from the Explorer; ESCAPE gives the focus back.
    await win.locator('[data-testid="browse-list"]').focus()
    await win.keyboard.press('Control+f')
    ok(await until(async () => (await popup.count()) === 1, 5000), 'Ctrl+F in the Explorer opens it')
    // Pressed on its own magnifier first: the keys are still the popup's.
    const tabsBefore = await win.locator('[role="tablist"] [role="tab"]').count()
    await popup.locator('.browse-search-popup-field > svg').click()
    await win.keyboard.press('Control+t')
    await sleep(300)
    ok((await win.locator('[role="tablist"] [role="tab"]').count()) === tabsBefore && (await popup.count()) === 1, 'Ctrl+T over it opens no tab underneath')
    await win.keyboard.press('Escape')
    ok(await until(async () => (await popup.count()) === 0, 5000), 'Escape closes it')
    ok(await win.evaluate(() => !!document.activeElement?.closest('[data-testid="browse-list"]')), 'and the focus is back in the list')
    // A click outside closes it too.
    await open()
    await popup.waitFor({ timeout: 5000 })
    // On the status line, where a click lands on nothing that acts.
    const size = await win.evaluate(() => [window.innerWidth, window.innerHeight])
    await win.mouse.click(Math.round(size[0] / 2), size[1] - 8)
    ok(await until(async () => (await popup.count()) === 0, 5000), 'a click outside closes it')

    // A FOLDER is gone into.
    await open()
    await field.fill('reports')
    ok(await until(async () => (await names()).includes('reports'), 15000), 'a folder is listed')
    const at = (await names()).indexOf('reports')
    for (let i = 0; i <= at; i++) await field.press('ArrowDown')
    await field.press('Enter')
    ok(await until(async () => (await current()) === 'reports', 8000), 'Enter on a folder goes into it')
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await current()) === 'searchpop', 8000), 'Back returns')

    // SHOW MORE runs the full search in the list, Ctrl+Enter the same.
    await open()
    await field.fill('report')
    await until(async () => (await options.count()) >= 4, 15000)
    await popup.locator('[data-show-more]').click()
    ok(await until(async () => (await popup.count()) === 0, 5000), 'Show more closes the popup')
    const searched = () => win.locator('[data-testid="browse-list"] [data-browse-path]').count()
    ok(await until(async () => (await searched()) >= 5 && (await win.locator('[data-testid="browse-search-status"]').count()) === 1, 15000), `and the list shows every match (${await searched()})`)
    ok((await win.locator('[data-testid="browse-search-button"]').getAttribute('data-active')) !== null, 'the search button is lit while it does')
    await win.locator('[data-testid="browse-search-clear"]').click()
    ok(await until(async () => (await win.locator('[data-testid="browse-search-status"]').count()) === 0, 8000), 'Clear search goes back to the folder')
    await open()
    await field.fill('draft')
    await field.press('Control+Enter')
    ok(await until(async () => (await popup.count()) === 0 && (await win.locator('[data-testid="browse-list"] [data-browse-path$="old-report-draft.txt"]').count()) === 1, 15000), 'Ctrl+Enter runs the full search too')
    await win.locator('[data-testid="browse-search-clear"]').click()

    // ONE LAYER: it does not open over a question, and leaves with its tab.
    await win.locator('[data-testid="browse-list"] [data-browse-path$="notes.txt"] .browse-name-text').click()
    await win.keyboard.press('Delete')
    await win.getByRole('dialog', { name: 'Move to the Recycle Bin?' }).waitFor({ timeout: 5000 })
    await win.locator('[data-testid="browse-search-button"]').evaluate((b) => b.click())
    await sleep(300)
    ok((await popup.count()) === 0, 'it does not open over a question')
    await win.getByRole('button', { name: 'Cancel', exact: true }).click()
    await open()
    await popup.waitFor({ timeout: 5000 })
    await win.evaluate(() => document.querySelector('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]')?.click())
    ok(await until(async () => (await popup.count()) === 0, 5000), 'a tab switch puts it away')
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await sleep(400)
    ok((await popup.count()) === 0, 'and it does not come back with the tab')

    // A TERMINAL'S BUTTONS give the address field the room (review of #268,
    // measured 266px of field at a 913px window with their words). Since #148
    // no way in the app puts a shell on an Explorer tab, so App's own markup
    // for them (an icon and its words per button) is put in the toolbar here
    // and measured with the real CSS at a wide and a narrow Explorer: words
    // where it is wide, icons where it is not.
    const fits = await win.evaluate(async () => {
      const fb = document.querySelector('.folder-browser')
      const tb = fb.querySelector('[data-testid="browse-toolbar"]')
      const icon = tb.querySelector('[data-testid="browse-search-button"] svg').outerHTML
      const box = document.createElement('div')
      box.className = 'browse-terminal-controls'
      box.innerHTML =
        '<div class="browse-terminal-actions">' +
        ['Return to terminal', 'Terminal folder', 'Use folder in terminal']
          .map((label, i) => `<button aria-label="${label}"${i === 2 ? ' class="browse-cd"' : ''}>${icon}<span>${label}</span></button>`)
          .join('') +
        '</div>'
      tb.insertBefore(box, tb.querySelector('button[aria-label="Preview pane"]'))
      const at = async (width) => {
        fb.style.width = `${width}px`
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
        const field = tb.querySelector('nav.browse-path').getBoundingClientRect().width
        const words = [...box.querySelectorAll('span')].some((s) => s.getClientRects().length)
        return { width, field: Math.round(field), words, controls: Math.round(box.getBoundingClientRect().width), overflow: tb.scrollWidth > tb.clientWidth + 1 }
      }
      const out = [await at(1400), await at(1000), await at(760)]
      box.remove()
      fb.style.width = ''
      return out
    })
    console.log('  terminal controls', JSON.stringify(fits))
    const [wide, mid, narrow] = fits
    ok(wide.words && !wide.overflow && wide.field >= 300, `a wide Explorer shows the words and keeps the field (${JSON.stringify(wide)})`)
    ok(!mid.words && !mid.overflow && mid.field >= 300, `a narrower one shows icons and the field keeps its room (${JSON.stringify(mid)})`)
    ok(!narrow.words && !narrow.overflow && narrow.field >= 250, `and so does a narrow one (${JSON.stringify(narrow)})`)

    // CTRL+F IN AN EDITOR IS THE EDITOR'S.
    await win.locator('[data-testid="browse-list"] [data-browse-path$="notes.txt"]').dblclick()
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    await win.locator('.cm-content:visible').first().click()
    await win.keyboard.press('Control+f')
    ok(await until(async () => (await win.locator('.cm-search').count()) > 0, 5000), 'Ctrl+F in the editor opens its own find')
    ok((await popup.count()) === 0, 'and not the popup')
    await win.keyboard.press('Escape')
    // AND IN A SHELL, the shell's.
    await win.keyboard.press('Control+`')
    const shell = await until(async () => (await win.locator('.xterm').count()) > 0, 20000)
    if (shell) {
      await win.waitForFunction(() => !!document.activeElement?.closest('.xterm'), null, { timeout: 10000 }).catch(() => {})
      await win.keyboard.press('Control+f')
      await sleep(500)
      ok((await popup.count()) === 0, 'Ctrl+F in a terminal does not open the popup')
      await win.keyboard.press('Control+`')
    } else ok(false, 'a terminal opened for the Ctrl+F check')

  } finally {
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
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

/**
 * THE ACCENT CAN BE SEE-THROUGH (#249; owner, 2026-10-02: "the accent colour
 * should be able to have an alpha value", fills only), set in the core's
 * colour picker since the rework (owner, 2026-10-03: alpha "should be built
 * into the colour pickers ... it should not be a separate opacity setting").
 * Driven as a user would: Shift+Left on the picker's Alpha slider, then eight
 * hex digits typed into the code field. Then a selected row is MEASURED: its
 * fill carries the alpha, and its label clears 4.5:1 against the fill as the
 * eye gets it (laid over the sidebar's own ground). A Reset link, being text,
 * stays opaque. The accent Reset puts everything back, and the draft is
 * restored in `finally`, since the profile is shared.
 */
async function accentOpacityScenario(fixtures) {
  console.log('accent opacity')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  let draftBefore = null
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    draftBefore = await win.evaluate(() => localStorage.getItem('prism.style.draft'))
    await settingsPage(win, 'appearance')
    const row = win.locator('[data-colour-row="c-accent"]')
    const field = row.locator('input:not([type])')
    await field.waitFor({ timeout: 8000 })
    await field.scrollIntoViewIfNeeded()
    ok((await win.locator('#c-accent-alpha, [data-pref="c-accent-alpha"]').count()) === 0, 'there is no Accent opacity row')
    const start = await field.inputValue()
    ok(/^#[0-9a-f]{6}$/.test(start), `an untouched accent shows six digits (${start})`)

    // The picker's Alpha slider, a tenth at a time with Shift, then by ones.
    await row.locator('[data-colour-swatch]').click()
    const pop = win.locator('[data-colour-popover][role="dialog"]')
    await pop.waitFor({ timeout: 5000 })
    ok((await pop.getAttribute('aria-label')) === 'Accent colour', 'the popover is named by its row')
    const alpha = pop.locator('[role="slider"][aria-label="Alpha"]')
    ok((await alpha.getAttribute('aria-valuemin')) === '10', 'its Alpha runs down to 10%')
    await alpha.focus()
    for (let i = 0; i < 7; i++) await alpha.press('Shift+ArrowLeft')
    for (let i = 0; i < 5; i++) await alpha.press('ArrowLeft')
    await sleep(150)
    ok((await alpha.getAttribute('aria-valuenow')) === '25', `Shift+Left and Left bring it to 25% (${await alpha.getAttribute('aria-valuenow')})`)
    const at25 = await field.inputValue()
    ok(/^#[0-9a-f]{8}$/.test(at25) && at25.slice(7) === '40', `the field shows eight digits (${at25})`)
    // A press outside keeps the colour and closes the picker.
    await field.click()
    await sleep(150)
    ok((await pop.count()) === 0, 'a press outside closes it')

    // Eight digits typed read back exactly as typed.
    await field.fill(start + '81')
    await field.press('Enter')
    await sleep(250)
    ok((await field.inputValue()) === start + '81', `#rrggbb81 reads back as typed (${await field.inputValue()})`)
    await field.fill(start + '66')
    await field.press('Enter')
    await sleep(250)
    const stored = await win.evaluate(() => JSON.parse(localStorage.getItem('prism.style.draft') ?? '{}'))
    ok(stored.accentAlpha === 0.4 && stored.accent === undefined, `a scheme accent keeps its scheme, the alpha beside it (${JSON.stringify(stored)})`)
    const readSel = () =>
      win.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = 'var(--p-sel-bg)'
        document.body.appendChild(probe)
        const c = getComputedStyle(probe).backgroundColor
        probe.remove()
        return c
      })
    const selToken = await readSel()
    ok(/rgba\(.*0\.4\)/.test(selToken), `the selection fill carries it (${selToken})`)

    // A BUTTON prints the same ink on --p-accent (review of #249: the raw
    // accent there left Frost's labels at 3.78:1). The lit Save button is
    // measured against the fill as seen on both grounds it can sit on.
    const save = win.locator('button:has-text("Save changes"):not([disabled])').first()
    ok((await save.count()) === 1, 'an alpha of its own lights Save changes')
    const button = await save.evaluate((el) => {
      const parse = (c) => {
        const n = (c.match(/[\d.]+/g) ?? []).map(Number)
        return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }
      }
      const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const token = (name) => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = `var(${name})`
        document.body.appendChild(probe)
        const c = parse(getComputedStyle(probe).backgroundColor).rgb
        probe.remove()
        return c
      }
      const fill = parse(getComputedStyle(el).backgroundColor)
      const label = parse(getComputedStyle(el).color).rgb
      const worst = Math.min(
        ...['--p-bg', '--p-side-flat'].map((g) => {
          const ground = token(g)
          const seen = fill.rgb.map((v, i) => ground[i] + (v - ground[i]) * fill.a)
          const [la, lb] = [lum(seen), lum(label)]
          return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
        })
      )
      return { alpha: fill.a, worst }
    })
    ok(button.alpha < 1, `the button's fill is see-through (${button.alpha})`)
    ok(button.worst >= 4.5, `and its label reads on it as seen (${button.worst.toFixed(2)}:1)`)

    // A Reset link is TEXT, so it stays opaque.
    const reset = row.locator('button', { hasText: 'Reset' })
    ok((await reset.count()) === 1, 'the accent row offers Reset')
    const resetColour = await reset.evaluate((el) => getComputedStyle(el).color)
    ok(/^rgb\(/.test(resetColour), `and the Reset link is opaque (${resetColour})`)
    await row.scrollIntoViewIfNeeded()
    await win.screenshot({ path: join(SHOTS, 'accent-opacity-style.png') })

    // Settings is a tab; go back to the file's tab and select a folder there.
    await win.locator('[data-tab-role]:not([data-pinned]) [role="tab"]:not(:has-text("Settings"))').first().click()
    await sleep(400)
    const codeRow = win.locator('[role="treeitem"]:has-text("code")').first()
    await codeRow.click()
    await sleep(400)
    ok((await codeRow.getAttribute('data-selected')) !== null, 'a folder row is selected')
    const look = await codeRow.evaluate((row) => {
      const parse = (c) => {
        const n = (c.match(/[\d.]+/g) ?? []).map(Number)
        return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }
      }
      const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      // The element that paints the fill: the row, or the first inside it.
      const painted = [row, ...row.querySelectorAll('*')].find((el) => {
        const bg = getComputedStyle(el).backgroundColor
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      })
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--p-side-flat)'
      document.body.appendChild(probe)
      const ground = parse(getComputedStyle(probe).backgroundColor).rgb
      probe.remove()
      const fill = parse(getComputedStyle(painted).backgroundColor)
      const seen = fill.rgb.map((v, i) => ground[i] + (v - ground[i]) * fill.a)
      const label = parse(getComputedStyle(painted).color).rgb
      const [la, lb] = [lum(seen), lum(label)]
      return {
        bg: getComputedStyle(painted).backgroundColor,
        alpha: fill.a,
        seen: seen.map(Math.round),
        label,
        contrast: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
      }
    })
    ok(look.alpha < 1, `the selected row's fill is see-through (${look.bg})`)
    ok(look.contrast >= 4.5, `its label reads on the fill as seen (${look.contrast.toFixed(2)}:1 on rgb(${look.seen.join(',')}))`)
    await win.screenshot({ path: join(SHOTS, 'accent-opacity-row.png') })

    // Reset gives back the colour AND the alpha.
    await settingsPage(win, 'appearance')
    await reset.waitFor({ timeout: 8000 })
    await reset.click()
    await sleep(250)
    ok((await field.inputValue()) === start, `Reset puts the accent back to six digits (${await field.inputValue()})`)
    ok(!/rgba/.test(await readSel()), `and the selection is solid again (${await readSel()})`)
    await win.keyboard.press('Control+w')
  } finally {
    await win
      .evaluate((d) => {
        if (d === null) localStorage.removeItem('prism.style.draft')
        else localStorage.setItem('prism.style.draft', d)
        window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
      }, draftBefore)
      .catch(() => {})
    await app.close()
  }
}

/**
 * EVERY STYLE COLOUR IS THE CORE'S PICKER, WITH ALPHA (#249 rework; owner,
 * 2026-10-03: "an input field for a color code and an alpha per colour on
 * every colour setting colour picker both in pt and prism"). The decisions of
 * the same day, each driven on the real Style page:
 *   1. Primary's alpha IS the old Acrylic slider: below 100 the window is
 *      glass, at 100 solid; a saved level shows as the alpha it paints; a hue
 *      edit leaves the glass alone. There is no Acrylic row.
 *   2. Secondary's alpha follows Primary's until it is moved.
 *   5. Under glass, a see-through accent's text-bearing fills are opaque.
 * Plus the #71 guard the old local well lacked: tabbing through a row writes
 * nothing; and Escape in a picker puts a row back exactly as it was.
 * (Mica staying mica is unit-tested: main's material is not readable here.)
 */
async function styleColoursScenario(fixtures) {
  console.log('style colours')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  let before = null
  const setDraft = (d) =>
    win.evaluate((v) => {
      if (v === null) localStorage.removeItem('prism.style.draft')
      else localStorage.setItem('prism.style.draft', JSON.stringify(v))
      window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
    }, d)
  const draft = () => win.evaluate(() => JSON.parse(localStorage.getItem('prism.style.draft') ?? '{}'))
  /** A token's computed colour as [r, g, b, a]. */
  const token = (name) =>
    win.evaluate((n) => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = `var(${n})`
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).backgroundColor
      probe.remove()
      const v = (c.match(/[\d.]+/g) ?? []).map(Number)
      return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]
    }, name)
  const contrast = (a, b) => {
    const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
    const lum = ([r, g, bb]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bb)
    const [x, y] = [lum(a), lum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  try {
    await win.waitForSelector('[role="treeitem"]', { timeout: 10000 })
    before = await win.evaluate(() => localStorage.getItem('prism.style.draft'))
    await setDraft(null)
    await settingsPage(win, 'appearance')
    const rowOf = (id) => win.locator(`[data-colour-row="${id}"]`)
    const fieldOf = (id) => rowOf(id).locator('input:not([type])')
    const pop = win.locator('[data-colour-popover][role="dialog"]')
    const slider = (name) => pop.locator(`[role="slider"][aria-label="${name}"]`)
    await fieldOf('c-bg').waitFor({ timeout: 8000 })
    ok((await win.locator('#c-glass').count()) === 0, 'there is no Acrylic slider')
    for (const id of ['c-bg', 'c-chrome', 'c-text', 'c-folder-icon', 'c-accent', 'c-selection'])
      ok((await rowOf(id).locator('[data-colour-swatch]').count()) === 1, `${id} is the core picker`)
    // By importance, with Selection right after the Accent it came out of
    // (#257; owner, 2026-10-03).
    const order = await win.evaluate(() => [...document.querySelectorAll('[data-colour-row]')].map((r) => r.getAttribute('data-colour-row')))
    const want = ['c-bg', 'c-chrome', 'c-accent', 'c-selection', 'c-text', 'c-folder-icon']
    ok(
      JSON.stringify(order.filter((id) => want.includes(id))) === JSON.stringify(want),
      `the colours run Primary, Secondary, Accent, Selection, Text, Folder icons (${order.join(', ')})`
    )
    ok((await win.locator('[data-pref="c-bg"] input[type="color"], [data-pref] input[type="color"]').count()) === 0, 'no native colour input is left')

    // #71's guard: tabbing through a row writes nothing (Folder icons
    // follows the accent, the Accent row is a scheme).
    for (const id of ['c-folder-icon', 'c-accent', 'c-selection']) {
      await fieldOf(id).focus()
      await win.keyboard.press('Tab')
      await win.keyboard.press('Tab')
    }
    await sleep(200)
    ok(JSON.stringify(await draft()) === '{}', `tabbing through Folder icons, Accent and Selection writes nothing (${JSON.stringify(await draft())})`)

    // SELECTION, unset, shows the accent's tint at its 22%, and a pick stores
    // the colour with its alpha; Escape puts the unset row back, and Reset
    // forgets a kept pick.
    const tintShown = await fieldOf('c-selection').inputValue()
    ok(/^#[0-9a-f]{6}38$/.test(tintShown), `unset, Selection shows the accent's tint at 22% (${tintShown})`)
    await rowOf('c-selection').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Hue').focus()
    for (let i = 0; i < 6; i++) await slider('Hue').press('Shift+ArrowRight')
    await sleep(150)
    ok(/^#[0-9a-f]{6}38$/.test((await draft()).selection ?? ''), `a hue edit stores the colour with its alpha (${(await draft()).selection})`)
    await slider('Hue').press('Escape')
    await sleep(200)
    ok((await pop.count()) === 0 && (await draft()).selection === undefined, 'Escape puts the unset Selection back')
    const accentBefore = await token('--p-accent-solid')
    await rowOf('c-selection').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Hue').focus()
    for (let i = 0; i < 6; i++) await slider('Hue').press('Shift+ArrowRight')
    await sleep(150)
    await fieldOf('c-text').click()
    await sleep(150)
    const kept = (await draft()).selection ?? ''
    ok(/^#[0-9a-f]{8}$/.test(kept), `a press outside keeps the pick (${kept})`)
    const tint = await token('--p-sel-tint')
    // The token must be the PICK, not merely a tint of the same strength: the
    // unset accent tint is also at 0x38, so only its colour tells them apart.
    const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1)
    ok(
      near(tint.slice(0, 3), rgbOf(kept)) && !near(tint.slice(0, 3), rgbOf(tintShown)) && Math.abs(tint[3] - 0x38 / 255) < 0.01,
      `and it is the tint (${tint.join(',')} for ${kept}, unset was ${tintShown})`
    )
    // The sweep band wears the Selection too (Windows' drag box is the
    // selection colour), so a box dragged over green marks is not blue.
    const hue = await token('--p-sel-hue')
    ok(near(hue.slice(0, 3), rgbOf(kept)), `the sweep band's hue is the pick (${hue.join(',')} for ${kept})`)
    ok(JSON.stringify(await token('--p-accent-solid')) === JSON.stringify(accentBefore), 'the accent does not move')
    await rowOf('c-selection').scrollIntoViewIfNeeded()
    await win.screenshot({ path: join(SHOTS, 'style-colours-selection.png') })
    const reset = rowOf('c-selection').locator('button', { hasText: 'Reset' })
    ok((await reset.count()) === 1, 'a picked Selection offers Reset')
    await reset.click()
    await sleep(200)
    ok((await draft()).selection === undefined, `Reset forgets it (${JSON.stringify(await draft())})`)
    ok((await fieldOf('c-selection').inputValue()) === tintShown, 'and the row shows the accent tint again')

    // Escape in a picker after a change puts the row back as it was: unset.
    await rowOf('c-folder-icon').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Alpha').focus()
    await slider('Alpha').press('Shift+ArrowLeft')
    await sleep(150)
    ok(typeof (await draft()).folderIcon === 'string', 'the picker writes as it moves')
    await slider('Alpha').press('Escape')
    await sleep(200)
    ok((await pop.count()) === 0 && (await draft()).folderIcon === undefined, 'Escape puts the unset row back')
    ok((await rowOf('c-folder-icon').locator('button', { hasText: 'Reset' }).count()) === 0, 'with no Reset showing')

    // 1. Primary: aurora is solid, so its alpha is 100 and six digits.
    const solidBg = await fieldOf('c-bg').inputValue()
    ok(/^#[0-9a-f]{6}$/.test(solidBg), `a solid style's Primary is six digits (${solidBg})`)
    ok((await token('--p-bg'))[3] === 1, 'and its ground is opaque')
    await rowOf('c-bg').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    ok(Number(await slider('Alpha').getAttribute('aria-valuemin')) === 53, `its Alpha starts at the slider's glassiest end (${await slider('Alpha').getAttribute('aria-valuemin')})`)
    await slider('Alpha').focus()
    await slider('Alpha').press('Shift+ArrowLeft')
    await slider('Alpha').press('Shift+ArrowLeft')
    await sleep(200)
    const glassy = await draft()
    ok(typeof glassy.acrylic === 'number' && glassy.acrylic > 0 && glassy.bg === undefined, `below 100 it is the Acrylic level, the colour untouched (${JSON.stringify(glassy)})`)
    const glassBg = await token('--p-bg')
    ok(glassBg[3] < 1, `the window's ground is see-through (${glassBg.join(',')})`)
    // A hue edit on glass leaves the level alone.
    await slider('Hue').focus()
    for (let i = 0; i < 6; i++) await slider('Hue').press('Shift+ArrowRight')
    await sleep(200)
    const hued = await draft()
    ok(hued.acrylic === glassy.acrylic && typeof hued.bg === 'string', `a hue edit moves the colour, not the glass (${JSON.stringify(hued)})`)
    // A press outside keeps what the picker did and closes it.
    await fieldOf('c-text').click()
    await sleep(150)
    // 5. A see-through accent under glass: its fills are flattened.
    await setDraft({ ...hued, accentAlpha: 0.4 })
    await sleep(250)
    const accentFill = await token('--p-accent')
    const selFill = await token('--p-sel-bg')
    const onAccent = await token('--p-on-accent')
    ok(accentFill[3] === 1 && selFill[3] === 1, `under glass the accent's fills are opaque (${accentFill.join(',')})`)
    ok(contrast(onAccent, accentFill) >= 4.5, `and their label reads on them (${contrast(onAccent, accentFill).toFixed(2)}:1)`)
    await win.screenshot({ path: join(SHOTS, 'style-colours-glass.png') })
    await setDraft(hued)
    await sleep(250)
    // 100 again is solid, and with the colour put back nothing is edited.
    ok((await pop.count()) === 0, 'the picker is closed')
    await rowOf('c-bg').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Alpha').focus()
    for (let i = 0; i < 6; i++) await slider('Alpha').press('Shift+ArrowRight')
    await sleep(200)
    ok((await draft()).acrylic === undefined && (await token('--p-bg'))[3] === 1, `at 100 the window is solid again (${JSON.stringify(await draft())})`)
    await slider('Alpha').press('Escape')
    await sleep(200)
    const same = (x, y) => JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort())
    ok(same(await draft(), hued), `Escape puts back the glass the picker opened on (${JSON.stringify(await draft())})`)

    // A level saved before this change shows as the alpha it paints: the old
    // slider's 40 is glass 0.63, painted 1 - (1 - 0.63 * 0.75)^3 = 0.853.
    await setDraft({ acrylic: 40 })
    await sleep(250)
    const saved = await fieldOf('c-bg').inputValue()
    ok(saved.slice(7) === 'da', `a saved Acrylic 40 reads as alpha da (${saved})`)
    // The token as published, before the browser rounds it to a byte.
    const savedGround = await win.evaluate(() => document.documentElement.style.getPropertyValue('--p-bg'))
    const savedAlpha = Number(/,\s*([\d.]+)\)$/.exec(savedGround)?.[1])
    ok(Math.abs(savedAlpha - (1 - (1 - 0.63 * 0.75) ** 3)) < 1e-9, `and paints exactly as it did (${savedGround})`)

    // 2. Secondary follows Primary's alpha until moved, then holds its own.
    const sec = await fieldOf('c-chrome').inputValue()
    ok(sec.slice(7) === 'da', `Secondary shows Primary's alpha (${sec})`)
    await rowOf('c-chrome').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Hue').focus()
    for (let i = 0; i < 4; i++) await slider('Hue').press('Shift+ArrowRight')
    await sleep(200)
    ok(/^#[0-9a-f]{6}$/.test((await draft()).side ?? ''), `a hue edit stores six digits and keeps following (${(await draft()).side})`)
    await slider('Alpha').focus()
    await slider('Alpha').press('Shift+ArrowLeft')
    await sleep(200)
    const own = (await draft()).side ?? ''
    ok(/^#[0-9a-f]{8}$/.test(own), `a moved alpha is its own, eight digits (${own})`)
    await fieldOf('c-chrome').click()
    await sleep(150)
    // Its own 100 on glass, in the colour the style already had, is a solid
    // panel kept as `ff` (review of #251: it was read as the style's own
    // colour put back and thrown away, and the panel stayed glass).
    await setDraft({ acrylic: 40 })
    await sleep(250)
    const styleSide = (await fieldOf('c-chrome').inputValue()).slice(0, 7)
    await rowOf('c-chrome').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Alpha').focus()
    await slider('Alpha').press('Shift+ArrowLeft')
    for (let i = 0; i < 6; i++) await slider('Alpha').press('Shift+ArrowRight')
    await sleep(200)
    const solidSide = (await draft()).side ?? ''
    ok(solidSide === styleSide + 'ff', `its own 100 on glass is kept as ff (${solidSide})`)
    ok((await token('--p-side'))[3] === 1 && (await token('--p-bg'))[3] < 1, 'a solid panel on a see-through window')
    await fieldOf('c-chrome').click()
    await sleep(150)

    // Text at half alpha still reads at 4.5:1 on the panel.
    await setDraft({})
    await sleep(250)
    await rowOf('c-text').locator('[data-colour-swatch]').click()
    await pop.waitFor({ timeout: 5000 })
    await slider('Alpha').focus()
    for (let i = 0; i < 5; i++) await slider('Alpha').press('Shift+ArrowLeft')
    await sleep(200)
    ok(/^#[0-9a-f]{8}$/.test((await draft()).text ?? ''), `Text stores its alpha (${(await draft()).text})`)
    const ink = await token('--p-text')
    const panel = await token('--p-side-flat')
    ok(ink[3] === 1 && contrast(ink, panel) >= 4.5, `and is drawn opaque, ${contrast(ink, panel).toFixed(2)}:1 on the panel`)
    await win.screenshot({ path: join(SHOTS, 'style-colours-picker.png') })
    await fieldOf('c-text').click()
    await sleep(150)
    await rowOf('c-bg').scrollIntoViewIfNeeded()
    await win.screenshot({ path: join(SHOTS, 'style-colours-rows.png') })
    await win.keyboard.press('Control+w')
  } finally {
    await win
      .evaluate((d) => {
        if (d === null) localStorage.removeItem('prism.style.draft')
        else localStorage.setItem('prism.style.draft', d)
        window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
      }, before)
      .catch(() => {})
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
      // Every drag here is taken by the row's NAME: since the sweep (#257) a
      // press on a row's blank space draws the rectangle, as in Explorer, and
      // a locator's centre is that blank space on a wide row.
      await win
        .locator('[role="treeitem"]:has-text("movable.txt")')
        .locator('span.truncate')
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
        .locator('span.truncate')
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
        .locator('span.truncate')
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
        .locator('span.truncate')
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
      // Inside the zip in the Explorer (#300), a member row dragged onto a
      // folder's crumb outside the zip extracts there. The drag used to show
      // NOTHING while it extracted (#166): it is the same window now as every
      // other way of extracting.
      await inZip(win, join(fixtures, 'zips', 'dragzip.zip'))
      await throughTheWindow(win, 'a member dragged out onto a folder', 'dragzip.zip', () =>
        win
          .locator('[data-testid="browse-list"] .browse-row', { hasText: 'carry.txt' })
          .first()
          .locator('.browse-name-text')
          .dragTo(win.locator(`.browse-crumb button[data-crumb-path="${join(fixtures, 'zips').replace(/\\/g, '\\\\')}"]`))
      )
      ok(existsSync(join(fixtures, 'zips', 'carry.txt')), 'a member dragged out of the zip landed in the folder')
      rmSync(join(fixtures, 'zips', 'carry.txt'), { force: true })
      await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').first().click()
      await win.waitForSelector('aside [role="treeitem"]:has-text("out")', { timeout: 10000 })
      // A FOLDER dragged onto the tab strip opens as a tab of its own.
      const tabsBefore = await win.locator('[role="tablist"] [data-tab-role]:not([data-pinned]) [role="tab"]').count()
      // Aimed at the EMPTY space after the +, which is where a drop is
      // naturally made and where the window-drag region used to swallow it.
      const strip = await win.locator('[role="tablist"]').boundingBox()
      await win
        .locator('aside [role="treeitem"]:has-text("out")')
        .first()
        .locator('span.truncate')
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
        .locator('span.truncate')
        .dragTo(win.locator('body'), {
          targetPosition: { x: viewer.width - 220, y: viewer.height / 2 }
        })
      await sleep(1200)
      ok(
        (await win.locator('[data-archive-card]').count()) === 1,
        'a row dropped on the viewer opens it there (a zip shows its card, #300)'
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
    await win.click('[aria-label="More"]')
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
    await handoff(OTHER_ROOT)
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
async function switchStyle(win, style) {
  // ONE THEME, NO MODE (#298): each theme is dark or light by itself, and
  // `prism.mode` is only the boot screen's mirror of what is painted.
  return win.evaluate(
    (s) => {
      const before = localStorage.getItem('prism.style')
      if (s === null) localStorage.removeItem('prism.style')
      else localStorage.setItem('prism.style', s)
      window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style', storageArea: localStorage }))
      return before
    },
    style
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
  let styleBefore
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
      const t = box('[aria-label="More"]')
      const s = box('[aria-label="Settings"]')
      return c && t && s ? { chipRight: c.right, toolsLeft: t.left, settingsLeft: s.left, settingsRight: s.right } : null
    })
    // Since #272 More is on the INSIDE, next to the window buttons (owner,
    // 2026-10-04), so the order is chip, Settings, More.
    ok(
      order !== null && order.chipRight <= order.settingsLeft && order.settingsRight <= order.toolsLeft,
      `the chip is the leftmost of the group: chip, then Settings, then More (${JSON.stringify(order)})`
    )
    await shot('update-chip-dark')
    // AND THE GROUP STAYS PUT WHEN THE CHIP COMES OR GOES, which is the reason
    // the comment in TopBar gives for the chip leading it. Measured rather
    // than argued: the chip's own flex item is taken out of the row and More
    // must not have moved a pixel. (The preview's chip never leaves by itself,
    // so it is hidden by hand and put back in the same breath.)
    const toolsShift = await win.evaluate(() => {
      const bar = document.querySelector('[data-title-bar]')
      const tools = bar?.querySelector('[aria-label="More"]')
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
      `More does not move when the chip goes or comes back (${JSON.stringify(toolsShift)})`
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
      const t = box(bar?.querySelector('[aria-label="More"]'))
      const s = box(bar?.querySelector('[aria-label="Settings"]'))
      const n = box(bar?.querySelector('[data-testid="titlebar-file-name"]'))
      return c && t && s && n
        ? { inner: window.innerWidth, nameLeft: n.left, chipLeft: c.left, chipRight: c.right, toolsLeft: t.left, settingsLeft: s.left, settingsRight: s.right }
        : null
    })
    ok(
      narrow !== null &&
        narrow.nameLeft <= narrow.chipLeft &&
        narrow.chipRight <= narrow.settingsLeft &&
        narrow.settingsRight <= narrow.toolsLeft,
      `and at the minimum window width: name, chip, Settings, More, none overlapping (${JSON.stringify(narrow)})`
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
    styleBefore = await switchStyle(win, 'paper')
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
    if (styleBefore !== undefined) await switchStyle(win, styleBefore).catch(() => {})
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
      await until(async () => ((await win.locator('[role="treeitem"][aria-selected="true"]').textContent()) ?? '').includes('*'), 20000, 50),
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

/* ----- never a loading screen (#271) ----- */

/**
 * NEVER A LOADING SCREEN (#271; owner, 2026-10-04: "whenever the app loads, it
 * has to load the files in the file explorer. Like there's a loading screen
 * ... I don't ever want to see that ... not even if you launch it from a
 * restart of the PC, or it's your first time after installing the program").
 * Design: docs/superpowers/specs/2026-10-04-explorer-never-loading-design.md.
 *
 * Every launch here installs TWO probes. `earlyProbe.js` is a frame preload
 * (main registers it under `PRISM_E2E_EARLY_PROBE`), so it watches from before
 * the page's first script and records any loading text ("Loading folder",
 * "Loading…", "Opening Prism") or a word in the boot shell's status line
 * (review of #271: the page probe alone went in after `domcontentloaded`, and
 * missed whatever came and went before). The page probe, put in by the
 * harness, records the same texts from then on and the moment the first
 * Explorer row appears. Timings are
 * taken in the page (performance.now), never from the harness's own clock.
 * Cold-disk timing after a real reboot cannot be done here; it is on the
 * hands-on list.
 */
const NL = join(ROOT, '.e2e', 'never-loading')

function buildNeverLoading() {
  rmSync(NL, { recursive: true, force: true })
  const mk = (rel, files = 0, prefix = 'f') => {
    const dir = join(NL, rel)
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < files; i++)
      writeFileSync(join(dir, `${prefix}${String(i).padStart(5, '0')}.txt`), 'x'.repeat((i % 97) + 1))
    return dir
  }
  const dirs = {
    empty: mk('empty'),
    one: mk('one', 1),
    deep: mk(join('deep', 'a', 'b', 'c', 'd', 'e', 'f', 'g'), 3),
    unicode: mk('ünïcødé 日本語 ✓', 4),
    cached: mk('cached', 40),
    home: mk('home', 30),
    // More than 30 entries, so nothing here is read ahead at idle: the folders
    // under it are COLD until they are opened.
    cold: mk('cold', 31, 'pad')
  }
  mkdirSync(join(dirs.home, 'Documents'), { recursive: true })
  return {
    ...dirs,
    root: NL,
    big2000: mk(join('cold', 'two-thousand'), 2000),
    big2000b: mk(join('cold', 'two-thousand-b'), 2000),
    big2000c: mk(join('cold', 'two-thousand-c'), 2000),
    big5000: mk(join('cold', 'five-thousand'), 5000),
    slow: mk(join('cold', 'slow-target'), 5)
  }
}

/** Runs in the page, as early as there is one. */
function installLoadingProbe() {
  if (window.__nl) return
  const bad = /Loading folder|Loading…|Opening Prism/
  const nl = { seen: [], firstRowAt: 0, firstRows: [], emptied: false, marks: [], rowAt: {} }
  window.__nl = nl
  const rows = () => [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path]')]
  const look = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement
    if (!el || el.closest('style,script,head')) return
    const text = node.nodeType === 3 ? node.data : el.innerText ?? el.textContent
    if (text && bad.test(text)) nl.seen.push(text.trim().slice(0, 80))
  }
  look(document.body)
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') look(r.target)
      for (const n of r.addedNodes) look(n)
    }
    const now = rows()
    const t = performance.now()
    for (const row of now) {
      const key = row.dataset.browsePath.toLowerCase()
      if (!(key in nl.rowAt)) nl.rowAt[key] = t
    }
    if (now.length && !nl.firstRowAt) {
      nl.firstRowAt = performance.now()
      nl.firstRows = now.map((row) => row.dataset.browsePath)
    } else if (nl.firstRowAt && !now.length && !nl.paused) nl.emptied = true
    for (const m of nl.marks) if (!m.at && m.test(now)) m.at = performance.now()
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
}

/** What the probes saw, with the first paint of the boot shell for reference. */
const probeOf = (win) =>
  win.evaluate(() => ({
    seen: (() => {
      let early
      try {
        early = JSON.parse(document.documentElement.getAttribute('data-nl-early') ?? 'null')
      } catch {
        early = null
      }
      return [...(early?.installed ? early.seen : ['no early probe']), ...(window.__nl?.seen ?? ['no probe'])]
    })(),
    firstRowAt: window.__nl?.firstRowAt ?? 0,
    firstRows: window.__nl?.firstRows ?? [],
    emptied: !!window.__nl?.emptied,
    fcp: performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1
  }))

/** One launch on `profile` with the probe in, tabs seeded when given. */
async function launchProbed({ tabs, env = {}, profile = PROFILE } = {}) {
  if (tabs) {
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'tabs.json'), JSON.stringify(tabs))
  }
  let last
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const app = await launchTestApp({
        args: [MAIN, `--user-data-dir=${profile}`, '--e2e'],
        env: { ...process.env, PRISM_E2E_EARLY_PROBE: join(ROOT, 'tools', 'e2e', 'earlyProbe.js'), ...env }
      })
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await win.evaluate(installLoadingProbe)
      await offscreen(app)
      return { app, win }
    } catch (err) {
      last = err
      reapStrays()
      await sleep(2000 + attempt * 1000)
    }
  }
  throw last
}

const explorerTab = (id, root, path = root, pinned = true) => ({
  id,
  role: 'explorer',
  ...(pinned ? { pinned: true } : {}),
  root,
  browse: {
    path,
    history: [{ path, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } }],
    cursor: 0,
    surface: 'folder',
    preview: false
  },
  panes: [],
  open: []
})

/** The folder the Explorer list is showing, by its accessible name. */
const shownDir = (win) =>
  win.evaluate(() =>
    (document.querySelector('[data-testid="browse-list"]')?.getAttribute('aria-label') ?? '').replace(/^Files in /, '')
  )

/** Go to a folder by typing it in the address field, as a user would. */
async function typePath(win, path) {
  await win.locator('[data-testid="browse-list"]').focus()
  await win.keyboard.press('Control+l')
  const field = win.locator('.folder-browser input[aria-label="Folder path"]')
  await field.waitFor({ timeout: 5000 })
  await field.fill(path)
  await field.press('Enter')
}

const sameDir = (a, b) => a.toLowerCase().replace(/[\\/]+$/, '') === b.toLowerCase().replace(/[\\/]+$/, '')
async function landed(win, path, timeout = 8000) {
  return until(async () => sameDir(await shownDir(win), path), timeout, 50)
}

/** 1. No loading element, ever, at launch or across twenty moves. */
async function noLoadingEverScenario() {
  console.log('never a loading screen: twenty moves and a relaunch')
  const f = buildNeverLoading()
  const tabs = {
    active: 0,
    tabs: [explorerTab('nl-pinned', f.root), explorerTab('nl-second', f.one, f.one, false)]
  }
  let { app, win } = await launchProbed({ tabs })
  try {
    ok(await landed(win, f.root, 15000), 'the Explorer opens on the fixture folder')
    const moves = [f.empty, f.one, f.big2000, f.big5000, f.deep, f.unicode, f.cold, f.root, f.cached, f.slow]
    let landedAll = 0
    for (const path of moves) {
      await typePath(win, path)
      if (await landed(win, path)) landedAll += 1
    }
    ok(landedAll === moves.length, `ten folders typed in and shown (${landedAll}/${moves.length}: empty, 1, 2000 and 5000 files, a deep path, Unicode names)`)
    const back = async (keys, n) => {
      for (let i = 0; i < n; i++) {
        await win.locator('[data-testid="browse-list"]').focus()
        await win.keyboard.press(keys)
        await sleep(120)
      }
    }
    await back('Alt+ArrowLeft', 4)
    ok(await landed(win, f.unicode), 'four steps back')
    await back('Alt+ArrowRight', 2)
    ok(await landed(win, f.root), 'two forward')
    await back('Alt+ArrowUp', 1)
    ok(await landed(win, join(ROOT, '.e2e')), 'one up')
    await back('Backspace', 1)
    ok(await landed(win, f.root), 'and Backspace goes back')
    // Tabs: the second Explorer tab and back, twice.
    for (let i = 0; i < 2; i++) {
      await win.locator('[role="tablist"] [role="tab"]').nth(1).click()
      ok(await landed(win, f.one), `switch ${i + 1} to the second Explorer tab shows its folder`)
      await win.locator('[role="tablist"] [role="tab"]').nth(0).click()
      ok(await landed(win, f.root), `and back to the first`)
    }
    let probe = await probeOf(win)
    ok(probe.seen.length === 0, `no loading text and no restoring screen in twenty moves (${JSON.stringify(probe.seen.slice(0, 3))})`)
    await win.screenshot({ path: join(SHOTS, 'never-loading-moves.png') })
    await sleep(800)
    await app.close()
    await sleep(900)
    ;({ app, win } = await launchProbed())
    ok(await until(async () => (await win.locator('[data-testid="browse-list"] .browse-row').count()) > 0, 15000, 50), 'a relaunch shows rows')
    probe = await probeOf(win)
    ok(probe.seen.length === 0, `and nothing that reads as loading on the way (${JSON.stringify(probe.seen.slice(0, 3))})`)
  } finally {
    await app.close().catch(() => {})
  }
}

/** 2. A launch with the folder in the listing cache paints the cached rows,
 *  then corrects them in place. */
async function coldLaunchCachedScenario() {
  console.log('never a loading screen: launch from the listing cache')
  const f = buildNeverLoading()
  const tabs = { active: 0, tabs: [explorerTab('nl-pinned', f.root, f.cached)] }
  rmSync(join(PROFILE, 'listing-cache'), { recursive: true, force: true })
  let { app, win } = await launchProbed({ tabs })
  try {
    ok(await landed(win, f.cached, 15000), 'the first launch shows the saved folder (not the root)')
    // The details finish and the cache is written (its index on a 500 ms delay).
    await sleep(1500)
    await app.close()
    await sleep(900)
    const index = (() => {
      try {
        return JSON.parse(readFileSync(join(PROFILE, 'listing-cache', 'index.json'), 'utf8'))
      } catch {
        return null
      }
    })()
    ok(!!index?.entries?.some((e) => sameDir(e.path, f.cached)), 'the folder went into the listing cache')
    writeFileSync(join(f.cached, 'aaa-new.txt'), 'new')
    const times = []
    for (let i = 0; i < 3; i++) {
      ;({ app, win } = await launchProbed({ tabs }))
      const newKey = join(f.cached, 'aaa-new.txt').toLowerCase()
      const seenNew = () => win.evaluate((key) => window.__nl.rowAt[key] ?? 0, newKey)
      ok(await until(seenNew, 5000, 50), `launch ${i + 1}: the file added since appears`)
      const p = await probeOf(win)
      const fresh = await seenNew()
      times.push({ first: Math.round(p.firstRowAt - p.fcp), fixed: Math.round(fresh - p.firstRowAt) })
      if (i === 0) {
        ok(p.firstRows.length > 0 && p.firstRows.every((r) => r.toLowerCase().startsWith(f.cached.toLowerCase())), 'the first rows painted are the saved folder')
        ok(!p.firstRows.some((r) => r.endsWith('aaa-new.txt')), 'and they are the CACHED rows (the new file is not among them yet)')
        ok(!p.emptied, 'the list never emptied between the cached rows and the fresh ones')
        ok(p.seen.length === 0, `no loading text (${JSON.stringify(p.seen.slice(0, 3))})`)
      }
      await app.close()
      await sleep(900)
    }
    // Launch 1 is the one with a change on disk the cache has not seen; by
    // launch 2 the cache holds it, so only the first-row times are compared.
    const median = times.map((t) => t.first).sort((a, b) => a - b)[1]
    console.log(`  (cached launch, ms after the first paint: first rows ${times.map((t) => t.first).join(', ')}; the new file ${times[0].fixed} ms after them on launch 1)`)
    ok(median < 400, `rows within 400 ms of the window's first paint (median ${median} ms)`)
    ok(times[0].fixed >= 0 && times[0].fixed < 500, `the change on disk is shown within 500 ms of them (${times[0].fixed} ms)`)
  } finally {
    await app.close().catch(() => {})
    rmSync(join(f.cached, 'aaa-new.txt'), { force: true })
  }
}

/** 3. The first run after an install: no cache, no saved tabs. */
async function coldLaunchNoCacheScenario() {
  console.log('never a loading screen: first run, no cache')
  const f = buildNeverLoading()
  const fresh = `${PROFILE}-firstrun`
  const times = []
  try {
    for (let i = 0; i < 3; i++) {
      rmSync(fresh, { recursive: true, force: true })
      const { app, win } = await launchProbed({ profile: fresh, env: { PRISM_E2E_HOME: f.home } })
      try {
        ok(await until(async () => (await probeOf(win)).firstRowAt > 0, 15000, 50), `first run ${i + 1}: rows appear`)
        const p = await probeOf(win)
        ok(sameDir(await shownDir(win), f.home), `in the home folder (${await shownDir(win)})`)
        ok(p.seen.length === 0, `with nothing that reads as loading (${JSON.stringify(p.seen.slice(0, 3))})`)
        times.push(Math.round(p.firstRowAt - p.fcp))
        if (i === 0) await win.screenshot({ path: join(SHOTS, 'never-loading-first-run.png') })
      } finally {
        await app.close()
        await sleep(900)
      }
    }
    const median = [...times].sort((a, b) => a - b)[1]
    ok(median < 600, `rows within 600 ms of the window's first paint on a first run (${times.join(', ')} ms)`)
  } finally {
    rmSync(fresh, { recursive: true, force: true })
  }
}

/** Time from a double-click on a folder row to its first row in the DOM. */
async function openFolderTimed(win, parent, target) {
  await win.evaluate((dir) => {
    const nl = window.__nl
    nl.click = 0
    nl.marks.length = 0
    nl.marks.push({ test: (rows) => rows.some((r) => r.dataset.browsePath.toLowerCase().startsWith(`${dir}\\`.toLowerCase())), at: 0 })
    nl.marks.push({
      test: (rows) => {
        const mine = rows.filter((r) => r.dataset.browsePath.toLowerCase().startsWith(`${dir}\\`.toLowerCase()))
        const cells = mine.map((r) => r.querySelector('.browse-column-size'))
        return cells.length > 0 && cells.every((c) => c && c.textContent.trim() !== '')
      },
      at: 0
    })
    if (!nl.clickHooked) {
      nl.clickHooked = true
      document.addEventListener('dblclick', () => (window.__nl.click = performance.now()), true)
    }
  }, target)
  await win.locator(`[data-testid="browse-list"] [data-browse-path="${target.replace(/\\/g, '\\\\')}"]`).dblclick()
  await until(() => win.evaluate(() => window.__nl.marks.every((m) => m.at)), 8000, 30)
  return win.evaluate(() => ({
    row: window.__nl.marks[0].at ? Math.round(window.__nl.marks[0].at - window.__nl.click) : -1,
    sizes: window.__nl.marks[1].at ? Math.round(window.__nl.marks[1].at - window.__nl.click) : -1
  }))
}

/** 4. A folder of 2000 files never opened before: rows at once, sizes after. */
async function newFolder2000Scenario() {
  console.log('never a loading screen: a new folder of 2000 files')
  const f = buildNeverLoading()
  const tabs = { active: 0, tabs: [explorerTab('nl-pinned', f.cold)] }
  let { app, win } = await launchProbed({ tabs })
  try {
    ok(await landed(win, f.cold, 15000), 'the Explorer opens on a folder of 31 files and its subfolders')
    await sleep(600)
    const t = await openFolderTimed(win, f.cold, f.big2000)
    console.log(`  (2000 files: first row ${t.row} ms after the double-click, every visible size ${t.sizes} ms)`)
    ok(t.row >= 0 && t.row < 50, `the first row is in the DOM within 50 ms of the double-click (${t.row} ms)`)
    ok(t.sizes >= 0 && t.sizes < 500, `the size cells fill within 500 ms (${t.sizes} ms)`)
    const p = await probeOf(win)
    ok(p.seen.length === 0, `no loading text (${JSON.stringify(p.seen.slice(0, 3))})`)
    await app.close()
    await sleep(900)
    // The details held back 600 ms, so a select and a scroll land BEFORE them:
    // the patch must keep both.
    ;({ app, win } = await launchProbed({ tabs, env: { PRISM_E2E_DETAILS_DELAY: '600' } }))
    ok(await landed(win, f.cold, 15000), 'again, with the details held back')
    await sleep(600)
    await win.locator(`[data-testid="browse-list"] [data-browse-path="${f.big2000b.replace(/\\/g, '\\\\')}"]`).dblclick()
    ok(await landed(win, f.big2000b), 'into the second folder of 2000')
    const blank = await win.evaluate(() =>
      [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"] .browse-column-size')].every((c) => c.textContent.trim() === '')
    )
    ok(blank, 'its size cells are blank, not "0 B", until the details arrive')
    const pickName = join(f.big2000b, 'f00012.txt')
    await win.locator(`[data-testid="browse-list"] [data-browse-path="${pickName.replace(/\\/g, '\\\\')}"]`).click()
    await win.evaluate(() => {
      const list = document.querySelector('[data-testid="browse-list"]')
      list.scrollTop = 130
      list.dispatchEvent(new Event('scroll'))
    })
    const filled = await until(
      () =>
        win.evaluate(() => {
          const cells = [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"] .browse-column-size')]
          return cells.length > 0 && cells.every((c) => c.textContent.trim() !== '')
        }),
      5000,
      50
    )
    ok(filled, 'the sizes arrive')
    const after = await win.evaluate((name) => ({
      selected: document.querySelector(`[data-browse-path="${CSS.escape(name)}"]`)?.getAttribute('aria-selected'),
      scrollTop: document.querySelector('[data-testid="browse-list"]').scrollTop
    }), pickName)
    ok(after.selected === 'true', 'the selection made before them is kept')
    ok(Math.abs(after.scrollTop - 130) <= 1, `and so is the scroll (${after.scrollTop})`)
    await app.close()
    await sleep(900)
    // SORTED BY SIZE (review of #271): a new folder draws in name order until
    // the last size is known, then re-sorts ONCE, and the selection and the
    // scroll made before that survive it.
    const bySize = {
      active: 0,
      tabs: [
        (() => {
          const t = explorerTab('nl-pinned', f.cold)
          t.browse.history[0].sort = { key: 'size', direction: 'desc' }
          return t
        })()
      ]
    }
    ;({ app, win } = await launchProbed({ tabs: bySize, env: { PRISM_E2E_DETAILS_DELAY: '600' } }))
    ok(await landed(win, f.cold, 15000), 'sorted by size, with the details held back')
    await sleep(600)
    await win.evaluate(() => {
      // The first file row, sampled every frame: how many times the order moved.
      const nl = window.__nl
      nl.orders = []
      const tick = () => {
        const first = document.querySelector('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"]')?.dataset.browsePath ?? ''
        if (first && nl.orders[nl.orders.length - 1] !== first) nl.orders.push(first)
        nl.sampling = requestAnimationFrame(tick)
      }
      tick()
    })
    await win.locator(`[data-testid="browse-list"] [data-browse-path="${f.big2000c.replace(/\\/g, '\\\\')}"]`).dblclick()
    ok(await landed(win, f.big2000c), 'into a third new folder of 2000')
    const firstNow = await win.evaluate(() => document.querySelector('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"]')?.dataset.browsePath ?? '')
    ok(/f00000\.txt$/.test(firstNow), `before the sizes it is in name order (${firstNow.split('\\').pop()})`)
    const pickSized = join(f.big2000c, 'f00003.txt')
    await win.locator(`[data-testid="browse-list"] [data-browse-path="${pickSized.replace(/\\/g, '\\\\')}"]`).click()
    await win.evaluate(() => {
      const list = document.querySelector('[data-testid="browse-list"]')
      list.scrollTop = 130
      list.dispatchEvent(new Event('scroll'))
    })
    const resorted = await until(
      () =>
        win.evaluate(() => {
          const first = document.querySelector('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"]')
          return !!first && first.querySelector('.browse-column-size')?.textContent.trim() !== '' && !/f00000\.txt$/.test(first.dataset.browsePath)
        }),
      5000,
      50
    )
    await sleep(300)
    const sized = await win.evaluate((name) => {
      cancelAnimationFrame(window.__nl.sampling)
      const orders = window.__nl.orders
      const at = orders.findIndex((p) => /two-thousand-c/i.test(p))
      return {
        first: document.querySelector('[data-testid="browse-list"] .browse-row[data-browse-path$=".txt"]')?.dataset.browsePath ?? '',
        moves: at < 0 ? -1 : orders.length - at - 1,
        selected: document.querySelector(`[data-browse-path="${CSS.escape(name)}"]`)?.getAttribute('aria-selected') ?? null,
        scrollTop: document.querySelector('[data-testid="browse-list"]').scrollTop
      }
    }, pickSized)
    // Sizes run 1 to 97 bytes by i % 97, so the biggest files are f00096 and
    // every 97th after it.
    const firstIndex = Number(/f(\d+)\.txt$/.exec(sized.first)?.[1] ?? -1)
    ok(resorted && firstIndex % 97 === 96, `once the sizes are in it is sorted by size, biggest first (${sized.first.split('\\').pop()})`)
    ok(sized.moves === 1, `the order moved exactly once, not with every patch (${sized.moves})`)
    ok(Math.abs(sized.scrollTop - 130) <= 1, `the scroll made before it is kept (${sized.scrollTop})`)
    // The selected row may have scrolled out of the drawn window with its
    // file, so the selection is read where the app keeps it: the tab's saved
    // place (written 400 ms after a change).
    const stillSelected = await until(() => {
      try {
        const saved = JSON.parse(readFileSync(join(PROFILE, 'tabs.json'), 'utf8'))
        const tab = saved.tabs.find((t) => t.role === 'explorer' && t.browse && sameDir(t.browse.path, f.big2000c))
        const at = tab?.browse.history[tab.browse.cursor]
        return !!at && sameDir(at.selected ?? '', pickSized)
      } catch {
        return false
      }
    }, 3000, 100)
    ok(stillSelected, 'and so is the selection, which moved with its file')
  } finally {
    await app.close().catch(() => {})
  }
}

/** 5. A folder slower than 300 ms: old rows first, then the header and a bar. */
async function slowFolderHintScenario() {
  console.log('never a loading screen: a slow folder')
  const f = buildNeverLoading()
  const tabs = { active: 0, tabs: [explorerTab('nl-pinned', f.root)] }
  const { app, win } = await launchProbed({ tabs, env: { PRISM_E2E_LIST_DELAY: '800' } })
  try {
    ok(await landed(win, f.root, 15000), 'the Explorer shows the fixture folder')
    await until(async () => (await win.locator('[data-testid="browse-list"] .browse-row').count()) > 0, 5000, 50)
    await sleep(1200)
    await typePath(win, f.slow)
    const sample = () =>
      win.evaluate((root) => {
        const rows = [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path]')]
        return {
          old: rows.filter((r) => r.dataset.browsePath.toLowerCase().startsWith(root.toLowerCase() + '\\') && !r.dataset.browsePath.toLowerCase().includes('slow-target')).length,
          rows: rows.length,
          bar: !!document.querySelector('.browse-progress[data-on]'),
          header: !!document.querySelector('.folder-browser .browse-columns'),
          status: document.querySelector('.browse-status')?.textContent ?? '',
          address: document.querySelector('.folder-browser nav.browse-path')?.textContent ?? ''
        }
      }, f.root)
    await sleep(150)
    const early = await sample()
    ok(early.old > 0 && !early.bar, `under 300 ms the old rows stay and there is no bar (${early.old} rows)`)
    ok(early.address.includes('slow-target'), 'the address already says where it is going')
    await sleep(300)
    const late = await sample()
    ok(late.rows === 0 && late.header && late.bar, 'past 300 ms: the header, no rows, and the thin bar under it')
    ok(/Reading folder/.test(late.status), `the status line says what is happening ("${late.status}")`)
    await win.screenshot({ path: join(SHOTS, 'never-loading-slow.png') })
    ok(await until(async () => (await sample()).rows > 0, 5000, 50), 'then the folder arrives')
    ok(!(await sample()).bar, 'and the bar goes')
    const p = await probeOf(win)
    ok(p.seen.length === 0, `no loading text at any point (${JSON.stringify(p.seen.slice(0, 3))})`)
  } finally {
    await app.close().catch(() => {})
  }
}

/** 6. A tab switch draws rows at once, with every read held back 800 ms. */
async function tabSwitchInstantScenario() {
  console.log('never a loading screen: a tab switch')
  const f = buildNeverLoading()
  const tabs = {
    active: 0,
    tabs: [explorerTab('nl-pinned', f.root), explorerTab('nl-second', f.cold, f.cold, false)]
  }
  const { app, win } = await launchProbed({ tabs, env: { PRISM_E2E_LIST_DELAY: '800' } })
  try {
    ok(await landed(win, f.root, 15000), 'the first Explorer tab shows its folder')
    await sleep(1200)
    const times = []
    for (const [index, dir] of [[1, f.cold], [0, f.root], [1, f.cold]]) {
      await win.evaluate((target) => {
        const nl = window.__nl
        nl.marks.length = 0
        // A row DIRECTLY in the target: `cold` is inside `root`, so a prefix
        // match on root was already true on cold's rows and the mark fired
        // before the click (a negative time, seen in a rerun).
        const base = `${target}\\`.toLowerCase()
        nl.marks.push({
          test: (rows) => rows.some((r) => {
            const p = r.dataset.browsePath.toLowerCase()
            return p.startsWith(base) && !p.slice(base.length).includes('\\')
          }),
          at: 0
        })
        nl.down = 0
        if (!nl.downHooked) {
          nl.downHooked = true
          document.addEventListener('pointerdown', () => (window.__nl.down = performance.now()), true)
        }
      }, dir)
      await win.locator('[role="tablist"] [role="tab"]').nth(index).click()
      await until(() => win.evaluate(() => !!window.__nl.marks[0].at), 3000, 20)
      times.push(await win.evaluate(() => Math.round(window.__nl.marks[0].at - window.__nl.down)))
    }
    console.log(`  (tab switch to rows: ${times.join(', ')} ms, every folder read held 800 ms)`)
    ok(times.every((t) => t >= 0 && t < 100), `each switch draws its rows without waiting on a read (${times.join(', ')} ms, a read would take over 800)`)
    const p = await probeOf(win)
    ok(p.seen.length === 0, `no loading text (${JSON.stringify(p.seen.slice(0, 3))})`)
  } finally {
    await app.close().catch(() => {})
  }
}

/** Settings > General > Remember folders: off deletes the cache, Clear too. */
async function rememberFoldersScenario() {
  console.log('never a loading screen: the Remember folders setting')
  const f = buildNeverLoading()
  const tabs = { active: 0, tabs: [explorerTab('nl-pinned', f.root, f.cached)] }
  rmSync(join(PROFILE, 'listing-cache'), { recursive: true, force: true })
  const { app, win } = await launchProbed({ tabs })
  const cacheDir = join(PROFILE, 'listing-cache')
  const files = () => (existsSync(cacheDir) ? readdirSync(cacheDir).filter((n) => n.endsWith('.json') && n !== 'index.json').length : 0)
  try {
    ok(await landed(win, f.cached, 15000), 'the Explorer shows a folder')
    ok(await until(() => files() > 0, 5000), `and it is kept on disk (${files()} file(s))`)
    await settingsPage(win, 'explorer')
    const row = win.locator('#remember-folders-clear')
    ok(await until(async () => (await row.count()) === 1, 5000), 'Settings > Explorer has Remember recent folders')
    await row.click()
    ok(await until(() => files() === 0, 5000), 'Clear deletes what was kept')
    const sw = win.locator('button[role="switch"][aria-label="Remember recent folders"]')
    ok((await sw.getAttribute('aria-checked')) === 'true', 'the switch is on by default')
    await sw.click()
    ok(await until(() => !existsSync(cacheDir), 5000), 'off deletes the folder')
    await sw.click()
    ok((await sw.getAttribute('aria-checked')) === 'true', 'and it can be switched back on')
  } finally {
    await win.evaluate(() => localStorage.removeItem('prism.explorer.rememberFolders')).catch(() => {})
    await app.close().catch(() => {})
  }
}

/** What a settings page looks like, measured in the page (#292). Every colour
 *  is read through a probe, since `color-mix()` computes to `color(srgb ...)`
 *  in 0..1; a see-through fill is laid over what is under it before a ratio. */
const settingsLookOf = (win) =>
  win.evaluate(() => {
    const parse = (c) => {
      const span = document.createElement('span')
      span.style.color = c
      document.body.appendChild(span)
      const v = getComputedStyle(span).color
      span.remove()
      const n = (v.replace(/^color\(srgb/, '').match(/[\d.]+/g) ?? []).map(Number)
      const unit = v.startsWith('color(') ? 255 : 1
      return { rgb: n.slice(0, 3).map((x) => x * unit), a: n.length > 3 ? n[3] : 1 }
    }
    const over = (top, under) => top.rgb.map((v, i) => under[i] + (v - under[i]) * top.a)
    const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const ratio = (x, y) => {
      const [a, b] = [lum(x), lum(y)]
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const root = getComputedStyle(document.documentElement)
    const frame = document.querySelector('[data-settings-page]')
    // The frame paints the style's ground; under glass it is composited over
    // the flat sidebar colour, the nearest thing to what is behind it.
    const flat = parse(root.getPropertyValue('--p-side-flat').trim()).rgb
    const ground = over(parse(getComputedStyle(frame).backgroundColor), flat)
    const panelEl = document.querySelector('[data-settings-panel]')
    const panelGround = panelEl ? over(parse(getComputedStyle(panelEl).backgroundColor), ground) : ground
    const row = document.querySelector('[data-setting-row]')
    const label = row?.querySelector('label')
    const sub = row?.querySelector('label + [title]')
    const tile = row?.firstElementChild?.firstElementChild
    const warnEl = document.querySelector('[data-setting-row] [title] svg')?.closest('[title]')
    const ink = (el) => over(parse(getComputedStyle(el).color), panelGround)
    const chosen = document.querySelector('[data-settings-tab][aria-current="page"]')
    const accent = parse(root.getPropertyValue('--p-accent').trim())
    // A swatch IS its colour (its fill is inline), and the accent-following
    // scheme's swatch is the accent: a mark, not a button that wears it.
    const accentButtons = [...frame.querySelectorAll('button')].filter((b) => {
      if (b.style.background) return false
      const mine = parse(getComputedStyle(b).backgroundColor)
      return mine.a > 0.3 && mine.rgb.map(Math.round).join() === accent.rgb.map(Math.round).join()
    })
    const rows = [...frame.querySelectorAll('[data-setting-row]')]
    const radius = parseFloat(root.getPropertyValue('--p-radius')) || 0
    const r = (n) => Math.round(n * 10) / 10
    // Two controls of one row overlapping is a layout fault the eye can miss.
    const overlap = rows.some((rw) => {
      const boxes = [...rw.querySelectorAll('[data-row-control] > *')].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0)
      return boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1))
    })
    return {
      label: label ? ratio(ink(label), panelGround) : 0,
      sub: sub ? ratio(ink(sub), panelGround) : 0,
      icon: tile ? ratio(ink(tile), over(parse(getComputedStyle(tile).backgroundColor), panelGround)) : 0,
      warn: warnEl ? ratio(ink(warnEl), panelGround) : null,
      chosen: chosen ? parse(getComputedStyle(chosen).backgroundColor) : null,
      hoverHi: parse(root.getPropertyValue('--p-hover-hi').trim()),
      accent,
      accentButtons: accentButtons.map((b) => b.textContent.trim()),
      sideways: frame.scrollWidth > frame.clientWidth + 1 || document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      rowMin: rows.length ? Math.min(...rows.map((x) => x.getBoundingClientRect().height)) : 0,
      tile: tile ? r(tile.getBoundingClientRect().width) : 0,
      panelRadius: panelEl ? parseFloat(getComputedStyle(panelEl).borderTopLeftRadius) : 0,
      wantRadius: Math.max(4, radius + 3),
      overlap,
      rail: Math.round(frame.querySelector('nav[aria-label="Settings pages"]').getBoundingClientRect().width)
    }
  })

/**
 * THE SETTINGS LOOK (#292; owner, 2026-10-05: the approved v1 "Grouped cards",
 * with no accent bar on the chosen rail item). Every page in a dark and a
 * light style: label and subtext 4.5:1 on the panel as composited, the icon
 * 3:1 on its tile, a warning subtext 4.5:1, the chosen rail page the GREY fill
 * and never the accent, Save changes the only accent-filled buttons, rows at
 * least 58px with a 32px tile, the panel's corner the style's roundness plus
 * 3px (Void 2px gives 5px, Glacier 14px gives 17px), nothing sideways at 1600
 * and 900px or with Font size Large, the icon rail under 760px and
 * from the title bar's toggle. A screenshot of every page in both schemes,
 * LOOKED AT before a change is called done (#20 in Prism Terminal).
 *
 * In `e2e:terminal`, RUNNER-SAFE: the frame, sections and rows are the core's,
 * so a core bump that breaks Prism's settings layout is held here. Nothing
 * reads a window material or assumes this machine.
 */
async function settingsLookScenario(fixtures) {
  console.log('settings look')
  const root = join(tmpdir(), `${PROFILE_NAME}-settings-look`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  EXTRA_ENV = { PRISM_DICTATION_ROOT: root, PRISM_E2E_NVIDIA: '0' }
  let app
  let win
  let styleBefore
  // The window's size is SAVED in the shared profile: the scenarios after
  // this one must start at the size they always did.
  let sizeBefore = null
  try {
    ;({ app, win } = await launch(join(fixtures, 'README.md')))
    sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    const setSize = (w, h) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), [w, h])
    await setSize(1600, 1000)
    await win.waitForSelector('[role="treeitem"]', { timeout: 15000 })
    styleBefore = await switchStyle(win, 'aurora')
    await settingsPage(win, 'appearance')
    ok((await win.locator('[data-settings-tab="appearance"]').getAttribute('aria-current')) === 'page', 'Settings opens on Appearance')
    const rail = await win.evaluate(() => [...document.querySelectorAll('[data-settings-tab]')].map((b) => b.getAttribute('data-settings-tab')))
    ok(
      JSON.stringify(rail) === JSON.stringify(['appearance', 'explorer', 'project', 'terminal', 'agents', 'dictation', 'media', 'about']),
      `the rail runs Appearance, Explorer, Project settings, Terminal, Agents, Dictation, Media, About (${rail.join(', ')})`
    )
    const pages = [
      ['appearance'],
      ['explorer'],
      ['project'],
      ['terminal'],
      ['agents'],
      ['dictation'],
      ['media', 'visualizer'],
      ['media', 'progress'],
      ['about']
    ]
    for (const [scheme, style] of [['dark', 'aurora'], ['light', 'paper']]) {
      await switchStyle(win, style)
      ok(await until(() => win.evaluate((m) => document.documentElement.dataset.mode === m, scheme), 6000, 50), `in a ${scheme} style (${style})`)
      for (const [page, view] of pages) {
        await settingsPage(win, page)
        if (view) await win.locator(`[data-seg="${view}"]`).click()
        // The dictation page's switch, on with no model, is the one live
        // warning a fresh profile can show: measure it while it is up.
        if (page === 'dictation') {
          const sw = win.locator('[data-pref="dictation-enabled"] [role="switch"]')
          if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
        }
        await win.mouse.move(5, 5)
        await sleep(450)
        const name = view ? `${page}-${view}` : page
        const m = await settingsLookOf(win)
        ok(m.label >= 4.5 && m.sub >= 4.5, `${scheme} ${name}: label and subtext read on the panel (${m.label.toFixed(1)}:1, ${m.sub.toFixed(1)}:1)`)
        ok(m.icon >= 3, `${scheme} ${name}: the icon reads 3:1 on its tile (${m.icon.toFixed(1)}:1)`)
        if (page === 'dictation') ok(m.warn !== null && m.warn >= 4.5, `${scheme} dictation: a warning subtext reads 4.5:1 (${m.warn?.toFixed(1)}:1)`)
        ok(
          !!m.chosen && m.chosen.rgb.map(Math.round).join() === m.hoverHi.rgb.map(Math.round).join() && Math.abs(m.chosen.a - m.hoverHi.a) < 0.02,
          `${scheme} ${name}: the chosen rail page is the grey fill (${JSON.stringify(m.chosen)})`
        )
        ok(!!m.chosen && m.chosen.rgb.map(Math.round).join() !== m.accent.rgb.map(Math.round).join(), `${scheme} ${name}: and not the accent`)
        ok(m.accentButtons.every((b) => b === 'Save changes'), `${scheme} ${name}: the only accent-filled buttons are Save changes (${JSON.stringify(m.accentButtons)})`)
        ok(!m.sideways, `${scheme} ${name}: nothing scrolls sideways at 1600px`)
        ok(m.rowMin >= 57.5 && m.tile === 32, `${scheme} ${name}: rows at least 58px, a 32px icon tile (${m.rowMin}, ${m.tile})`)
        ok(m.panelRadius === m.wantRadius, `${scheme} ${name}: the panel's corner is the style's plus 3px (${m.panelRadius} of ${m.wantRadius})`)
        ok(!m.overlap, `${scheme} ${name}: no two controls of a row overlap`)
        await win.screenshot({ path: join(SHOTS, `settings-${name}-${scheme}.png`) })
        if (page === 'dictation') await win.locator('[data-pref="dictation-enabled"] [role="switch"]').click()
      }
    }
    // The theme's ROUNDNESS rounds the panels: Void (2px) and Glacier (14px).
    for (const [style, want] of [['new-void', 5], ['glacier', 17]]) {
      await switchStyle(win, style)
      await settingsPage(win, 'appearance')
      ok(
        await until(async () => (await settingsLookOf(win)).panelRadius === want, 3000, 50),
        `${style}: the panels' corners are ${want}px (${(await settingsLookOf(win)).panelRadius})`
      )
      await win.screenshot({ path: join(SHOTS, `settings-appearance-${style}.png`) })
    }
    await switchStyle(win, 'aurora')
    // Font size Large zooms the page by 1.12: nothing overflows.
    const size = await gotoPref(win, 'tree-size')
    await size.locator('#tree-size').click()
    await win.locator('[data-pref="tree-size"] [role="option"]:has-text("Large")').click()
    ok(await until(() => win.evaluate(() => localStorage.getItem('prism.tree.size') === 'large'), 3000, 50), 'Font size is Large')
    for (const [page, view] of pages) {
      await settingsPage(win, page)
      if (view) await win.locator(`[data-seg="${view}"]`).click()
      await sleep(250)
      ok(!(await settingsLookOf(win)).sideways, `Large: ${view ?? page} scrolls nothing sideways`)
    }
    await win.screenshot({ path: join(SHOTS, 'settings-large.png') })
    await (await gotoPref(win, 'tree-size')).locator('#tree-size').click()
    await win.locator('[data-pref="tree-size"] [role="option"]:has-text("Default")').click()
    // 900px: the full rail, nothing sideways. Under 760px of the FRAME the rail
    // is icons and Find a setting a magnifier.
    await settingsPage(win, 'appearance')
    await setSize(900, 800)
    await sleep(500)
    ok(!(await settingsLookOf(win)).sideways, 'nothing scrolls sideways at 900px')
    ok((await settingsLookOf(win)).rail >= 200, `at 900px the rail has its names (${(await settingsLookOf(win)).rail}px)`)
    await setSize(700, 700)
    ok(await until(async () => (await settingsLookOf(win)).rail <= 60, 3000, 50), `under 760px the rail is icons (${(await settingsLookOf(win)).rail}px)`)
    ok(!(await win.locator('[data-settings-tab="appearance"] span').last().isVisible()), 'with the page names hidden')
    ok(!(await settingsLookOf(win)).sideways, 'and nothing scrolls sideways')
    const find = win.locator('[data-settings-find]')
    await find.click()
    await win.keyboard.type('font')
    ok(await until(async () => (await find.evaluate((el) => el.getBoundingClientRect().width)) > 200, 3000, 50), 'the magnifier opens the field over the pane')
    await win.screenshot({ path: join(SHOTS, 'settings-narrow-search.png') })
    await win.keyboard.press('Escape')
    await setSize(1600, 1000)
    await sleep(300)
    // Prism's own compact rail, from the title bar's toggle, is the same icons.
    await win.locator('[data-title-bar] [data-panel-toggle]').click()
    ok(await until(async () => (await settingsLookOf(win)).rail <= 60, 3000, 50), `the title bar's toggle collapses the rail to icons (${(await settingsLookOf(win)).rail}px)`)
    // Each page is a 40px tile there, as in the narrow layout: the chosen
    // fill was an 18px sliver round the icon before (review of #292).
    const tileW = await win.evaluate(() => Math.round(document.querySelector('[data-settings-tab][aria-current="page"]').getBoundingClientRect().width))
    ok(tileW >= 38 && tileW <= 42, `and each page is a 40px tile there (${tileW}px)`)
    await win.screenshot({ path: join(SHOTS, 'settings-compact.png') })
    await win.locator('[data-title-bar] [data-panel-toggle]').click()
    ok(await until(async () => (await settingsLookOf(win)).rail >= 200, 3000, 50), 'and back')
  } finally {
    EXTRA_ENV = {}
    if (styleBefore !== undefined && win) await switchStyle(win, styleBefore).catch(() => {})
    await win?.evaluate(() => localStorage.removeItem('prism.tree.size')).catch(() => {})
    if (sizeBefore) await app?.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), sizeBefore).catch(() => {})
    await app?.close().catch(() => {})
  }
}

/**
 * THE THEME WALL (#298; owner, 2026-10-06, the approved mockup: "perfect, go
 * ahead and build"). Settings > Appearance opens on the Themes card: its
 * header row ("Themes", "Choose your look."), then the wall collapsed to the
 * row of the current theme, card style B (the chosen card's ring in the
 * accent line and a check in its band, the blurb as tooltip, no
 * "Suggested"). Show all opens with the height only growing, every card in
 * the approved order, the chevron turned, and nothing left running or inline
 * when it ends; Show fewer shuts the same way; a second press mid-way
 * reverses from where the wall IS; reduced motion is the end state at once.
 * The keys: one tab stop; an arrow previews (paints, stores nothing); Enter
 * keeps; past the row opens the wall; Home, End; Escape goes back with the
 * draft intact; focus is the fill, never a ring (#272).
 */
const THEME_ORDER = ['aurora', 'new-void', 'carbon', 'obsidian', 'ember', 'volt', 'midnight-hc', 'glacier', 'lagoon', 'frost', 'paper', 'sand', 'sage', 'blush', 'chalk', 'daylight-hc', 'orchid', 'pearl']

/** The wall as the page has it. */
const wallState = (win) =>
  win.evaluate(() => {
    const wall = document.querySelector('[data-theme-wall]')
    const cards = [...document.querySelectorAll('[data-theme-card]')]
    const more = document.querySelector('[data-wall-more]')
    const chev = document.querySelector('[data-wall-chevron]')
    const inline = [wall, ...cards].filter((el) => el.style.height || el.style.transform || el.style.opacity).length
    return {
      ids: cards.map((c) => c.getAttribute('data-theme-card')),
      shown: cards.filter((c) => !c.hasAttribute('data-hid')).map((c) => c.getAttribute('data-theme-card')),
      checked: cards.filter((c) => c.getAttribute('aria-checked') === 'true').map((c) => c.getAttribute('data-theme-card')),
      more: more?.textContent?.trim() ?? '',
      expanded: more?.getAttribute('aria-expanded'),
      chevron: chev ? getComputedStyle(chev).transform : '',
      anims: wall ? wall.getAnimations({ subtree: true }).length : -1,
      inline,
      moving: wall?.hasAttribute('data-moving'),
      height: wall ? wall.getBoundingClientRect().height : 0
    }
  })

/** Press Show all / Show fewer and sample the wall's height every 25ms until
 *  it settles (or `ms`). */
const pressAndSample = (win, ms = 600) =>
  win.evaluate(
    (ms) =>
      new Promise((done) => {
        const wall = document.querySelector('[data-theme-wall]')
        const heights = [wall.getBoundingClientRect().height]
        document.querySelector('[data-wall-more]').click()
        const t0 = performance.now()
        const iv = setInterval(() => {
          heights.push(wall.getBoundingClientRect().height)
          if (performance.now() - t0 > ms) {
            clearInterval(iv)
            done(heights)
          }
        }, 25)
      }),
    ms
  )

const monotonic = (hs, dir) => hs.every((h, i) => i === 0 || (dir > 0 ? h >= hs[i - 1] - 0.5 : h <= hs[i - 1] + 0.5))

async function themeWallScenario(fixtures) {
  console.log('theme wall')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  let styleBefore
  let draftBefore
  const blurbs = Object.fromEntries(
    JSON.parse(readFileSync(join(ROOT, 'src', 'renderer', 'src', 'lib', 'themes', 'catalogue.json'), 'utf8')).map((t) => [
      t.id,
      t.blurb.replace(/\s*Kept from the current set\.\s*$/, '')
    ])
  )
  const setDraft = (d) =>
    win.evaluate((v) => {
      if (v === null) localStorage.removeItem('prism.style.draft')
      else localStorage.setItem('prism.style.draft', v)
      window.dispatchEvent(new StorageEvent('storage', { key: 'prism.style.draft', storageArea: localStorage }))
    }, d)
  const bg = () => win.evaluate(() => document.documentElement.style.getPropertyValue('--p-bg'))
  const stored = () => win.evaluate(() => localStorage.getItem('prism.style'))
  const focused = () => win.evaluate(() => document.activeElement?.getAttribute('data-theme-card') ?? null)
  const sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
    draftBefore = await win.evaluate(() => localStorage.getItem('prism.style.draft'))
    await setDraft(null)
    styleBefore = await switchStyle(win, 'aurora')
    const row = await gotoPref(win, 'style-theme')
    const head = (await row.textContent()) ?? ''
    ok(head.includes('Themes') && head.includes('Choose your look.'), `the Themes card opens on its header row (${head.trim()})`)
    ok((await win.locator('[data-settings-section="style-theme"] h3').count()) === 0, 'and has no section heading above it')
    ok((await win.locator('[data-pref="mode"]').count()) === 0, 'there is no Colour mode row')
    let w = await wallState(win)
    const own = w.ids.filter((id) => !THEME_ORDER.includes(id))
    ok(JSON.stringify(w.ids.slice(0, 18)) === JSON.stringify(THEME_ORDER), `the wall lists the 18 in the approved order, then own copies (${w.ids.join(', ')})`)
    ok(JSON.stringify(w.shown) === JSON.stringify(THEME_ORDER.slice(0, 6)), `collapsed, it shows exactly the current row (${w.shown.join(', ')})`)
    ok(w.more === `Show all ${w.ids.length} themes` && w.expanded === 'false', `under it: "${w.more}", not expanded`)
    ok(JSON.stringify(w.checked) === '["aurora"]', `Aurora is the chosen card (${w.checked})`)
    const ring = await win.evaluate(() => {
      const pv = document.querySelector('[data-theme-card="aurora"] .theme-card-pv')
      const probe = document.createElement('i')
      probe.style.color = 'var(--p-accent-solid)'
      document.body.appendChild(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      const cs = getComputedStyle(pv)
      // The page's zoom: a 100px box inside it as the window lays it out.
      const ruler = document.createElement('div')
      ruler.style.width = '100px'
      pv.parentElement.appendChild(ruler)
      const zoom = ruler.getBoundingClientRect().width / 100
      ruler.remove()
      return { outline: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset, zoom, accent, check: !!pv.querySelector('[data-theme-check]'), checks: document.querySelectorAll('[data-theme-check]').length }
    })
    // 2px, snapped to whole device pixels (1.78px at 225%).
    const px = (v) => Math.abs(parseFloat(v) - 2) < 0.5
    ok(
      ring.outline === ring.accent && px(ring.width) && px(ring.offset),
      `the chosen ring is 2px of --p-accent-solid, 2px out (${JSON.stringify(ring)})`
    )
    ok(ring.check && ring.checks === 1, 'and its band carries the one check')
    const titles = await win.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-theme-card]')].map((c) => [c.getAttribute('data-theme-card'), c.getAttribute('title')])))
    ok(THEME_ORDER.every((id) => titles[id] === blurbs[id]), 'every card\'s tooltip is its theme\'s description')
    ok(!((await win.locator('[data-style-wall]').textContent()) ?? '').includes('Suggested'), 'nothing says "Suggested"')
    await win.mouse.move(5, 5)
    await win.screenshot({ path: join(SHOTS, 'theme-wall-dark-collapsed.png') })

    // Show all: the height only grows, then every card, "Show fewer", the
    // chevron turned, nothing left running or inline.
    let hs = await pressAndSample(win)
    w = await wallState(win)
    ok(hs.length > 8 && monotonic(hs, 1) && hs[hs.length - 1] > hs[0] + 100, `Show all: the height only grows (${hs.map(Math.round).join(' ')})`)
    ok(hs.slice(1, 6).some((h) => h > hs[0] + 1 && h < hs[hs.length - 1] - 1), 'and it moves there, not in one jump')
    ok(w.shown.length === w.ids.length && JSON.stringify(w.shown.slice(0, 18)) === JSON.stringify(THEME_ORDER), `then all ${w.ids.length} are shown, in order`)
    ok(w.more === 'Show fewer' && w.expanded === 'true', `the control says "${w.more}", expanded`)
    ok(/^matrix\(-1, ?0(\.0+)?, ?-?0(\.0+)?, ?-1/.test(w.chevron), `the chevron is turned 180 degrees (${w.chevron})`)
    ok(w.anims === 0 && w.inline === 0 && !w.moving, `nothing left running, inline or clipped (${w.anims} animations, ${w.inline} inline)`)
    await win.screenshot({ path: join(SHOTS, 'theme-wall-dark-expanded.png') })
    hs = await pressAndSample(win)
    w = await wallState(win)
    ok(monotonic(hs, -1) && hs[hs.length - 1] < hs[0] - 100, `Show fewer: the height only shrinks (${hs.map(Math.round).join(' ')})`)
    ok(JSON.stringify(w.shown) === JSON.stringify(THEME_ORDER.slice(0, 6)) && w.anims === 0 && w.inline === 0, 'and ends on the current row, settled')

    // A second press 100ms in reverses from where the wall is.
    const rev = await win.evaluate(
      () =>
        new Promise((done) => {
          const wall = document.querySelector('[data-theme-wall]')
          const more = document.querySelector('[data-wall-more]')
          const hs = []
          more.click()
          setTimeout(() => {
            const at = wall.getBoundingClientRect().height
            more.click()
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                hs.push(wall.getBoundingClientRect().height)
                setTimeout(() => done({ at, next: hs[0], end: wall.getBoundingClientRect().height }), 450)
              })
            )
          }, 100)
        })
    )
    w = await wallState(win)
    ok(Math.abs(rev.next - rev.at) < 40 && rev.next <= rev.at + 1, `a second press 100ms in reverses from the measured height (${Math.round(rev.at)} then ${Math.round(rev.next)})`)
    ok(w.shown.length === 6 && w.anims === 0 && w.inline === 0, `and ends collapsed, settled (${Math.round(rev.end)}px)`)

    // Reduced motion: the end state in the same frame, no animation.
    await win.emulateMedia({ reducedMotion: 'reduce' })
    const instant = await win.evaluate(() => {
      const wall = document.querySelector('[data-theme-wall]')
      document.querySelector('[data-wall-more]').click()
      return {
        shown: [...document.querySelectorAll('[data-theme-card]')].filter((c) => !c.hasAttribute('data-hid')).length,
        anims: wall.getAnimations({ subtree: true }).length
      }
    })
    ok(instant.anims === 0 && instant.shown === w.ids.length, `reduced motion: every card at once, no animation (${JSON.stringify(instant)})`)
    await win.locator('[data-wall-more]').click()
    await win.emulateMedia({ reducedMotion: 'no-preference' })

    // THE KEYS. Tab lands on the chosen card; the next Tab leaves the wall.
    await win.evaluate(() => {
      const r = document.querySelector('[data-pref="style-theme"]')
      r.tabIndex = -1
      r.focus()
    })
    await win.keyboard.press('Tab')
    ok((await focused()) === 'aurora', `Tab lands on the chosen card (${await focused()})`)
    // Focus is the hover's fill, never a ring (#272), focused against unfocused.
    const look = await win.evaluate(() => {
      const a = document.querySelector('[data-theme-card="aurora"]')
      const b = document.querySelector('[data-theme-card="new-void"]')
      const cs = (el) => {
        const s = getComputedStyle(el)
        return { image: s.backgroundImage, outline: s.outlineStyle, ring: s.boxShadow, edge: getComputedStyle(el.querySelector('.theme-card-pv')).outlineStyle }
      }
      return { on: cs(a), off: cs(b) }
    })
    ok(look.on.image !== 'none' && look.off.image === 'none', `a focused card wears the hover fill (${look.on.image.slice(0, 40)})`)
    ok(look.on.outline === 'none' && look.on.ring === 'none', 'and no outline or ring of focus')
    await win.screenshot({ path: join(SHOTS, 'theme-wall-focused.png') })
    await win.keyboard.press('Tab')
    ok(await win.evaluate(() => !document.activeElement?.closest('[data-theme-wall]')), 'the next Tab leaves the wall (one stop)')
    await win.locator('[data-theme-card="aurora"]').focus()

    // Right PREVIEWS: the window repaints, nothing is stored.
    const auroraBg = await bg()
    await win.keyboard.press('ArrowRight')
    ok(await until(async () => (await bg()) !== auroraBg, 2000, 25), `Right repaints the window (--p-bg ${auroraBg} to ${await bg()})`)
    ok((await stored()) === 'aurora', 'and stores nothing (prism.style is still aurora)')
    ok(await until(async () => (await focused()) === 'new-void', 2000, 25), 'the focus moves to Void')
    ok(JSON.stringify((await wallState(win)).checked) === '["new-void"]', 'and Void is the chosen card')
    await win.keyboard.press('Enter')
    ok(await until(async () => (await stored()) === 'new-void', 2000, 25), 'Enter keeps it (prism.style is new-void)')
    ok(((await win.locator('[data-wall-say]').textContent()) ?? '') === 'Void kept', 'and says so')

    // A draft on Void, then Down past the row: the wall opens, Glacier is
    // previewed, the draft hidden; Escape gives Void and its draft back.
    await setDraft(JSON.stringify({ font: 'mono' }))
    const voidBg = await bg()
    const monoFont = await win.evaluate(() => document.documentElement.style.getPropertyValue('--p-font'))
    await win.locator('[data-theme-card="new-void"]').focus()
    await win.keyboard.press('ArrowDown')
    ok(await until(async () => (await wallState(win)).expanded === 'true', 2000, 25), 'Down past the row opens the wall')
    ok(await until(async () => (await focused()) === 'glacier', 2000, 25), `and lands on Glacier (${await focused()})`)
    ok((await bg()).startsWith('rgba('), `previewing see-through Glacier (${await bg()})`)
    await sleep(400)
    await win.screenshot({ path: join(SHOTS, 'theme-wall-preview-glacier.png') })
    await win.keyboard.press('Home')
    ok(await until(async () => (await focused()) === 'aurora', 2000, 25), 'Home goes to the first')
    await win.keyboard.press('End')
    const last = (await wallState(win)).ids.at(-1)
    ok(await until(async () => (await focused()) === last, 2000, 25), `End to the last (${last})`)
    await win.keyboard.press('Escape')
    ok(await until(async () => (await bg()) === voidBg, 2000, 25), 'Escape goes back to Void')
    ok((await win.locator('[data-settings-page]').count()) === 1, 'and leaves Settings open')
    ok((await focused()) === 'new-void', 'with the focus on its card')
    ok((await stored()) === 'new-void', 'nothing was stored on the way')
    ok(
      (await win.evaluate(() => localStorage.getItem('prism.style.draft'))) === JSON.stringify({ font: 'mono' }) &&
        (await win.evaluate(() => document.documentElement.style.getPropertyValue('--p-font'))) === monoFont,
      'and the draft is intact, painted again'
    )
    await setDraft(null)

    // Holding Right across all 18 repaints at key-repeat speed: no frame
    // over 50ms (spec 10).
    await win.locator('[data-theme-card="new-void"]').focus()
    await win.keyboard.press('Home')
    await win.evaluate(() => {
      window.__frames = []
      window.__presses = []
      let last = performance.now()
      const tick = (t) => {
        window.__frames.push([t, t - last])
        last = t
        if (window.__frames.length < 400) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await sleep(100)
    for (let i = 0; i < 17; i++) {
      await win.evaluate(() => window.__presses.push([performance.now(), document.activeElement?.getAttribute('data-theme-card')]))
      await win.keyboard.press('ArrowRight')
      await sleep(33)
    }
    await sleep(200)
    const { frames, presses } = await win.evaluate(() => ({ frames: window.__frames.slice(2), presses: window.__presses }))
    const worst = Math.max(...frames.map((f) => f[1]))
    const slow = frames
      .filter((f) => f[1] >= 34)
      .map(([t, d]) => `${Math.round(d)}ms after ${[...presses].reverse().find((p) => p[0] <= t)?.[1] ?? 'start'}`)
    ok(worst < 50, `holding Right across all 18: the longest frame is ${Math.round(worst)}ms (${slow.join(', ') || 'none over 34ms'})`)
    ok((await focused()) === 'pearl', `and ends on Pearl (${await focused()})`)
    await win.keyboard.press('Escape')
    ok(await until(async () => (await bg()) === voidBg, 2000, 25), 'Escape goes back from there too')

    // Screenshots of the page in each kind of theme, for the eye.
    await win.mouse.move(5, 5)
    for (const id of ['paper', 'glacier', 'orchid', 'midnight-hc', 'daylight-hc']) {
      await switchStyle(win, id)
      await sleep(350)
      await win.screenshot({ path: join(SHOTS, `theme-wall-${id}.png`) })
    }
    await switchStyle(win, 'paper')
    await sleep(350)
    if ((await win.locator('[data-wall-more]').getAttribute('aria-expanded')) !== 'true') await win.locator('[data-wall-more]').click()
    await sleep(450)
    await win.screenshot({ path: join(SHOTS, 'theme-wall-light-expanded.png') })
    ok(own.length >= 0, `own copies after the 18: ${own.length}`)
  } finally {
    await win.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {})
    await setDraft(draftBefore ?? null).catch(() => {})
    if (styleBefore !== undefined) await switchStyle(win, styleBefore).catch(() => {})
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), sizeBefore).catch(() => {})
    await app.close().catch(() => {})
  }
}

/**
 * THE THEMES WHERE THEY ARE WORN (#298): a code file and the Explorer in a
 * dark, a warm, a monochrome light, both high contrast and a see-through
 * theme. The code colours are the theme's own tokens (they left index.css),
 * and the screenshots are for the eye, against the mockup's.
 */
async function themeLooksScenario(fixtures) {
  console.log('theme looks')
  const { app, win } = await launch(join(fixtures, 'code', 'main.py'))
  let styleBefore
  const catalogue = JSON.parse(readFileSync(join(ROOT, 'src', 'renderer', 'src', 'lib', 'themes', 'catalogue.json'), 'utf8'))
  try {
    await win.waitForSelector('.cm-content', { timeout: 10000 })
    for (const id of ['aurora', 'ember', 'chalk', 'midnight-hc', 'daylight-hc', 'orchid']) {
      const r = await switchStyle(win, id)
      if (styleBefore === undefined) styleBefore = r
      await sleep(350)
      const t = catalogue.find((x) => x.id === id)
      const code = await win.evaluate(() => {
        const cs = getComputedStyle(document.documentElement)
        return { keyword: cs.getPropertyValue('--p-code-keyword').trim(), string: cs.getPropertyValue('--p-code-string').trim(), tag: cs.getPropertyValue('--p-code-tag').trim() }
      })
      ok(code.keyword === t.code.keyword && code.string === t.code.string && code.tag === t.code.tag, `${id}: the code colours are the theme's (${JSON.stringify(code)})`)
      await win.mouse.move(5, 5)
      await win.screenshot({ path: join(SHOTS, `theme-code-${id}.png`) })
    }
    await win.locator('[role="tab"]:has-text("Explorer")').first().click()
    for (const id of ['aurora', 'carbon', 'paper', 'midnight-hc', 'glacier', 'pearl']) {
      await switchStyle(win, id)
      await sleep(350)
      await win.screenshot({ path: join(SHOTS, `theme-explorer-${id}.png`) })
    }
  } finally {
    if (styleBefore !== undefined) await switchStyle(win, styleBefore).catch(() => {})
    await app.close().catch(() => {})
  }
}

/** Write window preferences into a profile before its first launch. */
function seedPreferences(profile, kv) {
  const preferences = join(profile, 'window-preferences')
  mkdirSync(preferences, { recursive: true })
  for (const [key, value] of Object.entries(kv))
    writeFileSync(join(preferences, createHash('sha256').update(key).digest('hex') + '.json'), JSON.stringify({ key, value }))
}

/**
 * SAVED THEMES MOVE ONCE (#298, spec 4), in two real profiles: one on Onyx
 * with an unsaved edit and two own copies (one dark, one light, both grown
 * out of Onyx), one on Driftwood with Colour mode left on light. After the
 * launch: Onyx is Void WITH ITS GLASS as an unsaved edit, Driftwood is Carbon
 * (the old mode is not read), the own copies are the last cards and
 * unchanged but for their base, the one quiet line names the old theme,
 * nothing reset to Aurora, the marker is set; a theme pick takes the line away.
 */
async function themeMigrationScenario(fixtures) {
  console.log('theme migration')
  const dark = { id: 'custom-0-1-Customtheme1', name: 'Custom theme 1', blurb: 'Glass over true black.', mode: 'dark', material: 'acrylic', bg: '#000000', side: '#141414', title: '#141414', text: '#eef0f4', folderIcon: '#8bb1fd', iconMode: 'kind', icon: '#8a8e99', accent: '#ff5500', font: 'system', size: '12.5', corners: '2', borders: 'faint', custom: true, base: 'default' }
  const light = { ...dark, id: 'custom-0-2-Customtheme2', name: 'Custom theme 2', mode: 'light', material: 'solid', bg: '#f8f4ed', side: '#f1ebe1', title: '#e9e2d5', text: '#241f18', accent: '#92400e' }
  const cases = [
    { name: 'onyx', seed: { 'prism.style': 'default', 'prism.style.draft': JSON.stringify({ accent: '#22aa66' }), 'prism.style.presets': JSON.stringify([dark, light]), 'prism.mode': 'dark' }, want: 'new-void', retired: 'Onyx', mapped: 'Void' },
    { name: 'driftwood', seed: { 'prism.style': 'driftwood', 'prism.mode': 'light' }, want: 'carbon', retired: 'Driftwood', mapped: 'Carbon' }
  ]
  for (const c of cases) {
    const profile = `${PROFILE}-migrate-${c.name}`
    rmSync(profile, { recursive: true, force: true })
    seedPreferences(profile, { 'prism.onboarded': '1', 'prism.sidebar': '1', 'prism.newtab.mode': 'folder', 'prism.newtab.folder': fixtures, ...c.seed })
    const { app, win } = await launchProbed({ profile, tabs: { active: 0, tabs: [explorerTab('fixture-explorer', fixtures)] } })
    try {
      const keys = await win.evaluate(() =>
        Object.fromEntries(['prism.style', 'prism.style.draft', 'prism.style.presets', 'prism.style.v', 'prism.style.retired', 'prism.mode'].map((k) => [k, localStorage.getItem(k)]))
      )
      ok(keys['prism.style'] === c.want, `${c.name}: the saved theme is now ${c.want} (${keys['prism.style']})`)
      ok(keys['prism.style.v'] === '2', `${c.name}: the marker is set`)
      ok(keys['prism.style.retired'] === c.retired, `${c.name}: the old name is kept for the one line (${keys['prism.style.retired']})`)
      if (c.name === 'onyx') {
        const draft = JSON.parse(keys['prism.style.draft'] ?? '{}')
        ok(draft.acrylic === 55 && draft.accent === '#22aa66', `onyx: its glass is an unsaved edit of Void, level 55, the edit kept (${keys['prism.style.draft']})`)
        ok(await win.evaluate(() => document.documentElement.style.getPropertyValue('--p-bg').startsWith('rgba(')), 'onyx: the window is see-through')
        const presets = JSON.parse(keys['prism.style.presets'] ?? '[]')
        ok(JSON.stringify(presets) === JSON.stringify([{ ...dark, base: 'new-void' }, { ...light, base: 'new-void' }]), 'onyx: both own copies are kept field for field, their base mapped')
      } else {
        ok(keys['prism.mode'] === 'dark', `driftwood: the old light mode was not read; the boot mirror says dark (${keys['prism.mode']})`)
      }
      await settingsPage(win, 'appearance')
      const line = win.locator('[data-theme-retired]')
      ok(((await line.textContent()) ?? '').trim() === `Your theme ${c.retired} was retired, ${c.mapped} is the closest.`, `${c.name}: the one quiet line (${(await line.textContent())?.trim()})`)
      const w = await wallState(win)
      if (c.name === 'onyx') ok(JSON.stringify(w.ids.slice(-2)) === JSON.stringify([dark.id, light.id]), `onyx: the own copies are the last cards (${w.ids.slice(-2)})`)
      ok(JSON.stringify(w.checked) === JSON.stringify([c.want]), `${c.name}: the chosen card is ${c.want}, nothing reset to Aurora (${w.checked})`)
      await win.screenshot({ path: join(SHOTS, `theme-migration-${c.name}.png`) })
      await win.locator('[data-theme-card="aurora"]').click()
      ok(await until(async () => (await line.count()) === 0, 3000, 50), `${c.name}: a theme pick takes the line away`)
      ok((await win.evaluate(() => localStorage.getItem('prism.style.retired'))) === null, `${c.name}: and its key`)
    } finally {
      await app.close().catch(() => {})
      await sleep(900)
      rmSync(profile, { recursive: true, force: true })
    }
  }
}

/**
 * ONBOARDING IS THREE STEPS, THE FIRST THE THEME WALL (#298, spec 5): a
 * profile that has not been through setup gets three dots and the same wall
 * on step one; picking Paper from Aurora plays the sweep and lands light;
 * Start stores the theme.
 */
async function onboardingThemeScenario(fixtures) {
  console.log('onboarding theme')
  const profile = `${PROFILE}-onboarding`
  rmSync(profile, { recursive: true, force: true })
  seedPreferences(profile, { 'prism.newtab.mode': 'folder', 'prism.newtab.folder': fixtures })
  const { app, win } = await launchProbed({ profile, tabs: { active: 0, tabs: [explorerTab('fixture-explorer', fixtures)] } })
  try {
    await win.locator('button:has-text("Get started")').click({ timeout: 15000 })
    ok((await win.locator('[data-ob-dots] > span').count()) === 3, `three steps (${await win.locator('[data-ob-dots] > span').count()} dots)`)
    const step = (await win.locator('.ob-deal h1').first().textContent()) ?? ''
    ok(step.includes('Choose your look.'), `step one is the theme step (${step})`)
    ok((await win.locator('[data-onboarding-wall] [data-theme-wall]').count()) === 1, 'with the theme wall on it')
    const w = await wallState(win)
    ok(w.shown.length === 6 && w.checked[0] === 'aurora', `collapsed to Aurora's row (${w.shown.join(', ')})`)
    await sleep(900) // the step deals in
    await win.screenshot({ path: join(SHOTS, 'onboarding-theme.png') })
    await win.locator('[data-wall-more]').click()
    await sleep(400)
    await win.locator('[data-theme-card="paper"]').click()
    ok(await until(async () => (await win.locator('.ob-sweep').count()) === 1, 1000, 20), 'picking Paper from Aurora plays the sweep')
    ok(await until(() => win.evaluate(() => document.documentElement.dataset.mode === 'light'), 3000, 50), 'and lands light')
    ok(await until(async () => (await win.locator('.ob-sweep').count()) === 0, 3000, 50), 'the sweep ends')
    await sleep(600)
    await win.screenshot({ path: join(SHOTS, 'onboarding-theme-paper.png') })
    await win.locator('button:has-text("Next")').click()
    await win.locator('button:has-text("Next")').click()
    await win.locator('button:has-text("Start using Prism")').click()
    ok(
      await until(() => win.evaluate(() => localStorage.getItem('prism.onboarded') === '1' && localStorage.getItem('prism.style') === 'paper'), 3000, 50),
      'Start stores the theme (paper) and the setup as done'
    )
  } finally {
    await app.close().catch(() => {})
    await sleep(900)
    rmSync(profile, { recursive: true, force: true })
  }
}

/**
 * FIND A SETTING (#292; spec 1.2, 1.3, 1.6): every row in Prism's index is
 * found by its own label and opened, landing on screen, flashed and holding
 * the keyboard (the Media half that holds it switched to); by keyboard alone
 * from the field to a control; Escape clears the field and only an EMPTY field
 * lets Escape close Settings; no status line without a query; a word that
 * matches nothing says so. The index is read as text from the app's own
 * `settingsIndex.ts` and the lists, as the gate reads `options.ts`.
 */
async function settingsSearchScenario(fixtures) {
  console.log('settings search')
  EXTRA_ENV = { PRISM_E2E_NVIDIA: '0' }
  let app
  let sizeBefore = null
  try {
    const started = await launch(join(fixtures, 'README.md'))
    app = started.app
    const win = started.win
    sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
    const labelOf = {}
    for (const file of [
      'node_modules/prism-term-core/renderer/settings/options.ts',
      'node_modules/prism-term-core/renderer/settings/dictationOptions.ts',
      'src/renderer/src/components/settings/appOptions.ts'
    ])
      for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(/\{\s*id: '([a-z-]+)'[^}]*\}/g))
        if (!m[0].includes('onlyWhere')) labelOf[m[1]] = (m[0].match(/label: '([^']+)'/) ?? [])[1]
    const order = readFileSync(join(ROOT, 'src/renderer/src/components/settings/settingsIndex.ts'), 'utf8')
    const rowOrder = order.slice(order.indexOf('ROW_ORDER'), order.indexOf('] as const'))
    const ids = [...rowOrder.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((id) => labelOf[id] && id !== 'dictation-gpu')
    ok(ids.length >= 50, `the index covers every row drawn on this PC (${ids.length})`)
    const find = win.locator('[data-settings-find]')
    const status = win.locator('[data-settings-page] [role="status"]')
    await win.click('[aria-label="Settings"]')
    await find.waitFor({ timeout: 8000 })
    ok((await status.count()) === 0, 'with nothing typed there is no status line')
    ok((await find.getAttribute('data-owns-escape')) === null, 'an empty field does not claim Escape')
    await find.fill('font')
    ok((await find.getAttribute('data-owns-escape')) !== null, 'a field holding text does')
    // ESCAPE: the field's first, then Settings'. Prism's own capture-phase
    // Escape closes Settings, and must stand down while the field holds text.
    await find.press('Escape')
    ok((await find.inputValue()) === '' && (await win.locator('[data-settings-page]').count()) === 1, 'Escape with text clears the field and leaves Settings open')
    await find.press('Escape')
    ok(await until(async () => (await win.locator('[data-settings-page]').count()) === 0, 3000, 50), 'Escape on an empty field closes Settings')
    await win.click('[aria-label="Settings"]')
    await find.waitFor({ timeout: 8000 })
    // Every row's controls are a group named by the row's label.
    await gotoPref(win, 'tab-width')
    ok((await win.locator('[data-pref="tab-width"] [role="group"]').getAttribute('aria-label')) === labelOf['tab-width'], 'a row names its controls by its label')
    // EVERY ROW, BY ITS OWN LABEL (spec 1.6). Some labels are shared (the
    // Glow, Cycle and Move of each Media half), so the row is looked for
    // among the results rather than as the first.
    const misses = []
    for (const id of ids) {
      await find.fill(labelOf[id])
      const hit = win.locator(`[data-settings-page] [role="option"][data-hit="${id}"]`)
      if (!(await until(async () => (await hit.count()) === 1, 3000, 30))) {
        misses.push(`${id}: not found`)
        continue
      }
      const first = await win.locator('[data-settings-page] [role="option"]').first().getAttribute('data-hit')
      if (labelOf[first] !== labelOf[id]) misses.push(`${id}: first result is ${first}`)
      await hit.click()
      const landed = await until(
        () =>
          win.evaluate((pref) => {
            const row = document.querySelector(`[data-pref="${pref}"]`)
            if (!row) return null
            const r = row.getBoundingClientRect()
            const onScreen = r.bottom > 0 && r.top < innerHeight
            return onScreen && row.hasAttribute('data-flash') && row.contains(document.activeElement) ? true : null
          }, id),
        4000,
        30
      )
      if (!landed) misses.push(`${id}: not on screen, flashed and focused`)
      if ((await find.inputValue()) !== '') misses.push(`${id}: the field kept its text`)
    }
    ok(misses.length === 0, `every row is found by its label and opened (${JSON.stringify(misses)})`)
    // TWO SIDEBAR POSITIONS (#304; owner, 2026-10-07: "two settings, one on
    // the project tab and one on the explorer tab"): one search finds both.
    await find.fill('sidebar position')
    ok(
      await until(async () => (await win.locator('[data-settings-page] [role="option"][data-hit="explorer-side"]').count()) === 1 && (await win.locator('[data-settings-page] [role="option"][data-hit="tree-side"]').count()) === 1, 3000, 30),
      'Sidebar position finds the Explorer row and the project row'
    )
    await find.fill('')
    // KEYBOARD ONLY: the field, Down, Enter, and the control has the focus.
    await find.focus()
    await win.keyboard.type('explorer menu')
    ok(await until(async () => ((await status.textContent().catch(() => '')) ?? '').includes('result'), 3000, 50), `a status line says how many (${await status.textContent().catch(() => '')})`)
    await win.keyboard.press('ArrowDown')
    ok(await win.evaluate(() => document.activeElement?.getAttribute('role') === 'option'), 'Down moves to the first result')
    await win.screenshot({ path: join(SHOTS, 'settings-search.png') })
    await win.keyboard.press('Enter')
    ok(
      await until(() => win.evaluate(() => !!document.activeElement?.closest('[data-pref="explorer-verb"]')), 4000, 30),
      "Enter opens it with the keyboard on the row's control"
    )
    ok((await win.locator('[data-settings-tab="explorer"]').getAttribute('aria-current')) === 'page', 'on the page that holds it')
    // A Media row opens its own half of the page.
    await find.fill('control band')
    await win.locator('[data-settings-page] [role="option"]').first().click()
    ok(
      await until(async () => (await win.locator('[data-seg="progress"][aria-pressed="true"]').count()) === 1 && (await win.locator('[data-pref="transport-bg"]').count()) === 1, 3000, 50),
      'a Progress bar row opens Media on its Progress bar half'
    )
    // While results are up the rail chooses nothing; Escape clears.
    await find.focus()
    await win.keyboard.type('colour')
    await until(async () => (await status.count()) === 1, 3000, 50)
    ok((await win.locator('[data-settings-tab][aria-current="page"]').count()) === 0, 'while results are up no page is chosen in the rail')
    await win.keyboard.press('Escape')
    ok((await find.inputValue()) === '' && (await status.count()) === 0, 'Escape clears the field and the status line goes')
    ok((await win.locator('[data-settings-page]').count()) === 1, 'and Settings stays open')
    // TEXT TYPED, THE KEYBOARD ELSEWHERE (review of #292): Escape did nothing
    // at all. It now takes the keyboard back to the field, and the next one
    // clears it there; Settings stays open throughout.
    await find.fill('font')
    await win.locator('[data-settings-tab="explorer"]').focus()
    await win.keyboard.press('Escape')
    ok(
      (await win.locator('[data-settings-page]').count()) === 1 && (await win.evaluate(() => document.activeElement?.hasAttribute('data-settings-find'))),
      'Escape with text and the focus on the rail takes the keyboard to the field'
    )
    await win.keyboard.press('Escape')
    ok((await find.inputValue()) === '' && (await win.locator('[data-settings-page]').count()) === 1, 'and the next Escape clears it, Settings still open')
    // Nothing found.
    await find.fill('zebra')
    ok(await until(async () => ((await status.textContent().catch(() => '')) ?? '') === 'No results', 3000, 50), 'a word that matches nothing says No results')
    ok(((await win.locator('[data-settings-nothing]').textContent()) ?? '').includes('Nothing matches zebra'), 'and the pane says what was not found')
    await win.screenshot({ path: join(SHOTS, 'settings-search-empty.png') })
    await find.fill('')
    // THE RAIL BY KEYBOARD (spec 1.3): Tab from the field lands on the rail,
    // Up and Down walk it and Home and End jump, and Settings keeps them: the
    // folder behind does not page.
    await find.focus()
    await win.keyboard.press('Tab')
    const at = () => win.evaluate(() => document.activeElement?.getAttribute('data-settings-tab') ?? document.activeElement?.tagName ?? null)
    ok((await at()) === 'appearance', `Tab from the field lands on the rail's first page (${await at()})`)
    await win.keyboard.press('ArrowDown')
    ok((await at()) === 'explorer', `Down walks the rail (${await at()})`)
    await win.keyboard.press('End')
    ok((await at()) === 'about', `End jumps to the last (${await at()})`)
    await win.keyboard.press('Home')
    ok((await at()) === 'appearance', `Home to the first (${await at()})`)
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('Enter')
    ok((await win.locator('[data-settings-tab="terminal"]').getAttribute('aria-current')) === 'page', 'Enter opens it, and the rail says it is the page')
  } finally {
    EXTRA_ENV = {}
    if (sizeBefore) await app?.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), sizeBefore).catch(() => {})
    await app?.close().catch(() => {})
  }
}

/** The coats under a box (#294): at points along its middle row (and one
 *  lower down for a tall box) where nothing carrying text is on top, every box
 *  from the top of the stack to the root, background alphas composited. The
 *  worst point is returned, with the coats that made it. Shared by
 *  `seeThrough` and `explorerSide` (#304). */
const coatsUnder = (win, sel, at) =>
  win.evaluate(([q, y0]) => {
    const el = document.querySelector(q)
    if (!el) return null
    const alphaOf = (c) => {
      if (!c || c === 'transparent') return 0
      const v = (c.match(/[\d.]+/g) ?? []).map(Number)
      return v.length > 3 ? v[3] : 1
    }
    const r = el.getBoundingClientRect()
    const rows = y0 !== null ? [r.top + y0] : r.height > 120 ? [r.top + 16, r.top + r.height * 0.5, r.bottom - 24] : [r.top + r.height / 2]
    let worst = null
    for (const y of rows)
      for (let x = r.left + 6; x < r.right - 6; x += 9) {
        const stack = document.elementsFromPoint(x, y)
        if (!stack.length || !(stack[0] === el || el.contains(stack[0]))) continue
        const top = stack[0]
        if (top !== el && [...top.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
        // The file itself (a picture, a PDF page, a line of code) and a
        // control (the address field, the transport) are not grounds. A
        // film's box is measured: its letterbox is the pane's ground. A
        // CARD (the archive's member list) is a flat panel, like a menu.
        if (top.closest('img, canvas, svg, button, input, .browse-field, [data-page], [data-scrub], [data-transport-row], .p-sheet, .cm-line, .cm-gutterElement, [class~="bg-[var(--p-side-flat)]"]')) continue
        let clear = 1
        const coats = []
        for (const b of stack) {
          const a = alphaOf(getComputedStyle(b).backgroundColor)
          if (a > 0.01) {
            clear *= 1 - a
            const cls = typeof b.className === 'string' ? b.className.trim().split(/\s+/).filter((c) => !c.includes('[')).slice(0, 3).join('.') : ''
            coats.push(`${b.tagName.toLowerCase()}${cls ? '.' + cls : ''}@${a.toFixed(2)}`)
          }
        }
        const total = 1 - clear
        if (!worst || total > worst.total) worst = { total, x: Math.round(x), y: Math.round(y), coats }
      }
    return worst
  }, [sel, at ?? null])

/** The alpha of the window's see-through ground, --p-bg. */
const groundAlphaOf = (win) =>
  win.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = 'var(--p-bg)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    const v = (c.match(/[\d.]+/g) ?? []).map(Number)
    return v.length > 3 ? v[3] : 1
  })

/**
 * A SEE-THROUGH STYLE IS SEE-THROUGH EVERYWHERE (#294; owner, 2026-10-06, of
 * Prism on a glass style: "the top bar and settings sidebar don't follow the
 * acrylic of acrylic themes, they should, it should be everywhere", and of the
 * Explorer: "the preview also isn't acrylic"). Every surface that IS the
 * window's ground wears the style's see-through ground ONCE: the coats of
 * every box under a point, composited, come to the ground's own alpha. Two
 * translucent coats of Onyx's black read as an opaque slab (0.9 twice is
 * 0.99), which is what the owner saw. Measured on the title bar, the tab
 * strip, the one-row bar of a hidden title bar, the Settings rail and page,
 * and the Explorer's list and preview pane with text, code, markdown, a
 * picture, a PDF and a film in it, and a file opened under the address bar. Menus, dialogs and pills are flat on purpose: not grounds.
 */
async function seeThroughScenario(fixtures) {
  console.log('see-through')
  const dir = join(fixtures, 'seethrough')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'notes.txt'), Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'))
  writeFileSync(join(dir, 'main.ts'), Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i}`).join('\n'))
  writeFileSync(join(dir, 'notes.md'), '# Notes\n\nA short page.\n')
  copyFileSync(join(fixtures, 'one.png'), join(dir, 'one.png'))
  copyFileSync(join(fixtures, 'sample.pdf'), join(dir, 'sample.pdf'))
  copyFileSync(join(fixtures, 'ep1.mp4'), join(dir, 'ep1.mp4'))
  // A document (DocView's canvas), an archive, a sound and a kind Prism does
  // not read: every viewer the preview can hold.
  writeFileSync(join(dir, 'letter.rtf'), '{\\rtf1\\ansi Dear reader,\\par a short letter.}')
  copyFileSync(join(fixtures, 'zips', 'bundle.zip'), join(dir, 'bundle.zip'))
  writeFileSync(join(dir, 'mystery.qqq'), Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]))
  {
    // One second of silence, 8 kHz mono 16-bit.
    const n = 8000 * 2
    const wav = Buffer.alloc(44 + n)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + n, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(8000, 24)
    wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(n, 40)
    writeFileSync(join(dir, 'tone.wav'), wav)
  }
  const { app, win } = await launch(join(dir, 'notes.md'))
  let styleBefore = null
  /** The coats under a box (`coatsUnder`, above). */
  const coatsOf = (sel, at) => coatsUnder(win, sel, at)
  const groundAlpha = () => groundAlphaOf(win)
  const oneCoat = async (label, sel, want, at) => {
    let m = null
    await until(async () => {
      m = await coatsOf(sel, at)
      return !!m && Math.abs(m.total - want) <= 0.02
    }, 3000, 100)
    ok(
      !!m && Math.abs(m.total - want) <= 0.02,
      `${label}: one coat of the see-through ground (${m ? `${m.total.toFixed(3)} of ${want.toFixed(3)} at ${m.x},${m.y}: ${m.coats.join(' + ')}` : 'not found'})`
    )
  }
  try {
    await win.waitForSelector('[data-testid="browse-list"], [role="treeitem"]', { timeout: 15000 })
    styleBefore = await switchStyle(win, 'glacier')
    ok(await until(async () => (await groundAlpha()) < 1, 6000, 50), 'Glacier is a see-through style')
    const want = await groundAlpha()
    await win.mouse.move(2, 400)
    await sleep(700)

    // The chrome, the title bar shown.
    await oneCoat('the title bar', '[data-title-bar]', want)
    await oneCoat('the tab strip', '[role="tablist"]', want)

    // A file of its own (a project tab): its viewer and what is round it.
    for (const [label, sel] of [
      ['the viewer', '[data-workspace-viewer]'],
      ['the viewer\x27s address bar', '.browse-viewer-toolbar'],
      ['the viewer\x27s places', '.browse-viewer-places'],
      ['the project sidebar', '[data-project-sidebar]']
    ])
      if (await win.locator(sel).count()) await oneCoat(label, sel, want)
      else console.log(`  (no ${label} on this tab)`)

    // The Explorer, and its preview for each kind of file: a file handed
    // over opens there.
    await handoff(join(dir, 'notes.txt'))
    ok(await until(() => win.evaluate(() => !!document.querySelector('[data-browse-preview]')?.getClientRects().length), 10000), 'the Explorer shows a preview pane')
    await oneCoat('the Explorer list', '[data-testid="browse-list"]', want)
    await oneCoat('the Explorer address bar', '.folder-browser > .browse-toolbar', want)
    await oneCoat('the Explorer places', '.folder-browser .browse-places', want)
    await oneCoat('the Explorer status line', '.folder-browser .browse-status', want)
    for (const name of ['notes.txt', 'main.ts', 'notes.md', 'one.png', 'sample.pdf', 'ep1.mp4', 'letter.rtf', 'bundle.zip', 'tone.wav', 'mystery.qqq']) {
      await win.locator(`[data-testid="browse-list"] [data-browse-path$="${name}"]`).click()
      await until(
        () => win.evaluate((n) => document.querySelector('[data-testid="browse-list"] [aria-selected="true"]')?.getAttribute('data-browse-path')?.endsWith(n) ?? false, name),
        8000
      )
      await win.mouse.move(2, 400)
      await sleep(900)
      await oneCoat(`the preview pane with ${name}`, '[data-browse-preview]', want)
      await win.screenshot({ path: join(SHOTS, `see-through-preview-${name.replace('.', '-')}.png`) })
    }

    // Opened: a double click shows the file in the Explorer's own view.
    await win.locator(`[data-testid="browse-list"] [data-browse-path$="main.ts"]`).dblclick()
    ok(await until(() => win.locator('.browse-viewer-toolbar').count().then((n) => n > 0), 8000), 'a double click opens the file under the address bar')
    await win.mouse.move(2, 400)
    await sleep(900)
    await oneCoat('the opened file', '[data-workspace-viewer]', want)
    await oneCoat('its address bar', '.browse-viewer-toolbar', want)
    if (await win.locator('.browse-viewer-places').count()) await oneCoat('its places', '.browse-viewer-places', want)
    await win.screenshot({ path: join(SHOTS, 'see-through-opened.png') })

    // Settings: the rail and the page.
    await settingsPage(win, 'appearance')
    await win.mouse.move(2, 400)
    await sleep(600)
    await oneCoat('the Settings rail', '[data-settings-page] > nav', want)
    // Along its top margin, over the page's own ground: what the cards
    // below hold is content.
    await oneCoat('the Settings page', '[data-settings-page] > .p-scroll', want, 10)
    await win.screenshot({ path: join(SHOTS, 'see-through-settings.png') })
    await win.click('[aria-label="Settings"]')
    await sleep(400)

    // One row: the title bar hidden.
    await setTitleBar(win, 'hidden')
    await win.mouse.move(2, 400)
    await sleep(700)
    await oneCoat('the one-row bar of a hidden title bar', '[data-title-bar="tabs"]', want)
    await win.screenshot({ path: join(SHOTS, 'see-through-one-row.png') })
    await setTitleBar(win, 'shown')
  } finally {
    if (styleBefore)
      await win
        .evaluate((b) => {
          const put = (k, v) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v))
          put('prism.style', b[0])
          put('prism.mode', b[1])
        }, styleBefore)
        .catch(() => {})
    await app.close().catch(() => {})
  }
}

/* ---------- ZIPS ARE FOLDERS (#300) ---------- */

/** A tiny real PNG, for a member that is a picture. */
const ZIP_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M9QDwADgQF/e5IkGQAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * The zip the #300 scenarios walk: a "download as zip" (one top folder), a
 * folder three deep with a needle in it, a picture, text, a markdown file and
 * a zip inside the zip. Built fresh per scenario, under its own folder.
 */
async function zipWorld(fixtures, name) {
  const AdmZip = (await import('adm-zip')).default
  const dir = join(fixtures, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const inner = new AdmZip()
  inner.addFile('docs/inside-inner.txt', Buffer.from('from the inner zip\n'))
  const zip = new AdmZip()
  zip.addFile('Wind/README.md', Buffer.from('# Wind\n\nThe readme inside the zip.\n'))
  zip.addFile('Wind/package.json', Buffer.from('{ "name": "wind" }\n'))
  zip.addFile('Wind/src/main/caret.ts', Buffer.from('// The caret follows typing\nexport const SETTLE_MS = 150\n'))
  zip.addFile('Wind/src/main/index.ts', Buffer.from('export {}\n' + 'x'.repeat(3000)))
  zip.addFile('Wind/assets/pic.png', ZIP_PNG)
  zip.addFile('Wind/docs/deep/deeper/needle-in-zip.txt', Buffer.from('found me\n'))
  zip.addFile('Wind/nested.zip', inner.toBuffer())
  const zipPath = join(dir, 'Wind-0.2.2.zip')
  zip.writeZip(zipPath)
  writeFileSync(join(dir, 'notes.txt'), 'beside the zip\n')
  return { dir, zipPath }
}

/** The pinned Explorer, walked to `dir`. */
async function explorerAt(win, dir) {
  await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
  await win.waitForSelector('[data-testid="browse-list"]', { timeout: 10000 })
  await win.locator('[data-testid="browse-edit-path"]').click()
  await win.locator('.browse-path-form input').fill(dir)
  await win.keyboard.press('Enter')
  await until(async () => (await win.locator(`[data-testid="browse-list"] [data-browse-path$="notes.txt"]`).count()) === 1, 10000)
}

/** A row by the end of its path. A backslash in a CSS string is an escape,
 *  so it is doubled. */
const zipRow = (win, suffix) =>
  win.locator(`[data-testid="browse-list"] [data-browse-path$="${suffix.replace(/\\/g, '\\\\')}"]`)
const zipRows = (win) =>
  win.evaluate(() => [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path]')].map((r) => r.getAttribute('data-browse-path')))

async function zipFolderScenario(fixtures) {
  console.log('zips are folders (#300)')
  const { dir, zipPath } = await zipWorld(fixtures, 'zipfolder')
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'notes.txt'))
  EXTRA_ENV = {}
  const consoleErrors = []
  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  try {
    await explorerAt(win, dir)
    ok((await win.locator('.browse-list-area[data-in-archive]').count()) === 0, 'outside a zip there is no Packed column')
    // Double-click goes in, like a folder.
    await zipRow(win, 'Wind-0.2.2.zip').dblclick()
    ok(await until(async () => (await win.locator('[data-archive-strip]').count()) === 1, 10000), 'double-click goes in and the strip shows')
    const strip = (await win.locator('[data-archive-strip]').textContent()) ?? ''
    ok(/Wind-0\.2\.2\.zip/.test(strip) && /\d+ files/.test(strip) && /compressed/.test(strip), `the strip names the zip, its files and size (${strip})`)
    ok((await win.locator('.browse-crumb button[data-crumb-archive]').count()) === 1, 'the zip crumb wears the archive icon')
    ok((await win.locator('.browse-crumb button[data-crumb-archive] svg').count()) === 1, 'and draws it')
    ok((await win.locator('.browse-list-area[data-in-archive] .browse-columns .browse-column-packed').count()) === 1, 'inside, a Packed column')
    ok((await zipRows(win)).some((p) => /Wind-0\.2\.2\.zip\\Wind$/.test(p)), 'the top folder is a row')
    ok(/In Wind-0\.2\.2\.zip/.test((await win.locator('.browse-status').textContent()) ?? ''), 'the status bar says where you are')
    await win.screenshot({ path: join(SHOTS, 'zip-root.png') })
    // Into the folder: every row the plain ground (no stripes).
    await zipRow(win, 'Wind-0.2.2.zip\\Wind').dblclick()
    await until(async () => (await zipRows(win)).some((p) => p.endsWith('package.json')), 10000)
    // Away from every row, so no hover fill is measured as a stripe.
    await win.mouse.move(5, 5)
    await sleep(250)
    const grounds = await win.evaluate(() =>
      [...document.querySelectorAll('[data-testid="browse-list"] .browse-row[data-browse-path]')].map((r) => getComputedStyle(r).backgroundColor)
    )
    ok(grounds.length >= 5 && new Set(grounds).size === 1, `every row is the same ground, no zebra (${[...new Set(grounds)]})`)
    // Folders show their totals; files their packed size.
    const sizeOf = async (suffix, col) => ((await zipRow(win, suffix).locator(`.browse-column-${col}`).textContent()) ?? '').trim()
    ok(/B|KB/.test(await sizeOf('\\src', 'size')), `a folder says how much is in it (${await sizeOf('\\src', 'size')})`)
    ok(/B/.test(await sizeOf('package.json', 'packed')), `a file has a packed size (${await sizeOf('package.json', 'packed')})`)
    // Sort by Packed, both ways.
    await win.locator('.browse-columns .browse-column-packed').click()
    const asc = (await zipRows(win)).filter((p) => !/\\(src|assets|docs)$/.test(p))
    await win.locator('.browse-columns .browse-column-packed').click()
    const desc = (await zipRows(win)).filter((p) => !/\\(src|assets|docs)$/.test(p))
    ok(asc.length > 1 && asc.join() === [...desc].reverse().join(), 'sorting by Packed turns round on a second click')
    await win.locator('.browse-columns .browse-column-name').click()
    // Two folders down, Back, Forward, Alt+Up.
    await zipRow(win, 'Wind\\src').dblclick()
    await until(async () => (await zipRows(win)).some((p) => p.endsWith('\\main')), 10000)
    await zipRow(win, 'src\\main').dblclick()
    await until(async () => (await zipRows(win)).some((p) => p.endsWith('caret.ts')), 10000)
    const where = async () => (await win.locator('.browse-path').getAttribute('title')) ?? ''
    ok((await where()).endsWith('Wind-0.2.2.zip\\Wind\\src\\main'), `one path through the zip (${await where()})`)
    await win.locator('[data-testid="browse-list"]').focus()
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await where()).endsWith('Wind\\src')), 'Back walks the one history')
    await win.keyboard.press('Alt+ArrowRight')
    ok(await until(async () => (await where()).endsWith('src\\main')), 'Forward too')
    // A text member previews after the unpack, read-only, with its text.
    await zipRow(win, 'caret.ts').click()
    ok(await until(async () => /caret follows typing/.test((await win.textContent('body')) ?? ''), 15000), 'a text member previews with its text')
    await win.screenshot({ path: join(SHOTS, 'zip-member-preview.png') })
    // Up to the zip root, then out: the zip is marked.
    await win.keyboard.press('Alt+ArrowUp')
    await win.keyboard.press('Alt+ArrowUp')
    await win.keyboard.press('Alt+ArrowUp')
    ok(await until(async () => (await where()) === zipPath), `Alt+Up climbs to the zip root (${await where()})`)
    await win.keyboard.press('Alt+ArrowUp')
    ok(await until(async () => (await where()) === dir), 'and once more out of it')
    ok(await until(async () => (await zipRow(win, 'Wind-0.2.2.zip').getAttribute('data-selected')) === 'true'), 'with the zip marked')
    // The zip row outside previews as the archive card.
    await zipRow(win, 'Wind-0.2.2.zip').click()
    ok(await until(async () => (await win.locator('[data-archive-card]').count()) === 1, 10000), 'the zip row previews as the archive card')
    ok(await until(async () => /Inside, in Wind/.test((await win.locator('[data-archive-card]').textContent()) ?? '')), 'which shows the one top folder')
    await win.screenshot({ path: join(SHOTS, 'zip-card.png') })
    // An image member draws.
    await zipRow(win, 'Wind-0.2.2.zip').dblclick()
    await until(async () => (await win.locator('[data-archive-strip]').count()) === 1, 10000)
    await zipRow(win, 'Wind-0.2.2.zip\\Wind').dblclick()
    await until(async () => (await zipRows(win)).some((p) => p.endsWith('\\assets')), 10000)
    await zipRow(win, 'Wind\\assets').dblclick()
    await until(async () => (await zipRows(win)).some((p) => p.endsWith('pic.png')), 10000)
    await zipRow(win, 'pic.png').click()
    const drawn = await until(async () =>
      win.evaluate(() => !document.querySelector('[data-member-gate]') && [...document.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth > 0))
    , 15000)
    const membersRoot = join(tmpdir(), 'prism-members')
    const unpacked = existsSync(membersRoot) && readdirSync(membersRoot, { recursive: true }).some((f) => String(f).endsWith('pic.png'))
    ok(unpacked, 'the picture was unpacked into the run\'s member folder')
    ok(
      drawn,
      `an image member draws, from the run's member folder (${drawn ? '' : await win.evaluate(() => [...document.querySelectorAll('img')].map((i) => `${decodeURIComponent(i.src).slice(-80)} ${i.naturalWidth}`).join(' | ') + ' gate=' + (document.querySelector('[data-member-gate]')?.getAttribute('data-member-gate') ?? 'none'))})`
    )
    await win.screenshot({ path: join(SHOTS, 'zip-image.png') })
    // Search finds a member three folders down; Enter opens it.
    await win.locator('[data-testid="browse-list"]').focus()
    await win.keyboard.press('Backspace')
    await until(async () => (await where()).endsWith('\\Wind'))
    await win.keyboard.press('Control+f')
    await win.waitForSelector('[data-search-popup] input', { timeout: 5000 })
    await win.keyboard.type('needle')
    ok(await until(async () => /needle-in-zip\.txt/.test((await win.locator('[data-search-popup]').textContent()) ?? ''), 10000), 'the search finds a member three folders down')
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('Enter')
    ok(await until(async () => /found me/.test((await win.textContent('body')) ?? ''), 15000), 'and Enter opens it')
    // A zip inside the zip is a folder too.
    await win.keyboard.press('Escape')
    await win.locator('[data-testid="browse-edit-path"]').click().catch(() => {})
    await win.locator('.browse-path-form input').fill(`${zipPath}\\Wind\\nested.zip\\docs`)
    await win.keyboard.press('Enter')
    ok(await until(async () => (await zipRows(win)).some((p) => p.endsWith('inside-inner.txt')), 10000), 'a zip inside a zip opens as a folder, typed into the address')
    ok((await win.locator('.browse-crumb button[data-crumb-archive]').count()) === 2, 'both archives in the path wear the icon')
    await win.screenshot({ path: join(SHOTS, 'zip-nested.png') })
    ok(!consoleErrors.some((e) => !/Autofill|DevTools/.test(e)), `nothing in the console (${consoleErrors.slice(0, 3)})`)
  } finally {
    await app.close()
  }
}

/**
 * GOING INTO A FOLDER CLEARS THE PREVIEW (#300 review; owner, 2026-10-06, of a
 * zip opened from Downloads whose card stayed in the pane beside its contents:
 * "what should we do about the double view"). From a SELECTED item, so the
 * pane is open: into the zip (double-click) and into a plain folder (Enter),
 * the pane stays at its width and says "Select a file to preview"; a file
 * picked there previews as before; Back keeps it empty. Nothing is previewed
 * on its own.
 */
async function previewClearsScenario(fixtures) {
  console.log('going into a folder clears the preview (#300 review)')
  const { dir } = await zipWorld(fixtures, 'previewclears')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'sub', 'a.txt'), 'inside the sub folder\n')
  writeFileSync(join(dir, 'sub', 'b.txt'), 'the second file\n')
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'notes.txt'))
  EXTRA_ENV = {}
  const pane = () =>
    win.evaluate(() => {
      const box = document.querySelector('[data-browse-preview]')
      const rect = box?.getClientRects().length ? box.getBoundingClientRect() : null
      return {
        shown: !!rect,
        width: rect ? Math.round(rect.width) : 0,
        empty: !!box?.querySelector('[data-preview-empty]'),
        card: !!box?.querySelector('[data-archive-card]'),
        // What is ON SCREEN: other tabs keep their viewers mounted in the
        // same box, hidden (aria-hidden), and their text is not the pane's.
        text: (() => {
          if (!box) return ''
          const copy = box.cloneNode(true)
          copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
          return copy.textContent ?? ''
        })()
      }
    })
  const where = async () => (await win.locator('.browse-path').getAttribute('title')) ?? ''
  try {
    await explorerAt(win, dir)
    // The zip selected: its card in the pane.
    await zipRow(win, 'Wind-0.2.2.zip').click()
    ok(await until(async () => (await pane()).card, 10000), 'the selected zip previews as its card')
    await sleep(400)
    const open = await pane()
    // Into it: the card goes, the pane stays, at its width.
    await zipRow(win, 'Wind-0.2.2.zip').dblclick()
    ok(await until(async () => (await win.locator('[data-archive-strip]').count()) === 1, 10000), 'double-click goes into the zip')
    ok(await until(async () => (await pane()).empty, 5000), `the pane clears to its empty state (${JSON.stringify(await pane())})`)
    let now = await pane()
    ok(!now.card, 'the zip card is not shown beside its own contents')
    ok(now.shown && Math.abs(now.width - open.width) <= 1, `the pane stays open at its width (${open.width} -> ${now.width})`)
    ok(/Select a file to preview/.test(now.text), `and says what to do (${now.text})`)
    ok(
      (await win.locator('[data-testid="browse-list"] [data-browse-path][aria-selected="true"]').count()) === 0,
      'nothing inside is picked for you'
    )
    await win.screenshot({ path: join(SHOTS, 'preview-empty-zip.png') })
    // Deeper, still empty; then a file there previews.
    await zipRow(win, 'Wind-0.2.2.zip\\Wind').dblclick()
    await until(async () => (await zipRows(win)).some((p) => p.endsWith('package.json')), 10000)
    await sleep(300)
    ok((await pane()).empty, 'one folder further in, still empty')
    await zipRow(win, 'package.json').click()
    ok(await until(async () => /"wind"/.test((await pane()).text), 15000), 'a file picked inside previews as before')
    ok(!(await pane()).empty, 'and the empty state is gone')
    // Back: the place before, the pane empty again.
    await win.locator('[data-testid="browse-list"]').focus()
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await where()).endsWith('Wind-0.2.2.zip')), 'Back walks out a folder')
    ok(await until(async () => (await pane()).empty, 5000), 'and Back clears the preview too')
    // A plain folder the same way: a file selected, then Enter on the folder.
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await where()) === dir), 'Back out of the zip')
    await zipRow(win, 'notes.txt').click()
    ok(await until(async () => /beside the zip/.test((await pane()).text), 10000), 'a file beside it previews')
    const before = await pane()
    await zipRow(win, '\\sub').click()
    await sleep(300)
    ok(/beside the zip/.test((await pane()).text), 'selecting the folder keeps the file in the pane')
    await win.keyboard.press('Enter')
    ok(await until(async () => (await where()).endsWith('\\sub')), 'Enter goes into the folder')
    ok(await until(async () => (await pane()).empty, 5000), 'and the pane clears to its empty state')
    now = await pane()
    ok(now.shown && Math.abs(now.width - before.width) <= 1, `at the same width (${before.width} -> ${now.width})`)
    ok(!/beside the zip/.test(now.text), 'the file from the folder before is gone')
    await win.screenshot({ path: join(SHOTS, 'preview-empty-folder.png') })
    await zipRow(win, 'a.txt').click()
    ok(await until(async () => /inside the sub folder/.test((await pane()).text), 10000), 'a file picked there previews')
    // Back out of the folder: the pane is empty again.
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await pane()).empty, 5000), 'Back out of it, empty once more')
  } finally {
    await app.close()
  }
}

/**
 * SIDEBAR POSITION MOVES THE EXPLORER'S SIDEBAR (#304; owner, 2026-10-07: "fix
 * the setting in Explorer for the sidebar where you can put it on the right
 * side or the left side? I think that's just an empty setting for now ... when
 * the sidebar goes on the right, the preview menu and button to open it would
 * have to go on the left"), AND IT IS TWO SETTINGS (owner, the same day, after
 * testing one shared row: "No, it should be two settings, one on the project
 * tab and one on the explorer tab"). Explorer > Layout's row (`explorer-side`)
 * moves the places and leaves a project's tree where it is; Project settings'
 * row (`tree-side`) moves the tree and leaves the Explorer where it is. On the
 * right: the places against the window's right edge, the preview pane against
 * its left, the preview toggle before the history buttons; the toggle, both
 * grips, the hide, the peek and the pin all work turned round, one coat of a
 * see-through ground everywhere, and Left again gives back every box exactly.
 * Both choices outlive a restart.
 */
async function explorerSideScenario(fixtures) {
  console.log('explorer sidebar side (#304)')
  const dir = join(fixtures, 'explorerside')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'notes.txt'), Array.from({ length: 30 }, (_, i) => `line ${i + 1} of the notes`).join('\n'))
  writeFileSync(join(dir, 'other.txt'), 'other\n')
  let { app, win } = await launch(join(dir, 'notes.txt'))
  let widthsBefore = null
  let styleBefore
  const browser = '[data-testid="folder-browser"]'
  const boxes = () =>
    win.evaluate((b) => {
      const at = (q) => {
        const el = document.querySelector(q)
        if (!el || !el.getClientRects().length) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), r: Math.round(r.right), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      }
      return {
        side: document.querySelector(b)?.getAttribute('data-side') ?? 'left',
        work: at('.browse-workspace'),
        places: at(`${b} .browse-places`),
        list: at(`${b} .browse-list-area`),
        pane: at('[data-browse-preview]'),
        toggle: at(`${b} [aria-label="Preview pane"]`),
        back: at(`${b} [aria-label="Back"]`),
        field: at(`${b} .browse-path`),
        search: at('[data-testid="browse-search-button"]'),
        status: at(`${b} .browse-status`),
        placesGrip: at('.explorer-resize-places'),
        previewGrip: at('.explorer-resize-preview')
      }
    }, browser)
  const say = (m) => JSON.stringify(m)
  const settle = () => sleep(500)
  const toExplorer = async () => {
    await win.locator('[role="tablist"] [data-pinned] [role="tab"]').click()
    await win.waitForSelector(`${browser} .browse-row`, { timeout: 10000 })
  }
  const pick = async (name) => {
    await zipRow(win, name).click()
    ok(
      await until(() => win.evaluate(() => !!document.querySelector('[data-browse-preview]')?.textContent?.includes('line 1 of the notes')), 10000),
      `${name} previews`
    )
    await win.mouse.move(400, 300)
    await settle()
  }
  const toggle = () => win.locator(`${browser} [aria-label="Preview pane"]`)
  const placesShown = async () => (await win.locator(`${browser} .browse-places`).count()) === 1
  const drag = async (sel, dx) => {
    const g = await win.locator(sel).boundingBox()
    const x = g.x + g.width / 2
    const y = g.y + g.height / 2
    await win.mouse.move(x, y)
    await win.mouse.down()
    await win.mouse.move(x + dx / 2, y, { steps: 3 })
    await win.mouse.move(x + dx, y, { steps: 3 })
    await win.mouse.up()
    await settle()
  }
  const project = () =>
    win.evaluate(() => {
      const at = (el) => {
        if (!el || !el.getClientRects().length) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }
      }
      return {
        work: at(document.querySelector('.browse-workspace')),
        tree: at(document.querySelector('[data-project-sidebar]')),
        viewer: at(document.querySelector('[data-workspace-viewer]'))
      }
    })
  try {
    widthsBefore = await win.evaluate(() => localStorage.getItem('prism.explorer.widths'))
    // 0. TWO ROWS, one per page: the Explorer's first in its Layout, the
    // project tree's first in Project settings, each only there.
    await gotoPref(win, 'explorer-side')
    const firstInLayout = await win.evaluate(() => document.querySelector('[data-settings-section="layout"] [data-pref]')?.getAttribute('data-pref'))
    ok(firstInLayout === 'explorer-side', `the Explorer's Sidebar position is the first row of its Layout (${firstInLayout})`)
    ok((await win.locator('[data-pref="tree-side"]').count()) === 0, 'and the Explorer page has no project tree row')
    const explorerSub = (await win.locator('[data-pref="explorer-side"]').innerText()).replace(/\s+/g, ' ')
    ok(/Sidebar position/.test(explorerSub) && /places panel/.test(explorerSub), `it names the places panel (${explorerSub})`)
    await settingsPage(win, 'project')
    await win.locator('[data-pref="tree-side"]').waitFor({ timeout: 10000 })
    const firstInProject = await win.evaluate(() => document.querySelector('[data-settings-section="project"] [data-pref]')?.getAttribute('data-pref'))
    ok(firstInProject === 'tree-side', `the project tree's Sidebar position is back on Project settings, first (${firstInProject})`)
    ok((await win.locator('[data-pref="explorer-side"]').count()) === 0, 'and Project settings has no Explorer row')
    const treeSub = (await win.locator('[data-pref="tree-side"]').innerText()).replace(/\s+/g, ' ')
    ok(/Sidebar position/.test(treeSub) && /file tree/.test(treeSub), `it names the file tree (${treeSub})`)
    await win.click('[aria-label="Settings"]')
    await sleep(400)
    await pickStyleSegment(win, 'explorer-side', 'Left')
    await pickStyleSegment(win, 'tree-side', 'Left')

    // 1. LEFT, as it always was: the project tab and the Explorer.
    await win.locator('[role="tablist"] [role="tab"]').last().click()
    await win.waitForSelector('[data-project-sidebar]', { timeout: 10000 })
    await settle()
    const projLeft = await project()
    ok(!!projLeft.tree && projLeft.tree.x === projLeft.work.x, `Left: the project tree is at the left edge (${say(projLeft)})`)
    await explorerAt(win, dir)
    if (!(await placesShown())) await win.click('[data-panel-toggle]')
    ok(await until(placesShown, 4000), 'the places are shown')
    if ((await toggle().getAttribute('aria-pressed')) !== 'true') await toggle().click()
    await pick('notes.txt')
    // The panels at their own widths, so a later scenario starts where it did.
    await win.locator('.explorer-resize-places').dblclick()
    await win.locator('.explorer-resize-preview').dblclick()
    await win.mouse.move(400, 300)
    await settle()
    const left = await boxes()
    console.log(`  left: ${say(left)}`)
    ok(left.side === 'left' && left.places?.x === left.work.x, 'Left: the places are at the left edge')
    ok(left.pane?.r === left.work.r && left.pane.x >= left.list.r - 1, 'Left: the preview is at the right edge, right of the list')
    ok(left.toggle.x >= left.field.r && left.toggle.r <= left.search.x, 'Left: the preview toggle is after the address, before search')
    await win.screenshot({ path: join(SHOTS, 'explorer-side-left.png') })

    // 2. THE EXPLORER'S RIGHT.
    await pickStyleSegment(win, 'explorer-side', 'Right')
    ok((await win.evaluate(() => [localStorage.getItem('prism.explorer.side'), localStorage.getItem('prism.tree.side')])).join('/') === 'right/left', 'the Explorer row stores its own key and leaves the tree\'s')
    await toExplorer()
    await pick('notes.txt')
    const right = await boxes()
    console.log(`  right: ${say(right)}`)
    ok(right.side === 'right', 'Right: the browser says so')
    ok(right.places?.r === right.work.r, `Right: the places are at the window's right edge (${say(right.places)} in ${say(right.work)})`)
    ok(right.pane?.x === right.work.x && right.pane.r <= right.list.x + 1, `Right: the preview is at the left edge, left of the list (${say(right.pane)}, list ${say(right.list)})`)
    ok(right.list.r <= right.places.x + 1, 'Right: the list sits between them')
    ok(right.toggle.r <= right.back.x && right.toggle.r <= right.field.x, `Right: the preview toggle leads the address row, before Back (${say(right.toggle)} back ${say(right.back)})`)
    ok(right.search.x >= right.field.r, 'Right: search stays at the far end')
    ok(right.places.w === left.places.w && right.pane.w === left.pane.w && right.list.w === left.list.w, `Right: every panel keeps its width (${left.places.w}/${left.list.w}/${left.pane.w} -> ${right.places.w}/${right.list.w}/${right.pane.w})`)
    ok(right.placesGrip?.r === right.places.x && left.placesGrip?.x === left.places.r, `the places grip is its left twin turned round (${say(left.placesGrip)} / ${say(right.placesGrip)})`)
    ok(right.previewGrip?.r === right.pane.r && left.previewGrip?.x === left.pane.x, `the preview grip too (${say(left.previewGrip)} / ${say(right.previewGrip)})`)
    ok(right.status.x === right.work.x && right.status.r === right.places.x, `the status line runs under the preview and the list (${say(right.status)})`)
    for (const [scheme, style] of [['dark', 'new-void'], ['light', 'paper']]) {
      const was = await switchStyle(win, style)
      if (styleBefore === undefined) styleBefore = was
      await win.mouse.move(400, 300)
      await sleep(700)
      await win.screenshot({ path: join(SHOTS, `explorer-side-right-${scheme}.png`) })
    }

    // 3. One coat of a see-through ground on every panel, turned round too.
    await switchStyle(win, 'glacier')
    await win.mouse.move(400, 300)
    await sleep(800)
    const want = await groundAlphaOf(win)
    ok(want < 1, 'Glacier is a see-through style')
    for (const [label, sel] of [
      ['the list', '[data-testid="browse-list"]'],
      ['the places', `${browser} .browse-places`],
      ['the preview pane', '[data-browse-preview]'],
      ['the status line', `${browser} .browse-status`],
      ['the address bar', `${browser} > .browse-toolbar`]
    ]) {
      let m = null
      await until(async () => {
        m = await coatsUnder(win, sel)
        return !!m && Math.abs(m.total - want) <= 0.02
      }, 3000, 100)
      ok(!!m && Math.abs(m.total - want) <= 0.02, `Right, ${label}: one coat of the see-through ground (${m ? `${m.total.toFixed(3)} of ${want.toFixed(3)}: ${m.coats.join(' + ')}` : 'not found'})`)
    }
    await win.screenshot({ path: join(SHOTS, 'explorer-side-right-glass.png') })
    await switchStyle(win, 'new-void')
    await sleep(400)

    // 4. THE TOGGLE: shut, the list reaches the left edge; open, the pane is back.
    await toggle().click()
    ok(await until(async () => !(await boxes()).pane, 3000, 50), 'Right: the toggle shuts the preview')
    await settle()
    let now = await boxes()
    ok(now.list.x === now.work.x && now.places.r === now.work.r, `and the list reaches the left edge (${say(now.list)})`)
    await toggle().click()
    ok(await until(async () => !!(await boxes()).pane, 3000, 50), 'the toggle opens it again')
    await sleep(700)
    now = await boxes()
    ok(now.pane.x === now.work.x && now.pane.w === right.pane.w && now.list.x === right.list.x, `at the left edge, at its width (${say(now.pane)})`)

    // 5. THE GRIPS: toward the middle widens, the far side stays put.
    await drag('.explorer-resize-places', -40)
    now = await boxes()
    ok(now.places.w === right.places.w + 40 && now.places.r === now.work.r, `dragging the places' grip left widens them, against the right edge (${right.places.w} -> ${now.places.w})`)
    await win.locator('.explorer-resize-places').focus()
    await win.keyboard.press('ArrowLeft')
    await settle()
    const keyed = await boxes()
    ok(keyed.places.w === now.places.w + 16, `ArrowLeft on it widens them too (${now.places.w} -> ${keyed.places.w})`)
    await drag('.explorer-resize-preview', 40)
    now = await boxes()
    ok(now.pane.w === right.pane.w + 40 && now.pane.x === now.work.x, `dragging the preview's grip right widens it, against the left edge (${right.pane.w} -> ${now.pane.w})`)
    const saved = JSON.parse(await win.evaluate(() => localStorage.getItem('prism.explorer.widths') ?? '{}'))
    ok(saved.places === keyed.places.w && saved.preview === now.pane.w, `and both widths are remembered (${JSON.stringify(saved)})`)
    await win.screenshot({ path: join(SHOTS, 'explorer-side-right-resized.png') })
    await win.locator('.explorer-resize-places').dblclick()
    await win.locator('.explorer-resize-preview').dblclick()
    await win.mouse.move(400, 300)
    await settle()
    now = await boxes()
    ok(now.places.w === right.places.w && now.pane.w === right.pane.w, 'a double-click gives each its own width back')

    // 6. HIDDEN, the list takes the right edge; the edge peeks them over it.
    await win.click('[data-panel-toggle]')
    ok(await until(async () => !(await placesShown()), 3000), 'the toggle hides the places')
    await settle()
    const hiddenBoxes = await boxes()
    ok(hiddenBoxes.list.r === hiddenBoxes.work.r, `and the list reaches the right edge (${say(hiddenBoxes.list)})`)
    const edgeY = Math.round(hiddenBoxes.work.y + hiddenBoxes.work.h / 2)
    const away = { x: Math.round(hiddenBoxes.work.x + hiddenBoxes.work.w * 0.4), y: edgeY }
    await win.mouse.move(away.x, away.y)
    await sleep(50)
    await win.mouse.move(hiddenBoxes.work.r - 2, edgeY)
    ok(
      await until(async () => (await win.locator(`${browser}[data-places-peek="in"] .browse-places`).count()) === 1, 2000, 25),
      'resting on the RIGHT edge brings the places out'
    )
    await sleep(300)
    const peek = await boxes()
    ok(peek.places.r === peek.work.r && Math.abs(peek.places.w - right.places.w) <= 1, `over the list at the right edge, at their own width (${say(peek.places)})`)
    ok(JSON.stringify(peek.list) === JSON.stringify(hiddenBoxes.list), 'and the list did not move')
    const shadow = await win.evaluate((b) => getComputedStyle(document.querySelector(`${b} .browse-places`)).boxShadow, browser)
    ok(/-10px/.test(shadow), `the shadow falls on the list's side (${shadow})`)
    await win.screenshot({ path: join(SHOTS, 'explorer-side-right-peek.png') })
    await win.mouse.move(away.x, away.y, { steps: 4 })
    ok(await until(async () => !(await placesShown()), 2000, 25), 'they go when the pointer leaves')
    await win.mouse.move(hiddenBoxes.work.r - 2, edgeY)
    ok(await until(async () => (await win.locator(`${browser}[data-places-peek="in"]`).count()) === 1, 2000, 25), 'out again')
    await sleep(300)
    await win.locator(`${browser} [data-peek-pin]`).click()
    ok(
      await until(async () => (await win.locator(`${browser}[data-places-peek]`).count()) === 0 && (await placesShown()), 3000),
      'and their pin keeps them'
    )
    await win.mouse.move(400, 300)
    await settle()
    now = await boxes()
    ok(now.places.r === now.work.r && now.places.w === right.places.w, `pinned at the right edge (${say(now.places)})`)

    // 7. THE PROJECT TAB stays put under the Explorer's Right.
    const toProject = async () => {
      await win.locator('[role="tablist"] [role="tab"]').last().click()
      await win.waitForSelector('[data-project-sidebar]', { timeout: 10000 })
      await settle()
    }
    await toProject()
    const projStill = await project()
    ok(JSON.stringify(projStill) === JSON.stringify(projLeft), `the Explorer's Right leaves the project tree at the left edge (${say(projStill)} vs ${say(projLeft)})`)

    // 8. THE PROJECT'S RIGHT: the tree on the right, the file left of it.
    await pickStyleSegment(win, 'tree-side', 'Right')
    ok((await win.evaluate(() => [localStorage.getItem('prism.explorer.side'), localStorage.getItem('prism.tree.side')])).join('/') === 'right/right', 'the project row stores its own key')
    await toProject()
    const projRight = await project()
    ok(projRight.tree?.r === projRight.work.r && projRight.viewer?.r <= projRight.tree.x + 1, `Right: the project tree is at the right edge, the file left of it (${say(projRight)})`)
    ok(projRight.tree.w === projLeft.tree.w, 'at the width it had')
    await win.screenshot({ path: join(SHOTS, 'explorer-side-right-project.png') })

    // 9. THE EXPLORER'S LEFT AGAIN, with the project's Right kept: every
    // Explorer box exactly as it was, so the project row moved nothing here.
    await pickStyleSegment(win, 'explorer-side', 'Left')
    await toExplorer()
    await pick('notes.txt')
    const back = await boxes()
    ok(JSON.stringify(back) === JSON.stringify(left), `the project's Right leaves the Explorer as it was, every box exactly (${say(back)} vs ${say(left)})`)
    await win.screenshot({ path: join(SHOTS, 'explorer-side-left-again.png') })
    await toProject()
    const projKept = await project()
    ok(projKept.tree?.r === projKept.work.r, `and the project tree is still on the right (${say(projKept)})`)

    // 10. A RESTART keeps both, each its own. (Measured against the window it
    // opens at: a restart restores the window's size, not to the pixel.)
    await pickStyleSegment(win, 'explorer-side', 'Right')
    await app.close()
    await sleep(900)
    ;({ app, win } = await launch(join(dir, 'notes.txt')))
    ok((await win.evaluate(() => [localStorage.getItem('prism.explorer.side'), localStorage.getItem('prism.tree.side')])).join('/') === 'right/right', 'both choices are stored')
    await explorerAt(win, dir)
    await pick('notes.txt')
    const again = await boxes()
    ok(again.side === 'right' && again.places?.r === again.work.r && again.pane?.x === again.work.x, `after a restart the places are on the right and the preview on the left (${say(again)})`)
    ok(again.toggle.r <= again.back.x, 'and the preview toggle still leads the address row')
    await toProject()
    const projAgain = await project()
    ok(projAgain.tree?.r === projAgain.work.r, `and the project tree is on the right (${say(projAgain)})`)
    await pickStyleSegment(win, 'explorer-side', 'Left')
    await pickStyleSegment(win, 'tree-side', 'Left')
    await toProject()
    const projLeftAgain = await project()
    ok(projLeftAgain.tree?.x === projLeftAgain.work.x, `the project row's Left puts the tree back at the left edge (${say(projLeftAgain)})`)
  } finally {
    await win
      .evaluate((w) => {
        localStorage.setItem('prism.tree.side', 'left')
        localStorage.setItem('prism.explorer.side', 'left')
        localStorage.setItem('prism.explorer.places', '1')
        if (w === null) localStorage.removeItem('prism.explorer.widths')
        else localStorage.setItem('prism.explorer.widths', w)
      }, widthsBefore)
      .catch(() => {})
    if (styleBefore !== undefined) await switchStyle(win, styleBefore).catch(() => {})
    await app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The labels of the open context menu, top to bottom. */
const menuLabels = (win) =>
  win.evaluate(() =>
    [...document.querySelectorAll('[role="menu"] > [role="menuitem"]')].map((b) => b.querySelector('.truncate')?.textContent ?? '')
  )
/** Open a row's menu and read it; Escape puts it away. */
async function rowMenu(win, suffix) {
  await zipRow(win, suffix).click({ button: 'right' })
  await win.waitForSelector('[role="menu"] [role="menuitem"]', { timeout: 5000 })
  const labels = await menuLabels(win)
  await win.keyboard.press('Escape')
  await sleep(150)
  return labels
}
/** The address the Explorer shows. */
const zipWhere = async (win) => (await win.locator('.browse-path').getAttribute('title')) ?? ''
async function zipGo(win, path, until_) {
  await win.locator('[data-testid="browse-edit-path"]').click()
  await win.locator('.browse-path-form input').fill(path)
  await win.keyboard.press('Enter')
  return until(until_ ?? (async () => (await zipWhere(win)).toLowerCase() === path.toLowerCase()), 10000)
}

/**
 * THE MENUS (#300, mockups 02, 07, 08): a zip outside, a folder inside, a
 * file inside, and a read-only 7z inside, each exactly the rows the spec
 * lists (`lib/archiveMenus.ts`), with the left-out ones absent.
 */
async function zipMenusScenario(fixtures) {
  console.log('zip menus (#300)')
  const { dir, zipPath } = await zipWorld(fixtures, 'zipmenus')
  const seven = join(ROOT, 'vendor', '7zip', '7z.exe')
  const src = join(dir, 'src7')
  mkdirSync(join(src, 'inside'), { recursive: true })
  writeFileSync(join(src, 'inside', 'note.txt'), 'in a 7z\n')
  execFileSync(seven, ['a', '-t7z', join(dir, 'locked.7z'), join(src, '*')], { windowsHide: true, stdio: 'ignore' })
  rmSync(src, { recursive: true, force: true })
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'notes.txt'))
  EXTRA_ENV = {}
  try {
    await explorerAt(win, dir)
    const outside = await rowMenu(win, 'Wind-0.2.2.zip')
    const wantOutside = ['Open', 'Open in new tab', 'Extract here', 'Extract to...', 'Add files...', 'Copy', 'Copy path', 'Rename', 'Delete', 'Show in File Explorer', 'Properties']
    ok(outside.join('|') === wantOutside.join('|'), `a zip outside has the archive's rows (${outside.join(', ')})`)
    await zipGo(win, `${zipPath}\\Wind`, async () => (await zipRows(win)).some((p) => p.endsWith('package.json')))
    const folder = await rowMenu(win, 'Wind\\src')
    const wantFolder = ['Open', 'Open in new tab', 'Extract this folder', 'Extract this folder to...', 'Add files here...', 'Copy folder', 'Delete from zip', 'Show Wind-0.2.2.zip in File Explorer', 'Properties']
    ok(folder.join('|') === wantFolder.join('|'), `a folder inside has its rows (${folder.join(', ')})`)
    ok(!folder.includes('Rename'), 'and no Rename: a folder inside a zip is not renamed')
    const file = await rowMenu(win, 'package.json')
    const wantFile = ['Open', 'Extract this file', 'Extract this file to...', 'Copy file', 'Rename', 'Delete from zip', 'Show Wind-0.2.2.zip in File Explorer', 'Properties']
    ok(file.join('|') === wantFile.join('|'), `a file inside has its rows (${file.join(', ')})`)
    ok(!file.some((l) => /^Open (with|in)/.test(l)), 'and no Open with: a temp copy would lose its saves')
    // The empty space's own menu.
    const box = await win.locator('[data-testid="browse-list"]').boundingBox()
    await win.mouse.click(box.x + box.width / 2, box.y + box.height - 20, { button: 'right' })
    await win.waitForSelector('[role="menu"] [role="menuitem"]', { timeout: 5000 })
    const empty = await menuLabels(win)
    await win.keyboard.press('Escape')
    ok(empty.join('|') === ['Extract here', 'Extract to...', 'Add files here...', 'Show Wind-0.2.2.zip in File Explorer', 'Copy address'].join('|'), `the empty space inside has its rows (${empty.join(', ')})`)
    await win.screenshot({ path: join(SHOTS, 'zip-menu.png') })
    // A 7z is read-only: no Add, Rename or Delete anywhere.
    await zipGo(win, join(dir, 'locked.7z'), async () => /locked\.7z/.test((await win.locator('[data-archive-strip]').textContent().catch(() => '')) ?? ''))
    ok(/read-only/.test((await win.locator('[data-archive-strip]').textContent()) ?? ''), 'a 7z says it is read-only')
    await zipGo(win, join(dir, 'locked.7z', 'inside'), async () => (await zipRows(win)).some((p) => p.endsWith('note.txt')))
    const sevenFile = await rowMenu(win, 'note.txt')
    ok(!sevenFile.some((l) => /Rename|Delete|Add/.test(l)), `a 7z member has no write rows (${sevenFile.join(', ')})`)
    // F2 and Delete do nothing there.
    await zipRow(win, 'note.txt').click()
    await win.keyboard.press('F2')
    await win.keyboard.press('Delete')
    await sleep(300)
    ok((await win.locator('[role="dialog"]').count()) === 0, 'F2 and Delete are inert in a read-only archive')
  } finally {
    await app.close()
  }
}

/**
 * WRITES INSIDE A ZIP (#300): rename a file member, delete one, delete a
 * folder with its subtree, add files here, and a Prism row dragged in (its
 * original binned, Ctrl+Z takes both halves back). Each is read back with
 * adm-zip, from the container itself.
 */
async function zipWritesScenario(fixtures) {
  console.log('writes inside a zip (#300)')
  const { dir, zipPath } = await zipWorld(fixtures, 'zipwrites')
  const AdmZip = (await import('adm-zip')).default
  const names = () => new AdmZip(zipPath).getEntries().map((e) => e.entryName)
  const addMe = join(dir, 'add-me.txt')
  writeFileSync(addMe, 'added from outside\n')
  writeFileSync(join(dir, 'carry-me.txt'), 'dragged in\n')
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index'), PRISM_E2E_PICK_FILES: addMe }
  const { app, win } = await launch(join(dir, 'notes.txt'))
  EXTRA_ENV = {}
  try {
    await explorerAt(win, dir)
    await zipGo(win, `${zipPath}\\Wind`, async () => (await zipRows(win)).some((p) => p.endsWith('package.json')))
    // F2 renames a file member.
    await zipRow(win, 'package.json').click()
    await win.keyboard.press('F2')
    await win.waitForSelector('input[aria-label="New name"]', { timeout: 5000 })
    await win.locator('input[aria-label="New name"]').fill('pkg.json')
    await win.keyboard.press('Enter')
    ok(await until(() => names().includes('Wind/pkg.json')), 'F2 renamed the member inside the zip')
    ok(await until(async () => (await zipRows(win)).some((p) => p.endsWith('pkg.json'))), 'and the list shows it')
    // Delete asks the no-Recycle-Bin question, then the entry is gone.
    await zipRow(win, 'pkg.json').click()
    await win.keyboard.press('Delete')
    await win.waitForSelector('text=no Recycle Bin', { timeout: 5000 })
    await win.locator('[role="dialog"] button', { hasText: 'Delete' }).click()
    ok(await until(() => !names().includes('Wind/pkg.json')), 'Delete took it out of the zip')
    // A folder takes its subtree.
    await zipRow(win, 'Wind\\docs').click()
    await win.keyboard.press('Delete')
    await win.waitForSelector('text=no Recycle Bin', { timeout: 5000 })
    await win.locator('[role="dialog"] button', { hasText: 'Delete' }).click()
    ok(await until(() => !names().some((n) => n.startsWith('Wind/docs/'))), 'deleting a folder takes its subtree')
    // Add files here lands in that folder.
    await zipRow(win, 'Wind\\src').click({ button: 'right' })
    await win.locator('[role="menuitem"]', { hasText: 'Add files here...' }).click()
    ok(await until(() => names().includes('Wind/src/add-me.txt')), 'Add files here put the file in that folder')
    ok(existsSync(addMe), 'and left the original where it was')
    // A Prism row dragged into the zip: added, its original binned, undoable.
    await win.screenshot({ path: join(SHOTS, 'zip-writes.png') })
    // In the project's tree, the zip is a folder node, and a Prism row
    // dropped on it goes in (taken by its NAME, the sweep's rule).
    await win.locator('[role="tablist"] [role="tab"]', { hasText: 'zipwrites' }).click()
    await win.waitForSelector('aside [role="treeitem"]:has-text("carry-me.txt")', { timeout: 10000 })
    await win
      .locator('aside [role="treeitem"]:has-text("carry-me.txt")')
      .locator('span.truncate')
      .dragTo(win.locator(`aside [data-row="${zipPath.replace(/\\/g, '\\\\')}"]`))
    ok(await until(() => names().includes('carry-me.txt'), 10000), 'a Prism row dropped on the zip went in')
    ok(await until(() => !existsSync(join(dir, 'carry-me.txt'))), 'and its original went to the bin')
    await win.locator('body').press('Control+z')
    ok(await until(() => existsSync(join(dir, 'carry-me.txt')), 10000), 'Ctrl+Z puts the original back')
    ok(await until(() => !names().includes('carry-me.txt')), 'and takes the member out of the zip')
  } finally {
    await app.close()
  }
}

/**
 * PROJECT MODE (#300, mockups 09 and 10): a zip in a project's tree is a node
 * with a chevron; a member opens read-only with the note; typing changes
 * nothing; Extract here puts the file beside the zip and opens that copy.
 */
async function zipProjectScenario(fixtures) {
  console.log('zips in project mode (#300)')
  const { dir, zipPath } = await zipWorld(fixtures, 'zipproject')
  const { app, win } = await launch(join(dir, 'notes.txt'))
  try {
    await win.waitForSelector('aside [data-row]', { timeout: 10000 })
    const node = win.locator(`aside [data-row="${zipPath.replace(/\\/g, '\\\\')}"]`)
    ok((await node.getAttribute('data-zip-node')) === 'true', 'the zip is a node in the tree')
    ok((await node.getAttribute('aria-expanded')) === 'false', 'with a chevron, shut')
    await node.locator('span').first().click()
    ok(await until(async () => (await win.locator('aside [data-row$="\\\\Wind"]').count()) === 1, 10000), 'the chevron opens it')
    await win.locator('aside [data-row$="\\\\Wind"] span').first().click()
    await until(async () => (await win.locator('aside [data-row$="\\\\README.md"]').count()) === 1, 10000)
    await win.locator('aside [data-row$="\\\\Wind\\\\src"] span').first().click()
    await until(async () => (await win.locator('aside [data-row$="\\\\main"]').count()) === 1, 10000)
    await win.locator('aside [data-row$="\\\\src\\\\main"] span').first().click()
    await until(async () => (await win.locator('aside [data-row$="caret.ts"]').count()) === 1, 10000)
    await win.locator('aside [data-row$="caret.ts"]').click()
    ok(await until(async () => (await win.locator('[data-member-note]').count()) === 1, 15000), 'a member opens with the read-only note')
    ok(/In Wind-0\.2\.2\.zip, read-only/.test((await win.locator('[data-member-note]').textContent()) ?? ''), 'which says where it is and that it is read-only')
    ok(await until(async () => /caret follows typing/.test((await win.locator('.cm-content').textContent().catch(() => '')) ?? ''), 15000), 'its text is shown')
    await win.locator('.cm-content').click()
    await win.keyboard.type('typed')
    await sleep(300)
    ok(!/typed/.test((await win.locator('.cm-content').textContent()) ?? ''), 'typing changes nothing')
    ok(!(await win.locator('aside [data-row$="caret.ts"]').textContent())?.includes('*'), 'and no unsaved star appears')
    await win.screenshot({ path: join(SHOTS, 'zip-project.png') })
    // The zip node's own menu is the archive's.
    await node.click({ button: 'right' })
    await win.waitForSelector('[role="menu"] [role="menuitem"]', { timeout: 5000 })
    const labels = await menuLabels(win)
    await win.screenshot({ path: join(SHOTS, 'zip-project-menu.png') })
    await win.keyboard.press('Escape')
    ok(labels.includes('Extract here') && labels.some((l) => /^Extract to/.test(l)), `the zip node's menu has the archive's verbs (${labels.join(', ')})`)
    // Extract here: the file lands beside the zip and opens editable.
    await win.locator('[data-member-extract]').click()
    ok(await until(() => existsSync(join(dir, 'caret.ts')), 15000), 'Extract here put the file beside the zip')
    ok(await until(async () => (await win.locator('[data-member-note]').count()) === 0, 10000), 'and the copy opened, without the note')
  } finally {
    await app.close()
  }
}

/**
 * A TAB INSIDE A ZIP COMES BACK THERE (#300): relaunch, and it is two folders
 * in, painted in the first frame from the listing cache, Back still working;
 * with the zip gone, it falls back to its folder.
 */
async function zipRestoreScenario(fixtures) {
  console.log('a tab inside a zip comes back (#300)')
  const { dir, zipPath } = await zipWorld(fixtures, 'ziprestore')
  const inside = `${zipPath}\\Wind\\src`
  const seed = (path, history) => {
    const explorer = {
      id: 'fixture-explorer', role: 'explorer', pinned: true, root: dir,
      browse: { path, history: history.map((p) => ({ path: p, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } })), cursor: history.length - 1, surface: 'folder', preview: true },
      panes: [], open: [dir]
    }
    writeFileSync(join(PROFILE, 'tabs.json'), JSON.stringify({ active: 0, tabs: [explorer] }))
  }
  let app
  try {
    seed(inside, [dir, zipPath, inside])
    ;({ app } = await (async () => {
      const a = await launchTestApp({ args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e'], env: { ...process.env, PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') } })
      return { app: a }
    })())
    let win = await app.firstWindow()
    await offscreen(app)
    ok(await until(async () => (await zipRows(win)).some((p) => p.endsWith('\\main')), 15000), 'the tab came back inside the zip')
    ok((await zipWhere(win)) === inside, 'two folders in')
    await win.locator('[data-testid="browse-list"]').focus()
    await win.keyboard.press('Alt+ArrowLeft')
    ok(await until(async () => (await zipWhere(win)) === zipPath), 'Back still works')
    await win.keyboard.press('Alt+ArrowRight')
    await until(async () => (await zipWhere(win)) === inside)
    await app.close()
    await sleep(900)
    // Second launch: the first frame paints from the cache.
    app = await launchTestApp({ args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e'], env: { ...process.env, PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') } })
    win = await app.firstWindow()
    await offscreen(app)
    ok(await until(async () => (await zipRows(win)).some((p) => p.endsWith('\\main')), 15000), 'and again on the next launch')
    await app.close()
    await sleep(900)
    // The zip deleted: the tab falls back to its folder.
    rmSync(zipPath, { force: true })
    app = await launchTestApp({ args: [MAIN, `--user-data-dir=${PROFILE}`, '--e2e'], env: { ...process.env, PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') } })
    win = await app.firstWindow()
    await offscreen(app)
    ok(await until(async () => (await zipRows(win)).some((p) => p.endsWith('notes.txt')), 15000), `with the zip gone, the tab falls back to its folder (${await zipWhere(win)})`)
  } finally {
    await app?.close().catch(() => {})
  }
}

/**
 * LOCKED, DAMAGED AND TEMP (#300): a ZipCrypto member asks once and again on a
 * wrong password; a damaged zip says so and keeps the list where it was;
 * every member opened lands under the run's `prism-members` folder, nothing in
 * `%TEMP%\prism-zip-*`, and the run's folder is gone after quit.
 */
async function zipLockedScenario(fixtures) {
  console.log('locked, damaged and temp (#300)')
  const dir = join(fixtures, 'ziplocked')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(ROOT, 'src', 'main', 'fixtures', 'crypto.zip'), join(dir, 'crypto.zip'))
  writeFileSync(join(dir, 'broken.zip'), Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 7)]))
  writeFileSync(join(dir, 'notes.txt'), 'beside\n')
  const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('prism-zip-')))
  EXTRA_ENV = { PRISM_E2E_INDEX_ROOT: join(tmpdir(), 'prism-e2e-no-index') }
  const { app, win } = await launch(join(dir, 'notes.txt'))
  EXTRA_ENV = {}
  let runDir
  try {
    await explorerAt(win, dir)
    // Damaged: the error line, and the list stays where it was.
    await zipRow(win, 'broken.zip').dblclick()
    ok(await until(async () => /can't be read/i.test((await win.locator('.browse-list-area').textContent()) ?? ''), 10000), 'a damaged zip says it cannot be read')
    await win.locator('[data-testid="browse-list"]').focus()
    // Locked: entering lists; opening a member asks.
    await zipGo(win, join(dir, 'crypto.zip'), async () => (await win.locator('[data-archive-strip]').count()) === 1)
    const first = (await zipRows(win)).find((p) => /\.\w+$/.test(p))
    ok(!!first, `the locked zip lists its members (${first})`)
    await zipRow(win, first.replace(/^.*\\/, '')).click()
    ok(await until(async () => (await win.locator('input[aria-label="Archive password"]').count()) === 1, 10000), 'a locked member asks for the password')
    await win.locator('input[aria-label="Archive password"]').fill('wrong-one')
    await win.keyboard.press('Enter')
    ok(await until(async () => /didn't open/.test((await win.textContent('body')) ?? ''), 10000), 'a wrong one asks again, saying so')
    await win.locator('input[aria-label="Archive password"]').fill('letmein')
    await win.keyboard.press('Enter')
    ok(await until(async () => (await win.locator('input[aria-label="Archive password"]').count()) === 0 && (await win.locator('[data-member-gate]').count()) === 0, 10000), 'the right one opens it')
    const members = join(tmpdir(), 'prism-members')
    const runs = existsSync(members) ? readdirSync(members) : []
    ok(runs.length >= 1, `members land under the run's prism-members folder (${runs.join(', ')})`)
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('prism-zip-') && !before.has(n))
    ok(after.length === 0, `nothing new in %TEMP%\\prism-zip-* (${after.join(', ')})`)
    runDir = runs.map((r) => join(members, r))
  } finally {
    await app.close()
  }
  await sleep(1500)
  const left = (runDir ?? []).filter((d) => existsSync(d))
  ok(left.length === 0, `the run's member folder is gone after quit (${left.join(', ')})`)
}

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
await run(startupScenario)
await run(mdScenario)
await run(pdfScenario)
await run(pdfZoomScenario)
await run(sortScenario)
await run(bigTreeScenario)
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
await run(titleBarScenario)
await run(moreMenuScenario)
await run(sidebarPeekScenario)
await run(updateWindowScenario)
await run(updateGuardScenario)
await run(updateQuietScenario)
await run(terminalScenario)
await run(termOptionsScenario)
await run(noCommandHelpScenario)
await run(termColourPickerScenario)
await run(settingsLookScenario)
await run(themeWallScenario)
await run(themeMigrationScenario)
await run(onboardingThemeScenario)
await run(themeLooksScenario)
await run(settingsSearchScenario)
await run(dictationScenario)
await run(dictationPageScenario)
await run(pinRecentScenario)
await run(termCwdScenario)
await run(agentTitleScenario)
await run(handoffOverTermScenario)
await run(openInExplorerScenario)
await run(neverWindowlessScenario)
await run(promptLayoutScenario)
await run(termMenuCopyScenario)
await run(extractScenario)
await run(extractWindowScenario)
await run(extractCancelScenario)
await run(flatZipScenario)
await run(zipMenusScenario)
await run(zipWritesScenario)
await run(zipProjectScenario)
await run(zipRestoreScenario)
await run(zipLockedScenario)
await run(zipFolderScenario)
await run(previewClearsScenario)
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
await run(accentOpacityScenario)
await run(styleColoursScenario)
await run(seeThroughScenario)
await run(dragScenario)
await run(marqueeScenario)
await run(marqueeQuietScenario)
await run(markTintScenario)
await run(explorerSizeScenario)
await run(sidebarPlacesScenario)
await run(sidebarGroundScenario)
await run(rightClickSelectScenario)
await run(columnHeadersScenario)
await run(panelsAlignScenario)
await run(explorerSideScenario)
await run(downloadsDateScenario)
await run(noLoadingEverScenario)
await run(coldLaunchCachedScenario)
await run(coldLaunchNoCacheScenario)
await run(newFolder2000Scenario)
await run(slowFolderHintScenario)
await run(tabSwitchInstantScenario)
await run(rememberFoldersScenario)
await run(listScrollbarScenario)
await run(addressFieldScenario)
await run(explorerVerbsScenario)
await run(searchPopupScenario)
await run(searchNavScenario)
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
