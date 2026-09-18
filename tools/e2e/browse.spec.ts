/* eslint-disable no-empty-pattern -- Playwright requires a destructured fixture argument, including tests without browser fixtures. */
import { test, expect, type TestInfo } from '@playwright/test'
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Page } from 'playwright-core'
import { execFile, execFileSync } from 'node:child_process'
import { createServer, type Socket } from 'node:net'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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

async function start(profile: string, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.PRISM_BROWSE_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [MAIN]), `--user-data-dir=${profile}`, '--preview', '--e2e', ...extraArgs]
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
    await newExplorerWithoutPreview(page)
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await park(app)
    return { app, page, profile, home, project, movies, nested }
  } catch (error) {
    await stop(app)
    throw error
  }
}

/** Legacy scenarios opt out explicitly; the default-preview scenario exercises untouched tabs. */
async function newExplorerWithoutPreview(page: Page): Promise<void> {
  const before = await ordinaryTabs(page).count()
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(ordinaryTabs(page)).toHaveCount(before + 1)
  await expect(ordinaryTabs(page).last()).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
  const preview = page.getByRole('button', { name: 'Preview pane', exact: true })
  if ((await preview.getAttribute('aria-pressed')) === 'true') await preview.click()
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

async function expectOpenInAppsMenu(page: Page): Promise<void> {
  const openIn = page
    .getByRole('menuitem')
    .filter({ has: page.getByText('Open in', { exact: true }) })
  await expect(openIn.locator('[data-file-menu-icon="open-with"]')).toBeVisible()
  await openIn.hover()
  await expect(page.getByRole('menuitem', { name: 'Default app', exact: true })).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Choose another app…', exact: true })
  ).toBeVisible()
}

async function waitForIndexedFixture(path: string): Promise<void> {
  const es = join(process.env.USERPROFILE ?? '', '.local', 'bin', 'es.exe')
  if (!existsSync(es)) return
  // Indexed search observes fixtures after Everything consumes their filesystem
  // events. When the service is unavailable the scenarios exercise the walk.
  await expect.poll(() => {
    try {
      const output = execFileSync(es, ['-json', '-n', '10', '-path', `"${dirname(path)}"`, '-search*', `"${basename(path)}"`], { windowsHide: true, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 2000 })
      return (JSON.parse(output || '[]') as { filename: string }[]).some((row) => resolve(row.filename).toLowerCase() === resolve(path).toLowerCase())
    } catch { return true }
  }).toBe(true)
}

async function search(page: Page, query: string): Promise<void> {
  const directory = await page.getByRole('navigation', { name: 'Folder path', exact: true }).getAttribute('title')
  if (query && directory && existsSync(join(directory, query)))
    await waitForIndexedFixture(join(directory, query))
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

test('Explorer displays all file types independently of viewer support', async () => {
  const h = await setup()
  try {
    const folder = join(h.home, 'All file types')
    mkdirSync(folder)
    const names = ['library.dll', 'driver.sys', 'program.exe', 'data.bin', 'unknown.xyz123', 'no-extension', '.hidden', 'desktop.ini']
    for (const name of names) writeFileSync(join(folder, name), Buffer.from([0, 1, 2, 255]))
    await go(h.page, folder)
    for (const name of names) await expect(row(h.page, name)).toBeVisible()
    await expect(h.page.getByTestId('browse-list').getByRole('option')).toHaveCount(names.length)
    await search(h.page, 'ext:dll')
    await expect(row(h.page, 'library.dll')).toBeVisible()
    await row(h.page, 'library.dll').dblclick()
    await expect(h.page.getByRole('button', { name: 'Show the bytes', exact: true })).toBeVisible()
  } finally {
    await stop(h.app)
  }
})

test('returning Up shows visited folder rows while a slow refresh discovers new files', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await row(page, 'Nested').dblclick()
    await expect(row(page, 'inside.txt')).toBeVisible()
    writeFileSync(join(h.project, '.new-while-away.dll'), 'new file')
    await app.evaluate(({ ipcMain }, target) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browse:directory')!
      let release!: () => void
      const gate = new Promise<void>((done) => { release = done })
      const delayed = { calls: 0, fail: false, release }
      Object.assign(globalThis, { folderRefreshDelay: delayed })
      ipcMain.removeHandler('browse:directory')
      ipcMain.handle('browse:directory', async (...args: unknown[]) => {
        if (args[2] === target) {
          delayed.calls++
          await gate
          if (delayed.fail) return null
        }
        return original(...args)
      })
    }, h.project)
    await page.getByRole('button', { name: 'Up', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute('title', h.project)
    await expect(row(page, 'Nested')).toBeVisible()
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByText('Loading folder…', { exact: true })).toHaveCount(0)
    await expect(row(page, '.new-while-away.dll')).toHaveCount(0)
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { folderRefreshDelay: { calls: number } }).folderRefreshDelay.calls
    )).toBe(1)
    await app.evaluate(() =>
      (globalThis as unknown as { folderRefreshDelay: { release: () => void } }).folderRefreshDelay.release()
    )
    await expect(row(page, '.new-while-away.dll')).toBeVisible()
    expect(await app.evaluate(() =>
      (globalThis as unknown as { folderRefreshDelay: { calls: number } }).folderRefreshDelay.calls
    )).toBe(1)
    await row(page, 'Nested').dblclick()
    await expect(row(page, 'inside.txt')).toBeVisible()
    await app.evaluate(() => {
      (globalThis as unknown as { folderRefreshDelay: { fail: boolean } }).folderRefreshDelay.fail = true
    })
    await page.getByRole('button', { name: 'Up', exact: true }).click()
    await expect(page.getByText('This folder cannot be opened. Check the path or choose another location.', { exact: true })).toBeVisible()
    await expect(row(page, 'Nested')).toHaveCount(0)
  } finally {
    await stop(app)
  }
})

test('a new refresh sees filesystem changes without waiting for an older folder response', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await app.evaluate(({ ipcMain }, target) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browse:directory')!
      let release!: () => void
      const gate = new Promise<void>((done) => { release = done })
      const delayed = { calls: 0, captured: false, release }
      Object.assign(globalThis, { oldFolderResponse: delayed })
      ipcMain.removeHandler('browse:directory')
      ipcMain.handle('browse:directory', async (...args: unknown[]) => {
        const hold = args[2] === target && ++delayed.calls === 1
        const result = await original(...args)
        if (hold) {
          delayed.captured = true
          await gate
        }
        return result
      })
    }, h.project)
    await page.getByRole('button', { name: 'Refresh folder', exact: true }).click()
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { oldFolderResponse: { captured: boolean } }).oldFolderResponse.captured
    )).toBe(true)
    writeFileSync(join(h.project, '.created-during-read.dll'), 'new file')
    await page.getByRole('button', { name: 'Refresh folder', exact: true }).click()
    await expect(row(page, '.created-during-read.dll')).toBeVisible()
    await app.evaluate(() =>
      (globalThis as unknown as { oldFolderResponse: { release: () => void } }).oldFolderResponse.release()
    )
    await expect(row(page, '.created-during-read.dll')).toBeVisible()
  } finally {
    await stop(app)
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

    await newExplorerWithoutPreview(page)
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
      await expect(
        page.getByRole('menuitem').filter({ has: page.getByText(name, { exact: true }) })
      ).toBeVisible()
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
    await newExplorerWithoutPreview(page)
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
    await newExplorerWithoutPreview(page)
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
    await newExplorerWithoutPreview(page)
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
    await expect(quick).toContainText('Right-click a file or folder to pin it here.')
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
    await row(page, 'entry-000.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
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

test('Places context menus open folder pins, file pins and drives in separate Explorer and project tabs', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    const source = ordinaryTabs(page).first()
    await row(page, 'Nested').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await search(page, '')
    const quick = page.getByRole('region', { name: 'Quick access', exact: true })
    const folderPin = quick.getByRole('button', { name: 'Nested', exact: true })
    await folderPin.click({ button: 'right' })
    for (const [name, icon] of [
      ['Open in new tab', 'new-tab'],
      ['Open as project', 'project']
    ]) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeEnabled()
      await expect(
        page.getByRole('menuitem', { name, exact: true }).locator(`[data-file-menu-icon="${icon}"]`)
      ).toBeVisible()
    }
    await shot(page, info, 'places-folder-menu.png', app)
    await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'explorer'
    )
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.nested)
    await expect(row(page, 'inside.txt')).toBeVisible()
    await source.click()
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.project)
    await folderPin.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(3)
    await expectEmptyProject(page, h.nested, 'inside.txt')

    await source.click()
    const filePin = quick.getByRole('button', { name: 'notes.txt', exact: true })
    await filePin.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(4)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'explorer'
    )
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toHaveText(
      'Original notes'
    )
    await source.click()
    await filePin.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(5)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'project'
    )
    await expect(ordinaryTabs(page).last()).toHaveAttribute('title', h.project)
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toHaveText(
      'Original notes'
    )
    await expectNoExplorerControls(page)

    await source.click()
    const drivePath = h.project.slice(0, 3)
    const drive = page
      .getByRole('region', { name: 'This PC', exact: true })
      .getByTitle(drivePath, { exact: true })
    await drive.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(6)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'explorer'
    )
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', drivePath)
    await source.click()
    await drive.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(7)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'project'
    )
    await expect(ordinaryTabs(page).last()).toHaveAttribute('title', drivePath)
    await expect(page.getByText('No file selected', { exact: true })).toBeVisible()
    await expectNoExplorerControls(page)
  } finally {
    await stop(app)
  }
})

test('project folder context menus create Explorer and project tabs without changing their source project', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    const source = ordinaryTabs(page).nth(1)
    await projectRow(page, 'notes.txt').click({ button: 'right' })
    await expectOpenInAppsMenu(page)
    await page.keyboard.press('Escape')
    await projectRow(page, 'Nested').click({ button: 'right' })
    for (const [name, icon] of [
      ['Open in new tab', 'new-tab'],
      ['Open as project', 'project']
    ]) {
      await expect(
        page.getByRole('menuitem', { name, exact: true }).locator(`[data-file-menu-icon="${icon}"]`)
      ).toBeVisible()
    }
    await shot(page, info, 'project-folder-menu.png', app)
    await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(3)
    await expect(ordinaryTabs(page).last().locator('..')).toHaveAttribute(
      'data-tab-role',
      'explorer'
    )
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.nested)
    await expect(row(page, 'inside.txt')).toBeVisible()
    await source.click()
    await expect(source).toHaveAttribute('title', h.project)
    await expect(page.getByText('No file selected', { exact: true })).toBeVisible()
    await expectNoExplorerControls(page)
    await projectRow(page, 'Nested').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(4)
    await expectEmptyProject(page, h.nested, 'inside.txt')
    await source.click()
    await expect(source).toHaveAttribute('title', h.project)
    await expect(page.getByText('No file selected', { exact: true })).toBeVisible()
    await expectNoExplorerControls(page)
    const projectSearch = page.getByRole('textbox', { name: 'Search files', exact: true })
    await projectSearch.fill('Nested')
    const result = page
      .getByRole('listbox', { name: 'Search results', exact: true })
      .getByRole('option')
      .filter({ has: page.getByText('Nested', { exact: true }) })
    await result.click({ button: 'right' })
    await page
      .getByRole('menuitem')
      .filter({ has: page.getByText('Open', { exact: true }) })
      .click()
    await expect(projectSearch).toHaveValue('')
    await expect(projectRow(page, 'inside.txt')).toBeVisible()
    await expect(ordinaryTabs(page)).toHaveCount(4)
    await expect(source).toHaveAttribute('aria-selected', 'true')
  } finally {
    await stop(app)
  }
})

test('Explorer context menu icons and Cut Paste work for folder and search-result file destinations at high zoom', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  const restoreClipboard = await keepClipboard(app)
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('No file clipboard fixture'))
    await row(page, 'Nested').click({ button: 'right' })
    const action = (name: string) =>
      page.getByRole('menuitem').filter({ has: page.getByText(name, { exact: true }) })
    for (const [name, icon] of [
      ['Open', 'open'],
      ['Open in new tab', 'new-tab'],
      ['Open as project', 'project'],
      ['Copy', 'copy'],
      ['Cut', 'cut'],
      ['Paste', 'paste'],
      ['Rename', 'rename'],
      ['Delete', 'delete'],
      ['Copy path', 'path'],
      ['Properties', 'properties']
    ]) {
      await expect(action(name).locator(`[data-file-menu-icon="${icon}"]`)).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await expectOpenInAppsMenu(page)
    await action('Cut').click()
    await clipboardFile(join(h.project, 'notes.txt'))
    await search(page, '')
    await row(page, 'Nested').click({ button: 'right' })
    await action('Paste').click()
    await expect.poll(() => existsSync(join(h.nested, 'notes.txt'))).toBe(true)
    expect(existsSync(join(h.project, 'notes.txt'))).toBe(false)

    await go(page, h.movies)
    await row(page, 'readme.txt').click({ button: 'right' })
    await action('Copy').click()
    await clipboardFile(join(h.movies, 'readme.txt'))
    await go(page, h.project)
    await search(page, 'inside.txt')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await row(page, 'inside.txt').click({ button: 'right' })
    await action('Paste').scrollIntoViewIfNeeded()
    await expect(action('Paste')).toBeInViewport()
    await action('Properties').scrollIntoViewIfNeeded()
    await expect(action('Properties')).toBeInViewport()
    const menuBounds = await page.getByRole('menu').first().boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(menuBounds!.y).toBeGreaterThanOrEqual(0)
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(viewport.height + 1)
    await shot(page, info, 'explorer-file-menu-zoom200.png', app)
    await action('Paste').click()
    await expect.poll(() => existsSync(join(h.nested, 'readme.txt'))).toBe(true)
    expect(existsSync(join(h.project, 'readme.txt'))).toBe(false)
    expect(readFileSync(join(h.movies, 'readme.txt'), 'utf8')).toBe(
      'A different browsing location.\n'
    )
  } finally {
    await restoreClipboard()
    await stop(app)
  }
})

