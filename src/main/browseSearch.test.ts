import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import * as fs from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browseSearch, cancelBrowseSearch, normalizeSearchWindow } from './browseSearch'
import {
  grantDesktopDirectory,
  insideDesktop,
  releaseDesktop,
  resetDesktopAccess
} from './desktopAccess'
import { addRoot, insideAnyRoot, openRoots, resetRoots } from './roots'
import type { BrowseSearchProgress } from '@shared/browse'
import { searchEverythingBrowse, searchEverythingBrowseWindow } from './everythingBrowse'

vi.mock('./everythingBrowse', () => ({
  searchEverythingBrowse: vi.fn(async () => null),
  searchEverythingBrowseWindow: vi.fn(async () => null)
}))

vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>())
}))

let box: string
let home: string
let playnite: string
beforeEach(() => {
  vi.mocked(searchEverythingBrowse).mockResolvedValue(null)
  vi.mocked(searchEverythingBrowseWindow).mockResolvedValue(null)
  box = mkdtempSync(join(tmpdir(), 'prism-browse-search-'))
  home = join(box, 'Admin')
  playnite = join(home, 'AppData', 'Roaming', 'Playnite')
  mkdirSync(playnite, { recursive: true })
  writeFileSync(join(playnite, 'Playnite.exe'), 'unsupported but searchable')
  writeFileSync(join(playnite, '.playnite-settings'), 'hidden but searchable')
  writeFileSync(join(home, 'playnite-notes.txt'), 'notes')
  resetRoots()
  resetDesktopAccess()
  grantDesktopDirectory('explorer', home)
})
afterEach(() => {
  vi.restoreAllMocks()
  resetDesktopAccess()
  rmSync(box, { recursive: true, force: true })
})

