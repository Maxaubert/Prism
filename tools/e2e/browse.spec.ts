/* eslint-disable no-empty-pattern -- Playwright requires a destructured fixture argument, including tests without browser fixtures. */
import { test, expect, type TestInfo } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'

const ROOT = resolve(__dirname, '../..')
const MAIN = join(ROOT, 'out/main/index.js')
const quotePS = (value: string): string => `'${value.replace(/'/g, "''")}'`

/** The app writes on a debounce; a poll may land while Windows holds the file open. */
function savedTabs(path: string): {
  active: number
  tabs: Array<{
    root?: string
    role?: 'explorer' | 'project'
    pinned?: boolean
    file?: string
    term?: string
    browse?: { path: string; surface: string; preview?: boolean }
    panes?: { path: string }[]
  }>
} | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

interface Harness {
  app: ElectronApplication
  page: Page
  profile: string
  home: string
  project: string
  movies: string
  nested: string
}

async function park(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setSkipTaskbar(true)
    window.setOpacity(0)
    window.unmaximize()
    window.setPosition(-4000, -4000)
    window.setSize(1440, 900)
  })
}

async function start(profile: string): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.PRISM_BROWSE_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [MAIN]), `--user-data-dir=${profile}`, '--preview', '--e2e']
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await park(app)
  return { app, page }
}

/** Only this test's Electron process tree is eligible for fallback cleanup. */
async function stop(app: ElectronApplication): Promise<void> {
  const child = app.process()
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  if (child.exitCode === null) {
    await Promise.race([
      new Promise<void>((done) => child.once('exit', () => done())),
      new Promise<void>((done) => setTimeout(done, 2000))
    ])
  }
  if (child.exitCode === null && child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch {
      /* exited meanwhile */
    }
  }
  // Windows descendants can retain the dead Electron process's pipe handles.
  // Release only this harness's streams after exit so Playwright receives close.
  if (child.exitCode !== null) {
    for (const stream of child.stdio) stream?.destroy()
  }
}