test('an open app flyout stays attached when delayed Paste and a longer same-count app choice arrive', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    await expect.poll(() => savedTabs(join(h.profile, 'tabs.json'))?.tabs.length).toBe(2)
    await page.evaluate(() => localStorage.setItem('prism.tree.side', 'right'))
    await page.reload()
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    await app.evaluate(({ ipcMain }) => {
      let paste!: () => void
      let apps!: () => void
      const pasteGate = new Promise<void>((resolve) => {
        paste = resolve
      })
      const appsGate = new Promise<void>((resolve) => {
        apps = resolve
      })
      const gates = { paste, apps, pasteStarted: false, appsStarted: false }
      ;(globalThis as unknown as { __prismMenuGates: typeof gates }).__prismMenuGates = gates
      ipcMain.removeHandler('clipboard:has-files')
      ipcMain.handle('clipboard:has-files', async () => {
        gates.pasteStarted = true
        await pasteGate
        return true
      })
      ipcMain.removeHandler('apps:for')
      ipcMain.handle('apps:for', async () => {
        gates.appsStarted = true
        await appsGate
        return [
          {
            id: 'fixture-only-never-launched',
            name: 'A deliberately long registered application name that widens the existing three-row flyout'
          }
        ]
      })
    })
    await projectRow(page, 'notes.txt').click({ button: 'right' })
    await expect
      .poll(() =>
        app.evaluate(() => {
          const gate = (
            globalThis as unknown as {
              __prismMenuGates: { pasteStarted: boolean; appsStarted: boolean }
            }
          ).__prismMenuGates
          return gate.pasteStarted && gate.appsStarted
        })
      )
      .toBe(true)
    await expectOpenInAppsMenu(page)
    const parent = page
      .getByRole('menuitem')
      .filter({ has: page.getByText('Open in', { exact: true }) })
    const flyout = page
      .getByRole('menu')
      .filter({ has: page.getByRole('menuitem', { name: 'Default app', exact: true }) })
    await expect(flyout.getByRole('menuitem')).toHaveCount(3)
    await expect(
      page.getByRole('menuitem', { name: 'Looking for apps…', exact: true })
    ).toBeVisible()
    const before = await flyout.boundingBox()
    const main = page.getByRole('menu').filter({ has: parent })
    const mainBefore = await main.boundingBox()
    await app.evaluate(() =>
      (
        globalThis as unknown as { __prismMenuGates: { paste: () => void } }
      ).__prismMenuGates.paste()
    )
    await expect(
      page.getByRole('menuitem').filter({ has: page.getByText('Paste', { exact: true }) })
    ).toBeVisible()
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem', { name: 'Default app', exact: true })).toBeVisible()
    await expect.poll(async () => (await main.boundingBox())!.y).toBeLessThan(mainBefore!.y)
    await app.evaluate(() =>
      (globalThis as unknown as { __prismMenuGates: { apps: () => void } }).__prismMenuGates.apps()
    )
    await expect(flyout.getByRole('menuitem')).toHaveCount(3)
    await expect(
      page.getByRole('menuitem', { name: /^A deliberately long registered application/ })
    ).toBeVisible()
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect
      .poll(async () => (await flyout.boundingBox())!.width)
      .toBeGreaterThan(before!.width)
    const after = await flyout.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(after!.x).toBeGreaterThanOrEqual(7)
    expect(after!.y).toBeGreaterThanOrEqual(7)
    expect(after!.x + after!.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(after!.y + after!.height).toBeLessThanOrEqual(viewport.height - 7)
    const parentBox = await parent.boundingBox()
    const firstItem = await flyout.getByRole('menuitem').first().boundingBox()
    expect(Math.abs(firstItem!.y - parentBox!.y - 1)).toBeLessThanOrEqual(1)
    await shot(page, info, 'project-delayed-app-flyout.png', app)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.getByText('No file selected', { exact: true })).toBeVisible()
  } finally {
    await stop(app)
  }
})

