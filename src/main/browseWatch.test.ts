import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { DirChange } from '@shared/types'
import { browseDirectory, browseWatch } from './browse'
import { releaseDesktop, resetDesktopAccess } from './desktopAccess'
import { browseWatcherOf, closeBrowseWatch, setBrowseWatch } from './browseWatch'

let box: string
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-browse-watch-'))
  resetDesktopAccess()
})
afterEach(() => {
  resetDesktopAccess()
  rmSync(box, { recursive: true, force: true })
})

it('watches only an explicitly selected owned folder and releases the old watcher', async () => {
  const first = join(box, 'first')
  const second = join(box, 'second')
  mkdirSync(first)
  mkdirSync(second)
  const changes: DirChange[] = []
  const emit = (change: DirChange): void => {
    changes.push(change)
  }
  expect(await browseWatch('owner', first, emit)).toBe(false)
  await browseDirectory('owner', first)
  expect(await browseWatch('another-tab', first, emit)).toBe(false)
  expect(await browseWatch('owner', first, emit)).toBe(true)
  writeFileSync(join(first, '.env'), 'new=hidden')
  await expect.poll(() => changes.length).toBeGreaterThan(0)
  expect(changes[0]).toEqual({ root: first, dirs: [first] })

  // Granting another path (for a cwd report or preview) does not change the
  // selected watcher. It follows only browseWatch's explicit surface choice.
  await browseDirectory('owner', second)
  changes.length = 0
  writeFileSync(join(second, 'unsupported.exe'), 'unwatched')
  writeFileSync(join(first, '.env'), 'new=still-watched')
  await expect.poll(() => changes.length).toBeGreaterThan(0)
  expect(changes.every((change) => change.root === first)).toBe(true)

  expect(await browseWatch('owner', second, emit)).toBe(true)
  changes.length = 0
  writeFileSync(join(first, '.env'), 'new=old-folder')
  writeFileSync(join(second, 'unsupported.exe'), 'watched')
  await expect.poll(() => changes.length).toBeGreaterThan(0)
  expect(changes.every((change) => change.root === second)).toBe(true)
  releaseDesktop('owner')
  expect(await browseWatch('owner', second, emit)).toBe(false)
  expect(await browseWatch('owner', null, emit)).toBe(true)
})

it('a newer watch ask wins over an older one still waiting on its archive check', async () => {
  const first = join(box, 'first')
  const second = join(box, 'second')
  mkdirSync(first)
  mkdirSync(second)
  const zip = join(first, 'pack.zip')
  writeFileSync(zip, 'not really a zip; only its being a file is asked')
  await browseDirectory('owner', first)
  await browseDirectory('owner', second)
  const changes: DirChange[] = []
  const emit = (change: DirChange): void => {
    changes.push(change)
  }
  const older = browseWatch('owner', join(zip, 'inner'), emit)
  const newer = browseWatch('owner', second, emit)
  expect(await newer).toBe(true)
  expect(await older).toBe(true)
  writeFileSync(zip, 'changed')
  writeFileSync(join(second, 'new.txt'), 'watched')
  await expect.poll(() => changes.length).toBeGreaterThan(0)
  expect(changes.every((change) => change.root === second)).toBe(true)
  expect(await browseWatch('owner', null, emit)).toBe(true)
})

it('a watch still waiting on its native path stands down for a newer ask or a close (2026-10-12)', async () => {
  const first = join(box, 'first')
  const second = join(box, 'second')
  mkdirSync(first)
  mkdirSync(second)
  const changes: DirChange[] = []
  const emit = (change: DirChange): void => {
    changes.push(change)
  }
  const closed = setBrowseWatch('t', first, emit)
  closeBrowseWatch('t')
  expect(await closed).toBe(true)
  expect(browseWatcherOf('t')).toBeUndefined()

  const older = setBrowseWatch('t', first, emit)
  const newer = setBrowseWatch('t', second, emit)
  expect(await older).toBe(true)
  expect(await newer).toBe(true)
  writeFileSync(join(first, 'a.txt'), 'unwatched')
  writeFileSync(join(second, 'b.txt'), 'watched')
  await expect.poll(() => changes.length).toBeGreaterThan(0)
  expect(changes.every((change) => change.root === second)).toBe(true)
  closeBrowseWatch('t')
})