async function setup(): Promise<Harness> {
  const key = randomUUID()
  const home = join(ROOT, '.e2e/browse-fixtures', key)
  const project = join(home, 'Prism Project')
  const movies = join(home, 'Movies')
  const nested = join(project, 'Nested')
  for (const folder of [project, movies, nested]) mkdirSync(folder, { recursive: true })
  writeFileSync(join(project, 'notes.txt'), 'Original notes\n')
  writeFileSync(join(project, '.hidden-note'), 'A dotfile must appear in the folder browser.\n')
  writeFileSync(join(project, 'unknown.prism-test-binary'), Buffer.from([0, 1, 2, 255]))
  writeFileSync(join(nested, 'inside.txt'), 'Nested folder\n')
  for (let i = 0; i < 90; i++)
    writeFileSync(join(project, `entry-${String(i).padStart(3, '0')}.txt`), `${i}\n`)
  writeFileSync(join(movies, 'readme.txt'), 'A different browsing location.\n')
  const profile = join(tmpdir(), `prism-browse-e2e-${key}`)
  const { app, page } = await start(profile)
  try {
    await page.evaluate((folder) => {
      localStorage.setItem('prism.onboarded', '1')
      localStorage.setItem('prism.sidebar', '1')
      localStorage.setItem('prism.tabs.confirmClose', '0')
      localStorage.setItem('prism.newtab.mode', 'folder')
      localStorage.setItem('prism.newtab.folder', folder)
      localStorage.setItem('prism.newtab.show', 'none')
    }, project)
    await page.reload()
    await expect(page.locator('[data-pinned] > [role="tab"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await park(app)
    return { app, page, profile, home, project, movies, nested }
  } catch (error) {
    await stop(app)
    throw error
  }
}

async function go(page: Page, path: string): Promise<void> {
  await page.getByRole('button', { name: 'Edit folder path', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Folder path', exact: true })
  await input.fill(path)
  await input.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Folder path', exact: true })).toHaveAttribute(
    'title',
    path
  )
  await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
}

async function returnToFolder(page: Page): Promise<void> {
  await page
    .getByTestId('browse-toolbar')
    .getByRole('button', { name: 'Back', exact: true })
    .click()
  await expect(page.getByTestId('folder-browser')).toBeVisible()
}

/** Open a real shell through a folder's Explorer context menu, leaving its Explorer at the same path. */
async function newTerminalHere(page: Page): Promise<void> {
  const path = await page
    .getByRole('navigation', { name: 'Folder path', exact: true })
    .getAttribute('title')
  expect(path).toBeTruthy()
  const tabs = ordinaryTabs(page)
  const ownerIndex = await tabs.evaluateAll((elements) =>
    elements.findIndex((el) => el.getAttribute('aria-selected') === 'true')
  )
  const count = await tabs.count()
  await go(page, dirname(path!))
  await row(page, basename(path!)).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New terminal here', exact: true }).click()
  await expect(tabs).toHaveCount(count + 1)
  await tabs.nth(ownerIndex).click()
  await go(page, path!)
  await tabs.last().click()
}

async function expectNoExplorerControls(page: Page): Promise<void> {
  await expect(page.getByRole('tab', { selected: true }).locator('..')).toHaveAttribute(
    'data-tab-role',
    'project'
  )
  await expect(page.locator('.browse-toolbar, .browse-actions, .browse-return-row')).toHaveCount(0)
  await expect(page.getByTestId('folder-browser')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Folder path', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Folder path', exact: true })).toHaveCount(0)
  for (const name of [
    'Browse files',
    'Terminal folder',
    'Use folder in terminal',
    'Return to terminal'
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
}

function row(page: Page, filename: string) {
  return page
    .getByTestId('browse-list')
    .locator('[role="option"]')
    .filter({
      has: page.locator('.browse-name-text > span:first-child', {
        hasText: new RegExp(`^${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      })
    })
}

function ordinaryTabs(page: Page) {
  return page.locator('[data-tab-role]:not([data-pinned]) > [role="tab"]')
}

async function expectEmptyProject(page: Page, root: string, childName: string): Promise<void> {
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', root)
  await expect(page.getByRole('tab', { selected: true }).locator('..')).toHaveAttribute(
    'data-tab-role',
    'project'
  )
  await expect(page.getByRole('tree')).toBeVisible()
  await expect(page.getByRole('tree')).toContainText(childName)
  await expect(page.getByRole('tree').locator('[aria-selected="true"]')).toHaveCount(0)
  await expect(page.getByText('No file selected', { exact: true })).toBeVisible()
  await expect(page.getByText('Pick one from the sidebar', { exact: true })).toBeVisible()
  await expect(page.getByTestId('folder-browser')).toHaveCount(0)
  await expectNoExplorerControls(page)
  await expect(page.locator('.xterm:visible')).toHaveCount(0)
  await expect(
    page
      .getByRole('textbox')
      .filter({ hasText: /Original notes|AppData settings fixture|Nested folder/ })
  ).toHaveCount(0)
}

async function search(page: Page, query: string): Promise<void> {
  await page
    .getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
    .fill(query)
  if (query) await expect(page.getByTestId('browse-search-status')).toContainText('Search results')
  else await expect(page.getByTestId('browse-search-status')).toHaveCount(0)
  await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
}

async function shellLine(page: Page, line: string): Promise<void> {
  const term = page.locator('.xterm:visible').last()
  await expect(term).toBeVisible()
  await term.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

async function shellReady(page: Page, folder: string): Promise<void> {
  await expect
    .poll(() => page.locator('.xterm:visible .xterm-rows').last().textContent(), {
      timeout: 25_000
    })
    .toContain(`${folder}>`)
}

async function shot(
  page: Page,
  info: TestInfo,
  name: string,
  app: ElectronApplication
): Promise<void> {
  const path = info.outputPath(name)
  if (await page.locator('aside[aria-hidden="false"]').count()) {
    await expect
      .poll(() =>
        page
          .locator('aside[aria-hidden="false"]')
          .first()
          .evaluate((el) =>
            Math.abs(
              el.getBoundingClientRect().width - Number.parseFloat((el as HTMLElement).style.width)
            )
          )
      )
      .toBeLessThan(1)
  }
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  )
  // CDP screenshots crop Electron pages at non-default zoom; the native capture covers the client area.
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(path, Buffer.from(png, 'base64'))
  await info.attach(name, { path, contentType: 'image/png' })
  mkdirSync(join(ROOT, '.e2e/shots'), { recursive: true })
  copyFileSync(path, join(ROOT, '.e2e/shots', `browse-${name}`))
}

function videoFixture(folder: string): string {
  const file = join(folder, 'sample.mp4')
  // Optional retained demo photograph improves visual review; this remains a generated test video.
  const photo = process.env.PRISM_BROWSE_DEMO_IMAGE
  const source =
    photo && existsSync(photo)
      ? ['-loop', '1', '-i', photo, '-vf', 'scale=-2:720', '-r', '24']
      : ['-f', 'lavfi', '-i', 'color=c=0x224466:s=640x360:r=24']
  execFileSync(
    join(ROOT, 'vendor/ffmpeg/ffmpeg.exe'),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...source,
      '-t',
      '6',
      '-c:v',
      'libopenh264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      file
    ],
    { windowsHide: true }
  )
  return file
}

test('folder navigation retains history state and lists dotfiles and unsupported files', async ({}, info) => {
  const h = await setup()
  const { page } = h
  try {
    await expect(row(page, '.hidden-note')).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search this folder' }).fill('unknown')
    await row(page, 'unknown.prism-test-binary').dblclick()
    await expect(page.getByRole('button', { name: 'Show the bytes', exact: true })).toBeVisible()
    await returnToFolder(page)
    await expect(page.getByRole('searchbox', { name: 'Search this folder' })).toHaveValue('unknown')

    await search(page, 'entry')
    await page.getByRole('button', { name: 'Sort by name, ascending', exact: true }).click()
    const list = page.getByTestId('browse-list')
    await list.focus()
    await page.keyboard.press('End')
    const selected = await list.locator('[aria-selected="true"]').getAttribute('data-browse-path')
    const top = await list.evaluate((el) => el.scrollTop)
    expect(top).toBeGreaterThan(1000)
    await go(page, h.movies)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: 'Search this folder' })).toHaveValue('entry')
    await expect(list.locator('[aria-selected="true"]')).toHaveAttribute(
      'data-browse-path',
      selected!
    )
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(top)
    await expect(
      page.getByRole('button', { name: 'Sort by name, descending', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Forward', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute(
      'title',
      h.movies
    )
    await page.getByRole('button', { name: 'Up', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute(
      'title',
      h.home
    )
    await row(page, 'Prism Project').dblclick()
    await expect(page.getByRole('searchbox', { name: 'Search this folder' })).toHaveValue('entry')
    await shot(page, info, 'folder-history.png', h.app)
    await search(page, '')
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Home')
    await shot(page, info, 'desktop.png', h.app)
    await h.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await expect(
      page.getByRole('button', { name: 'Edit folder path', exact: true })
    ).toBeInViewport()
    await expect(
      page.getByRole('button', { name: 'Open as project', exact: true })
    ).toBeInViewport()
    await expect(page.getByTestId('browse-list')).toBeInViewport()
    await shot(page, info, 'zoom200.png', h.app)
  } finally {
    await stop(h.app)
  }
})

test('Explorer stays pinned, new tabs browse immediately, and places and path controls work', async ({}, info) => {
  const h = await setup()
  const { page } = h
  try {
    const pinned = page.locator('[data-pinned]')
    await pinned.getByRole('tab').click()
    await expect(pinned.locator('[data-tab-close]')).toHaveCount(0)
    const before = await page.getByRole('tab').count()
    await page.keyboard.press('Control+w')
    await expect(page.getByRole('tab')).toHaveCount(before)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const pathBar = page.getByRole('navigation', { name: 'Folder path', exact: true })
    const blank = page.locator('.browse-edit-path')
    await expect(blank.locator('svg')).toHaveCount(0)
    await page.getByRole('button', { name: 'New tab', exact: true }).hover()
    const idlePathBackground = await pathBar.evaluate((el) => getComputedStyle(el).backgroundColor)
    await blank.hover({ position: { x: 3, y: 18 } })
    await expect
      .poll(() => pathBar.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(idlePathBackground)
    await expect(blank).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const hoveredPathBackground = await pathBar.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    )
    await pathBar.locator('.browse-crumb button').last().hover()
    await expect(pathBar).toHaveCSS('background-color', hoveredPathBackground)
    await pathBar.locator('.browse-crumb button').last().focus()
    await page.getByRole('button', { name: 'New tab', exact: true }).hover()
    await expect(pathBar).toHaveCSS('background-color', hoveredPathBackground)
    await blank.click({ position: { x: 3, y: 18 } })
    const editablePath = page.getByRole('textbox', { name: 'Folder path', exact: true })
    await expect(editablePath).toBeVisible()
    expect(
      await editablePath.evaluate(
        (el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length
      )
    ).toBe(true)
    await page.keyboard.press('Escape')
    const driveRoot = (await pathBar.getAttribute('title'))!.slice(0, 3)
    const ancestor = pathBar.locator('.browse-crumb button').first()
    await ancestor.click()
    await expect(page.getByRole('textbox', { name: 'Folder path', exact: true })).toHaveCount(0)
    await expect(pathBar).toHaveAttribute('title', driveRoot)

    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'explorer'
    )
    await expect(pathBar).toHaveAttribute('title', h.project)
    const openProject = page.getByRole('button', { name: 'Open as project', exact: true })
    await expect(openProject).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click()
    await expect(openProject).toBeDisabled()
    await search(page, 'Nested')
    await row(page, 'Nested').click()
    await expect(openProject).toBeEnabled()
    await page.getByRole('button', { name: 'More file actions', exact: true }).click()
    for (const name of ['Open', 'Copy', 'Rename', 'Delete']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0)
    }
    for (const name of [
      'New terminal here',
      'Open in new tab',
      'Open as project',
      'Pin to Quick access',
      'Show in File Explorer',
      'Copy path',
      'Properties'
    ]) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
    }
    await shot(page, info, 'explorer-actions-more.png', h.app)
    await h.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await shot(page, info, 'explorer-actions-more-zoom200.png', h.app)
    await h.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(1)
      return contents.getZoomFactor()
    })
    await page.keyboard.press('Escape')
    await row(page, 'Nested').click({ button: 'right' })
    for (const name of ['Open', 'Copy', 'Rename', 'Delete']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toBeVisible()
    await expect(page.getByRole('tree')).toHaveCount(0)
    await page.keyboard.press('Control+b')
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('folder-browser')).toHaveAttribute('data-places-hidden', 'true')
    await page.keyboard.press('Control+b')
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toBeVisible()

    await search(page, 'notes.txt')
    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    const locations = page.getByRole('complementary', { name: 'Locations', exact: true })
    await expect(locations).toBeVisible()
    await shot(page, info, 'explorer-viewer-places.png', h.app)
    await page.keyboard.press('Control+b')
    await expect(locations).toHaveCount(0)
    await page.keyboard.press('Control+b')
    await expect(locations).toBeVisible()
    const homePlace = locations.getByRole('button', { name: 'Home', exact: true })
    const homePath = await homePlace.getAttribute('title')
    await homePlace.click()
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(pathBar).toHaveAttribute('title', homePath!)
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(ordinaryTabs(page).first()).toHaveAttribute('title', h.project)
    await ordinaryTabs(page).first().click()
    await expect(pathBar).toHaveAttribute('title', h.project)
    await ordinaryTabs(page).last().click()

    await page.evaluate(() => localStorage.removeItem('prism.tabs.confirmClose'))
    await page.keyboard.press('Control+w')
    await expect(ordinaryTabs(page)).toHaveCount(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pinned).toHaveCount(1)
  } finally {
    await stop(h.app)
  }
})

test('full-file breadcrumbs and Back return to the containing folder without consuming editor Backspace', async ({}, info) => {
  const h = await setup()
  const { page } = h
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    const toolbar = page.getByTestId('browse-toolbar')
    const pathBar = page.getByRole('navigation', { name: 'Folder path', exact: true })
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(toolbar).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toHaveCount(0)
    await expect(toolbar.locator('.browse-file-crumb')).toHaveText('notes.txt')
    await expect(pathBar).toHaveAttribute('title', h.project)
    await expect(toolbar.getByRole('button', { name: 'Back', exact: true })).toBeEnabled()
    await toolbar.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(row(page, 'notes.txt')).toHaveAttribute('aria-selected', 'true')

    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await page.keyboard.press('Control+l')
    const editablePath = page.getByRole('textbox', { name: 'Folder path', exact: true })
    await expect(editablePath).toHaveValue(h.project)
    expect(
      await editablePath.evaluate(
        (el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length
      )
    ).toBe(true)
    await editablePath.press('Escape')
    await pathBar.locator('.browse-crumb button').last().click()
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(pathBar).toHaveAttribute('title', h.project)

    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await toolbar.getByRole('button', { name: 'Back', exact: true }).focus()
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await toolbar.getByRole('button', { name: 'Back', exact: true }).focus()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(page.getByTestId('folder-browser')).toBeVisible()

    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    const editor = page.getByRole('textbox').and(page.locator('.cm-content'))
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('Z')
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(editor).toHaveText('Original notes')
    await toolbar.getByRole('button', { name: 'Edit folder path', exact: true }).hover()
    await shot(page, info, 'full-file-breadcrumbs.png', h.app)
    await h.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await expect(toolbar.getByRole('button', { name: 'Back', exact: true })).toBeInViewport()
    await expect(toolbar.locator('.browse-file-crumb')).toBeInViewport()
    await toolbar.getByRole('button', { name: 'Edit folder path', exact: true }).hover()
    await shot(page, info, 'full-file-breadcrumbs-zoom200.png', h.app)
  } finally {
    await stop(h.app)
  }
})

test('archive Backspace leaves its internal folder before returning to the disk folder', async () => {
  const h = await setup()
  const { page } = h
  try {
    const archive = new AdmZip()
    archive.addFile('Inside/member.txt', Buffer.from('Archive member fixture\n'))
    archive.writeZip(join(h.project, 'nested.zip'))
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await search(page, 'nested.zip')
    await row(page, 'nested.zip').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    const root = page.getByRole('listbox', { name: 'Contents of nested.zip', exact: true })
    await expect(root).toBeVisible()
    await root.locator('[data-arc-row="Inside"]').dblclick()
    const inside = page.getByRole('listbox', { name: 'Contents of Inside', exact: true })
    await expect(inside).toBeVisible()
    await inside.getByRole('option').first().focus()
    await page.keyboard.press('Backspace')
    await expect(root).toBeVisible()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await page
      .getByTestId('browse-toolbar')
      .getByRole('button', { name: 'Back', exact: true })
      .focus()
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(row(page, 'nested.zip')).toHaveAttribute('aria-selected', 'true')
  } finally {
    await stop(h.app)
  }
})

test('Quick access supports empty defaults, file and folder pins, reordering and restart', async ({}, info) => {
  const h = await setup()
  let { app, page } = h
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    let quick = page.getByRole('region', { name: 'Quick access', exact: true })
    let pins = quick.locator('[data-quick-access-path]')
    await expect.poll(() => pins.count()).toBeGreaterThan(0)
    const drive = page
      .getByRole('region', { name: 'This PC', exact: true })
      .getByRole('button')
      .first()
    const drivePath = await drive.getAttribute('title')
    expect(drivePath).toMatch(/^[A-Za-z]:\\$/)
    await drive.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    const drivePin = quick.getByTitle(drivePath!, { exact: true })
    await expect(drivePin).toBeVisible()
    await expect(drivePin.locator(':scope > span')).toHaveText(drivePath!.replace(/[\\/]+$/, ''))
    await drivePin.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).click()
    await expect(drivePin).toHaveCount(0)
    while (await pins.count()) {
      await pins.first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).click()
    }
    await expect(quick).toContainText('Drag files or folders here to pin them.')
    expect(await page.evaluate(() => localStorage.getItem('prism.quickAccess'))).toBe('[]')
    await expect.poll(() => savedTabs(join(h.profile, 'tabs.json'))?.tabs.length).toBe(3)
    await stop(app)
    ;({ app, page } = await start(h.profile))
    quick = page.getByRole('region', { name: 'Quick access', exact: true })
    pins = quick.locator('[data-quick-access-path]')
    await expect(quick).toBeVisible()
    await expect(pins).toHaveCount(0)
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.project)

    await row(page, 'Nested').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await expect(pins.locator(':scope > span')).toHaveText(['Nested', 'notes.txt'])
    await search(page, '')
    await row(page, 'entry-000.txt').dragTo(
      quick.getByRole('heading', { name: 'Quick access', exact: true })
    )
    await expect(pins.locator(':scope > span')).toHaveText(['Nested', 'notes.txt', 'entry-000.txt'])
    await quick
      .getByRole('button', { name: 'entry-000.txt', exact: true })
      .dragTo(quick.getByRole('button', { name: 'Nested', exact: true }), {
        targetPosition: { x: 35, y: 4 }
      })
    await expect(pins.locator(':scope > span')).toHaveText(['entry-000.txt', 'Nested', 'notes.txt'])
    await quick.getByRole('button', { name: 'notes.txt', exact: true }).focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Move up', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(pins.locator(':scope > span')).toHaveText(['entry-000.txt', 'notes.txt', 'Nested'])
    await shot(page, info, 'quick-access-customized.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await expect(quick.getByRole('button', { name: 'notes.txt', exact: true })).toBeInViewport()
    await expect(quick.getByRole('button', { name: 'Nested', exact: true })).toBeInViewport()
    await shot(page, info, 'quick-access-customized-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(1)
      return contents.getZoomFactor()
    })

    await stop(app)
    ;({ app, page } = await start(h.profile))
    quick = page.getByRole('region', { name: 'Quick access', exact: true })
    pins = quick.locator('[data-quick-access-path]')
    await expect(pins.locator(':scope > span')).toHaveText(['entry-000.txt', 'notes.txt', 'Nested'])
    await quick.getByRole('button', { name: 'Nested', exact: true }).click()
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.nested)
    await quick.getByRole('button', { name: 'notes.txt', exact: true }).click()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toBeVisible()
    await expect(page.getByTestId('browse-toolbar').locator('.browse-file-crumb')).toHaveText(
      'notes.txt'
    )
    await page.getByRole('button', { name: 'Edit folder path', exact: true }).hover()
    await shot(page, info, 'path-bar-quick-access.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await expect(page.getByTestId('browse-toolbar').locator('.browse-file-crumb')).toBeInViewport()
    await expect(quick.getByRole('button', { name: 'notes.txt', exact: true })).toBeInViewport()
    await page.getByRole('button', { name: 'Edit folder path', exact: true }).hover()
    await shot(page, info, 'path-bar-quick-access-zoom200.png', app)
  } finally {
    await stop(app)
  }
})

test('missing file pins recover on a valid choice and late failures stay out of another tab', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    for (const name of ['notes.txt', 'entry-000.txt']) {
      await search(page, name)
      await row(page, name).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    }
    const quick = page.getByRole('region', { name: 'Quick access', exact: true })
    await quick.getByRole('button', { name: 'notes.txt', exact: true }).click()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    const missing = join(h.project, 'entry-000.txt')
    unlinkSync(missing)
    await quick.getByRole('button', { name: 'entry-000.txt', exact: true }).click()
    const errorText = 'This file cannot be opened. It may have moved or been deleted.'
    await expect(page.getByText(errorText, { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await quick.getByRole('button', { name: 'notes.txt', exact: true }).click()
    await expect(page.getByText(errorText, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toBeVisible()

    await app.evaluate(({ ipcMain }, target) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const original = handlers.get('open:within')!
      let release!: () => void
      const gate = new Promise<void>((done) => {
        release = done
      })
      const delayed = {
        started: false,
        completed: false,
        release: () => {
          release()
          ipcMain.removeHandler('open:within')
          ipcMain.handle('open:within', original)
        }
      }
      ;(globalThis as unknown as { __prismPinDelay: typeof delayed }).__prismPinDelay = delayed
      ipcMain.removeHandler('open:within')
      ipcMain.handle('open:within', async (...args: unknown[]) => {
        if (args[2] !== target) return original(...args)
        delayed.started = true
        await gate
        const result = await original(...args)
        delayed.completed = true
        return result
      })
    }, missing)
    await quick.getByRole('button', { name: 'entry-000.txt', exact: true }).click()
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __prismPinDelay: { started: boolean } }).__prismPinDelay
              .started
        )
      )
      .toBe(true)
    await ordinaryTabs(page).first().click()
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await app.evaluate(() =>
      (
        globalThis as unknown as { __prismPinDelay: { release: () => void } }
      ).__prismPinDelay.release()
    )
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __prismPinDelay: { completed: boolean } }).__prismPinDelay
              .completed
        )
      )
      .toBe(true)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText(errorText, { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.project)
    await ordinaryTabs(page).last().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText(errorText, { exact: true })).toHaveCount(0)
  } finally {
    await stop(app)
  }
})

test('context target uses distinct grey on both row stripes and restores blue selection on dismissal', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    const rows = page.locator('.browse-row')
    let menuBackground: string | undefined
    for (const striped of [false, true]) {
      const target = rows
        .locator(striped ? ':scope[data-striped]' : ':scope:not([data-striped])')
        .first()
      await page.getByRole('button', { name: 'New tab', exact: true }).hover()
      const idleBackground = await target.evaluate((el) => getComputedStyle(el).backgroundColor)
      await target.click({ button: 'right' })
      await expect(target).toHaveAttribute('data-menu', 'true')
      await expect(target).toHaveAttribute('aria-selected', 'false')
      await expect(
        page.getByRole('menuitem', { name: 'Open as project', exact: true })
      ).toBeVisible()
      const style = await target.evaluate((el) => {
        const css = getComputedStyle(el)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')!
        context.fillStyle = css.backgroundColor
        context.fillRect(0, 0, 1, 1)
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        return { background: css.backgroundColor, color: css.color, channels }
      })
      expect(style.background).not.toBe(idleBackground)
      // A neutral context target must not look like the blue selection state.
      expect(Math.max(...style.channels) - Math.min(...style.channels)).toBeLessThan(20)
      if (menuBackground) expect(style.background).toBe(menuBackground)
      menuBackground = style.background
      await expect(target).toHaveCSS('outline-style', 'solid')
      expect(
        await target.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))
      ).toBeGreaterThanOrEqual(1.5)
      await expect(target.locator('.browse-name')).toHaveCSS('color', style.color)
      await expect(target.locator('.browse-column-type')).toHaveCSS('color', style.color)
      await page.getByRole('button', { name: 'New tab', exact: true }).hover()
      await expect(target).toHaveCSS('background-color', style.background)
      await target.hover({ position: { x: 28, y: 20 } })
      await expect(target).toHaveCSS('background-color', style.background)
      await shot(page, info, `context-row-${striped ? 'striped' : 'plain'}.png`, app)
      await page.keyboard.press('Escape')
      await expect(page.locator('.browse-row[data-menu]')).toHaveCount(0)
      await page.getByRole('button', { name: 'New tab', exact: true }).hover()
      await expect(target).toHaveCSS('background-color', idleBackground)
    }
    const selected = rows.first()
    await selected.click()
    await expect(selected).toHaveAttribute('aria-selected', 'true')
    const selectedBackground = await selected.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(selectedBackground).not.toBe(menuBackground)
    await selected.click({ button: 'right' })
    await expect(selected).toHaveCSS('background-color', menuBackground!)
    await page.keyboard.press('Escape')
    await expect(selected).toHaveCSS('background-color', selectedBackground)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await rows.first().click({ button: 'right' })
    await expect(rows.first()).toHaveCSS('background-color', menuBackground!)
    await shot(page, info, 'context-row-zoom200.png', app)
    await page.keyboard.press('Escape')
    await expect(page.locator('.browse-row[data-menu]')).toHaveCount(0)
  } finally {
    await stop(app)
  }
})

test('recursive Explorer search finds AppData and opens files and folders as separate persistent projects', async ({}, info) => {
  const h = await setup()
  let { app, page } = h
  try {
    const appData = join(h.home, 'AppData', 'Local', 'Playnite')
    mkdirSync(appData, { recursive: true })
    const settings = join(appData, 'Playnite-settings.txt')
    writeFileSync(settings, 'AppData settings fixture\n')
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await go(page, h.home)
    await search(page, 'Playnite')
    await expect(row(page, 'Playnite')).toBeVisible()
    await expect(row(page, 'Playnite-settings.txt')).toBeVisible()
    await expect(row(page, 'Playnite-settings.txt').locator('.browse-result-location')).toHaveText(
      appData
    )
    await expect(page.getByTestId('browse-search-status')).toContainText(
      'This folder and subfolders'
    )
    await shot(page, info, 'recursive-appdata-search.png', app)

    const explorer = ordinaryTabs(page).nth(1)
    await row(page, 'Playnite-settings.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(3)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'project'
    )
    await expect(ordinaryTabs(page).last()).toHaveAttribute('title', appData)
    await expect(
      page.getByRole('textbox').filter({ hasText: 'AppData settings fixture' })
    ).toBeVisible()
    await expect(page.getByRole('tree')).toBeVisible()
    // The Explorer remains where the result was found, independent of the new project root.
    await explorer.click()
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.home)
    // Explicit folder promotion stays empty even if ordinary new projects prefer a file or shell.
    for (const [preference, folder, root, child] of [
      ['file', 'Prism Project', h.project, 'notes.txt'],
      ['terminal', 'Nested', h.nested, 'inside.txt']
    ]) {
      await explorer.click()
      await page.evaluate((value) => localStorage.setItem('prism.newtab.show', value), preference)
      await search(page, folder)
      await row(page, folder).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
      await expectEmptyProject(page, root, child)
    }
    await shot(page, info, 'empty-project-workspace.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await expectEmptyProject(page, h.nested, 'inside.txt')
    await shot(page, info, 'empty-project-workspace-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(1)
      return contents.getZoomFactor()
    })

    const saved = join(h.profile, 'tabs.json')
    await expect.poll(() => savedTabs(saved)?.tabs.filter((tab) => tab.pinned).length).toBe(1)
    await expect
      .poll(() =>
        savedTabs(saved)?.tabs.some(
          (tab) => tab.role === 'explorer' && !tab.pinned && tab.browse?.path === h.home
        )
      )
      .toBe(true)
    await expect
      .poll(() =>
        savedTabs(saved)?.tabs.some((tab) => tab.role === 'project' && tab.root === appData)
      )
      .toBe(true)
    const count = await page.getByRole('tab').count()
    await expect.poll(() => savedTabs(saved)?.tabs.length).toBe(count)
    await expect
      .poll(() => {
        const tabs = savedTabs(saved)?.tabs
        return [h.project, h.nested].every((root) =>
          tabs?.some(
            (tab) =>
              tab.role === 'project' &&
              tab.root === root &&
              !tab.file &&
              !tab.term &&
              tab.browse?.surface === 'viewer'
          )
        )
      })
      .toBe(true)
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(page.getByRole('tab')).toHaveCount(count)
    await expect(page.locator('[data-pinned]')).toHaveCount(1)
    await expectEmptyProject(page, h.nested, 'inside.txt')
    await ordinaryTabs(page).nth(3).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    await ordinaryTabs(page).nth(2).click()
    await expect(
      page.getByRole('textbox').filter({ hasText: 'AppData settings fixture' })
    ).toBeVisible()
    const restoredExplorer = page
      .locator('[data-tab-role="explorer"]:not([data-pinned]) > [role="tab"]')
      .nth(1)
    await restoredExplorer.click()
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.home)
    await expect(
      page.getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
    ).toHaveValue('Nested')
    await search(page, 'Prism Project')
    await expect(row(page, 'Prism Project')).toBeVisible()
    await shot(page, info, 'explorer-projects.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await expect(
      page.getByRole('button', { name: 'Edit folder path', exact: true })
    ).toBeInViewport()
    await expect(
      page.getByRole('button', { name: 'Open as project', exact: true })
    ).toBeInViewport()
    await expect(
      page.getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
    ).toBeInViewport()
    await shot(page, info, 'explorer-projects-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    )
    const phone = await page.evaluate((root) => window.prism.phoneSetOn(true, root), h.project)
    const base = `http://127.0.0.1:${phone.port}`
    const paired = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: phone.code?.code, name: 'restored Explorer scope test' })
    })
    expect(paired.status).toBe(200)
    const { token } = await paired.json()
    const outsideProject = await fetch(`${base}/api/dir?path=${encodeURIComponent(h.home)}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(outsideProject.status).toBe(403)
  } finally {
    await stop(app)
  }
})

test('renaming an Explorer preview keeps the same tab and role', async () => {
  const h = await setup()
  const { page } = h
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await search(page, 'notes')
    await row(page, 'notes.txt').click()
    await page.getByRole('button', { name: 'Preview pane', exact: true }).click()
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toBeVisible()
    const count = await page.getByRole('tab').count()
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('textbox', { name: 'New name', exact: true }).fill('notes-renamed.txt')
    await page.getByRole('textbox', { name: 'New name', exact: true }).press('Enter')
    await expect.poll(() => existsSync(join(h.project, 'notes-renamed.txt'))).toBe(true)
    expect(existsSync(join(h.project, 'notes.txt'))).toBe(false)
    await expect(page.getByRole('tab')).toHaveCount(count)
    await expect(page.getByRole('tab', { selected: true }).locator('..')).toHaveAttribute(
      'data-tab-role',
      'explorer'
    )
    await expect(row(page, 'notes-renamed.txt')).toBeVisible()
    await page.getByRole('button', { name: 'Refresh folder', exact: true }).click()
    await expect(page.getByTestId('browse-search-status')).toContainText('Search results')
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await expect(row(page, 'notes-renamed.txt')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toBeVisible()
  } finally {
    await stop(h.app)
  }
})

test('cancel search reaches the matching request and a fresh query can run afterward', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    // Hold one request at the IPC boundary so Cancel remains actionable on fast disks.
    // The real traversal and cancellation ownership are verified by browseSearch unit tests.
    await app.evaluate(({ ipcMain }) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const original = handlers.get('browse:search')!
      ipcMain.removeHandler('browse:search')
      ipcMain.handle('browse:search', (...args: unknown[]) => {
        if (args[3] !== 'held-search') return original(...args)
        const [, tabId, path, , requestId] = args
        return new Promise((resolveResult) => {
          const cancelled = (_event: unknown, owner: string, request: string): void => {
            if (owner !== tabId || request !== requestId) return
            ipcMain.removeListener('browse:search-cancel', cancelled)
            resolveResult({
              path,
              listing: { folders: [], files: [] },
              scanned: 17,
              unreadable: 0,
              skippedLinks: 0,
              truncated: false,
              cancelled: true
            })
          }
          ipcMain.on('browse:search-cancel', cancelled)
          ;(globalThis as unknown as { __prismSearchHeld: boolean }).__prismSearchHeld = true
        })
      })
    })
    await page
      .getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
      .fill('held-search')
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as unknown as { __prismSearchHeld?: boolean }).__prismSearchHeld
        )
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Cancel search', exact: true }).click()
    await expect(page.getByTestId('browse-search-status')).toContainText('Search stopped')
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('button', { name: 'Cancel search', exact: true })).toHaveCount(0)
    await search(page, 'inside.txt')
    await expect(row(page, 'inside.txt')).toBeVisible()
    await expect(row(page, 'inside.txt').locator('.browse-result-location')).toHaveText(h.nested)
  } finally {
    await stop(app)
  }
})

test('promoted projects keep Explorer controls absent in file, full terminal, split terminal and folder drops', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  try {
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(2)
    const editor = page.getByRole('textbox').and(page.locator('.cm-content'))
    await expect(editor).toHaveText('Original notes')
    await expectNoExplorerControls(page)
    await shot(page, info, 'project-file-without-explorer.png', app)
    for (const key of ['Control+l', 'Alt+ArrowUp', 'Backspace']) {
      await page.getByRole('tab', { selected: true }).focus()
      await page.keyboard.press(key)
      await expectNoExplorerControls(page)
      await expect(editor).toBeVisible()
      await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', h.project)
    }
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await shellReady(page, h.project)
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expectNoExplorerControls(page)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    await expectNoExplorerControls(page)
    await expect(page.locator('.xterm:visible')).toHaveCount(1)
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await shot(page, info, 'project-split-without-explorer.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await expectNoExplorerControls(page)
    await shot(page, info, 'project-split-without-explorer-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(1)
      return contents.getZoomFactor()
    })
    for (const key of ['Control+l', 'Alt+ArrowUp', 'Backspace']) {
      await page.getByRole('tab', { selected: true }).focus()
      await page.keyboard.press(key)
      await expectNoExplorerControls(page)
    }
    await ordinaryTabs(page).first().click()
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    const nestedRow = page
      .getByRole('treeitem')
      .filter({ has: page.getByText('Nested', { exact: true }) })
    await nestedRow.dragTo(page.getByText('No file selected', { exact: true }))
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', h.nested)
    await expectNoExplorerControls(page)
    await expect(page.getByRole('tree')).toContainText('inside.txt')
  } finally {
    await stop(app)
  }
})

test('two real shell tabs retain cwd and work while another tab browses and opens media', async ({}, info) => {
  const h = await setup()
  const { page } = h
  try {
    videoFixture(h.movies)
    const tabs = ordinaryTabs(page)
    await newTerminalHere(page)
    await expect(tabs).toHaveCount(2)
    await shellReady(page, h.project)
    const first = join(h.home, 'first-shell.txt')
    await shellLine(
      page,
      `$PrismSentinel='first'; "$PID|$($PWD.Path)|$PrismSentinel" | Set-Content -LiteralPath ${quotePS(first)}`
    )
    await expect
      .poll(() => (existsSync(first) ? readFileSync(first, 'utf8').trim() : ''))
      .toContain(`|${h.project}|first`)
    const firstState = readFileSync(first, 'utf8').trim()
    await tabs.nth(0).click()
    await go(page, h.movies)
    await newTerminalHere(page)
    await expect(tabs).toHaveCount(3)
    await shellReady(page, h.movies)
    const second = join(h.home, 'second-shell.txt')
    await shellLine(
      page,
      `$PrismSentinel='second'; "$PID|$($PWD.Path)|$PrismSentinel" | Set-Content -LiteralPath ${quotePS(second)}`
    )
    await expect
      .poll(() => (existsSync(second) ? readFileSync(second, 'utf8').trim() : ''))
      .toContain(`|${h.movies}|second`)
    const secondState = readFileSync(second, 'utf8').trim()

    // Real pwsh is busy; title glyphs deterministically exercise the Claude activity pipeline.
    const stopSignal = join(h.home, 'stop-title-fixture')
    await shellLine(
      page,
      `$Host.UI.RawUI.WindowTitle="$([char]0x2733) Claude Code"; Start-Sleep -Milliseconds 200; $until=(Get-Date).AddSeconds(90); while (!(Test-Path -LiteralPath ${quotePS(stopSignal)}) -and (Get-Date) -lt $until) { $Host.UI.RawUI.WindowTitle="$([char]0x25D0) Claude Code"; Start-Sleep -Milliseconds 200 }; $Host.UI.RawUI.WindowTitle="$([char]0x2733) Claude Code"`
    )
    await expect(tabs.nth(2).locator('..')).toHaveAttribute('data-agent-state', 'working')
    await expectNoExplorerControls(page)
    await tabs.nth(0).click()
    await go(page, h.nested)
    await expect(tabs.nth(2)).toHaveText('Movies')
    await go(page, h.movies)
    await expect(tabs.nth(2).locator('..')).toHaveAttribute('data-agent-state', 'working')
    await row(page, 'sample.mp4').dblclick()
    await expect(page.locator('video')).toHaveCount(1)
    await expect(page.locator('video')).toBeVisible()
    await expect
      .poll(() => page.locator('video').evaluate((video) => video.readyState))
      .toBeGreaterThanOrEqual(2)
    await expect(page.getByRole('tablist')).toBeVisible()
    await shot(page, info, 'full-media-viewer.png', h.app)
    await page.keyboard.press('Control+Tab')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    const firstCheck = join(h.home, 'first-shell-check.txt')
    await shellLine(
      page,
      `"$PID|$($PWD.Path)|$PrismSentinel" | Set-Content -LiteralPath ${quotePS(firstCheck)}`
    )
    await expect
      .poll(() => (existsSync(firstCheck) ? readFileSync(firstCheck, 'utf8').trim() : ''))
      .toBe(firstState)
    await page.keyboard.press('Control+Shift+Tab')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await returnToFolder(page)
    await expect(row(page, 'sample.mp4')).toHaveAttribute('aria-selected', 'true')
    await shot(page, info, 'sessions-and-browser.png', h.app)
    writeFileSync(stopSignal, 'stop')
    await tabs.nth(2).click()
    await expectNoExplorerControls(page)
    await shellReady(page, h.movies)
    const secondCheck = join(h.home, 'second-shell-check.txt')
    await shellLine(
      page,
      `"$PID|$($PWD.Path)|$PrismSentinel" | Set-Content -LiteralPath ${quotePS(secondCheck)}`
    )
    await expect
      .poll(() => (existsSync(secondCheck) ? readFileSync(secondCheck, 'utf8').trim() : ''))
      .toBe(secondState)
  } finally {
    await stop(h.app)
  }
})

test('preview uses one player and dirty text survives folder browsing and tab changes', async ({}, info) => {
  const h = await setup()
  const { page } = h
  try {
    await page.getByRole('searchbox', { name: 'Search this folder' }).fill('notes.txt')
    await row(page, 'notes.txt').dblclick()
    const editor = page.getByRole('textbox').and(page.locator('.cm-content'))
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('Unsaved browsing test')
    await expect(editor).toContainText('Unsaved browsing test')
    await returnToFolder(page)
    await go(page, h.movies)
    await newTerminalHere(page)
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await ordinaryTabs(page).first().click()
    await go(page, h.project)
    await row(page, 'notes.txt').dblclick()
    await expect(editor).toContainText('Unsaved browsing test')
    expect(readFileSync(join(h.project, 'notes.txt'), 'utf8')).toBe('Original notes\n')
    await shot(page, info, 'dirty-buffer-retained.png', h.app)
    videoFixture(h.movies)
    await returnToFolder(page)
    await go(page, h.movies)
    await row(page, 'sample.mp4').click()
    await page.getByRole('button', { name: 'Preview pane', exact: true }).click()
    await expect(page.locator('video')).toHaveCount(1)
    await expect(page.locator('video')).toBeVisible()
    const player = await page.locator('video').elementHandle()
    expect(player).toBeTruthy()
    await expect.poll(() => player!.evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2)
    await row(page, 'sample.mp4').dblclick()
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await page.getByRole('button', { name: 'Open full view', exact: true }).click()
    await expect(page.getByTestId('folder-browser')).not.toBeVisible()
    expect(
      await player!.evaluate(
        (video) => video.isConnected && video === document.querySelector('video')
      )
    ).toBe(true)
    await expect(page.locator('video')).toHaveCount(1)
    await returnToFolder(page)
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    expect(
      await player!.evaluate(
        (video) => video.isConnected && video === document.querySelector('video')
      )
    ).toBe(true)
    await shot(page, info, 'single-player-preview.png', h.app)
  } finally {
    await stop(h.app)
  }
})

test('desktop browsing leaves phone scope fixed and restores a hidden shell in its own cwd', async ({}, info) => {
  const h = await setup()
  let { app, page } = h
  try {
    await newTerminalHere(page)
    await shellReady(page, h.project)
    const phone = await page.evaluate((root) => window.prism.phoneSetOn(true, root), h.project)
    const base = `http://127.0.0.1:${phone.port}`
    expect(phone.addresses).toEqual(['127.0.0.1'])
    const paired = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: phone.code?.code, name: 'browse scope test' })
    })
    expect(paired.status).toBe(200)
    const { token } = await paired.json()
    await shellLine(page, `Set-Location -LiteralPath ${quotePS(h.nested)}`)
    await shellReady(page, h.nested)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expectNoExplorerControls(page)
    await ordinaryTabs(page).first().click()
    await go(page, h.movies)
    const outside = await fetch(`${base}/api/dir?path=${encodeURIComponent(h.movies)}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(outside.status).toBe(403)
    const inside = await fetch(`${base}/api/dir?path=${encodeURIComponent(h.project)}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(inside.status).toBe(200)
    const saved = join(h.profile, 'tabs.json')
    await expect
      .poll(() => {
        return savedTabs(saved)?.tabs.find((tab) => tab.term === 'hidden') ?? null
      })
      .toMatchObject({
        root: h.project,
        cwd: h.nested,
        browse: { path: h.project, surface: 'viewer' }
      })
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute(
      'title',
      h.movies
    )
    await ordinaryTabs(page).last().click()
    await expectNoExplorerControls(page)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await shellReady(page, h.nested)
    await shot(page, info, 'restored-terminal-cwd.png', app)
  } finally {
    await stop(app)
  }
})

