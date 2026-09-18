import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { DirChange } from '@shared/types'
import { browseDirectory, browseWatch } from './browse'
import { releaseDesktop, resetDesktopAccess } from './desktopAccess'

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
  expect(browseWatch('owner', first, emit)).toBe(false)
  await browseDirectory('owner', first)
  expect(browseWatch('another-tab', first, emit)).toBe(false)
  expect(browseWatch('owner', first, emit)).toBe(true)
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

  expect(browseWatch('owner', second, emit)).toBe(true)
  changes.length = 0
  writeFileSync(join(first, '.env'), 'new=old-folder')
  writeFileSync(join(second, 'unsupported.exe'), 'watched')
  await expect.poll(() => changes.length).toBeGreaterThan(0)
  expect(changes.every((change) => change.root === second)).toBe(true)
  releaseDesktop('owner')
  expect(browseWatch('owner', second, emit)).toBe(false)
  expect(browseWatch('owner', null, emit)).toBe(true)
})
