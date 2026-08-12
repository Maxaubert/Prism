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
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
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
    await win.screenshot({ path: join(SHOTS, 'markdown.png') })
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
    await win.waitForSelector('.p-pdf-textlayer span', { timeout: 10000 })
    ok((await win.locator('.p-pdf-textlayer span').count()) > 0, 'text layer present')

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

    // Page jump via PageDown; the pill's page number follows.
    await win.keyboard.press('PageDown')
    await sleep(400)
    ok((await win.inputValue('input[aria-label="Page number"]')) === '2', 'PageDown flips to page 2')
    await win.screenshot({ path: join(SHOTS, 'pdf.png') })
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
    // Docs group: README.md + sample.pdf + notes.txt = "x / 3" in the top bar.
    ok(await win.locator('text=/\\/ 3$/').first().isVisible().catch(() => false), 'group scope lists 3 documents')
    ok((await fileRows.count()) === 3, 'group scope shows 3 file rows in the tree')

    await funnel.click()
    await win.click('[role="menuitemradio"]:has-text("All in one")')
    await sleep(200)
    ok((await fillOf()) === 'none', 'all-in-one shows an outlined funnel')
    ok(await win.locator('text=/\\/ 8$/').first().isVisible().catch(() => false), 'all scope lists 8 files')
    ok((await fileRows.count()) === 8, 'all scope shows all 8 file rows in the tree')

    await funnel.click()
    await win.click('[role="menuitemradio"]:has-text("Per file type")')
    await sleep(200)
    ok((await fillOf()) === 'currentColor', 'per-type shows a filled funnel')
    // Text kind: README.md + notes.txt.
    ok(await win.locator('text=/\\/ 2$/').first().isVisible().catch(() => false), 'per-type lists the 2 text files')
    ok((await fileRows.count()) === 2, 'per-type shows the 2 text rows in the tree')
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
  } finally {
    await app.close()
  }
}

async function editScenario(fixtures) {
  console.log('edit mode')
  const notes = join(fixtures, 'notes.txt')
  const { app, win } = await launch(notes)
  try {
    await win.waitForSelector('pre', { timeout: 10000 })
    const pencil = win.locator('[aria-label="Edit"]')
    ok((await pencil.count()) === 1, 'pencil shows for a text file')
    await pencil.click()
    await win.waitForSelector('textarea', { timeout: 5000 })
    ok((await win.inputValue('textarea')).startsWith('alpha beta'), 'editor holds the raw text')

    await win.locator('textarea').focus()
    await win.keyboard.press('Control+End')
    await win.keyboard.type('gamma')

    // Navigating away from a dirty editor asks first; "Keep editing" stays.
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('text=Discard your changes?', { timeout: 5000 })
    ok(true, 'leaving a dirty editor asks first')
    await win.click('button:has-text("Keep editing")')
    await sleep(200)
    ok((await win.locator('textarea').count()) === 1, 'Keep editing stays in the editor')

    await win.keyboard.press('Control+s')
    await win.waitForSelector('pre', { timeout: 5000 })
    ok((await win.textContent('pre')).includes('gamma'), 'save returns to the viewer with the new text')
    ok(readFileSync(notes, 'utf-8').includes('gamma'), 'the file on disk holds the edit')

    // Markdown edits its unrendered source.
    await win.click('[role="treeitem"]:has-text("README.md")')
    await win.waitForSelector('.p-md h1', { timeout: 10000 })
    await win.click('[aria-label="Edit"]')
    await win.waitForSelector('textarea', { timeout: 5000 })
    ok((await win.inputValue('textarea')).startsWith('<div align="center">'), 'markdown editor shows raw source')
    await win.screenshot({ path: join(SHOTS, 'edit-md.png') })
    await win.keyboard.press('Escape') // not dirty: straight back to the view
    await win.waitForSelector('.p-md h1', { timeout: 5000 })
    ok(true, 'Escape leaves a clean editor without asking')
    ok(!win.isClosed(), 'window survives editor Escape')
  } finally {
    await app.close()
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
    await win.waitForSelector('text=ep2.mp4', { timeout: 10000 })
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
  await playerScenario(fixtures)
} catch (e) {
  failures += 1
  console.error('scenario crashed:', e)
}

console.log(failures ? `\n${failures} failure(s)` : '\nall e2e checks passed')
process.exit(failures ? 1 : 0)