test('Explorer split keeps locations and list beside one replaceable viewer across folders and restart', async ({}, info) => {
  const h = await setup()
  let { app, page } = h
  try {
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    const viewer = page.locator('[data-browse-preview="true"]')
    const editor = page.getByRole('textbox').and(page.locator('.cm-content'))
    await expect(editor).toHaveText('Original notes')
    await expect(viewer).toHaveCount(1)
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toBeVisible()
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(0)
    await search(page, 'entry-000.txt')
    await row(page, 'entry-000.txt').click()
    await expect(editor).toHaveText('0')
    await search(page, 'entry-001.txt')
    await row(page, 'entry-001.txt').dblclick()
    await expect(editor).toHaveText('1')
    await expect(viewer).toHaveCount(1)
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(0)
    await search(page, '')
    await row(page, 'Nested').click()
    await expect(editor).toHaveText('1')
    await row(page, 'Nested').dblclick()
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview pane', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(editor).toHaveText('1')
    await row(page, 'inside.txt').click()
    await expect(editor).toHaveText('Nested folder')
    await go(page, h.project)
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').dblclick()
    await expect(editor).toHaveText('Original notes')
    await search(page, '')
    const boxes = await Promise.all([
      page.getByRole('complementary', { name: 'Locations', exact: true }).boundingBox(),
      page.getByTestId('browse-list').boundingBox(),
      viewer.boundingBox()
    ])
    expect(boxes.every(Boolean)).toBe(true)
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 2)
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 2)
    await shot(page, info, 'explorer-single-split.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await expect(viewer).toBeVisible()
    await expect(page.getByTestId('browse-list')).toBeInViewport()
    await shot(page, info, 'explorer-single-split-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(1)
      return contents.getZoomFactor()
    })
    await page.getByRole('button', { name: 'Open full view', exact: true }).click()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(editor).toHaveText('Original notes')
    await returnToFolder(page)
    await expect(editor).toHaveText('Original notes')
    const saved = join(h.profile, 'tabs.json')
    await expect
      .poll(() => {
        const snapshot = savedTabs(saved)
        return snapshot ? { active: snapshot.active, tab: snapshot.tabs[1] } : null
      })
      .toMatchObject({
        active: 1,
        tab: {
          role: 'explorer',
          file: join(h.project, 'notes.txt'),
          browse: { path: h.project, surface: 'folder', preview: true }
        }
      })
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(ordinaryTabs(page)).toHaveCount(1)
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(page.locator('[data-browse-preview="true"]')).toHaveCount(1)
    await expect(page.getByRole('textbox').and(page.locator('.cm-content'))).toHaveText(
      'Original notes'
    )
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(0)
    await search(page, 'entry-000.txt')
    await row(page, 'entry-000.txt').click()
    await expect(page.getByRole('textbox').and(page.locator('.cm-content'))).toHaveText('0')
  } finally {
    await stop(app)
  }
})

