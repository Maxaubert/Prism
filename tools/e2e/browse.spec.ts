/* eslint-disable no-empty-pattern -- Playwright requires a destructured fixture argument, including tests without browser fixtures. */
import { test, expect, type TestInfo } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

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
    term?: string
    browse?: { path: string; surface: string }
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
    const payload = await page.evaluate((folder) => window.prism.openRoot(folder), project)
    expect(payload).toBeTruthy()
    await app.evaluate(({ BrowserWindow }, opened) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open:file', { ...opened, folder: true })
    }, payload)
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
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
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
      page.getByRole('button', { name: 'New terminal here', exact: true })
    ).toBeInViewport()
    await expect(page.getByTestId('browse-list')).toBeInViewport()
    await shot(page, info, 'zoom200.png', h.app)
  } finally {
    await stop(h.app)
  }
})

test('Explorer stays pinned, new tabs browse immediately, and places and path controls work', async () => {
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
    await blank.click({ position: { x: 3, y: 18 } })
    await expect(page.getByRole('textbox', { name: 'Folder path', exact: true })).toBeVisible()
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
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toBeVisible()
    await expect(page.getByRole('tree')).toHaveCount(0)
    await page.keyboard.press('Control+b')
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('folder-browser')).toHaveAttribute('data-places-hidden', 'true')
    await page.keyboard.press('Control+b')
    await expect(page.getByRole('complementary', { name: 'Locations', exact: true })).toBeVisible()

    await page.evaluate(() => localStorage.removeItem('prism.tabs.confirmClose'))
    await page.keyboard.press('Control+w')
    await expect(ordinaryTabs(page)).toHaveCount(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pinned).toHaveCount(1)
  } finally {
    await stop(h.app)
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
    await search(page, 'Prism Project')
    await row(page, 'Prism Project').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as project', exact: true }).click()
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('title', h.project)
    await expect(page.getByRole('tree')).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.project)

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
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(page.getByRole('tab')).toHaveCount(count)
    await expect(page.locator('[data-pinned]')).toHaveCount(1)
    const restoredExplorer = page.locator(
      '[data-tab-role="explorer"]:not([data-pinned]) > [role="tab"]'
    )
    await restoredExplorer.click()
    await expect(
      page.getByRole('navigation', { name: 'Folder path', exact: true })
    ).toHaveAttribute('title', h.home)
    await expect(
      page.getByRole('searchbox', { name: 'Search this folder and subfolders', exact: true })
    ).toHaveValue('Prism Project')
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

test('two real shell tabs retain cwd and work while another tab browses and opens media', async ({}, info) => {
  const h = await setup()
  const { page } = h
  try {
    videoFixture(h.movies)
    const tabs = ordinaryTabs(page)
    await page.getByRole('button', { name: 'New terminal here', exact: true }).click()
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
    await page.getByRole('button', { name: 'New terminal here', exact: true }).click()
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
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
    await go(page, h.nested)
    await expect(
      page.getByRole('button', { name: 'Use folder in terminal', exact: true })
    ).toBeDisabled()
    await expect(tabs.nth(2)).toHaveText('Movies')
    await tabs.nth(0).click()
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
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
    await expect(row(page, 'sample.mp4')).toHaveAttribute('aria-selected', 'true')
    await shot(page, info, 'sessions-and-browser.png', h.app)
    writeFileSync(stopSignal, 'stop')
    await tabs.nth(2).click()
    await page.getByRole('button', { name: 'Return to terminal', exact: true }).click()
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
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
    await go(page, h.movies)
    await page.getByRole('button', { name: 'New terminal here', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await ordinaryTabs(page).first().click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await row(page, 'notes.txt').dblclick()
    await expect(editor).toContainText('Unsaved browsing test')
    expect(readFileSync(join(h.project, 'notes.txt'), 'utf8')).toBe('Original notes\n')
    await shot(page, info, 'dirty-buffer-retained.png', h.app)
    videoFixture(h.movies)
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
    await go(page, h.movies)
    await row(page, 'sample.mp4').click()
    await page.getByRole('button', { name: 'Preview pane', exact: true }).click()
    await expect(page.locator('video')).toHaveCount(1)
    await expect(page.locator('video')).toBeVisible()
    const player = await page.locator('video').elementHandle()
    expect(player).toBeTruthy()
    await expect.poll(() => player!.evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2)
    await row(page, 'sample.mp4').dblclick()
    await expect(page.getByTestId('folder-browser')).not.toBeVisible()
    expect(
      await player!.evaluate(
        (video) => video.isConnected && video === document.querySelector('video')
      )
    ).toBe(true)
    await expect(page.locator('video')).toHaveCount(1)
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
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
    await page.getByRole('button', { name: 'New terminal here', exact: true }).click()
    await shellReady(page, h.project)
    await shellLine(page, `Set-Location -LiteralPath ${quotePS(h.nested)}`)
    await shellReady(page, h.nested)
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
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
        browse: { path: h.movies, surface: 'folder' }
      })
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toHaveAttribute(
      'title',
      h.movies
    )
    await page.getByRole('button', { name: 'Return to terminal', exact: true }).click()
    await shellReady(page, h.nested)
    await shot(page, info, 'restored-terminal-cwd.png', app)
  } finally {
    await stop(app)
  }
})

test('pinned file panes survive browsing, terminal tabs and restart', async () => {
  const h = await setup()
  let { app, page } = h
  try {
    await page.getByRole('searchbox', { name: 'Search this folder' }).fill('notes.txt')
    await row(page, 'notes.txt').dblclick()
    const pinPath = join(h.project, 'entry-000.txt')
    const treeRow = page
      .getByRole('treeitem')
      .filter({ has: page.getByText('entry-000.txt', { exact: true }) })
    await treeRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in split view', exact: true }).click()
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Browse files', exact: true }).click()
    await go(page, h.movies)
    await page.getByRole('button', { name: 'New terminal here', exact: true }).click()
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await ordinaryTabs(page).first().click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await row(page, 'notes.txt').dblclick()
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(1)
    const saved = join(h.profile, 'tabs.json')
    await expect
      .poll(() => {
        const snapshot = savedTabs(saved)
        return snapshot ? { active: snapshot.active, tab: snapshot.tabs[1] } : null
      })
      .toMatchObject({
        active: 1,
        tab: { browse: { path: h.project, surface: 'viewer' }, panes: [{ path: pinPath }] }
      })
    await stop(app)
    ;({ app, page } = await start(h.profile))
    await expect(ordinaryTabs(page)).toHaveCount(2)
    await expect(page.locator('[data-pane="pinned"]')).toHaveCount(1)
    await expect(page.locator('[data-pane="pinned"] .cm-content')).toHaveText('0')
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
    await expect(ordinaryTabs(page).first()).toHaveText('Prism Project')
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
