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
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
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
  await win.evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
  }, { 'prism.onboarded': '1', 'prism.sidebar': '1' })
  await sleep(300)
  await app.close()
  await sleep(900) // let the single-instance lock go
}

/** Launch Prism on a file, in the seeded profile. */
async function launch(file) {
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${PROFILE}`, file] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await sleep(600) // the opened file arrives over IPC after load
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

async function filterScenario(fixtures) {
  console.log('navigation filter')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    const funnel = win.locator('[aria-label="Navigation filter"]')
    await funnel.waitFor({ timeout: 10000 })
    // File rows in the tree (folders have aria-expanded, files don't).
    const fileRows = win.locator('[role="treeitem"]:not([aria-expanded])')

    const fillOf = () => funnel.locator('svg').getAttribute('fill')
    ok((await fillOf()) === 'currentColor', 'default scope (group) shows a filled funnel')
    // Docs group: README.md + sample.pdf + notes.txt + ep1.en.srt = "x / 4".
    ok(await win.locator('text=/\\/ 4$/').first().isVisible().catch(() => false), 'group scope lists 4 documents')
    ok((await fileRows.count()) === 4, 'group scope shows 4 file rows in the tree')

    await funnel.click()
    await win.click('[role="menuitemradio"]:has-text("All in one")')
    await sleep(200)
    ok((await fillOf()) === 'none', 'all-in-one shows an outlined funnel')
    ok(await win.locator('text=/\\/ 9$/').first().isVisible().catch(() => false), 'all scope lists 9 files')
    ok((await fileRows.count()) === 9, 'all scope shows all 9 file rows in the tree')

    // Sorting: Playnite's shape, one direction pair for every field. Size
    // ascending puts the smallest first; flipping to descending, the biggest.
    const sortBtn = win.locator('[aria-label="Sort order"]')
    const sortMenu = '[role="menu"][aria-label="Sort order"]'
    const firstRow = () => fileRows.first().textContent()
    await sortBtn.click()
    await win.click(`${sortMenu} [role="menuitemradio"]:has-text("Size")`)
    await sleep(250)
    ok(((await firstRow()) ?? '').includes('notes.txt'), 'size ascending puts the smallest file first')
    const rootFiles = readdirSync(fixtures).filter((n) => statSync(join(fixtures, n)).isFile() && !/\.srt$/i.test(n))
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

    await funnel.click()
    await win.click('[role="menuitemradio"]:has-text("Per file type")')
    await sleep(200)
    ok((await fillOf()) === 'currentColor', 'per-type shows a filled funnel')
    // Text kind: README.md + notes.txt + ep1.en.srt.
    ok(await win.locator('text=/\\/ 3$/').first().isVisible().catch(() => false), 'per-type lists the 3 text files')
    ok((await fileRows.count()) === 3, 'per-type shows the 3 text rows in the tree')
    ok(
      (await win.locator('[role="treeitem"][aria-selected="true"]').count()) === 1,
      'the open file row survives every filter'
    )
    await win.screenshot({ path: join(SHOTS, 'filter.png') })

    // Settings shows the same value: the two controls share the store.
    await win.click('[aria-label="Settings"]')
    await sleep(400)
    await win.click('button:has-text("General")') // settings opens on Style
    await sleep(300)
    ok((await win.inputValue('#nav-scope').catch(() => '')) === 'type', 'Settings select agrees')
    await win.screenshot({ path: join(SHOTS, 'filter-settings.png') })
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
    await win.hover('[role="menuitem"]:has-text("Open in")')
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
    await win.screenshot({ path: join(SHOTS, 'context-menu.png') })

    // Duplicate makes "README (2).md" appear in the tree.
    await win.keyboard.press('Escape')
    await sleep(200)
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

    // Navigating away from unsaved text asks first; "Keep editing" stays.
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('text=Discard your changes?', { timeout: 5000 })
    ok(true, 'leaving unsaved text asks first')
    await win.click('button:has-text("Keep editing")')
    await sleep(200)
    ok((await win.locator('.cm-content').count()) === 1, 'Keep editing stays on the file')

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

    // Click into the text and the arrows become the caret's.
    await win.locator('.cm-line').first().click()
    await sleep(200)
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
    await sleep(200)
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
    await sleep(400)
    ok((await win.locator('.cm-searchMatch').count()) >= 1, 'and finds a match')
    await win.screenshot({ path: join(SHOTS, 'code-find.png') })
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
    await win.waitForSelector('text=Save before closing?', { timeout: 5000 })
    ok(true, 'closing with unsaved text asks first')
    await win.screenshot({ path: join(SHOTS, 'unsaved-close.png') })

    await win.click('button:has-text("Cancel")')
    await sleep(400)
    ok(!win.isClosed(), 'Cancel keeps the window open')
    ok(((await row().textContent()) ?? '').includes('*'), 'and keeps the unsaved text')

    // Save and close: the file lands on disk, then the window really goes.
    await win.evaluate(() => window.prism.close())
    await win.waitForSelector('text=Save before closing?', { timeout: 5000 })
    await win.click('button:has-text("Save and close")')
    await sleep(1500)
    ok(readFileSync(notes, 'utf-8').includes('delta'), 'Save and close writes the file')
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

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
const fixtures = buildFixtures()

try {
  await seedProfile()
  await mdScenario(fixtures)
  await sleep(900) // let the single-instance lock go
  await pdfScenario(fixtures)
  await sleep(900)
  await filterScenario(fixtures)
  await sleep(900)
  await contextMenuScenario(fixtures)
  await sleep(900)
  await editScenario(fixtures)
  await sleep(900)
  await codeScenario(fixtures)
  await sleep(900)
  await unsavedScenario(fixtures)
  await sleep(900)
  await playerScenario(fixtures)
} catch (e) {
  failures += 1
  console.error('scenario crashed:', e)
}

console.log(failures ? `\n${failures} failure(s)` : '\nall e2e checks passed')
process.exit(failures ? 1 : 0)