test('project file split panes remain independent and persist with the project terminal', async ({}, info) => {
  const h = await setup()
  let { app, page } = h
  try {
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await page
      .getByRole('tree')
      .locator('..')
      .evaluate((el) => {
        el.scrollTop = 0
      })
    for (const name of ['entry-000.txt', 'entry-001.txt']) {
      const target = page
        .getByRole('treeitem')
        .filter({ has: page.getByText(name, { exact: true }) })
      await target.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    }
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(2)
    await expect(page.locator('[data-pane="pinned"] .cm-content')).toHaveText(['0', '1'])
    await shot(page, info, 'project-independent-splits.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(2)
      return contents.getZoomFactor()
    })
    await shot(page, info, 'project-independent-splits-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.setZoomFactor(1)
      return contents.getZoomFactor()
    })
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await shellReady(page, h.project)
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(2)
    await expectNoExplorerControls(page)
    const saved = join(h.profile, 'tabs.json')
    await expect
      .poll(() => savedTabs(saved)?.tabs[2])
      .toMatchObject({
        role: 'project',
        root: h.project,
        term: 'hidden',
        panes: [
          { path: join(h.project, 'entry-000.txt') },
          { path: join(h.project, 'entry-001.txt') }
        ]
      })
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(2)
    await expect(page.locator('[data-pane="pinned"] .cm-content')).toHaveText(['0', '1'])
    await expectNoExplorerControls(page)
  } finally {
    await stop(app)
  }
})

