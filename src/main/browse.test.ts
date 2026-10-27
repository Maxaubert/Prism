import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browseDirectory, browseLocations } from './browse'
import {
  grantDesktopDirectory,
  insideDesktop,
  releaseDesktop,
  resetDesktopAccess,
  validDesktopRoot
} from './desktopAccess'
import { addRoot, insideAnyRoot, openRoots, resetRoots, validRoot } from './roots'
import { listDir } from './dirList'
import { parseTabs } from './tabs'

let box: string
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-browse-'))
  resetRoots()
  resetDesktopAccess()
})
afterEach(() => rmSync(box, { recursive: true, force: true }))

describe('desktop browsing authority', () => {
  it('visits a parent without expanding the paired phone root or granting all descendants', async () => {
    const project = join(box, 'project')
    const privateDir = join(box, 'private')
    mkdirSync(project)
    mkdirSync(privateDir)
    const secret = join(privateDir, 'secret.txt')
    writeFileSync(secret, 'private')
    addRoot(project)
    await browseDirectory('files', box)
    expect(openRoots()).toEqual([project])
    expect(validRoot(project, box)).toBe(false)
    expect(insideAnyRoot(secret)).toBe(false)
    expect(insideDesktop(secret)).toBe(false)
    expect(insideDesktop(privateDir)).toBe(true)
    expect(validDesktopRoot(box, privateDir)).toBe(true)
    await browseDirectory('files', privateDir)
    expect(insideDesktop(secret)).toBe(true)
    expect(validRoot(project, secret)).toBe(false)
    releaseDesktop('files')
    expect(insideDesktop(secret)).toBe(false)
    expect(insideDesktop(project)).toBe(true)
  })

  it('retains visited directories per tab until the owner closes', async () => {
    const one = join(box, 'one')
    const two = join(box, 'two')
    mkdirSync(one)
    mkdirSync(two)
    // Dirty buffers belong to existing files. Real files also let canonical
    // paths expand an 8.3 TEMP alias consistently on Windows CI runners.
    writeFileSync(join(one, 'dirty.txt'), 'first buffer')
    writeFileSync(join(two, 'dirty.txt'), 'second buffer')
    await browseDirectory('a', one)
    await browseDirectory('a', two)
    await browseDirectory('b', one)
    releaseDesktop('a')
    expect(insideDesktop(join(one, 'dirty.txt'))).toBe(true)
    expect(insideDesktop(join(two, 'dirty.txt'))).toBe(false)
    releaseDesktop('b')
    expect(insideDesktop(join(one, 'dirty.txt'))).toBe(false)
  })

  it('refuses implicit traversal through a junction until its destination is explicitly visited', () => {
    const visible = join(box, 'visible')
    const outside = join(box, 'outside')
    mkdirSync(visible)
    mkdirSync(outside)
    symlinkSync(outside, join(visible, 'jump'), 'junction')
    grantDesktopDirectory('files', visible)
    expect(insideDesktop(join(visible, 'jump'))).toBe(false)
  })

  it('refuses a relative or missing path without granting it', async () => {
    expect(await browseDirectory('a', 'relative')).toBeNull()
    expect(await browseDirectory('a', join(box, 'gone'))).toBeNull()
    expect(insideDesktop(box)).toBe(false)
  })
})

it('lists unsupported files, hidden files and skipped directories only in the desktop browser', async () => {
  writeFileSync(join(box, 'installer.exe'), 'exe')
  writeFileSync(join(box, '.env'), 'private=value')
  writeFileSync(join(box, 'desktop.ini'), 'ini')
  mkdirSync(join(box, 'node_modules'))
  const result = await browseDirectory('browser', box)
  expect(result?.listing.files.map((entry) => entry.name)).toEqual([
    '.env',
    'desktop.ini',
    'installer.exe'
  ])
  expect(result?.listing.files.find((entry) => entry.name === 'installer.exe')?.kind).toBe('other')
  expect(result?.listing.folders.map((entry) => entry.name)).toContain('node_modules')
  const tree = await listDir(box)
  expect(tree.files).toEqual([])
})

