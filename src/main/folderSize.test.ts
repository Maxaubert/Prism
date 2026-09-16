import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import * as fs from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { folderSize } from './folderSize'
import { grantDesktopDirectory, insideDesktop, resetDesktopAccess } from './desktopAccess'
import { insideAnyRoot, resetRoots } from './roots'

vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>())
}))

let box: string
let root: string
const scan = (path: string): ReturnType<typeof folderSize> =>
  folderSize(path, new AbortController().signal)

beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-folder-size-'))
  root = join(box, 'root')
  mkdirSync(join(root, 'nested', 'empty'), { recursive: true })
  writeFileSync(join(root, 'one.txt'), Buffer.alloc(7))
  writeFileSync(join(root, 'nested', '.hidden'), Buffer.alloc(11))
  resetRoots()
  resetDesktopAccess()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetDesktopAccess()
  rmSync(box, { recursive: true, force: true })
})

describe('recursive folder size', () => {
  it('sums file bytes including hidden files, counts descendants and refreshes changes', async () => {
    expect(await scan(root)).toEqual({
      bytes: 18,
      files: 2,
      folders: 2,
      unreadable: 0,
      skippedLinks: 0,
      truncated: false
    })
    writeFileSync(join(root, 'one.txt'), Buffer.alloc(25))
    expect(await scan(root)).toMatchObject({ bytes: 36, files: 2 })
    expect(await scan(join(root, 'nested', 'empty'))).toMatchObject({
      bytes: 0,
      files: 0,
      folders: 0
    })
  })

  it('does not turn a recursive count into desktop or phone grants', async () => {
    grantDesktopDirectory('explorer', box)
    const child = join(root, 'nested', '.hidden')
    expect(insideDesktop(root)).toBe(true)
    expect(insideDesktop(child)).toBe(false)
    await scan(root)
    expect(insideDesktop(child)).toBe(false)
    expect(insideAnyRoot(child)).toBe(false)
  })

  it('skips outside junctions and loops, including a linked root', async () => {
    const outside = join(box, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret'), Buffer.alloc(1000))
    symlinkSync(outside, join(root, 'external'), 'junction')
    symlinkSync(root, join(root, 'nested', 'loop'), 'junction')
    expect(await scan(root)).toMatchObject({ bytes: 18, files: 2, folders: 2, skippedLinks: 2 })
    expect(await scan(join(root, 'external'))).toMatchObject({ bytes: 0, skippedLinks: 1 })
  })

  it('keeps readable siblings when a subfolder cannot be opened', async () => {
    const original = fs.opendir
    vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      if (args[0] === join(root, 'nested')) throw new Error('Access denied')
      return original(...args)
    })
    expect(await scan(root)).toMatchObject({ bytes: 7, files: 1, folders: 1, unreadable: 1 })
  })

  it('reports work and time limits as partial instead of presenting a complete total', async () => {
    const limited = await folderSize(root, new AbortController().signal, { maxEntries: 1 })
    expect(limited?.truncated).toBe(true)
    expect((limited?.files ?? 0) + (limited?.folders ?? 0)).toBe(1)
    expect(await folderSize(root, new AbortController().signal, { maxMs: 0 })).toMatchObject({
      bytes: 0,
      files: 0,
      truncated: true
    })
  })

  it('returns null for files, relative paths, and cancellation during a scan', async () => {
    expect(await scan(join(root, 'missing'))).toBeNull()
    expect(await scan(join(root, 'one.txt'))).toBeNull()
    expect(await scan('relative')).toBeNull()
    const controller = new AbortController()
    const original = fs.lstat
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[0] === join(root, 'one.txt')) controller.abort()
      return result
    })
    expect(await folderSize(root, controller.signal)).toBeNull()
    expect(await scan(root)).toMatchObject({ bytes: 18 })
  })

  it('returns null when the root cannot be enumerated', async () => {
    vi.spyOn(fs, 'opendir').mockRejectedValue(new Error('Access denied'))
    expect(await scan(root)).toBeNull()
  })

  it('limits concurrent scans to two and cancels queued work without touching disk', async () => {
    const original = fs.opendir
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const open = vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      await gate
      return original(...args)
    })
    const first = scan(root)
    const second = scan(root)
    const cancelled = new AbortController()
    const third = folderSize(root, cancelled.signal)
    const fourth = scan(root)
    try {
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2))
      cancelled.abort()
      expect(await third).toBeNull()
      expect(open).toHaveBeenCalledTimes(2)
    } finally {
      release()
      expect(await first).toMatchObject({ bytes: 18 })
      expect(await second).toMatchObject({ bytes: 18 })
      expect(await fourth).toMatchObject({ bytes: 18 })
    }
  })
})