test('a late folder result stays with its initiating tab while another tab is browsing', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await page.keyboard.press('Control+t')
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await go(page, h.nested)
    await expect(row(page, 'inside.txt')).toBeVisible()
    await ordinaryTabs(page).first().click()
    await app.evaluate(({ ipcMain }, target) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const original = handlers.get('browse:directory')
      if (!original) throw new Error('The real browse handler was not registered')
      let release!: () => void
      const gate = new Promise<void>((done) => {
        release = done
      })
      const delayed = {
        started: false,
        release: () => {
          release()
          ipcMain.removeHandler('browse:directory')
          ipcMain.handle('browse:directory', original)
        }
      }
      ;(globalThis as unknown as { __prismBrowseDelay: typeof delayed }).__prismBrowseDelay =
        delayed
      ipcMain.removeHandler('browse:directory')
      ipcMain.handle('browse:directory', async (...args: unknown[]) => {
        if (args[2] === target) {
          delayed.started = true
          await gate
        }
        return original(...args)
      })
    }, h.movies)
    await page.getByRole('button', { name: 'Edit folder path', exact: true }).click()
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(h.movies)
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).press('Enter')
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __prismBrowseDelay: { started: boolean } })
              .__prismBrowseDelay.started
        )
      )
      .toBe(true)
    await ordinaryTabs(page).last().click()
    await expect(row(page, 'inside.txt')).toBeVisible()
    await app.evaluate(() =>
      (
        globalThis as unknown as { __prismBrowseDelay: { release: () => void } }
      ).__prismBrowseDelay.release()
    )
    await expect(ordinaryTabs(page).first()).toHaveText('Movies')
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute(
      'title',
      h.nested
    )
    await expect(row(page, 'inside.txt')).toBeVisible()
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await ordinaryTabs(page).first().click()
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute(
      'title',
      h.movies
    )
    await expect(row(page, 'readme.txt')).toBeVisible()
  } finally {
    await stop(app)
  }
})