it('does not filter the desktop file list by extension or viewer support', async () => {
  const names = ['library.dll', 'driver.sys', 'program.exe', 'data.bin', 'unknown.xyz123', 'no-extension', '.hidden', 'desktop.ini']
  for (const name of names) writeFileSync(join(box, name), 'file')
  const result = await browseDirectory('all-types', box)
  expect(result?.listing.files.map((file) => file.name).sort()).toEqual(names.sort())
  expect(result?.listing.files.find((file) => file.name === 'library.dll')?.kind).toBe('other')
})

it('restores independent browsing', () => {
  const project = join(box, 'project')
  const browsing = join(box, 'browsing')
  mkdirSync(project)
  mkdirSync(browsing)
  const history = [
    {
      path: browsing,
      selected: null,
      scrollTop: 140,
      query: 'test',
      sort: { key: 'size', direction: 'desc' }
    }
  ]
  const state = {
    tabs: [
      {
        id: 'stable',
        root: project,
        role: 'explorer',
        browse: { path: browsing, history, cursor: 0, surface: 'folder', preview: true }
      }
    ],
    active: 0
  }
  expect(parseTabs(JSON.stringify(state))).toEqual(state)
})

it('ignores the pinned panes an old strip carries (2026-10-26)', () => {
  const project = join(box, 'project')
  mkdirSync(project)
  const path = join(box, 'pinned.txt')
  writeFileSync(path, 'pinned')
  const state = {
    tabs: [{ root: project, panes: [{ id: 'pin', path, dir: 'right' }] }],
    active: 0
  }
  expect('panes' in parseTabs(JSON.stringify(state)).tabs[0]).toBe(false)
})

it('does not recreate grants when a tab closes during an asynchronous browse', async () => {
  const pending = browseDirectory('closing', box)
  releaseDesktop('closing')
  expect(await pending).toBeNull()
  expect(insideDesktop(box)).toBe(false)
})

it('refuses a late callback starting a new browse after its owning tab closed', async () => {
  await browseDirectory('closed', box)
  releaseDesktop('closed')
  expect(await browseDirectory('closed', box)).toBeNull()
  grantDesktopDirectory('closed', box)
  expect(insideDesktop(box)).toBe(false)
  expect(await browseDirectory('new-tab', box)).not.toBeNull()
})

it('ignores the terminal fields an old strip carries (2026-10-26)', () => {
  const state = {
    tabs: [
      {
        root: box,
        term: 'full',
        terms: 3,
        agent: 'claude',
        cwd: box,
        panes: [
          { id: 'terminal', path: 'term:slot-1', dir: 'left', termSlot: 1 },
          { id: 'gone', path: 'term:gone', dir: 'right', termSlot: 9 }
        ]
      }
    ],
    active: 0
  }
  const tab = parseTabs(JSON.stringify(state)).tabs[0]
  expect(tab).toEqual({ root: box, role: 'explorer' })
  expect(tab).not.toHaveProperty('term')
  expect(tab).not.toHaveProperty('terms')
  expect(tab).not.toHaveProperty('agent')
  expect(tab).not.toHaveProperty('cwd')
})

describe('browseLocations', () => {
  const getPath = (key: string): string => `C:\\Users\\me\\${key}`
  const dir = { isDirectory: () => true }

  it('a hung drive is left out after its time limit, not waited on (2026-10-16)', async () => {
    const hung = new Promise<never>(() => {})
    const probe = (p: string): Promise<{ isDirectory(): boolean }> =>
      p === 'Z:\\' || p.endsWith('desktop') ? hung : Promise.resolve(dir)
    const t = Date.now()
    const places = await browseLocations(getPath, probe, 50)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(places.some((p) => p.path === 'Z:\\' || p.known === 'desktop')).toBe(false)
    expect(places.find((p) => p.known === 'downloads')?.path).toBe('C:\\Users\\me\\downloads')
  })

  it('gives Home without asking the disk', async () => {
    const asked: string[] = []
    const probe = (p: string): Promise<{ isDirectory(): boolean }> => {
      asked.push(p)
      return Promise.reject(new Error('ENOENT'))
    }
    const places = await browseLocations(getPath, probe, 50)
    expect(places.map((p) => p.name)).toEqual(['Home'])
    expect(asked).not.toContain('C:\\Users\\me\\home')
  })
})
