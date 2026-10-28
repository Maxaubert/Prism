import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { canonicalPath, forgetCanonical, warmCanonical } from './dirList'
import {
  grantDesktopDirectory,
  insideDesktopAllAsync,
  insideDesktopAsync,
  resetDesktopAccess
} from './desktopAccess'

// The wall resolves the same paths over and over on main's thread (review,
// 2026-10-28: guard-slow lines of 281 to 1067 ms in the owner's log). A path
// that exists is remembered for two seconds, Prism's own writes forget it, and
// an awaiting caller resolves off the thread first.

let box: string
beforeEach(() => {
  box = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-canonical-')))
  forgetCanonical()
  resetDesktopAccess()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetDesktopAccess()
  rmSync(box, { recursive: true, force: true })
})

it('resolves a path once, then answers from memory until two seconds pass', () => {
  const file = join(box, 'a.txt')
  writeFileSync(file, 'x')
  const native = vi.spyOn(realpathSync, 'native')
  const first = canonicalPath(file)
  expect(canonicalPath(file)).toBe(first)
  expect(native).toHaveBeenCalledTimes(1)
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 2500)
  expect(canonicalPath(file)).toBe(first)
  expect(native).toHaveBeenCalledTimes(2)
})

it('never remembers a path that does not exist, and forgets everything on a write', () => {
  const missing = join(box, 'not-yet')
  const native = vi.spyOn(realpathSync, 'native')
  canonicalPath(missing)
  canonicalPath(missing)
  expect(native).toHaveBeenCalledTimes(2)
  mkdirSync(missing)
  canonicalPath(missing)
  forgetCanonical()
  canonicalPath(missing)
  expect(native).toHaveBeenCalledTimes(4)
})

it('warms off the thread: the sync guard after it makes no native call', async () => {
  const dir = join(box, 'shown')
  mkdirSync(join(dir, 'one'), { recursive: true })
  mkdirSync(join(dir, 'two'))
  grantDesktopDirectory('tab', dir)
  const native = vi.spyOn(realpathSync, 'native')
  const asked = [join(dir, 'one'), join(dir, 'two'), join(box, 'elsewhere'), 7]
  expect(await insideDesktopAllAsync(asked)).toEqual([join(dir, 'one'), join(dir, 'two')])
  expect(await insideDesktopAsync(join(dir, 'one'))).toBe(true)
  // Only the missing path, which is never remembered, is resolved inline.
  expect(native.mock.calls.every(([p]) => p === join(box, 'elsewhere') || p === box)).toBe(true)
})

it('warmCanonical gives the same answer the sync resolve does', async () => {
  const file = join(box, 'Mixed Case.TXT')
  writeFileSync(file, 'x')
  const sync = canonicalPath(file)
  forgetCanonical()
  await warmCanonical([file, file, ''])
  const native = vi.spyOn(realpathSync, 'native')
  expect(canonicalPath(file)).toBe(sync)
  expect(native).not.toHaveBeenCalled()
})
