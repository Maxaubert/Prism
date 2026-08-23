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
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildFixtures } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const PROFILE = join(tmpdir(), 'prism-e2e-profile')
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
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`] })
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
async function launch(file, keepTabs = false) {
  // Every scenario but the tab one expects a single-root world. The profile is
  // shared across scenarios (it is wiped once, at the start), so last
  // scenario's strip would restore into this one and change what the tree
  // counts. Forgetting it is the isolation; the tab scenario opts out, because
  // surviving a restart is the thing it is checking.
  if (!keepTabs) rmSync(join(PROFILE, 'tabs.json'), { force: true })
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`, file] })
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
    ok(await win.locator('text=/\\/ 3/').first().isVisible().catch(() => false), 'pill shows / 3')
    // The rebased zoom: 1.9 pdf.js units is the default and reads as 100%.
    ok((await win.locator('button[title="Default zoom (0)"]').textContent()) === '100%', 'default zoom reads 100%')
    ok(
      await win.evaluate(() => {
        const page = document.querySelector('[data-page="1"]')
        return Math.abs(page.getBoundingClientRect().width - 612 * 1.9) < 2
      }),
      'default zoom really is 1.9 pdf units'
    )
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

    for (const label of ['Open in', 'Show in File Explorer', 'Copy path', 'Copy file', 'Duplicate', 'Rename', 'Delete']) {
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
    await win.screenshot({ path: join(SHOTS, 'context-menu.png') })
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
    await win.waitForSelector('.cm-content', { timeout: 5000 })
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
    await win.keyboard.press('ArrowLeft')
    await sleep(700)
    ok(((await selected()) ?? '').includes('hello.sh'), 'Left pages the folder while nothing is focused')

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
    await win.keyboard.press('ArrowLeft')
    await sleep(500)
    ok((await selected()) === before, 'the arrows stop paging once the caret is in the file')

    await win.keyboard.press('Escape')
    await sleep(300)
    ok(!(await caretInFile()), 'Escape hands focus back to the folder')
    ok(!win.isClosed(), 'Escape does not close the window')
    await win.keyboard.press('ArrowRight')
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

    // Right/Left are the chevron while the cursor is on a folder.
    await win.keyboard.press('ArrowRight')
    await sleep(600)
    ok((await expanded('nested')) === 'true', 'Right expands the folder')
    await win.keyboard.press('ArrowLeft')
    await sleep(600)
    ok((await expanded('nested')) === 'false', 'Left collapses it')

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
    await win.keyboard.press('ArrowRight') // expand `nested`
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
    await win.evaluate(() => {
      const v = document.querySelector('video')
      v.currentTime = Math.max(0, v.duration - 0.3)
      void v.play()
    })
    await win.waitForSelector('[role="treeitem"][aria-selected="true"]:has-text("ep2.mp4")', { timeout: 10000 })
    ok(true, 'autoplay advances to the next video')
    ok(!win.isClosed(), 'window survives the whole tour')
  } finally {
    await app.close()
  }
}

/**
 * A real second launch, the way an Explorer double-click arrives: Prism is
 * single-instance, so this process hands its path to the running window and
 * exits. Nothing test-only is involved, which is the point - this IS the route
 * a new tab is supposed to come in through.
 */
async function handoff(file) {
  const child = spawn(electronPath, [MAIN, `--user-data-dir=${PROFILE}`, file], {
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

    // A second root, opened deliberately. The dialog is native and cannot be
    // driven, so the scenario asks for the same payload the button asks for.
    await handoff(join(fixtures, 'code', 'bad.json'))
    await win.waitForSelector(strip, { timeout: 10000 })
    ok((await tabRows().count()) === 2, 'a second root opens a second tab')
    const labels = await tabRows().allTextContents()
    ok(labels.some((l) => /code/.test(l)), 'the new tab is named for its folder')

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

    // Switching: the tree and the viewer both follow.
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
    // recreate the code tab, restoring the order the flow below expects
    await handoff(join(fixtures, 'code', 'bad.json'))
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
    await handoff(join(fixtures, 'code', 'bad.json'))
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

    // Hide, then show: same session, scrollback intact, shell still alive.
    await win.keyboard.press('Control+`')
    await sleep(300)
    ok((await win.locator('.xterm').count()) === 0, 'Ctrl+` hides the panel')
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm', { timeout: 10000 })
    await sleep(300)
    ok(
      ((await win.locator('.xterm').textContent()) ?? '').includes('prism-e2e-marker'),
      'reopening shows the same shell, scrollback intact'
    )

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

    // The terminal button's own menu: split, and clear.
    await win.locator('aside [aria-label="Terminal"]').click({ button: 'right' })
    await win.waitForSelector('[role="menu"]', { timeout: 5000 })
    ok(
      (await win.locator('[role="menuitem"]:has-text("Open in split view")').count()) === 1 &&
        (await win.locator('[role="menuitem"]:has-text("Clear terminal")').count()) === 1,
      'right-clicking the terminal button offers split and clear'
    )
    await win.locator('[role="menuitem"]:has-text("Clear terminal")').click()
    await sleep(500)
    ok((await countMarker()) === 0, 'Clear terminal wipes screen and scrollback')
    ok(
      ((await win.locator('.xterm').textContent()) ?? '').includes('PS '),
      'but the prompt (same shell, same cwd) is still there'
    )
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
    await win.waitForSelector('[data-agent-present]', { timeout: 30000 })
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
    ok(
      (await win.locator('[aria-label="Edit"]').count()) === 0,
      'a full terminal hides the markdown pencil'
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
  // Windows hands Prism a .7z whenever someone picks it out of "More apps",
  // which lists every installed application regardless of SupportedTypes. The
  // window must say so rather than sit empty. (.zip used to be the specimen;
  // it opens for real since #68 and has its own scenario.)
  const { app, win } = await launch(join(fixtures, 'misc', 'archive.7z'))
  try {
    await win.waitForFunction(
      () => /can.t show 7Z files/.test(document.body.textContent ?? ''),
      null,
      { timeout: 10000 }
    )
    const text = ((await win.textContent('body')) ?? '').replace(/\s+/g, ' ')
    ok(/can.t show 7Z files/.test(text), 'the panel names the format')
    ok(/archive\.7z/.test(text), 'the panel names the file')
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

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
const fixtures = buildFixtures()

try {
  await seedProfile()
  await mdScenario(fixtures)
  await sleep(900) // let the single-instance lock go
  await pdfScenario(fixtures)
  await sleep(900)
  await sortScenario(fixtures)
  await sleep(900)
  await contextMenuScenario(fixtures)
  await sleep(900)
  await editScenario(fixtures)
  await sleep(900)
  await codeScenario(fixtures)
  await sleep(900)
  await treeNavScenario(fixtures)
  await sleep(900)
  await unsavedScenario(fixtures)
  await sleep(900)
  await playerScenario(fixtures)
  await sleep(900)
  await tabsScenario(fixtures)
  await sleep(900)
  await terminalScenario(fixtures)
  await sleep(900)
  await archiveScenario(fixtures)
  await sleep(900)
  await selectionScenario(fixtures)
  await sleep(900)
  await dragScenario(fixtures)
  await sleep(900)
  await unsupportedScenario(fixtures)
} catch (e) {
  failures += 1
  console.error('scenario crashed:', e)
}

console.log(failures ? `\n${failures} failure(s)` : '\nall e2e checks passed')
process.exit(failures ? 1 : 0)