test('recursive folder sizes sort by totals, refresh nested changes and agree with Explorer and project Properties', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  const large = join(h.movies, 'Large folder')
  try {
    for (const path of [
      join(large, 'Nested', 'Deep'),
      join(large, 'Empty within'),
      join(h.movies, 'Empty folder'),
      join(h.movies, 'Small folder')
    ])
      mkdirSync(path, { recursive: true })
    writeFileSync(join(large, 'direct.bin'), Buffer.alloc(1024))
    writeFileSync(join(large, 'Nested', 'deeper.bin'), Buffer.alloc(2048))
    writeFileSync(join(large, 'Nested', 'Deep', 'third.bin'), Buffer.alloc(4096))
    writeFileSync(join(h.movies, 'Small folder', 'tiny.txt'), 'abc')
    await go(page, h.movies)
    const size = (name: string) => row(page, name).locator('.browse-column-size')
    await expect(size('Large folder')).toHaveText('7.0 KB')
    await expect(size('Small folder')).toHaveText('3 B')
    await expect(size('Empty folder')).toHaveText('0 B')
    const names = page.getByTestId('browse-list').locator('.browse-name-text > span:first-child')
    await page.getByRole('button', { name: /^Sort by size/ }).click()
    await expect(names).toHaveText(['Empty folder', 'Small folder', 'Large folder', 'readme.txt'])
    await page.getByRole('button', { name: /^Sort by size/ }).click()
    await expect(names).toHaveText(['Large folder', 'Small folder', 'Empty folder', 'readme.txt'])
    const property = (name: string) =>
      page
        .getByRole('dialog')
        .locator('dl > div')
        .filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}$`) }) })
        .locator('dd')
    await row(page, 'Large folder').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Properties', exact: true }).click()
    await expect(property('Size')).toHaveText(`7.0 KB (${(7168).toLocaleString()} bytes)`)
    await expect(property('Contents')).toHaveText('3 files, 3 folders (including subfolders)')
    await expect(property('Coverage')).toHaveText('Includes files in all subfolders')
    await shot(page, info, 'explorer-recursive-folder-properties.png', app)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    writeFileSync(join(large, 'Nested', 'Deep', 'third.bin'), Buffer.alloc(8192))
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('F5')
    await expect(size('Large folder')).toHaveText('11.0 KB')
    await shot(page, info, 'explorer-recursive-folder-sizes.png', app)
    await go(page, h.home)
    await row(page, 'Movies').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.movies, 'readme.txt')
    await projectRow(page, 'Large folder').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Properties', exact: true }).click()
    await expect(property('Size')).toHaveText(`11.0 KB (${(11264).toLocaleString()} bytes)`)
    await expect(property('Contents')).toHaveText('3 files, 3 folders (including subfolders)')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await projectRow(page, 'Empty folder').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Properties', exact: true }).click()
    await expect(property('Size')).toHaveText('0 B (0 bytes)')
    await expect(property('Contents')).toHaveText('0 files, 0 folders (including subfolders)')
  } finally {
    await stop(app)
  }
})

test('folder size scans show pending and partial totals, cancel on navigation and ignore late results', async () => {
  const h = await setup()
  const { app, page } = h
  const held = join(h.movies, 'Held folder')
  const unavailable = join(h.movies, 'Unavailable folder')
  try {
    mkdirSync(held)
    mkdirSync(unavailable)
    await app.evaluate(
      ({ ipcMain }, paths) => {
        type Handler = (...args: unknown[]) => unknown
        const original = (
          ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
        )._invokeHandlers.get('folder:size')!
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        const state = { ids: [] as string[], cancelled: [] as string[], release, completed: 0 }
        ;(globalThis as unknown as { __prismSizeGate: typeof state }).__prismSizeGate = state
        ipcMain.on('folder:size-cancel', (_event, id: string) => state.cancelled.push(id))
        ipcMain.removeHandler('folder:size')
        ipcMain.handle('folder:size', async (...args: unknown[]) => {
          if (args[1] === paths.unavailable) return null
          if (args[1] !== paths.held) return original(...args)
          state.ids.push(args[2] as string)
          await gate
          state.completed++
          return {
            bytes: 1024,
            files: 2,
            folders: 1,
            unreadable: 1,
            skippedLinks: 1,
            truncated: true
          }
        })
      },
      { held, unavailable }
    )
    await go(page, h.movies)
    await expect(row(page, 'Held folder').locator('.browse-column-size')).toHaveText('Calculating…')
    await expect(row(page, 'Unavailable folder').locator('.browse-column-size')).toHaveText(
      'Unavailable'
    )
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __prismSizeGate: { ids: string[] } }).__prismSizeGate.ids
              .length
        )
      )
      .toBeGreaterThan(0)
    await go(page, h.nested)
    await expect
      .poll(() =>
        app.evaluate(() => {
          const gate = (
            globalThis as unknown as { __prismSizeGate: { ids: string[]; cancelled: string[] } }
          ).__prismSizeGate
          return gate.ids.every((id) => gate.cancelled.includes(id))
        })
      )
      .toBe(true)
    await app.evaluate(() =>
      (
        globalThis as unknown as { __prismSizeGate: { release: () => void } }
      ).__prismSizeGate.release()
    )
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __prismSizeGate: { completed: number } }).__prismSizeGate
              .completed
        )
      )
      .toBeGreaterThan(0)
    await expect(row(page, 'inside.txt')).toBeVisible()
    await expect(page.getByTestId('browse-list')).not.toContainText('≥')
    await go(page, h.movies)
    await expect(row(page, 'Held folder').locator('.browse-column-size')).toHaveText('≥ 1.0 KB')
    await expect(row(page, 'Held folder').locator('.browse-column-size')).toHaveAttribute(
      'title',
      'Partial total: 1 unreadable items; 1 links skipped; Scan limit reached'
    )
    await row(page, 'Held folder').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Properties', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText(
      `≥ 1.0 KB (at least ${(1024).toLocaleString()} bytes)`
    )
    await expect(page.getByRole('dialog')).toContainText(
      'Partial total: 1 unreadable items; 1 links skipped; Scan limit reached'
    )
  } finally {
    await stop(app)
  }
})

test('image viewer context actions and save formats have shared icons in Explorer and a high-zoom project', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    for (const name of ['picture-one.png', 'picture-two.png'])
      copyFileSync(join(ROOT, 'build/icon.png'), join(h.movies, name))
    await go(page, h.movies)
    await row(page, 'picture-one.png').dblclick()
    const picture = page.getByRole('img', { name: 'picture-one.png', exact: true })
    const verifyMenu = async () => {
      await expect(picture).toBeVisible()
      await expect
        .poll(() =>
          picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
        )
        .toBe(true)
      await picture.click({ button: 'right' })
      for (const [name, icon] of [
        ['Rotate', 'rotate'],
        ['Copy image', 'copy'],
        ['Save a copy', 'save'],
        ['Slideshow', 'slideshow'],
        ['Show in File Explorer', 'folder'],
        ['Copy path', 'path']
      ]) {
        await expect(
          page
            .getByRole('menuitem', { name, exact: true })
            .locator(`[data-file-menu-icon="${icon}"]`)
        ).toBeVisible()
      }
      await page.getByRole('menuitem', { name: 'Save a copy', exact: true }).hover()
      for (const name of ['PNG', 'JPEG'])
        await expect(
          page.getByRole('menuitem', { name, exact: true }).locator('[data-file-menu-icon="image"]')
        ).toBeVisible()
    }
    await verifyMenu()
    await shot(page, info, 'image-context-icons.png', app)
    await page.keyboard.press('Escape')
    await returnToFolder(page)
    await row(page, 'picture-one.png').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectNoExplorerControls(page)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await verifyMenu()
    await shot(page, info, 'image-context-icons-zoom200.png', app)
  } finally {
    await stop(app)
  }
})

test('new Explorer tabs preview clicks and arrow selections by default while double-click and Enter open full view', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    writeFileSync(join(h.movies, 'a.txt'), 'First preview\n')
    writeFileSync(join(h.movies, 'b.txt'), 'Second preview\n')
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    const toggle = page.getByRole('button', { name: 'Preview pane', exact: true })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: 'Open as project here', exact: true })
    ).toHaveCount(0)
    await go(page, h.movies)
    const preview = page.locator('[data-browse-preview="true"]')
    await row(page, 'a.txt').click()
    await expect(preview.locator('.cm-content')).toHaveText('First preview')
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(row(page, 'b.txt')).toHaveAttribute('aria-selected', 'true')
    await expect(preview.locator('.cm-content')).toHaveText('Second preview')
    await shot(page, info, 'explorer-default-preview.png', app)
    await row(page, 'a.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    const filePin = page
      .getByRole('region', { name: 'Quick access', exact: true })
      .getByRole('button', { name: 'a.txt', exact: true })
    await filePin.click()
    await expect(preview.locator('.cm-content')).toHaveText('First preview')
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await filePin.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(page.getByRole('textbox').filter({ hasText: 'First preview' })).toBeVisible()
    await returnToFolder(page)
    await filePin.dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(page.getByRole('textbox').filter({ hasText: 'First preview' })).toBeVisible()
    await returnToFolder(page)
    await row(page, 'b.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(page.getByRole('textbox').filter({ hasText: 'Second preview' })).toBeVisible()
    await returnToFolder(page)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await row(page, 'a.txt').click()
    await expect(preview.locator('.cm-content')).toHaveText('First preview')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(page.getByRole('textbox').filter({ hasText: 'First preview' })).toBeVisible()
    await returnToFolder(page)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await row(page, 'b.txt').click()
    await expect(page.getByTestId('browse-list')).toBeVisible()
    await expect(preview).toHaveCount(0)
    await row(page, 'b.txt').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Show in preview', exact: true })).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: 'Open in split view', exact: true })
    ).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
    await expect(preview.locator('.cm-content')).toHaveText('Second preview')
  } finally {
    await stop(app)
  }
})

test('missing file pins recover on a valid choice and late failures stay out of another tab', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await newExplorerWithoutPreview(page)
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
    await newExplorerWithoutPreview(page)
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
    await waitForIndexedFixture(settings)
    await newExplorerWithoutPreview(page)
    await go(page, h.home)
    await search(page, 'Playnite')
    await expect(row(page, 'Playnite')).toBeVisible()
    await expect(row(page, 'Playnite-settings.txt')).toBeVisible()
    await expect(row(page, 'Playnite-settings.txt').locator('.browse-result-location')).toHaveText(
      appData
    )
    await expect(page.getByTestId('browse-search-status')).toHaveAttribute('title', /This folder and subfolders/)
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
    await newExplorerWithoutPreview(page)
    const toggle = page.getByRole('button', { name: 'Preview pane', exact: true })
    if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click()
    await search(page, 'notes')
    await row(page, 'notes.txt').click()
    await expect(row(page, 'notes.txt')).toHaveAttribute('aria-selected', 'true')
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

test('Everything Explorer filters respond from the index and focus surrounds the complete field', async ({}, info) => {
  const es = join(process.env.USERPROFILE ?? '', '.local', 'bin', 'es.exe')
  test.skip(!existsSync(es), 'Everything CLI is not installed on this machine')
  const h = await setup()
  const { app, page } = h
  try {
    const folder = join(h.project, 'Playnite')
    mkdirSync(folder)
    mkdirSync(join(folder, 'Saved Games'))
    writeFileSync(join(folder, 'Playnite.dll'), 'indexed unsupported file')
    writeFileSync(join(folder, '.Playnite-hidden'), 'indexed hidden file')
    await waitForIndexedFixture(join(folder, '.Playnite-hidden'))
    await app.evaluate(({ ipcMain }) => {
      type Handler = (...args: unknown[]) => Promise<unknown>
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browse:search')!
      const timings: { query: string; ms: number }[] = []
      let waitingForIndex = true
      ;(globalThis as unknown as { __searchTimings: typeof timings }).__searchTimings = timings
      ipcMain.removeHandler('browse:search')
      ipcMain.handle('browse:search', async (...args: unknown[]) => {
        const start = performance.now()
        const result = await original(...args)
        timings.push({ query: String(args[3]), ms: Math.round(performance.now() - start) })
        // Reproduce a query arriving just before Everything consumes a newly
        // created folder. The unchanged query must fill in quietly afterward.
        if (args[3] === 'folder: Playnite' && waitingForIndex) {
          waitingForIndex = false
          return { ...(result as Record<string, unknown>), listing: { folders: [], files: [] } }
        }
        return result
      })
    })
    const normalHeight = await page.locator('.browse-row').first().evaluate((el) => el.getBoundingClientRect().height)
    await search(page, 'folder: Playnite')
    await expect(page.locator('.browse-columns button')).toHaveText(['Name', 'Path', 'Size'])
    await expect(page.locator('.browse-list-area > .browse-search-status')).toHaveCount(0)
    await expect(page.locator('.browse-status .browse-search-status')).toHaveCount(1)
    expect(await row(page, 'Playnite').evaluate((el) => el.getBoundingClientRect().height)).toBe(normalHeight)
    await expect(row(page, 'Playnite')).toBeVisible()
    await expect(row(page, 'Playnite.dll')).toHaveCount(0)
    await expect(page.getByTestId('browse-search-status')).toHaveAttribute('data-source', 'everything')
    await search(page, 'file: Playnite')
    await expect(row(page, 'Playnite.dll')).toBeVisible()
    await expect(row(page, '.Playnite-hidden')).toBeVisible()
    await expect(row(page, 'Playnite')).toHaveCount(0)
    await search(page, 'file: ext:dll size:>1')
    await expect(row(page, 'Playnite.dll')).toBeVisible()
    await expect(row(page, '.Playnite-hidden')).toHaveCount(0)
    await search(page, '"Playnite.dll"')
    await expect(row(page, 'Playnite.dll')).toBeVisible()
    await search(page, 'folder:"Saved Games"')
    await expect(row(page, 'Saved Games')).toBeVisible()
    await search(page, '<folder: Playnite> | <file: ext:dll>')
    await expect(row(page, 'Playnite')).toBeVisible()
    await expect(row(page, 'Playnite.dll')).toBeVisible()
    await search(page, 'prism-no-such-indexed-result-152')
    await expect(page.getByTestId('browse-list').locator('[role="option"]')).toHaveCount(0)
    await expect(page.getByTestId('browse-search-status')).toHaveAttribute('data-source', 'everything')
    await search(page, 'file: Playnite')
    for (const zoom of [1, 2]) {
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
      const field = page.getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
      await field.focus()
      await expect(field).toBeFocused()
      await expect(field).toHaveCSS('outline-style', 'none')
      await expect(field.locator('..')).toHaveCSS('outline-style', 'solid')
      expect(await field.locator('..').evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThan(1)
      const result = row(page, 'Playnite.dll')
      await expect(result.locator('.browse-column-path')).toHaveText(folder)
      await expect(result).toHaveCSS('height', '40px')
      const cells = await result.locator(':scope > span').evaluateAll((elements) => elements.map((el) => {
        const rect = el.getBoundingClientRect()
        return { x: rect.x, right: rect.right, y: rect.y, height: rect.height, width: rect.width }
      }))
      expect(cells).toHaveLength(3)
      expect(cells.every((cell) => cell.width > 0)).toBe(true)
      expect(cells[0].right).toBeLessThan(cells[1].x)
      expect(cells[1].right).toBeLessThan(cells[2].x)
      await shot(page, info, `search-focus-${zoom}.png`, app)
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await page.locator('.browse-list-area').evaluate((element) => { (element as HTMLElement).style.width = '240px' })
    const list = page.getByTestId('browse-list')
    expect(await row(page, 'Playnite.dll').locator('.browse-name-text').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(100)
    await list.evaluate((element) => { element.scrollLeft = 120 })
    await expect.poll(() => page.locator('.browse-column-viewport').evaluate((el) => el.scrollLeft)).toBe(120)
    await expect(row(page, 'Playnite.dll').locator('.browse-column-path')).toBeVisible()
    await list.evaluate((element) => { element.scrollLeft = 0 })
    await expect.poll(() => page.locator('.browse-column-viewport').evaluate((el) => el.scrollLeft)).toBe(0)
    await page.getByRole('button', { name: 'Sort by size', exact: true }).focus()
    await expect.poll(async () => {
      const headerLeft = await page.locator('.browse-column-viewport').evaluate((el) => el.scrollLeft)
      const bodyLeft = await list.evaluate((el) => el.scrollLeft)
      return headerLeft > 0 && headerLeft === bodyLeft
    }).toBe(true)
    await page.locator('.browse-list-area').evaluate((element) => { (element as HTMLElement).style.removeProperty('width') })
    const timings = await app.evaluate(() => (globalThis as unknown as { __searchTimings: { query: string; ms: number }[] }).__searchTimings)
    console.log('Indexed Explorer timings:', JSON.stringify(timings))
    await info.attach('indexed-search-timings', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' })
    expect(timings.length).toBeGreaterThanOrEqual(5)
    // Generous regression limit. Exact measured latency is attached separately.
    expect(timings.every((timing) => timing.ms < 1500)).toBe(true)
  } finally { await stop(app) }
})

test('cancel search reaches the matching request and a fresh query can run afterward', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    await newExplorerWithoutPreview(page)
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
    const terminalDivider = page.locator(
      '[data-term-panel] > .cursor-ew-resize, [data-term-panel] > .cursor-ns-resize'
    )
    const dividerColor = await terminalDivider.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    await terminalDivider.hover()
    expect(await terminalDivider.evaluate((element) => getComputedStyle(element).cursor)).toMatch(
      /^(ew|ns)-resize$/
    )
    await expect(terminalDivider).toHaveCSS('background-color', dividerColor)
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
    await row(page, 'sample.mp4').click()
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
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
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
    await row(page, 'entry-001.txt').click()
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
    await row(page, 'notes.txt').click()
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
    await expect(page.locator('.cm-content')).toHaveText('Original notes')
    const treeSeparator = page.getByRole('separator', { name: 'Resize file tree', exact: true })
    await expect
      .poll(() =>
        page
          .locator('aside[aria-hidden="false"]')
          .first()
          .evaluate((element) =>
            Math.abs(
              element.getBoundingClientRect().width -
                Number.parseFloat((element as HTMLElement).style.width)
            )
          )
      )
      .toBeLessThan(1)
    const treeEdge = await treeSeparator.boundingBox()
    const originalWidth = await treeSeparator.getAttribute('aria-valuenow')
    // The sidebar clips the outer half of its handle, so grab its visible half.
    const treeGrip = {
      x: treeEdge!.x + treeEdge!.width / 4,
      y: treeEdge!.y + treeEdge!.height / 2
    }
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[role="separator"]')
            ?.getAttribute('aria-label'),
        treeGrip
      )
    ).toBe('Resize file tree')
    await page.mouse.move(treeGrip.x, treeGrip.y)
    await expect(treeSeparator).toHaveCSS('cursor', 'ew-resize')
    await expect(treeSeparator.locator('span')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.mouse.down()
    await expect(treeSeparator).toBeFocused()
    await page.mouse.move(treeGrip.x + 30, treeGrip.y, { steps: 8 })
    await expect(treeSeparator.locator('span')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await shot(page, info, 'held-project-resize-no-line.png', app)
    await page.mouse.up()
    await expect(treeSeparator).not.toHaveAttribute('aria-valuenow', originalWidth!)
    await treeSeparator.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(treeSeparator.locator('span')).not.toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    )
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
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
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
      await expect(separator).toHaveCSS('cursor', 'ew-resize')
      await expect
        .poll(() =>
          separator.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)
        )
        .toBe('rgba(0, 0, 0, 0)')
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 })
      await expect
        .poll(() =>
          separator.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)
        )
        .toBe('rgba(0, 0, 0, 0)')
      if (name === 'Resize Explorer preview') await shot(page, info, 'held-resize-no-line.png', app)
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
    await expect
      .poll(() =>
        quickSeparator.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)
      )
      .not.toBe('rgba(0, 0, 0, 0)')
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

/** Restore the user's common clipboard formats after real CF_HDROP shortcut checks. */
async function keepClipboard(app: ElectronApplication): Promise<() => Promise<void>> {
  const saved = await app.evaluate(({ clipboard }) => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: clipboard.readImage().toDataURL()
  }))
  const files = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      '(Get-Clipboard -Format FileDropList) | ForEach-Object { $_.FullName }'
    ],
    { encoding: 'utf8', windowsHide: true }
  )
    .split(/\r?\n/)
    .filter(Boolean)
  return async () => {
    if (files.length) {
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath ${files.map(quotePS).join(',')}`],
        { windowsHide: true }
      )
    } else {
      await app.evaluate(({ clipboard, nativeImage }, value) => {
        clipboard.write({ ...value, image: nativeImage.createFromDataURL(value.image) })
      }, saved)
    }
  }
}

async function clipboardFile(path: string): Promise<void> {
  await expect
    .poll(() =>
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '(Get-Clipboard -Format FileDropList) | ForEach-Object { $_.FullName }'
        ],
        { encoding: 'utf8', windowsHide: true }
      )
        .split(/\r?\n/)
        .filter(Boolean)
    )
    .toContain(path)
}

test('Explorer file hotkeys target displayed folders and full files while text editing keeps its keys', async () => {
  const h = await setup()
  const { page, app } = h
  const restoreClipboard = await keepClipboard(app)
  const child = join(h.movies, 'Child')
  const moving = join(h.project, 'move-me.txt')
  try {
    mkdirSync(child)
    writeFileSync(moving, 'Move this fixture\n')
    await row(page, 'Nested').click()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.nested)
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Backspace')
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.project)
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click()
    await page.keyboard.press('Control+c')
    await clipboardFile(join(h.project, 'notes.txt'))
    await go(page, h.movies)
    await row(page, 'Child').click()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.movies, 'notes.txt'))).toBe(true)
    expect(readFileSync(join(h.movies, 'notes.txt'), 'utf8')).toBe('Original notes\n')
    expect(existsSync(join(child, 'notes.txt'))).toBe(false)
    expect(existsSync(join(h.project, 'notes.txt'))).toBe(true)

    await go(page, h.project)
    await search(page, 'move-me.txt')
    await row(page, 'move-me.txt').click()
    await page.keyboard.press('Control+x')
    await clipboardFile(moving)
    await go(page, h.movies)
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.movies, 'move-me.txt'))).toBe(true)
    await expect.poll(() => existsSync(moving)).toBe(false)

    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    const editor = page.locator('.cm-content')
    await expect(editor).toHaveText('Original notes')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+c')
    await clipboardFile(join(h.movies, 'notes.txt'))
    await go(page, h.nested)
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.nested, 'notes.txt'))).toBe(true)

    await go(page, h.project)
    await search(page, 'entry-000.txt')
    await row(page, 'entry-000.txt').click()
    await page.keyboard.press('Control+c')
    await clipboardFile(join(h.project, 'entry-000.txt'))
    await go(page, h.movies)
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(editor).toHaveText('Original notes')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.movies, 'entry-000.txt'))).toBe(true)
    await expect(editor).toHaveText('Original notes')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)

    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('Original notes')
    await page.keyboard.press('Control+x')
    await expect(editor).toHaveText('')
    expect(existsSync(join(h.movies, 'notes.txt'))).toBe(true)
    await page.keyboard.press('Control+v')
    await expect(editor).toHaveText('Original notes')
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(editor).toHaveText('Original notes')
    await returnToFolder(page)
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
    await expect(page.locator('.browse-preview-actions')).toHaveText('Open full view')
    const previewToggle = page.getByRole('button', { name: 'Preview pane', exact: true })
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'true')
    await previewToggle.click()
    await expect(page.locator('[data-browse-preview="true"]')).toHaveCount(0)
    await previewToggle.click()
    await expect(page.locator('[data-browse-preview="true"]')).toBeVisible()
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+f')
    await expect(
      page.getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
    ).toBeFocused()
  } finally {
    await restoreClipboard()
    await stop(app)
  }
})