describe('recursive desktop Explorer search', () => {
  it('bounds hostile viewport requests and validates native sort keys', () => {
    expect(normalizeSearchWindow(undefined)).toBeUndefined()
    expect(normalizeSearchWindow('all')).toBeUndefined()
    expect(normalizeSearchWindow([])).toBeUndefined()
    expect(
      normalizeSearchWindow({
        offset: Infinity,
        limit: NaN,
        sort: { key: '-exit', direction: 'anything' }
      })
    ).toEqual({ offset: 0, limit: 512, sort: { key: 'name', direction: 'asc' } })
    expect(normalizeSearchWindow({ offset: 1e20, limit: 1e20 })).toMatchObject({
      offset: 0xffffffff,
      limit: 512
    })
    expect(
      normalizeSearchWindow({ offset: -1, limit: 0, sort: { key: 'size', direction: 'desc' } })
    ).toEqual({ offset: 0, limit: 1, sort: { key: 'size', direction: 'desc' } })
  })

  it('returns a globally positioned window without validating or granting undisplayed candidates', async () => {
    const request = {
      offset: 9000,
      limit: 128,
      sort: { key: 'name' as const, direction: 'asc' as const }
    }
    const file = join(playnite, 'Playnite.exe')
    const missing = join(home, 'gone.dll')
    vi.mocked(searchEverythingBrowseWindow).mockResolvedValue({
      offset: 9000,
      total: 77296,
      rows: [
        null,
        { filename: file, attributes: 32, size: 123 },
        { filename: playnite, attributes: 16, size: 456 },
        { filename: missing, attributes: 32 },
        { filename: join(box, 'private'), attributes: 16 }
      ]
    })
    const stats = vi.spyOn(fs, 'stat')
    const walk = vi.spyOn(fs, 'opendir')
    const progress = vi.fn()
    const result = await browseSearch('explorer', home, 'play', 'window', progress, {}, request)
    expect(result.window).toMatchObject({
      offset: 9000,
      total: 77296,
      paths: [null, file, playnite, ...Array(125).fill(null)]
    })
    expect(result.window?.folderSizes?.[playnite]).toMatchObject({
      bytes: 456,
      source: 'index',
      countsKnown: false
    })
    expect(result.listing.files).toHaveLength(1)
    expect(result.listing.folders).toHaveLength(1)
    expect(result.truncated).toBe(false)
    expect(stats).not.toHaveBeenCalled()
    expect(walk).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
    expect(insideAnyRoot(file)).toBe(false)
    expect(insideDesktop(file)).toBe(true)
    expect(vi.mocked(searchEverythingBrowseWindow).mock.calls.at(-1)?.[2]).toEqual(request)
  })

  it('falls back to a bounded filesystem search when no windowed index is available', async () => {
    const result = await browseSearch(
      'explorer',
      home,
      'play',
      'fallback-window',
      undefined,
      { maxEntries: 1 },
      { offset: 0, limit: 512, sort: { key: 'name', direction: 'asc' } }
    )
    expect(result).toMatchObject({ source: 'filesystem', truncated: true, scanned: 1 })
    expect(result.window).toBeUndefined()
  })

  it('does not replace a distant viewport with a filesystem scan when its index is unavailable', async () => {
    const walk = vi.spyOn(fs, 'opendir')
    const result = await browseSearch(
      'explorer',
      home,
      'play',
      'lost-index',
      undefined,
      {},
      { offset: 10000, limit: 512, sort: { key: 'name', direction: 'asc' } }
    )
    expect(result.notice).toContain('temporarily unavailable')
    expect(result.window).toBeUndefined()
    expect(walk).not.toHaveBeenCalled()
  })

  it('discards a cancelled viewport before validating paths or granting access', async () => {
    let finish!: (result: Awaited<ReturnType<typeof searchEverythingBrowseWindow>>) => void
    vi.mocked(searchEverythingBrowseWindow).mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        })
    )
    const pending = browseSearch(
      'explorer',
      home,
      'play',
      'cancel-window',
      undefined,
      {},
      { offset: 10000, limit: 512, sort: { key: 'name', direction: 'asc' } }
    )
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    cancelBrowseSearch('explorer', 'cancel-window')
    const file = join(playnite, 'Playnite.exe')
    finish({ offset: 10000, total: 10001, rows: [{ filename: file, attributes: 32 }] })
    expect((await pending).cancelled).toBe(true)
    expect(insideDesktop(file)).toBe(false)
  })

  it('uses indexed metadata for hidden and unsupported entries without walking or stat calls', async () => {
    const walk = vi.spyOn(fs, 'opendir')
    const stats = vi.spyOn(fs, 'stat')
    vi.mocked(searchEverythingBrowse).mockResolvedValue([
      { filename: playnite, attributes: 16 },
      {
        filename: join(playnite, 'Playnite.exe'),
        attributes: 32,
        size: 123,
        date_modified: 116444736010000000
      },
      { filename: join(playnite, '.playnite-settings'), attributes: 34, size: 456 }
    ])
    const result = await browseSearch('explorer', home, 'file: | folder:', 'indexed')
    expect(result.source).toBe('everything')
    expect(result.listing.folders).toContainEqual({ path: playnite, name: 'Playnite' })
    expect(result.listing.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Playnite.exe', size: 123, mtimeMs: 1000, kind: 'other' }),
        expect.objectContaining({ name: '.playnite-settings', size: 456 })
      ])
    )
    expect(walk).not.toHaveBeenCalled()
    expect(stats).not.toHaveBeenCalled()
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(true)
    expect(insideAnyRoot(join(playnite, 'Playnite.exe'))).toBe(false)
  })

  it('never recursively walks after an empty indexed answer and reports unsupported fallback filters', async () => {
    const walk = vi.spyOn(fs, 'opendir')
    vi.mocked(searchEverythingBrowse).mockResolvedValueOnce([])
    expect(await browseSearch('explorer', home, 'missing', 'empty')).toMatchObject({
      source: 'everything',
      scanned: 0
    })
    expect(walk).not.toHaveBeenCalled()
    expect(await browseSearch('explorer', home, 'size:>100mb', 'advanced')).toMatchObject({
      source: 'filesystem',
      notice: expect.stringContaining('file index')
    })
    expect(walk).not.toHaveBeenCalled()
  })

  it('rejects indexed sibling-prefix paths, stale files and paths reached through junctions', async () => {
    const outside = join(box, 'Admin-other')
    mkdirSync(outside)
    const secret = join(outside, 'secret.dll')
    writeFileSync(secret, 'outside')
    const jump = join(home, 'jump')
    symlinkSync(outside, jump, 'junction')
    vi.mocked(searchEverythingBrowse).mockResolvedValue([
      { filename: secret, attributes: 32 },
      { filename: join(jump, 'secret.dll'), attributes: 32 },
      { filename: join(home, 'gone.dll'), attributes: 32 },
      { filename: jump, attributes: 1040 }
    ])
    const result = await browseSearch('explorer', home, '*', 'boundary')
    expect(result.listing).toEqual({ folders: [], files: [] })
    expect(result).toMatchObject({ skippedLinks: 2, unreadable: 1 })
    expect(insideDesktop(secret)).toBe(false)
  })

  it('aborts superseded indexed work and never grants late results', async () => {
    let finish!: (rows: Awaited<ReturnType<typeof searchEverythingBrowse>>) => void
    vi.mocked(searchEverythingBrowse).mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        })
    )
    const old = browseSearch('explorer', home, 'Playnite', 'old-indexed')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const signal = vi.mocked(searchEverythingBrowse).mock.calls.at(-1)![3]
    cancelBrowseSearch('explorer', 'old-indexed')
    expect(signal.aborted).toBe(true)
    finish([{ filename: join(playnite, 'Playnite.exe'), attributes: 32 }])
    expect((await old).cancelled).toBe(true)
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(false)
  })

  it('finds folders, hidden files and unsupported files under AppData with full paths', async () => {
    const result = await browseSearch('explorer', home, 'playnite', 'request')
    expect(result.listing.folders).toContainEqual({ name: 'Playnite', path: playnite })
    expect(result.listing.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        join(home, 'playnite-notes.txt'),
        join(playnite, 'Playnite.exe'),
        join(playnite, '.playnite-settings')
      ])
    )
    expect(result.listing.files.find((file) => file.name === 'Playnite.exe')?.kind).toBe('other')
    expect(result).toMatchObject({
      scanned: 6,
      unreadable: 0,
      skippedLinks: 0,
      truncated: false,
      cancelled: false
    })
  })

  it('uses the established glob, extension and exclusion syntax', async () => {
    const result = await browseSearch('explorer', home, '*.exe -installer', 'glob')
    expect(result.listing.files.map((file) => file.name)).toEqual(['Playnite.exe'])
    expect(
      (await browseSearch('explorer', home, 'ext:txt', 'extension')).listing.files.map(
        (file) => file.name
      )
    ).toEqual(['playnite-notes.txt'])
    expect(
      (await browseSearch('explorer', home, '-playnite', 'excluded')).listing.files
    ).toHaveLength(0)
  })

  it('grants only matching desktop locations to the owner without sharing them to the phone', async () => {
    const project = join(box, 'Project')
    mkdirSync(project)
    addRoot(project)
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(false)
    await browseSearch('explorer', home, 'Playnite.exe', 'grant')
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(true)
    expect(insideAnyRoot(join(playnite, 'Playnite.exe'))).toBe(false)
    expect(openRoots()).toEqual([project])
    releaseDesktop('explorer')
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(false)
  })

  it('refuses an unvisited directory and another tab borrowing the visited location', async () => {
    expect((await browseSearch('unowned', home, 'playnite', 'wrong-tab')).unreadable).toBe(1)
    expect((await browseSearch('explorer', box, 'playnite', 'ancestor')).unreadable).toBe(1)
    expect((await browseSearch('explorer', 'relative', 'playnite', 'relative')).unreadable).toBe(1)
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(false)
  })

  it('skips an outside junction and a junction loop and reports incomplete coverage', async () => {
    const outside = join(box, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'playnite-secret.txt'), 'outside')
    symlinkSync(outside, join(home, 'jump'), 'junction')
    symlinkSync(home, join(playnite, 'loop'), 'junction')
    const result = await browseSearch('explorer', home, 'playnite', 'links')
    expect(result.skippedLinks).toBe(2)
    expect(result.listing.files.some((file) => file.name === 'playnite-secret.txt')).toBe(false)
    expect(insideDesktop(join(outside, 'playnite-secret.txt'))).toBe(false)
  })

  it('reports unreadable subdirectories while keeping accessible matches', async () => {
    const inaccessible = join(home, 'denied')
    mkdirSync(inaccessible)
    const original = fs.opendir
    vi.spyOn(fs, 'opendir').mockImplementation((...args: Parameters<typeof fs.opendir>) => {
      if (args[0] === inaccessible)
        return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return original(...args)
    })
    const result = await browseSearch('explorer', home, 'playnite', 'denied')
    expect(result.unreadable).toBe(1)
    expect(result.listing.files.map((file) => file.name)).toContain('Playnite.exe')
    expect(result.cancelled).toBe(false)
  })

  it('keeps searching siblings when a matching entry disappears before it can be resolved', async () => {
    const changing = join(home, 'changing')
    mkdirSync(changing)
    const paths = ['alpha', 'beta', 'gamma'].map((name) => join(changing, `playnite-${name}.txt`))
    for (const path of paths) writeFileSync(path, 'searchable')
    const original = fs.realpath
    let vanished: string | undefined
    vi.spyOn(fs, 'realpath').mockImplementation((...args: Parameters<typeof fs.realpath>) => {
      const path = String(args[0])
      if (!vanished && paths.includes(path)) {
        vanished = path
        return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
      }
      return original(...args)
    })
    const result = await browseSearch('explorer', home, 'playnite', 'changing')
    expect(vanished).toBeDefined()
    expect(result.listing.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(paths.filter((path) => path !== vanished))
    )
    expect(result.listing.files.some((file) => file.path === vanished)).toBe(false)
    expect(result).toMatchObject({ unreadable: 1, cancelled: false, truncated: false })
  })

  it('bounds entries, matches and elapsed work without claiming exhaustive results', async () => {
    const entries = await browseSearch('explorer', home, 'playnite', 'entries', undefined, {
      maxEntries: 1
    })
    expect(entries).toMatchObject({ scanned: 1, truncated: true })
    const hits = await browseSearch('explorer', home, 'playnite', 'hits', undefined, { maxHits: 1 })
    expect(hits.listing.files.length + hits.listing.folders.length).toBe(1)
    expect(hits.truncated).toBe(true)
    expect(
      (await browseSearch('explorer', home, 'playnite', 'time', undefined, { maxMs: 0 })).truncated
    ).toBe(true)
  })

  it('supersedes only the same tab and ignores cancellation for an older request', async () => {
    grantDesktopDirectory('second', home)
    const old = browseSearch('explorer', home, 'playnite', 'old')
    const independent = browseSearch('second', home, 'playnite', 'independent')
    const newest = browseSearch('explorer', home, '*.exe', 'new')
    cancelBrowseSearch('explorer', 'old')
    expect((await old).cancelled).toBe(true)
    expect((await independent).cancelled).toBe(false)
    const result = await newest
    expect(result.cancelled).toBe(false)
    expect(result.listing.files.map((file) => file.name)).toEqual(['Playnite.exe'])
  })

  it('cancels mid-walk and keeps progress snapshots immutable', async () => {
    const progress: BrowseSearchProgress[] = []
    const result = await browseSearch('explorer', home, 'playnite', 'cancel', (update) => {
      progress.push(update)
      cancelBrowseSearch('explorer', 'cancel')
    })
    expect(progress).toHaveLength(1)
    expect(progress[0]).toMatchObject({ tabId: 'explorer', requestId: 'cancel', cancelled: false })
    expect(result.cancelled).toBe(true)
    expect(result.scanned).toBeLessThan(6)
    const snapshots: BrowseSearchProgress[] = []
    const complete = await browseSearch('explorer', home, 'playnite', 'complete', (update) =>
      snapshots.push(update)
    )
    expect(snapshots[0].listing.files).not.toBe(complete.listing.files)
    expect(snapshots[0].scanned).toBeLessThan(complete.scanned)
  })

  it('does not resurrect permissions or emit progress after its tab closes', async () => {
    const progress = vi.fn()
    const pending = browseSearch('explorer', home, 'Playnite.exe', 'closing', progress)
    releaseDesktop('explorer')
    expect((await pending).cancelled).toBe(true)
    expect(progress).not.toHaveBeenCalled()
    expect(insideDesktop(join(playnite, 'Playnite.exe'))).toBe(false)
  })
})