test('Explorer section widths drag and persist with slim usable scrollbars at normal and high zoom', async ({}, info) => {
  const h = await setup()
  let { app, page } = h
  try {
    writeFileSync(
      join(h.project, 'layout.json'),
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 80 }, (_, index) => [
            `section-${String(index).padStart(3, '0')}`,
            {
              title: 'A preview that stays beside the folder list',
              description: 'Readable content '.repeat(16)
            }
          ])
        ),
        null,
        2
      )
    )
    const comic = new AdmZip()
    const picture = readFileSync(join(ROOT, 'build/icon.png'))
    for (const name of ['page1.png', 'page2.png', 'page3.png']) comic.addFile(name, picture)
    comic.writeZip(join(h.project, 'resize-comic.cbz'))
    await search(page, 'layout.json')
    await row(page, 'layout.json').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    await expect(page.locator('.cm-content')).toContainText('section-000')
    await search(page, '')
    const places = () => page.getByRole('complementary', { name: 'Locations', exact: true })
    const viewer = () => page.locator('[data-browse-preview="true"]')
    const list = () => page.getByTestId('browse-list')
    const width = async (target: ReturnType<typeof places>): Promise<number> =>
      (await target.boundingBox())?.width ?? 0
    const drag = async (name: string, delta: number): Promise<void> => {
      const separator = page.getByRole('separator', { name, exact: true })
      const box = (await separator.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(8)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
    }
    const before = { places: await width(places()), preview: await width(viewer()) }
    await drag('Resize Quick access', 70)
    await expect.poll(() => width(places())).toBeGreaterThan(before.places + 60)
    await drag('Resize Explorer preview', -80)
    await expect.poll(() => width(viewer())).toBeGreaterThan(before.preview + 70)
    const afterDrag = { places: await width(places()), preview: await width(viewer()) }
    const quickSeparator = page.getByRole('separator', { name: 'Resize Quick access', exact: true })
    await quickSeparator.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => width(places())).toBeLessThan(afterDrag.places - 10)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => width(places())).toBeCloseTo(afterDrag.places, 0)
    const previewSeparator = page.getByRole('separator', {
      name: 'Resize Explorer preview',
      exact: true
    })
    await previewSeparator.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => width(viewer())).toBeGreaterThan(afterDrag.preview + 10)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => width(viewer())).toBeCloseTo(afterDrag.preview, 0)

    for (const scroller of [list(), page.locator('.cm-scroller')]) {
      const scrollStyle = await scroller.evaluate((element) => {
        const el = element as HTMLElement
        const bar = getComputedStyle(el, '::-webkit-scrollbar')
        const button = getComputedStyle(el, '::-webkit-scrollbar-button')
        return {
          width: parseFloat(bar.width),
          height: parseFloat(bar.height),
          button: button.display,
          gutter: el.offsetWidth - el.clientWidth,
          overflows: el.scrollHeight > el.clientHeight
        }
      })
      expect(scrollStyle.width).toBeLessThanOrEqual(8)
      expect(scrollStyle.height).toBeLessThanOrEqual(8)
      expect(scrollStyle.button).toBe('none')
      expect(scrollStyle.gutter).toBeLessThanOrEqual(8)
      expect(scrollStyle.overflows).toBe(true)
      await scroller.hover()
      await page.mouse.wheel(0, 360)
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await scroller.evaluate((el) => {
        el.scrollTop = 0
      })
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0)
      // Both slim thumbs remain draggable beside the wider resize hit targets.
      const box = (await scroller.boundingBox())!
      await page.mouse.move(box.x + box.width - 3, box.y + 8)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 3, box.y + 80, { steps: 8 })
      await page.mouse.up()
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await scroller.evaluate((el) => {
        el.scrollTop = 0
      })
    }
    await shot(page, info, 'explorer-resizable-sections.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await expect(list()).toBeInViewport()
    await expect(viewer()).toBeInViewport()
    const zoomBoxes = await Promise.all([
      places().boundingBox(),
      list().boundingBox(),
      viewer().boundingBox()
    ])
    expect(zoomBoxes[0]!.x + zoomBoxes[0]!.width).toBeLessThanOrEqual(zoomBoxes[1]!.x + 2)
    expect(zoomBoxes[1]!.x + zoomBoxes[1]!.width).toBeLessThanOrEqual(zoomBoxes[2]!.x + 2)
    expect(zoomBoxes[1]!.width).toBeGreaterThan(100)
    await shot(page, info, 'explorer-resizable-sections-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    )
    await expect.poll(() => width(places())).toBeCloseTo(afterDrag.places, 0)
    await expect.poll(() => width(viewer())).toBeCloseTo(afterDrag.preview, 0)

    // The same locations width applies while a file occupies the full main area.
    await page.getByRole('button', { name: 'Open full view', exact: true }).click()
    await expect.poll(() => width(places())).toBeCloseTo(afterDrag.places, 0)
    await expect(
      page.getByRole('separator', { name: 'Resize Quick access', exact: true })
    ).toBeVisible()
    await returnToFolder(page)
    await expect.poll(() => width(viewer())).toBeCloseTo(afterDrag.preview, 0)
    await expect
      .poll(() => savedTabs(join(h.profile, 'tabs.json'))?.tabs[1]?.browse?.preview)
      .toBe(true)
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(viewer()).toBeVisible()
    await expect.poll(() => width(places())).toBeCloseTo(afterDrag.places, 0)
    await expect.poll(() => width(viewer())).toBeCloseTo(afterDrag.preview, 0)
    await expect(page.locator('.cm-content')).toContainText('section-000')
    await search(page, 'resize-comic.cbz')
    await row(page, 'resize-comic.cbz').click()
    const comicPage = viewer().getByRole('img', { name: 'page1.png', exact: true })
    await expect(comicPage).toBeVisible()
    // Comic capture listeners must let a focused resize handle own its arrows.
    for (const name of ['Resize Quick access', 'Resize Explorer preview']) {
      const separator = page.getByRole('separator', { name, exact: true })
      const beforeKey = await separator.getAttribute('aria-valuenow')
      await separator.focus()
      await page.keyboard.press('ArrowRight')
      await expect(separator).not.toHaveAttribute('aria-valuenow', beforeKey!)
      await expect(comicPage).toBeVisible()
    }
  } finally {
    await stop(app)
  }
})