test('file cut and copy cross Explorer and project tabs while the terminal owns clipboard shortcuts', async () => {
  const h = await setup()
  const { page, app } = h
  const restoreClipboard = await keepClipboard(app)
  const moving = join(h.project, 'cross-tab.txt')
  try {
    writeFileSync(moving, 'Cross-tab move\n')
    copyFileSync(join(ROOT, 'build/icon.png'), join(h.movies, 'preview.png'))
    mkdirSync(join(h.movies, 'Child'))
    writeFileSync(join(h.movies, 'Child', 'inside-project.txt'), 'Inside project child\n')
    await search(page, 'cross-tab.txt')
    await row(page, 'cross-tab.txt').click()
    await page.keyboard.press('Control+x')
    await clipboardFile(moving)
    await go(page, h.home)
    await row(page, 'Movies').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.movies, 'readme.txt')
    const projectTab = ordinaryTabs(page).last()
    const explorerTab = ordinaryTabs(page).first()
    const treeRow = (path: string) =>
      page
        .getByRole('tree')
        .locator('[data-row]')
        .filter({
          has: page.getByText(basename(path), { exact: true })
        })
        .first()
    const childRow = treeRow(join(h.movies, 'Child'))
    await childRow.click()
    await page.keyboard.press('Enter')
    await expect(childRow).toHaveAttribute('aria-expanded', 'true')
    await treeRow(join(h.movies, 'Child', 'inside-project.txt')).click()
    await treeRow(join(h.movies, 'Child', 'inside-project.txt')).focus()
    await page.keyboard.press('Backspace')
    await expect(childRow).toBeFocused()
    await page.keyboard.press('Backspace')
    await expect(childRow).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', h.movies)
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.movies, 'cross-tab.txt'))).toBe(true)
    await expect.poll(() => existsSync(moving)).toBe(false)
    expect(existsSync(join(h.movies, 'Child', 'cross-tab.txt'))).toBe(false)

    await treeRow(join(h.movies, 'cross-tab.txt')).click()
    await page.keyboard.press('Control+x')
    await clipboardFile(join(h.movies, 'cross-tab.txt'))
    await explorerTab.click()
    await go(page, h.nested)
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.nested, 'cross-tab.txt'))).toBe(true)
    await expect.poll(() => existsSync(join(h.movies, 'cross-tab.txt'))).toBe(false)

    await projectTab.click()
    await treeRow(join(h.movies, 'readme.txt')).click()
    await page.keyboard.press('Control+c')
    await clipboardFile(join(h.movies, 'readme.txt'))
    await explorerTab.click()
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.nested, 'readme.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'readme.txt'))).toBe(true)

    await projectTab.click()
    await treeRow(join(h.movies, 'preview.png')).click()
    await expect(page.getByRole('img', { name: 'preview.png', exact: true })).toBeVisible()
    await treeRow(join(h.movies, 'preview.png')).focus()
    await page.keyboard.press('Control+c')
    await clipboardFile(join(h.movies, 'preview.png'))
    await explorerTab.click()
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.nested, 'preview.png'))).toBe(true)
    expect(readFileSync(join(h.nested, 'preview.png'))).toEqual(
      readFileSync(join(h.movies, 'preview.png'))
    )

    await projectTab.click()
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await shellReady(page, h.movies)
    await app.evaluate(({ clipboard }) => clipboard.writeText('Write-Output PRISM_HOTKEY_PASTE'))
    await page.locator('.xterm-helper-textarea:visible').focus()
    await page.keyboard.press('Control+x')
    await page.keyboard.press('Control+c')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      'Write-Output PRISM_HOTKEY_PASTE'
    )
    await page.keyboard.press('Control+v')
    await page.keyboard.press('Enter')
    await expect
      .poll(
        async () =>
          ((await page.locator('.xterm:visible .xterm-rows').textContent()) ?? '').split(
            'PRISM_HOTKEY_PASTE'
          ).length - 1
      )
      .toBeGreaterThanOrEqual(2)
    await shellReady(page, h.movies)
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expectNoExplorerControls(page)
    expect(existsSync(join(h.movies, 'readme.txt'))).toBe(true)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await treeRow(join(h.movies, 'readme.txt')).click()
    await treeRow(join(h.movies, 'readme.txt')).focus()
    await page.keyboard.press('Control+f')
    await expect(page.getByRole('textbox', { name: 'Search files', exact: true })).toBeFocused()
  } finally {
    await restoreClipboard()
    await stop(app)
  }
})

test('Explorer keyboard navigation retains focus through folder history and empty directories without frame outlines', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  const deep = join(h.nested, 'Deep')
  const empty = join(h.nested, 'Empty')
  mkdirSync(deep)
  mkdirSync(empty)
  writeFileSync(join(deep, 'leaf.txt'), 'Deep folder fixture\n')
  const at = async (path: string): Promise<void> => {
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', path)
    await expect(page.getByTestId('browse-list')).toHaveAttribute('aria-busy', 'false')
    await expect
      .poll(() =>
        page.getByTestId('browse-list').evaluate((el) => el.contains(document.activeElement))
      )
      .toBe(true)
    await expect(page.getByTestId('browse-list')).toHaveCSS('outline-style', 'none')
    await expect(page.getByTestId('folder-browser')).toHaveCSS('outline-style', 'none')
  }
  try {
    // The only pointer action. Every subsequent folder change keeps the keyboard usable.
    await row(page, 'Nested').click()
    await page.keyboard.press('Enter')
    await at(h.nested)
    await page.keyboard.press('Home')
    await expect(row(page, 'Deep')).toBeFocused()
    await expect(row(page, 'Deep')).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Enter')
    await at(deep)
    await page.keyboard.press('ArrowDown')
    await expect(row(page, 'leaf.txt')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Backspace')
    await at(h.nested)
    await page.keyboard.press('ArrowDown')
    await expect(row(page, 'Empty')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await at(empty)
    await expect(page.getByTestId('browse-list').getByRole('option')).toHaveCount(0)
    await page.keyboard.press('Backspace')
    await at(h.nested)
    await page.keyboard.press('ArrowUp')
    await expect(row(page, 'Deep')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await at(deep)
    await page.keyboard.press('Alt+ArrowUp')
    await at(h.nested)
    await page.keyboard.press('Alt+ArrowLeft')
    await at(deep)
    await page.keyboard.press('Alt+ArrowRight')
    await at(h.nested)
    for (const path of [deep, h.nested, h.project]) {
      await page.keyboard.press('Backspace')
      await at(path)
    }
    await page.keyboard.press('Home')
    await expect(row(page, 'Nested')).toBeFocused()
    await page.keyboard.press('Enter')
    await at(h.nested)
    await page.keyboard.press('Home')
    await expect(row(page, 'Deep')).toBeFocused()
    await expect(row(page, 'Deep')).toHaveCSS('outline-style', 'solid')
    await shot(page, info, 'keyboard-navigation.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await at(h.nested)
    await expect(row(page, 'Deep')).toBeFocused()
    await expect(row(page, 'Deep')).toHaveCSS('outline-style', 'solid')
    await shot(page, info, 'keyboard-navigation-zoom200.png', app)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await at(empty)
    await page.keyboard.press('Backspace')
    await at(h.nested)
    await page.keyboard.press('ArrowUp')
    await expect(row(page, 'Deep')).toBeFocused()
    await page.keyboard.press('Enter')
    await at(deep)
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toHaveText('Deep folder fixture')
    await page.keyboard.press('Backspace')
    await at(deep)
    await page.keyboard.press('ArrowUp')
    await expect(row(page, 'leaf.txt')).toBeFocused()
  } finally {
    await stop(app)
  }
})

function chromePdf(title: string): Buffer {
  const stream = `BT /F1 20 Tf 40 420 Td (${title}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

test('comic controls ignore outside movement and keep separate clocks through project pane page turns', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  const comicName = '000-scope-comic.cbz'
  const imageName = '001-scope-image.png'
  try {
    const comic = new AdmZip()
    const picture = readFileSync(join(ROOT, 'build/icon.png'))
    for (const name of ['page1.png', 'page2.png', 'page3.png']) comic.addFile(name, picture)
    comic.writeZip(join(h.project, comicName))
    writeFileSync(join(h.project, imageName), picture)
    await search(page, comicName)
    await row(page, comicName).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
    const viewer = page.locator('[data-browse-preview="true"]')
    const chrome = viewer.locator('[data-viewer-chrome]')
    await expect(viewer.getByRole('img', { name: 'page1.png', exact: true })).toBeVisible()
    const outside = page.getByRole('button', { name: 'New tab', exact: true })
    await outside.hover()
    await expect(chrome).toHaveCount(0, { timeout: 5000 })
    for (const target of [
      outside,
      page.getByRole('region', { name: 'Quick access', exact: true }),
      row(page, comicName)
    ]) {
      await target.hover()
      await page.waitForTimeout(180)
      await expect(chrome).toHaveCount(0)
    }
    await viewer.getByRole('img', { name: 'page1.png', exact: true }).hover()
    await expect(chrome).toBeVisible()
    const box = (await outside.boundingBox())!
    // Keep moving outside longer than the idle clock; outside motion must not reset it.
    for (let index = 0; index < 22; index++) {
      await page.mouse.move(box.x + box.width / 2 + (index % 2 ? 4 : -4), box.y + box.height / 2)
      await page.waitForTimeout(150)
    }
    await expect(chrome).toHaveCount(0)
    await viewer.getByRole('img', { name: 'page1.png', exact: true }).hover()
    await expect(chrome).toBeVisible()
    await chrome.hover()
    await page.waitForTimeout(3200)
    await expect(chrome).toBeVisible()
    await viewer.click({ position: { x: 50, y: 70 } })
    await outside.hover()
    await expect(chrome).toHaveCount(0, { timeout: 5000 })
    await page.keyboard.press('ArrowRight')
    await expect(viewer.getByRole('img', { name: 'page2.png', exact: true })).toBeVisible()
    await expect(chrome).toHaveCount(0)
    await shot(page, info, 'comic-outside-chrome-hidden.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await outside.hover()
    await expect(chrome).toHaveCount(0)
    await viewer.getByRole('img', { name: 'page2.png', exact: true }).hover()
    await expect(chrome).toBeVisible()
    await outside.hover()
    await expect(chrome).toHaveCount(0, { timeout: 5000 })
    await shot(page, info, 'comic-outside-chrome-hidden-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    )

    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    for (const name of [comicName, imageName]) {
      await page
        .getByRole('treeitem')
        .filter({ has: page.getByText(name, { exact: true }) })
        .click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    }
    const pins = page.locator('[data-pane="pinned"]')
    await expect(pins).toHaveCount(2)
    const comicPane = pins.nth(0)
    const imagePane = pins.nth(1)
    const comicChrome = comicPane.locator('[data-viewer-chrome]')
    const imageChrome = imagePane.locator('[data-viewer-chrome]')
    await expect(comicPane.getByRole('img', { name: /page[12]\.png/ })).toBeVisible()
    await expect(imagePane.getByRole('img', { name: imageName, exact: true })).toBeVisible()
    await outside.hover()
    await expect(pins.locator('[data-viewer-chrome]')).toHaveCount(0, { timeout: 5000 })
    await imagePane.getByRole('img', { name: imageName, exact: true }).hover()
    await expect(imageChrome).toBeVisible()
    await expect(comicChrome).toHaveCount(0)
    await imageChrome.hover()
    await page.waitForTimeout(3200)
    await expect(imageChrome).toBeVisible()
    await expect(comicChrome).toHaveCount(0)
    const previous = await comicPane.getByRole('img').getAttribute('alt')
    await page.keyboard.press(previous === 'page3.png' ? 'ArrowLeft' : 'ArrowRight')
    await expect(comicPane.getByRole('img')).not.toHaveAttribute('alt', previous!)
    await expect(comicChrome).toHaveCount(0)
    await expect(imageChrome).toBeVisible()
    await shot(page, info, 'project-independent-image-chrome.png', app)
  } finally {
    await stop(app)
  }
})

test('PDF controls reveal only inside their own Explorer or project viewer', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  const names = ['000-scope-first.pdf', '001-scope-second.pdf']
  try {
    for (const [index, name] of names.entries())
      writeFileSync(join(h.project, name), chromePdf(`Viewer ${index + 1}`))
    await search(page, names[0])
    await row(page, names[0]).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
    const viewer = page.locator('[data-browse-preview="true"] [data-pdf-viewer]')
    const chrome = viewer.locator('[data-pdf-chrome]')
    await expect(viewer.locator('canvas')).toBeVisible()
    const outside = page.getByRole('button', { name: 'New tab', exact: true })
    for (const target of [
      outside,
      page.getByRole('region', { name: 'Quick access', exact: true }),
      row(page, names[0])
    ]) {
      await target.hover()
      await expect(chrome).toHaveCSS('opacity', '0')
    }
    await viewer.hover({ position: { x: 70, y: 100 } })
    await expect(chrome).toHaveCSS('opacity', '1')
    await outside.hover()
    await expect(chrome).toHaveCSS('opacity', '0')
    await shot(page, info, 'pdf-outside-chrome-hidden.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    )
    await outside.hover()
    await expect(chrome).toHaveCSS('opacity', '0')
    await viewer.hover({ position: { x: 70, y: 100 } })
    await expect(chrome).toHaveCSS('opacity', '1')
    await outside.hover()
    await expect(chrome).toHaveCSS('opacity', '0')
    await shot(page, info, 'pdf-outside-chrome-hidden-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    )
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    for (const name of names) {
      await page
        .getByRole('treeitem')
        .filter({ has: page.getByText(name, { exact: true }) })
        .click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    }
    const viewers = page.locator('[data-pane="pinned"] [data-pdf-viewer]')
    await expect(viewers).toHaveCount(2)
    await expect(viewers.nth(1).locator('canvas')).toBeVisible()
    await outside.hover()
    for (const viewer of [viewers.nth(0), viewers.nth(1)])
      await expect(viewer.locator('[data-pdf-chrome]')).toHaveCSS('opacity', '0')
    await viewers.nth(0).hover({ position: { x: 70, y: 100 } })
    await expect(viewers.nth(0).locator('[data-pdf-chrome]')).toHaveCSS('opacity', '1')
    await expect(viewers.nth(1).locator('[data-pdf-chrome]')).toHaveCSS('opacity', '0')
    await viewers.nth(1).hover({ position: { x: 70, y: 100 } })
    await expect(viewers.nth(1).locator('[data-pdf-chrome]')).toHaveCSS('opacity', '1')
    await expect(viewers.nth(0).locator('[data-pdf-chrome]')).toHaveCSS('opacity', '0')
    await outside.hover()
    for (const viewer of [viewers.nth(0), viewers.nth(1)])
      await expect(viewer.locator('[data-pdf-chrome]')).toHaveCSS('opacity', '0')
    await shot(page, info, 'project-independent-pdf-chrome.png', app)
  } finally {
    await stop(app)
  }
})

/** Exercise the pointer gesture itself, including keys while the primary button remains held. */
async function pickUp(page: Page, source: ReturnType<typeof row>): Promise<void> {
  await source.scrollIntoViewIfNeeded()
  const box = await source.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + Math.min(100, box!.width / 2), box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + Math.min(100, box!.width / 2) + 24, box!.y + box!.height / 2, {
    steps: 4
  })
}

async function dropOn(page: Page, target: ReturnType<typeof row>, blank = false): Promise<void> {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(
    box!.x + Math.min(120, box!.width / 2),
    blank ? box!.y + box!.height - 24 : box!.y + box!.height / 2,
    { steps: 8 }
  )
  await page.mouse.up()
}

function projectRow(page: Page, name: string): ReturnType<typeof row> {
  return page
    .getByRole('tree')
    .locator('[data-row]')
    .filter({
      has: page.getByText(name, { exact: true })
    })
    .first()
}

async function expectGreyDropTarget(target: ReturnType<typeof row>): Promise<void> {
  await expect(target).toHaveAttribute('data-drag-over', 'true')
  const grey = await target.evaluate((element) => {
    const reference = document.createElement('span')
    reference.style.backgroundColor = 'var(--p-hover-hi)'
    element.append(reference)
    const grey = getComputedStyle(reference).backgroundColor
    reference.remove()
    return grey
  })
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          background: style.backgroundColor,
          shadow: style.boxShadow,
          outline: style.outlineWidth
        }
      })
    )
    .toEqual({ background: grey, shadow: 'none', outline: '0px' })
}

test('held file drags move into Explorer folders, and cancelled drags leave disk unchanged', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  const destination = join(h.movies, 'Destination')
  const movingFolder = join(h.movies, 'Moving folder')
  try {
    mkdirSync(destination)
    mkdirSync(movingFolder)
    writeFileSync(join(movingFolder, 'inside.txt'), 'A moved folder retains its contents\n')
    writeFileSync(join(h.movies, 'cancel-me.txt'), 'Cancelled pointer gesture\n')
    await go(page, h.movies)
    await pickUp(page, row(page, 'Moving folder'))
    await dropOn(page, row(page, 'Moving folder'))
    await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(existsSync(join(movingFolder, 'inside.txt'))).toBe(true)
    expect(existsSync(join(movingFolder, 'Moving folder'))).toBe(false)
    await pickUp(page, row(page, 'Moving folder'))
    const folderBox = await row(page, 'Destination').boundingBox()
    await page.mouse.move(folderBox!.x + 100, folderBox!.y + folderBox!.height / 2, { steps: 8 })
    await expect(row(page, 'Destination')).toHaveAttribute('data-drag-over', 'true')
    await expectGreyDropTarget(row(page, 'Destination'))
    await shot(page, info, 'held-folder-drag.png', app)
    await dropOn(page, row(page, 'Destination'))
    await expect.poll(() => existsSync(join(destination, 'Moving folder', 'inside.txt'))).toBe(true)
    expect(existsSync(movingFolder)).toBe(false)
    await expect(row(page, 'Moving folder')).toHaveCount(0)

    await pickUp(page, row(page, 'cancel-me.txt'))
    await dropOn(page, page.getByTestId('browse-list'), true)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row(page, 'cancel-me.txt')).toBeVisible()
    expect(readFileSync(join(h.movies, 'cancel-me.txt'), 'utf8')).toBe(
      'Cancelled pointer gesture\n'
    )

    await pickUp(page, row(page, 'cancel-me.txt'))
    const target = await row(page, 'Destination').boundingBox()
    await page.mouse.move(target!.x + 100, target!.y + target!.height / 2, { steps: 8 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('body')).not.toHaveAttribute('data-internal-file-drag', 'true')
    await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
    await expect(row(page, 'cancel-me.txt')).toBeVisible()
    expect(existsSync(join(destination, 'cancel-me.txt'))).toBe(false)
    expect(existsSync(join(h.movies, 'cancel-me.txt'))).toBe(true)

    await pickUp(page, row(page, 'cancel-me.txt'))
    await page.mouse.move(-20, -20, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
    await expect(row(page, 'cancel-me.txt')).toBeVisible()
    expect(existsSync(join(destination, 'cancel-me.txt'))).toBe(false)

    await go(page, h.nested)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    })
    await pickUp(page, row(page, 'inside.txt'))
    const parentCrumb = page
      .getByRole('navigation', { name: 'Folder path', exact: true })
      .getByRole('button', { name: 'Prism Project', exact: true })
    await expect(parentCrumb).toBeInViewport()
    const crumbBox = await parentCrumb.boundingBox()
    await page.mouse.move(crumbBox!.x + crumbBox!.width / 2, crumbBox!.y + crumbBox!.height / 2, {
      steps: 8
    })
    await expect(parentCrumb).toHaveAttribute('data-drag-over', 'true')
    await expectGreyDropTarget(parentCrumb)
    await shot(page, info, 'held-breadcrumb-drag-zoom200.png', app)
    await dropOn(page, parentCrumb)
    await expect.poll(() => existsSync(join(h.project, 'inside.txt'))).toBe(true)
    expect(existsSync(join(h.nested, 'inside.txt'))).toBe(false)
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.nested)
  } finally {
    await page.keyboard.up('Control').catch(() => {})
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held drags survive Ctrl+Tab and Ctrl+Shift+Tab between Explorer and a project sidebar', async () => {
  const h = await setup()
  const { page, app } = h
  const destination = join(h.project, 'Nested')
  try {
    writeFileSync(join(h.movies, 'cross-view.txt'), 'Move from Explorer to project\n')
    mkdirSync(join(h.movies, 'Return folder'))
    writeFileSync(join(h.movies, 'Return folder', 'inside.txt'), 'Move folder between tabs\n')
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    const explorer = ordinaryTabs(page).first()
    const project = ordinaryTabs(page).last()
    await explorer.click()
    await go(page, h.movies)

    await pickUp(page, row(page, 'cross-view.txt'))
    await page.keyboard.press('Control+Tab')
    await expect(project).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, projectRow(page, 'Nested'))
    await expect.poll(() => existsSync(join(destination, 'cross-view.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'cross-view.txt'))).toBe(false)
    await projectRow(page, 'Nested').dblclick()
    await expect(projectRow(page, 'cross-view.txt')).toBeVisible()

    await pickUp(page, projectRow(page, 'cross-view.txt'))
    await page.keyboard.press('Control+Shift+Tab')
    await expect(explorer).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, page.getByTestId('browse-list'), true)
    await expect.poll(() => existsSync(join(h.movies, 'cross-view.txt'))).toBe(true)
    expect(existsSync(join(destination, 'cross-view.txt'))).toBe(false)
    await expect(row(page, 'cross-view.txt')).toBeVisible()

    await pickUp(page, row(page, 'Return folder'))
    await page.keyboard.press('Control+Tab')
    await expect(project).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, projectRow(page, 'Nested'))
    await expect.poll(() => existsSync(join(destination, 'Return folder', 'inside.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'Return folder'))).toBe(false)
    await expectNoExplorerControls(page)
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held Explorer drags cross browsing tabs and preserve their originating preview', async () => {
  const h = await setup()
  const { page, app } = h
  try {
    writeFileSync(join(h.movies, 'between-explorers.txt'), 'Move between two browsing tabs\n')
    await go(page, h.movies)
    const sourceTab = ordinaryTabs(page).first()
    await newExplorerWithoutPreview(page)
    await go(page, h.nested)
    const destinationTab = ordinaryTabs(page).last()
    await sourceTab.click()
    await row(page, 'between-explorers.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
    const preview = page.locator('[data-browse-preview="true"]')
    await expect(preview.locator('.cm-content')).toHaveText('Move between two browsing tabs')

    // A collision leaves both files and the originating viewer intact, without changing tabs.
    writeFileSync(join(h.nested, 'between-explorers.txt'), 'An existing destination\n')
    await pickUp(page, row(page, 'between-explorers.txt'))
    await page.keyboard.press('Control+Tab')
    await expect(destinationTab).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, page.getByTestId('browse-list'), true)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(destinationTab).toHaveAttribute('aria-selected', 'true')
    expect(readFileSync(join(h.nested, 'between-explorers.txt'), 'utf8')).toBe(
      'An existing destination\n'
    )
    await sourceTab.click()
    await expect(preview.locator('.cm-content')).toHaveText('Move between two browsing tabs')
    await expect
      .poll(() => savedTabs(join(h.profile, 'tabs.json'))?.tabs[1]?.file)
      .toBe(join(h.movies, 'between-explorers.txt'))
    unlinkSync(join(h.nested, 'between-explorers.txt'))

    await pickUp(page, row(page, 'between-explorers.txt'))
    await page.keyboard.press('Control+Tab')
    await expect(destinationTab).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, page.getByTestId('browse-list'), true)
    await expect.poll(() => existsSync(join(h.nested, 'between-explorers.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'between-explorers.txt'))).toBe(false)
    await expect(row(page, 'between-explorers.txt')).toBeVisible()
    await sourceTab.click()
    await expect(preview.locator('.cm-content')).toHaveText('Move between two browsing tabs')
    await expect
      .poll(() => savedTabs(join(h.profile, 'tabs.json'))?.tabs[1]?.file)
      .toBe(join(h.nested, 'between-explorers.txt'))
    await destinationTab.click()
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held file and folder drags move into folder pins without adding pins elsewhere in Quick access', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  const movingFolder = join(h.movies, 'Moving folder')
  try {
    mkdirSync(movingFolder)
    writeFileSync(join(movingFolder, 'kept.txt'), 'Folder contents survive the move\n')
    writeFileSync(join(h.movies, 'unpin-me.txt'), 'Drops never create a pin\n')
    const quick = page.getByRole('region', { name: 'Quick access', exact: true })
    const pins = quick.locator('[data-quick-access-path]')
    while (await pins.count()) {
      await pins.first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).click()
    }
    await row(page, 'Nested').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await search(page, 'notes.txt')
    await row(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await go(page, h.movies)
    const folderPin = quick.getByRole('button', { name: 'Nested', exact: true })
    for (const name of ['readme.txt', 'Moving folder']) {
      await pickUp(page, row(page, name))
      const box = await folderPin.boundingBox()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 8 })
      await expect(folderPin).toHaveAttribute('data-drag-over', 'true')
      if (name === 'readme.txt') await shot(page, info, 'quick-access-folder-drop.png', app)
      await dropOn(page, folderPin)
      await expect.poll(() => existsSync(join(h.nested, name))).toBe(true)
      expect(existsSync(join(h.movies, name))).toBe(false)
      await expect(pins.locator(':scope > span')).toHaveText(['Nested', 'notes.txt'])
      await expect(
        page.getByRole('navigation', { name: 'Folder path', exact: true })
      ).toHaveAttribute('title', h.movies)
    }
    expect(readFileSync(join(h.nested, 'Moving folder', 'kept.txt'), 'utf8')).toBe(
      'Folder contents survive the move\n'
    )

    for (const target of [
      quick.getByRole('heading', { name: 'Quick access', exact: true }),
      quick.getByRole('button', { name: 'notes.txt', exact: true })
    ]) {
      await pickUp(page, row(page, 'unpin-me.txt'))
      await dropOn(page, target)
      await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
      await expect(pins.locator(':scope > span')).toHaveText(['Nested', 'notes.txt'])
      await expect(row(page, 'unpin-me.txt')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    // The section's bottom padding belongs to the region, not a pin target.
    await pickUp(page, row(page, 'unpin-me.txt'))
    const regionBox = await quick.boundingBox()
    const blank = {
      x: regionBox!.x + regionBox!.width / 2,
      y: regionBox!.y + regionBox!.height - 1
    }
    expect(
      await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-quick-access-path]')),
        blank
      )
    ).toBe(false)
    await page.mouse.move(blank.x, blank.y, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
    await expect(pins.locator(':scope > span')).toHaveText(['Nested', 'notes.txt'])
    expect(readFileSync(join(h.movies, 'unpin-me.txt'), 'utf8')).toBe('Drops never create a pin\n')
    expect(existsSync(join(h.nested, 'unpin-me.txt'))).toBe(false)
    await expect(row(page, 'unpin-me.txt')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held Quick access pins only reorder, including across tabs and rejected file destinations', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  const pinnedFolder = join(h.movies, 'Pinned folder')
  const archivePath = join(h.movies, 'pinned.zip')
  try {
    mkdirSync(pinnedFolder)
    writeFileSync(join(pinnedFolder, 'kept.txt'), 'A shortcut must not move this folder\n')
    const archive = new AdmZip()
    archive.addFile('unpacked.txt', Buffer.from('A shortcut must not extract this file\n'))
    archive.writeZip(archivePath)
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    const sourceTab = ordinaryTabs(page).first()
    const projectTab = ordinaryTabs(page).nth(1)
    await sourceTab.click()
    await go(page, h.movies)
    const quick = page.getByRole('region', { name: 'Quick access', exact: true })
    const pins = quick.locator('[data-quick-access-path]')
    while (await pins.count()) {
      await pins.first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Unpin from Quick access', exact: true }).click()
    }
    for (const name of ['readme.txt', 'Pinned folder', 'pinned.zip']) {
      await row(page, name).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    }
    const pin = (name: string) => quick.getByRole('button', { name, exact: true })
    await pickUp(page, pin('pinned.zip'))
    await expect(page.locator('body')).toHaveAttribute('data-internal-file-drag', 'true')
    const first = await pin('readme.txt').boundingBox()
    await page.mouse.move(first!.x + 35, first!.y + 4, { steps: 8 })
    await shot(page, info, 'quick-access-pin-reorder.png', app)
    await page.mouse.up()
    const order = ['pinned.zip', 'readme.txt', 'Pinned folder']
    await expect(pins.locator(':scope > span')).toHaveText(order)
    await newExplorerWithoutPreview(page)
    await go(page, h.nested)
    const destinationTab = ordinaryTabs(page).last()
    const tabCount = await page.getByRole('tab').count()
    await sourceTab.click()

    const unchanged = async () => {
      await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
      await expect(page.getByRole('tab')).toHaveCount(tabCount)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(readFileSync(join(h.movies, 'readme.txt'), 'utf8')).toBe(
        'A different browsing location.\n'
      )
      expect(readFileSync(join(pinnedFolder, 'kept.txt'), 'utf8')).toBe(
        'A shortcut must not move this folder\n'
      )
      expect(existsSync(archivePath)).toBe(true)
      for (const folder of [h.project, h.nested, pinnedFolder]) {
        for (const name of ['readme.txt', 'Pinned folder', 'pinned.zip', 'unpacked.txt']) {
          expect(existsSync(join(folder, name))).toBe(false)
        }
      }
      await sourceTab.click()
      await expect(page.getByTestId('browse-list')).toBeVisible()
      await expect(
        page.getByRole('navigation', { name: 'Folder path', exact: true })
      ).toHaveAttribute('title', h.movies)
      await expect(pins.locator(':scope > span')).toHaveText(order)
    }
    await pickUp(page, pin('readme.txt'))
    await dropOn(page, row(page, 'Pinned folder'))
    await unchanged()

    await pickUp(page, pin('pinned.zip'))
    await page.keyboard.press('Control+Tab')
    await expect(projectTab).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, projectRow(page, 'Nested'))
    await expect(projectTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('No file selected', { exact: true })).toBeVisible()
    await unchanged()

    await pickUp(page, pin('Pinned folder'))
    await page.keyboard.press('Control+Tab')
    await page.keyboard.press('Control+Tab')
    await expect(destinationTab).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, page.getByTestId('browse-list'), true)
    await expect(destinationTab).toHaveAttribute('aria-selected', 'true')
    await unchanged()

    for (const target of [
      destinationTab,
      page.getByRole('button', { name: 'New tab', exact: true })
    ]) {
      await pickUp(page, pin('readme.txt'))
      await dropOn(page, target)
      await expect(sourceTab).toHaveAttribute('aria-selected', 'true')
      await unchanged()
    }
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held project sidebar drags retain their files while Ctrl+Shift+Tab selects another project', async () => {
  const h = await setup()
  const { page, app } = h
  try {
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    await ordinaryTabs(page).first().click()
    await row(page, 'Movies').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.movies, 'readme.txt')
    await pickUp(page, projectRow(page, 'readme.txt'))
    await expect(page.locator('body')).toHaveAttribute('data-internal-file-drag', 'true')
    await page.keyboard.press('Control+Shift+Tab')
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', h.project)
    await expect(page.locator('[data-file-drag-badge]')).toBeVisible()
    await dropOn(page, projectRow(page, 'Nested'))
    await expect.poll(() => existsSync(join(h.nested, 'readme.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'readme.txt'))).toBe(false)
    await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held file drops onto existing tab labels and close areas use that tab folder without opening or selecting tabs', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  try {
    for (const name of ['tab-label.txt', 'tab-close.txt', 'settings-stays.txt']) {
      writeFileSync(join(h.movies, name), `${name}\n`)
    }
    mkdirSync(join(h.movies, 'Project cargo'))
    writeFileSync(
      join(h.movies, 'Project cargo', 'inside.txt'),
      'A folder dropped onto a project tab\n'
    )
    await go(page, h.movies)
    const source = ordinaryTabs(page).first()
    await newExplorerWithoutPreview(page)
    await go(page, h.nested)
    const destination = ordinaryTabs(page).last()
    const destinationWrapper = destination.locator('..')
    await source.click()
    const originalCount = await page.getByRole('tab').count()

    await pickUp(page, row(page, 'tab-label.txt'))
    const target = await destination.boundingBox()
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
      steps: 8
    })
    await expect(destinationWrapper).toHaveAttribute('data-folder-drop', h.nested)
    await expectGreyDropTarget(destinationWrapper)
    await shot(page, info, 'held-existing-tab-drag.png', app)
    await dropOn(page, destination)
    await expect.poll(() => existsSync(join(h.nested, 'tab-label.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'tab-label.txt'))).toBe(false)
    expect(existsSync(join(h.project, 'tab-label.txt'))).toBe(false)
    await expect(source).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab')).toHaveCount(originalCount)

    await pickUp(page, row(page, 'tab-close.txt'))
    await dropOn(page, destinationWrapper.locator('[data-tab-close]'))
    await expect.poll(() => existsSync(join(h.nested, 'tab-close.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'tab-close.txt'))).toBe(false)
    await expect(source).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab')).toHaveCount(originalCount)

    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    const project = ordinaryTabs(page).last()
    await expectEmptyProject(page, h.project, 'notes.txt')
    await source.click()
    await go(page, h.movies)
    await pickUp(page, row(page, 'Project cargo'))
    await dropOn(page, project)
    await expect.poll(() => existsSync(join(h.project, 'Project cargo', 'inside.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'Project cargo'))).toBe(false)
    await expect(source).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab')).toHaveCount(originalCount + 1)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.locator('[data-tab-role="settings"] > [role="tab"]')
    await expect(settings).toHaveAttribute('aria-selected', 'true')
    await source.click()
    await pickUp(page, row(page, 'settings-stays.txt'))
    await dropOn(page, settings)
    await expect(page.locator('[data-file-drag-badge]')).toHaveCount(0)
    await expect(source).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab')).toHaveCount(originalCount + 2)
    expect(readFileSync(join(h.movies, 'settings-stays.txt'), 'utf8')).toBe('settings-stays.txt\n')
    await expect(row(page, 'settings-stays.txt')).toBeVisible()
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

test('held drags preserve the marked row and preview, and selected files and folders keep their blue self-hover', async ({}, info) => {
  const h = await setup()
  const { page, app } = h
  try {
    writeFileSync(
      join(h.movies, 'drag-other.txt'),
      'This file is cargo, not the selected preview\n'
    )
    mkdirSync(join(h.movies, 'Dragging folder'))
    mkdirSync(join(h.movies, 'Target folder'))
    await go(page, h.movies)
    const sourceTab = ordinaryTabs(page).first()
    await newExplorerWithoutPreview(page)
    await go(page, h.nested)
    const destinationTab = ordinaryTabs(page).last()
    await sourceTab.click()
    await row(page, 'readme.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show in preview', exact: true }).click()
    const preview = page.locator('[data-browse-preview="true"] .cm-content')
    await expect(preview).toHaveText('A different browsing location.')
    await expect(row(page, 'readme.txt')).toHaveAttribute('aria-selected', 'true')
    const selectedBlue = await row(page, 'readme.txt').evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )

    await pickUp(page, row(page, 'drag-other.txt'))
    await expect(page.locator('[data-file-drag-badge]')).toContainText('drag-other.txt')
    await page.mouse.move(900, 400, { steps: 8 })
    const badge = page.locator('[data-file-drag-badge]')
    await expect.poll(async () => {
      const box = await badge.boundingBox()
      return !!box && box.x + box.width <= 900 && box.x + box.width >= 888 &&
        box.y >= 404 && box.y <= 420
    }).toBe(true)
    await shot(page, info, 'drag-label-below-left.png', app)
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await page.mouse.move(6, viewport.height - 6, { steps: 8 })
    await expect.poll(async () => {
      const box = await badge.boundingBox()
      return !!box && box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= viewport.width && box.y + box.height <= viewport.height
    }).toBe(true)
    await expect(row(page, 'readme.txt')).toHaveAttribute('aria-selected', 'true')
    await expect(row(page, 'readme.txt')).toHaveCSS('background-color', selectedBlue)
    await expect(row(page, 'drag-other.txt')).toHaveAttribute('aria-selected', 'false')
    await expect(preview).toHaveText('A different browsing location.')
    await page.keyboard.press('Control+Tab')
    await expect(destinationTab).toHaveAttribute('aria-selected', 'true')
    await dropOn(page, page.getByTestId('browse-list'), true)
    await expect.poll(() => existsSync(join(h.nested, 'drag-other.txt'))).toBe(true)
    expect(existsSync(join(h.movies, 'drag-other.txt'))).toBe(false)
    await sourceTab.click()
    await expect(row(page, 'readme.txt')).toHaveAttribute('aria-selected', 'true')
    await expect(preview).toHaveText('A different browsing location.')

    await pickUp(page, row(page, 'readme.txt'))
    await expect(page.locator('[data-file-drag-badge]')).toContainText('readme.txt')
    await expect(row(page, 'readme.txt')).not.toHaveAttribute('data-drag-over', 'true')
    await expect(row(page, 'readme.txt')).toHaveCSS('background-color', selectedBlue)
    await expect(preview).toHaveText('A different browsing location.')
    await shot(page, info, 'held-selected-file-stays-blue.png', app)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(row(page, 'readme.txt')).toHaveAttribute('aria-selected', 'true')

    await row(page, 'Dragging folder').click()
    await expect(row(page, 'Dragging folder')).toHaveAttribute('aria-selected', 'true')
    const folderBlue = await row(page, 'Dragging folder').evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    await pickUp(page, row(page, 'Dragging folder'))
    await expect(row(page, 'Dragging folder')).not.toHaveAttribute('data-drag-over', 'true')
    await expect(row(page, 'Dragging folder')).toHaveCSS('background-color', folderBlue)
    await expect(preview).toHaveText('A different browsing location.')
    const target = await row(page, 'Target folder').boundingBox()
    await page.mouse.move(target!.x + 100, target!.y + target!.height / 2, { steps: 8 })
    await expectGreyDropTarget(row(page, 'Target folder'))
    await expect(row(page, 'Dragging folder')).toHaveCSS('background-color', folderBlue)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(existsSync(join(h.movies, 'Dragging folder'))).toBe(true)
    expect(existsSync(join(h.movies, 'Target folder', 'Dragging folder'))).toBe(false)
  } finally {
    await page.mouse.up().catch(() => {})
    await stop(app)
  }
})

interface NativeFileClipboard {
  paths: string[]
  effect: number | null
  image: { width: number; height: number } | null
}

/** Read the native data object from a different process, after Prism's writer has exited. */
function nativeFileClipboard(): NativeFileClipboard {
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Add-Type -AssemblyName System.Windows.Forms
    $data = [System.Windows.Forms.Clipboard]::GetDataObject()
    $paths = @(if ($data -and $data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
      $data.GetData([System.Windows.Forms.DataFormats]::FileDrop)
    })
    $effect = $null
    if ($data -and $data.GetDataPresent('Preferred DropEffect')) {
      $raw = $data.GetData('Preferred DropEffect')
      $bytes = if ($raw -is [System.IO.MemoryStream]) { $raw.ToArray() } else { [byte[]]$raw }
      $effect = [BitConverter]::ToUInt32($bytes, 0)
    }
    $image = $null
    if ($data -and $data.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)) {
      $bitmap = $data.GetData([System.Windows.Forms.DataFormats]::Bitmap)
      try { $image = @{ width = $bitmap.Width; height = $bitmap.Height } }
      finally { $bitmap.Dispose() }
    }
    @{ paths = $paths; effect = $effect; image = $image } | ConvertTo-Json -Compress
  `
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    })
  )
}

/** Simulate another Windows application's file operation without Prism's renderer cut mark. */
function writeNativeFileClipboard(paths: string[], cut: boolean): void {
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Windows.Forms
    $paths = [System.Collections.Specialized.StringCollection]::new()
    foreach ($path in $request.paths) { [void]$paths.Add($path) }
    $data = [System.Windows.Forms.DataObject]::new()
    $data.SetFileDropList($paths)
    $effect = if ($request.cut) { 2 } else { 1 }
    $stream = [System.IO.MemoryStream]::new([BitConverter]::GetBytes([uint32]$effect))
    try {
      $data.SetData('Preferred DropEffect', $stream)
      [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
    } finally { $stream.Dispose() }
  `
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
    input: JSON.stringify({ paths, cut }),
    encoding: 'utf8',
    windowsHide: true
  })
}

/** Optional local integration: never paste into, configure or close a preexisting Word process. */
function pasteImageInIsolatedWord(): void {
  const script = `
    $ErrorActionPreference = 'Stop'
    $existing = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    if ($existing.Count -ne 0) { throw 'Word isolation requires no existing Word processes; no app or document was changed.' }
    $started = [DateTime]::UtcNow
    $word = $null
    $document = $null
    $range = $null
    $shape = $null
    $owned = $false
    $operationError = $null
    $cleanupError = $null
    $doNotSave = 0
    try {
      $word = New-Object -ComObject Word.Application
      $created = @(Get-CimInstance Win32_Process -Filter "Name = 'WINWORD.EXE'")
      if ($created.Count -ne 1 -or $created[0].CreationDate.ToUniversalTime() -lt $started -or
          $created[0].CommandLine -notmatch '/Automation' -or $created[0].CommandLine -notmatch '-Embedding') {
        throw 'Word isolation could not be established; no document was created or changed.'
      }
      $owned = $true
      [Console]::WriteLine('Owned Word process: ' + $created[0].ProcessId)
      if ($word.Documents.Count -ne 0) { throw 'The Word process has a document already; it was left untouched.' }
      $word.Visible = $false
      $word.DisplayAlerts = 0
      $document = $word.Documents.Add()
      $range = $document.Content
      $range.Paste()
      if ($document.InlineShapes.Count -ne 1) { throw 'Word did not paste one inline picture.' }
      $shape = $document.InlineShapes.Item(1)
      if ($shape.Type -ne 3 -or $shape.Width -le 0 -or $shape.Height -le 0) {
        throw 'The pasted Word content is not a picture with dimensions.'
      }
      [Console]::WriteLine('WORD_IMAGE_PASTE_OK InlineShapes=1 Type=3')
    } catch {
      $operationError = $_
    } finally {
      if ($owned) {
        try { if ($document) { $document.Close([ref]$doNotSave) } }
        catch { $cleanupError = $_ }
        finally {
          try { if ($word -and $word.Documents.Count -eq 0) { $word.Quit([ref]$doNotSave) } }
          catch { if (-not $cleanupError) { $cleanupError = $_ } }
        }
      }
      foreach ($com in @($shape, $range, $document, $word)) {
        if ($com -and [System.Runtime.InteropServices.Marshal]::IsComObject($com)) {
          try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($com) }
          catch { if (-not $cleanupError) { $cleanupError = $_ } }
        }
      }
    }
    if ($operationError) {
      if ($cleanupError) { [Console]::Error.WriteLine('Word cleanup also failed: ' + $cleanupError) }
      throw $operationError
    }
    if ($cleanupError) { throw $cleanupError }
  `
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000
    }
  )
  expect(output).toContain('WORD_IMAGE_PASTE_OK')
  console.log(output.trim())
}

test('Windows clipboard retains native file lists, copy and cut effects, and image pixels across Explorer and project copy actions', async () => {
  const h = await setup()
  const { page, app } = h
  const restoreClipboard = await keepClipboard(app)
  const fileName = "notat-ÆØÅ 東京 O'Brien $(literal).txt"
  const folderName = "Folder O'Brien $(literal)"
  const imageName = "bilde-æ O'Brien $(literal).png"
  const filePath = join(h.movies, fileName)
  const folderPath = join(h.movies, folderName)
  const imagePath = join(h.movies, imageName)
  try {
    writeFileSync(filePath, 'Literal path data must not be interpreted as a command\n')
    mkdirSync(folderPath)
    copyFileSync(join(ROOT, 'build/icon.png'), imagePath)
    await go(page, h.movies)
    await row(page, fileName).click()
    await page.keyboard.press('Control+c')
    await expect.poll(nativeFileClipboard).toEqual({ paths: [filePath], effect: 1, image: null })
    await page.keyboard.press('Control+x')
    await expect.poll(nativeFileClipboard).toEqual({ paths: [filePath], effect: 2, image: null })
    expect(existsSync(filePath)).toBe(true)
    await row(page, folderName).click()
    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(nativeFileClipboard).toEqual({ paths: [folderPath], effect: 1, image: null })

    await go(page, h.home)
    await row(page, 'Movies').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.movies, 'readme.txt')
    await projectRow(page, fileName).click()
    await projectRow(page, folderName).click({ modifiers: ['Control'] })
    await expect(page.getByRole('tree').locator('[data-selected="true"]')).toHaveCount(2)
    await page.keyboard.press('Control+c')
    await expect
      .poll(() => {
        const value = nativeFileClipboard()
        return { ...value, paths: [...value.paths].sort() }
      })
      .toEqual({ paths: [filePath, folderPath].sort(), effect: 1, image: null })

    await projectRow(page, imageName).click()
    await page.keyboard.press('Control+c')
    const png = readFileSync(imagePath)
    const image = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    await expect.poll(nativeFileClipboard).toEqual({ paths: [imagePath], effect: 1, image })
    // The persistent pixels remain readable after another receiving process opens the clipboard.
    expect(nativeFileClipboard()).toEqual({ paths: [imagePath], effect: 1, image })
    if (process.env.PRISM_TEST_WORD === '1') pasteImageInIsolatedWord()
    await page.keyboard.press('Control+x')
    await expect.poll(nativeFileClipboard).toEqual({ paths: [imagePath], effect: 2, image: null })
    expect(existsSync(imagePath)).toBe(true)

    // An external copy replaces a stale Prism cut of this exact same Unicode path.
    writeNativeFileClipboard([imagePath], false)
    await ordinaryTabs(page).first().click()
    await go(page, h.nested)
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.nested, imageName))).toBe(true)
    expect(existsSync(imagePath)).toBe(true)
    expect(readFileSync(join(h.nested, imageName))).toEqual(png)

    // Conversely, a cut from another app moves even though Prism never marked this file cut.
    writeNativeFileClipboard([filePath], true)
    await page.getByTestId('browse-list').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(h.nested, fileName))).toBe(true)
    await expect.poll(() => existsSync(filePath)).toBe(false)
    expect(readFileSync(join(h.nested, fileName), 'utf8')).toBe(
      'Literal path data must not be interpreted as a command\n'
    )
  } finally {
    await restoreClipboard()
    await stop(app)
  }
})

test('Explorer hides title filenames while a collapsed project still names its file', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    const title = page.getByTestId('titlebar-file-name')
    const explorer = ordinaryTabs(page).first()
    await go(page, h.movies)
    await row(page, 'readme.txt').click()
    await page.getByRole('button', { name: 'Preview pane', exact: true }).click()
    await expect(page.locator('[data-browse-preview]')).toBeVisible()
    await expect(title).toHaveText('')
    await shot(page, info, 'win-e-explorer-titlebar-preview.png', app)
    await page.getByRole('button', { name: 'Toggle file tree', exact: true }).click()
    await expect(title).toHaveText('')
    await row(page, 'readme.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(title).toHaveText('')
    await page.getByRole('button', { name: 'Toggle file tree', exact: true }).click()
    await expect(title).toHaveText('')
    await returnToFolder(page)
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    await projectRow(page, 'notes.txt').click()
    await expect(title).toHaveText('')
    await page.getByRole('button', { name: 'Toggle file tree', exact: true }).click()
    await expect(title).toHaveText('notes.txt')
    // Return with the project sidebar preference closed, reproducing the reported leak.
    await explorer.click()
    await go(page, h.movies)
    await row(page, 'readme.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await expect(title).toHaveText('')
    await shot(page, info, 'win-e-explorer-titlebar-full.png', app)
  } finally {
    await stop(app)
  }
})

test('Win+E General setting uses confirmed Windows state and handles failures without touching a real helper', async ({}, info) => {
  const h = await setup()
  const { app, page } = h
  try {
    await app.evaluate(({ ipcMain }) => {
      const fixture = {
        status: { available: true, enabled: false, running: false, conflict: false, error: '' },
        writes: [] as boolean[], release: () => {}, failNext: false
      }
      ;(globalThis as unknown as { __winEFixture: typeof fixture }).__winEFixture = fixture
      const initial = new Promise<void>((resolve) => { fixture.release = resolve })
      ipcMain.removeHandler('win-e:status')
      ipcMain.handle('win-e:status', async () => { await initial; return fixture.status })
      ipcMain.removeHandler('win-e:set')
      ipcMain.handle('win-e:set', (_event, enabled: boolean) => {
        fixture.writes.push(enabled)
        if (fixture.failNext) {
          fixture.failNext = false
          return { ...fixture.status, error: 'Windows could not start the shortcut helper.' }
        }
        fixture.status = { ...fixture.status, enabled, running: enabled, error: '' }
        return fixture.status
      })
    })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'General', exact: true }).click()
    const control = page.getByRole('switch', { name: 'Open Prism with Win+E', exact: true })
    await expect(control).toHaveAttribute('aria-checked', 'false')
    await expect(control).toBeDisabled()
    await app.evaluate(() => (globalThis as unknown as { __winEFixture: { release: () => void } }).__winEFixture.release())
    await expect(control).toBeEnabled()
    await app.evaluate(() => { (globalThis as unknown as { __winEFixture: { failNext: boolean } }).__winEFixture.failNext = true })
    await control.click()
    await expect(page.getByRole('status')).toContainText('Windows could not start the shortcut helper.')
    await expect(control).toHaveAttribute('aria-checked', 'false')
    await control.click()
    await expect(control).toHaveAttribute('aria-checked', 'true')
    await control.click()
    await expect(control).toHaveAttribute('aria-checked', 'false')
    expect(await app.evaluate(() => (globalThis as unknown as { __winEFixture: { writes: boolean[] } }).__winEFixture.writes)).toEqual([true, true, false])
    await control.scrollIntoViewIfNeeded()
    await shot(page, info, 'win-e-general-setting.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    })
    await control.scrollIntoViewIfNeeded()
    await expect(control).toBeInViewport()
    await expect(control).toBeEnabled()
    await expect(control).toHaveAttribute('aria-checked', 'false')
    const hint = page.locator('#win-e-shortcut-hint')
    const label = page.locator('label[for="win-e-shortcut"]')
    await expect(hint).toBeInViewport()
    await expect(label).toBeInViewport()
    const switchBounds = await control.boundingBox()
    const hintBounds = await hint.boundingBox()
    const labelBounds = await label.boundingBox()
    expect(hintBounds!.x + hintBounds!.width).toBeLessThanOrEqual(switchBounds!.x)
    expect(labelBounds!.x + labelBounds!.width).toBeLessThanOrEqual(switchBounds!.x)
    await shot(page, info, 'win-e-general-setting-zoom200.png', app)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    })
    for (const mode of ['conflict', 'unavailable'] as const) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await app.evaluate((_electron, mode) => {
        const fixture = (globalThis as unknown as { __winEFixture: { status: { available: boolean; enabled: boolean; running: boolean; conflict: boolean; error: string } } }).__winEFixture
        fixture.status = { available: mode !== 'unavailable', enabled: false, running: false, conflict: mode === 'conflict', error: mode === 'unavailable' ? 'Available in the installed Windows app.' : '' }
      }, mode)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(control).toBeDisabled()
      await expect(control).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByRole('status')).toContainText(mode === 'conflict' ? 'Another Prism installation or profile controls Win+E.' : 'Available in the installed Windows app.')
    }
  } finally {
    await stop(app)
  }
})

test('Win+E activates the pinned Explorer folder before acknowledging and preserves the project', async () => {
  const h = await setup()
  const { app, page } = h
  try {
    const pinned = page.locator('[data-pinned] > [role="tab"]')
    await pinned.click()
    await go(page, h.movies)
    await row(page, 'readme.txt').dblclick()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
    await ordinaryTabs(page).first().click()
    await go(page, h.home)
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expectEmptyProject(page, h.project, 'notes.txt')
    const projectTab = page.locator('[data-tab-role="project"] > [role="tab"]')
    await projectRow(page, 'notes.txt').click()
    const count = await page.getByRole('tab').count()
    const id = randomUUID()
    await app.evaluate(({ ipcMain, BrowserWindow }, requestId) => {
      const fixture = { acknowledgements: [] as string[] }
      ;(globalThis as unknown as { __winERequests: typeof fixture }).__winERequests = fixture
      ipcMain.on('win-e:ready', (_event, id: string) => fixture.acknowledgements.push(id))
      BrowserWindow.getAllWindows()[0].webContents.send('win-e:open', requestId)
    }, id)
    await expect(pinned).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(row(page, 'readme.txt')).toBeVisible()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __winERequests: { acknowledgements: string[] } }).__winERequests.acknowledgements)).toEqual([id])
    await expect(page.getByRole('tab')).toHaveCount(count)
    await projectTab.click()
    await expect(projectRow(page, 'notes.txt')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toBeVisible()
    await expect(page.getByTestId('folder-browser')).toHaveCount(0)
  } finally {
    await stop(app)
  }
})

/** A real local ACK endpoint, standing in for the helper without registering Win+E. */
async function winEAckPipe(requestId: string, observe: () => Promise<unknown>) {
  const messages: string[] = []
  const observations: Promise<unknown>[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let text = ''
    socket.on('data', (data) => {
      text += data.toString('utf8')
      if (!text.includes('\n')) return
      messages.push(text.trim())
      // Observe the rendered surface as soon as main acknowledges the request.
      observations.push(observe())
      socket.end()
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(String.raw`\\.\pipe\PrismWinE.${requestId}`, resolve)
  })
  return {
    messages,
    observations,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

async function winEVisibleState(page: Page) {
  return page.evaluate(() => {
    const selected = document.querySelector('[role="tab"][aria-selected="true"]')
    const folder = document.querySelector<HTMLElement>('[data-testid="folder-browser"]')
    return {
      role: selected?.parentElement?.getAttribute('data-tab-role'),
      pinned: selected?.parentElement?.hasAttribute('data-pinned'),
      folderVisible: !!folder?.getClientRects().length,
      folder: document.querySelector('nav[aria-label="Folder path"]')?.getAttribute('title'),
      projects: document.querySelectorAll('[data-tab-role="project"] > [role="tab"]').length
    }
  })
}

/** Leave a real saved project active and the pinned Explorer on a full-file surface. */
async function prepareWinEProject(h: Harness): Promise<void> {
  const { page } = h
  await page.locator('[data-pinned] > [role="tab"]').click()
  await go(page, h.movies)
  await row(page, 'readme.txt').dblclick()
  await expect(page.getByTestId('folder-browser')).toHaveCount(0)
  await ordinaryTabs(page).first().click()
  await go(page, h.home)
  await row(page, 'Prism Project').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
  await expectEmptyProject(page, h.project, 'notes.txt')
  await projectRow(page, 'notes.txt').click()
  await expect.poll(() => {
    const saved = savedTabs(join(h.profile, 'tabs.json'))
    return saved?.tabs[saved.active]
  }).toMatchObject({ role: 'project', root: h.project, file: join(h.project, 'notes.txt') })
}

async function expectWinEProjectPreserved(h: Harness): Promise<void> {
  const { page } = h
  const project = page.locator('[data-tab-role="project"] > [role="tab"]')
  await expect(project).toHaveCount(1)
  await expect(project).toHaveAttribute('title', h.project)
  await project.click()
  await expect(projectRow(page, 'notes.txt')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox').filter({ hasText: 'Original notes' })).toBeVisible()
  await expect(page.getByTestId('folder-browser')).toHaveCount(0)
}

test('Win+E cold CLI launch restores projects and acknowledges the rendered Explorer over its named pipe', async () => {
  test.skip(process.platform !== 'win32', 'The shortcut acknowledgement uses a Windows named pipe.')
  const h = await setup()
  let live = true
  let pipe: Awaited<ReturnType<typeof winEAckPipe>> | undefined
  try {
    await prepareWinEProject(h)
    const count = await h.page.getByRole('tab').count()
    await stop(h.app)
    live = false
    const id = randomUUID()
    pipe = await winEAckPipe(id, async () => winEVisibleState((await launch).page))
    const launch = start(h.profile, [`--win-e=${id}`])
    ;({ app: h.app, page: h.page } = await launch)
    live = true
    await expect.poll(() => pipe!.messages).toEqual([id])
    expect(await pipe.observations[0]).toEqual({
      role: 'explorer', pinned: true, folderVisible: true, folder: h.movies, projects: 1
    })
    await expect(h.page.getByRole('tab')).toHaveCount(count)
    await expect(h.page.locator('[data-pinned] > [role="tab"]')).toHaveAttribute('aria-selected', 'true')
    await expect(row(h.page, 'readme.txt')).toBeVisible()
    await expectWinEProjectPreserved(h)
  } finally {
    if (live) await stop(h.app)
    await pipe?.close()
  }
})

interface WinEChild {
  id: string
  profile: string
  executable: string
  pid?: number
  browser?: Browser
  page?: Page
}

/** Real detached children expose CDP on a random loopback port only under --e2e. */
async function connectWinEChild(child: WinEChild): Promise<Page> {
  let endpoint = ''
  await expect.poll(() => {
    try {
      const marker = JSON.parse(readFileSync(join(child.profile, 'prism-window.json'), 'utf8'))
      const [port, path] = readFileSync(join(child.profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/)
      if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0 || marker.closed !== false) return false
      if (!/^\d+$/.test(port) || Number(port) > 65535 || Number(port) < 1 || !path.startsWith('/devtools/browser/')) return false
      child.pid = marker.pid
      endpoint = `ws://127.0.0.1:${port}${path}`
      return true
    } catch {
      return false
    }
  }, { timeout: 30_000 }).toBe(true)
  child.browser = await chromium.connectOverCDP(endpoint)
  await expect.poll(() => child.browser!.contexts().flatMap((context) => context.pages()).length).toBe(1)
  child.page = child.browser.contexts()[0].pages()[0]
  await child.page.waitForLoadState('domcontentloaded')
  await expect(child.page.getByTestId('folder-browser')).toBeVisible()
  return child.page
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Never sweep processes by image name. Even fallback cleanup checks this request's exact identity. */
async function stopWinEChild(child: WinEChild, owner: string): Promise<void> {
  const expected = join(resolve(owner), 'explorer-windows', child.id)
  expect(resolve(child.profile)).toBe(expected)
  expect(child.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  if (!child.pid && existsSync(join(expected, 'prism-window.json')))
    child.pid = JSON.parse(readFileSync(join(expected, 'prism-window.json'), 'utf8')).pid
  await child.page?.evaluate(() => window.prism.close(true)).catch(() => {})
  try {
    if (child.pid) {
      expect(Number.isSafeInteger(child.pid) && child.pid > 0).toBe(true)
      try {
        await expect.poll(() => processIsAlive(child.pid!), { timeout: 5000 }).toBe(false)
      } catch {
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`
        ], { windowsHide: true })
        const live = stdout.trim() ? JSON.parse(stdout) : null
        if (live) {
          expect(live.ProcessId).toBe(child.pid)
          expect(live.ExecutablePath.toLowerCase()).toBe(child.executable.toLowerCase())
          expect(live.CommandLine).toContain(`--user-data-dir=${expected}`)
          expect(live.CommandLine).toContain(`--explorer-window=${child.id}`)
          await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        }
        await expect.poll(() => processIsAlive(child.pid!)).toBe(false)
      }
      // The exact profile and exited PID were verified above. The primary may already have removed it.
      rmSync(expected, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  } finally {
    await child.browser?.close().catch(() => {})
  }
}

test('Win+E warm CLI requests open independent Explorer processes with shared preferences and isolated sessions', async () => {
  test.skip(process.platform !== 'win32', 'The shortcut acknowledgement uses a Windows named pipe.')
  const h = await setup()
  const children: WinEChild[] = []
  const pipes: Awaited<ReturnType<typeof winEAckPipe>>[] = []
  let primaryLive = true
  try {
    await go(h.page, h.project)
    await search(h.page, 'notes.txt')
    await row(h.page, 'notes.txt').click({ button: 'right' })
    await h.page.getByRole('menuitem', { name: 'Pin to Quick access', exact: true }).click()
    await search(h.page, '')
    const pins = await h.page.evaluate(() => localStorage.getItem('prism.quickAccess'))
    await prepareWinEProject(h)
    const count = await h.page.getByRole('tab').count()
    const launch = await h.app.evaluate(({ app }) => ({
      executable: app.getPath('exe'), packaged: app.isPackaged, home: app.getPath('home'), pid: process.pid
    }))
    await h.page.evaluate(() => {
      localStorage.setItem('prism.tree.side', 'right')
      localStorage.setItem('prism.sidebar.width', '419')
      localStorage.setItem('prism.phone.win-e-fixture', 'parent-only')
      sessionStorage.setItem('win-e-fixture', 'parent-only')
    })

    const openChild = async (): Promise<Page> => {
      const id = randomUUID()
      const child: WinEChild = { id, profile: join(h.profile, 'explorer-windows', id), executable: launch.executable }
      children.push(child)
      // ACK can arrive before CDP attaches; no renderer interaction occurs before this observation.
      const pipe = await winEAckPipe(id, async () => winEVisibleState(await connection))
      pipes.push(pipe)
      const connection = connectWinEChild(child)
      const [page] = await Promise.all([connection, promisify(execFile)(launch.executable, [
        ...(launch.packaged ? [] : [MAIN]), `--user-data-dir=${h.profile}`,
        '--preview', '--e2e', `--win-e=${id}`
      ], { windowsHide: true, timeout: 15000 })])
      await expect.poll(() => pipe.messages).toEqual([id])
      expect(await pipe.observations[0]).toEqual({
        role: 'explorer', pinned: true, folderVisible: true, folder: launch.home, projects: 0
      })
      await expect(page.getByRole('tab')).toHaveCount(1)
      expect(child.pid).not.toBe(launch.pid)
      await expect(h.page.getByRole('tab')).toHaveCount(count)
      await expect(h.page.locator('[data-tab-role="project"] > [role="tab"]')).toHaveAttribute('aria-selected', 'true')
      await expectWinEProjectPreserved(h)
      return page
    }

    const first = await openChild()
    const firstPreferences = await first.evaluate(() => ({
      side: localStorage.getItem('prism.tree.side'), pins: localStorage.getItem('prism.quickAccess'),
      width: localStorage.getItem('prism.sidebar.width'), phone: localStorage.getItem('prism.phone.win-e-fixture'),
      session: sessionStorage.getItem('win-e-fixture')
    }))
    expect(firstPreferences).toMatchObject({ side: 'right', pins, phone: null, session: null })
    expect(firstPreferences.width).not.toBe('419')
    await expect(first.locator('.browse-places').getByRole('button', { name: 'notes.txt', exact: true })).toBeVisible()
    const notes = join(h.project, 'notes.txt')
    expect(await first.evaluate((path) => window.prism.readText(path), notes)).toEqual({ error: 'unreadable' })
    await go(first, h.project)
    expect(await first.evaluate((path) => window.prism.readText(path), notes)).toEqual({ text: 'Original notes\n' })
    await first.evaluate(() => {
      localStorage.setItem('prism.tree.side', 'left')
      sessionStorage.setItem('win-e-fixture', 'first-only')
    })

    const second = await openChild()
    expect(children[0].pid).not.toBe(children[1].pid)
    expect(await second.evaluate(() => localStorage.getItem('prism.tree.side'))).toBe('left')
    expect(await second.evaluate(() => sessionStorage.getItem('win-e-fixture'))).toBeNull()
    expect(await second.evaluate((path) => window.prism.readText(path), notes)).toEqual({ error: 'unreadable' })
    await go(second, h.project)
    expect(await second.evaluate((path) => window.prism.readText(path), notes)).toEqual({ text: 'Original notes\n' })
    await go(second, h.movies)
    await expect(first.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute('title', h.project)
    await expect.poll(() => h.page.evaluate(() => localStorage.getItem('prism.tree.side'))).toBe('left')
    expect(await h.page.evaluate(() => localStorage.getItem('prism.sidebar.width'))).toBe('419')

    // Identical terminal IDs in three real processes must address three distinct shells.
    const terminalId = `win-e-isolation-${randomUUID()}`
    for (const [page, owner, cwd] of [[h.page, 'parent', h.project], [first, 'first', h.project], [second, 'second', h.movies]] as const) {
      expect(await page.evaluate(({ id, cwd }) => window.prism.termSpawn(id, cwd, 'cmd'), { id: terminalId, cwd })).toBe(true)
      await page.evaluate(({ id, owner }) => window.prism.termInput(id, `set PRISM_WIN_E_OWNER=${owner}\r`), { id: terminalId, owner })
    }
    const checkTerminal = async (page: Page, owner: string): Promise<void> => {
      const output = join(h.home, `terminal-${owner}-${randomUUID()}.txt`)
      await page.evaluate(({ id, output }) => window.prism.termInput(id, `echo %PRISM_WIN_E_OWNER%>"${output}"\r`), { id: terminalId, output })
      await expect.poll(() => existsSync(output) ? readFileSync(output, 'utf8').trim() : null).toBe(owner)
    }
    await checkTerminal(h.page, 'parent')
    await checkTerminal(first, 'first')
    await checkTerminal(second, 'second')
    await expectWinEProjectPreserved(h)
    await stop(h.app)
    primaryLive = false
    await checkTerminal(first, 'first')
    await checkTerminal(second, 'second')
    await go(second, h.nested)
    await expect(row(second, 'inside.txt')).toBeVisible()
    await expect(first.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute('title', h.project)
  } finally {
    const cleanup = await Promise.allSettled(children.map((child) => stopWinEChild(child, h.profile)))
    if (primaryLive) await stop(h.app)
    await Promise.all(pipes.map((pipe) => pipe.close()))
    expect(cleanup.filter((result) => result.status === 'rejected'), 'Only owned child processes and profiles must be cleaned up').toEqual([])
  }
})

test('Win+E paints a usable loading window before App loads and acknowledges only the rendered Explorer', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The shortcut acknowledgement uses a Windows named pipe.')
  const { createServer: createHttpServer } = await import('node:http')
  const profile = join(tmpdir(), `prism-startup-e2e-${randomUUID()}`)
  mkdirSync(profile, { recursive: true })
  const incomingFile = join(profile, 'queued-open.txt')
  writeFileSync(incomingFile, 'Opened while the loading window was visible.\n')
  const id = randomUUID()
  let releaseApp!: () => void
  const heldApp = new Promise<void>((resolve) => { releaseApp = resolve })
  let appRequested = false
  const server = createHttpServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      const path = join(ROOT, 'out/renderer', pathname === '/' ? 'index.html' : pathname)
      if (/\/renderApp-[^/]+\.js$/.test(pathname)) {
        appRequested = true
        await heldApp
      }
      try {
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
        response.setHeader('Cache-Control', 'no-store')
        response.end(readFileSync(path))
      } catch {
        response.writeHead(404).end()
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  let app: ElectronApplication | undefined
  let page: Page | undefined
  const pipe = await winEAckPipe(id, async () => winEVisibleState(page!))
  try {
    const executablePath = process.env.PRISM_BROWSE_EXECUTABLE
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : [MAIN]), `--user-data-dir=${profile}`, '--preview', '--e2e', `--win-e=${id}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${address.port}/` }
    })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await park(app)
    await expect.poll(() => appRequested).toBe(true)
    await expect(page.getByTestId('window-loading')).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Opening Prism…')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    expect(pipe.messages).toEqual([])
    await shot(page, info, 'window-loading.png', app)
    await app.evaluate(({ app }, file) => {
      app.emit('second-instance', {}, [process.execPath, file], process.cwd())
    }, incomingFile)
    await page.getByRole('button', { name: 'Maximize', exact: true }).click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    await page.getByRole('button', { name: 'Maximize', exact: true }).click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false)
    await page.evaluate(() => localStorage.setItem('prism.onboarded', '1'))
    // Hold initial session messages after React mounts, reproducing slow folder
    // discovery without depending on disk speed or delaying the App chunk again.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const send = contents.send.bind(contents)
      const queued: Array<[string, ...unknown[]]> = []
      contents.send = (channel, ...args) => {
        if (['open:file', 'open:restored', 'win-e:open'].includes(channel)) queued.push([channel, ...args])
        else send(channel, ...args)
      }
      Object.assign(globalThis, {
        releaseStartupMessages: () => {
          contents.send = send
          for (const [channel, ...args] of queued) send(channel, ...args)
        }
      })
    })
    releaseApp()
    await expect(page.getByTestId('window-loading')).toHaveCount(0)
    await expect(page.getByTestId('window-restoring')).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Opening Prism…')
    await expect(page.getByText('Open a file or folder to view it', { exact: true })).toHaveCount(0)
    expect(pipe.messages).toEqual([])
    await shot(page, info, 'window-restoring.png', app)
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & { releaseStartupMessages?: () => void }
      state.releaseStartupMessages!()
      delete state.releaseStartupMessages
    })
    await expect(page.getByTestId('folder-browser')).toBeVisible()
    await expect(page.getByTestId('window-restoring')).toHaveCount(0)
    await expect.poll(() => pipe.messages).toEqual([id])
    expect(await pipe.observations[0]).toMatchObject({ role: 'explorer', pinned: true, folderVisible: true })
    await expect.poll(() => savedTabs(join(profile, 'tabs.json'))?.tabs.some((tab) => tab.file === incomingFile)).toBe(true)
    await ordinaryTabs(page).last().click()
    await expect(page.getByRole('textbox').filter({ hasText: 'Opened while the loading window was visible.' })).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally {
    releaseApp()
    if (app) await stop(app)
    await pipe.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
