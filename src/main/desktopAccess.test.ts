import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NULL_DIAG_LOG, setDiagMain } from 'prism-term-core/main/diagLog'
import {
  extendDesktopDirectories,
  grantDesktopDirectory,
  insideDesktop,
  insideDesktopAll,
  ownsDesktopDirectory,
  resetDesktopAccess,
  validDesktopRoot
} from './desktopAccess'

let directory: string
beforeEach(() => {
  // Resolved: a CI runner's temp is an 8.3 short path (RUNNER~1), which the
  // guard resolves for a folder that exists and cannot for one that does not,
  // so the timing tests' paths under it read as outside (CI only, #322).
  directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-desktop-access-')))
  resetDesktopAccess()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetDesktopAccess()
  rmSync(directory, { recursive: true, force: true })
})

it('does not resolve unrelated search grants when authorizing a known folder or its file', () => {
  for (let index = 0; index < 1000; index++) {
    grantDesktopDirectory('search', join(directory, `result-${index}`))
  }
  const selected = join(directory, 'selected')
  const file = join(selected, 'file.txt')
  mkdirSync(selected)
  writeFileSync(file, 'test')
  grantDesktopDirectory('search', selected)
  const native = vi.spyOn(realpathSync, 'native')
  expect(insideDesktop(selected)).toBe(true)
  expect(insideDesktop(file)).toBe(true)
  expect(native.mock.calls.length).toBeLessThanOrEqual(2)
  expect(native.mock.calls.every(([path]) => path === selected || path === file)).toBe(true)
})

// #351: a restored project tree lists hundreds of folders at launch, and each
// `dir:list` resolved every grant natively, several times, in main's thread
// (MEASURED: 3.6 s of the first 25 s with 86 grants). A grant is resolved once,
// when it is granted; a call resolves only the paths it was asked about.
it('resolves only the asked-about paths, however many grants there are (#351)', () => {
  const root = join(directory, 'root')
  const child = join(root, 'child')
  mkdirSync(child, { recursive: true })
  grantDesktopDirectory('tab', root)
  for (let index = 0; index < 200; index++) grantDesktopDirectory('tab', join(directory, `place-${index}`))
  const native = vi.spyOn(realpathSync, 'native')
  expect(validDesktopRoot(root, child)).toBe(true)
  expect(validDesktopRoot(root, join(directory, 'elsewhere', 'x'))).toBe(false)
  extendDesktopDirectories(root, [child, join(child, 'deeper')])
  expect(ownsDesktopDirectory('tab', child)).toBe(true)
  expect(native.mock.calls.length).toBeLessThanOrEqual(12)
})

// Perf review #31 (2026-10-28): the owner checks looked a folder up by
// scanning every grant of the tab; they are lookups now, with the same answers.
it('looks a held folder up per tab, an alias and a second spelling included', () => {
  const selected = join(directory, 'selected')
  const alias = join(directory, 'alias')
  mkdirSync(selected)
  symlinkSync(selected, alias, 'junction')
  for (let index = 0; index < 500; index++) grantDesktopDirectory('a', join(directory, `hit-${index}`))
  grantDesktopDirectory('a', selected)
  grantDesktopDirectory('a', selected.toUpperCase())
  expect(ownsDesktopDirectory('a', alias)).toBe(true)
  expect(ownsDesktopDirectory('a', selected)).toBe(true)
  expect(ownsDesktopDirectory('b', selected)).toBe(false)
  expect(ownsDesktopDirectory('a', join(directory, 'never'))).toBe(false)
  expect(validDesktopRoot(alias, join(selected, 'x.txt'))).toBe(true)
})

it('retains alias access while refusing a direct child junction into an unvisited location', () => {
  const selected = join(directory, 'selected')
  const outside = join(directory, 'outside')
  const alias = join(directory, 'alias')
  mkdirSync(selected)
  mkdirSync(outside)
  writeFileSync(join(selected, 'file.txt'), 'test')
  symlinkSync(selected, alias, 'junction')
  symlinkSync(outside, join(selected, 'jump'), 'junction')
  grantDesktopDirectory('search', selected)
  expect(insideDesktop(join(alias, 'file.txt'))).toBe(true)
  expect(insideDesktop(join(selected, 'jump'))).toBe(false)
  expect(insideDesktop(outside)).toBe(false)
})

describe('the guard times itself (#322)', () => {
  const lines: Array<{ k: string; fields?: Record<string, unknown> }> = []
  beforeEach(() => {
    lines.length = 0
    setDiagMain({ ...NULL_DIAG_LOG, write: (_src, k, fields) => void lines.push({ k, fields }) })
  })
  afterEach(() => setDiagMain(null))

  it('writes guard-slow for one call of 50 ms or more, with the paths and grants', () => {
    grantDesktopDirectory('tab', directory)
    grantDesktopDirectory('tab', join(directory, 'a'))
    // Each clock read is 60 ms after the last: the one call took 60 ms.
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 60))
    const paths: unknown[] = [join(directory, 'x'), join(directory, 'y'), 42]
    expect(insideDesktopAll(paths)).toEqual([join(directory, 'x'), join(directory, 'y')])
    expect(lines).toEqual([{ k: 'guard-slow', fields: { fn: 'insideDesktopAll', paths: 3, grants: 2, ms: 60 } }])
  })

  it('writes nothing for a fast one', () => {
    grantDesktopDirectory('tab', directory)
    expect(insideDesktop(join(directory, 'x'))).toBe(true)
    expect(validDesktopRoot(directory, join(directory, 'x'))).toBe(true)
    extendDesktopDirectories(directory, [join(directory, 'x')])
    expect(lines).toEqual([])
  })
})

// D12: the bin is never a granted FOLDER. Its files reach the wall only as the
// exact `$R` paths of a listing (pathWall `grantBin`), so a Recycle Bin folder
// passed to a folder grant, from anywhere, grants nothing.
describe('the Recycle Bin is never granted as a folder (D12)', () => {
  it('grantDesktopDirectory refuses a $Recycle.Bin path and anything below it', () => {
    const bin = join(directory, 'C', '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, '$R1ABCDE.txt'), 'x')
    grantDesktopDirectory('tab', bin)
    grantDesktopDirectory('tab', join(directory, 'C', '$Recycle.Bin'))
    expect(ownsDesktopDirectory('tab', bin)).toBe(false)
    expect(insideDesktop(bin)).toBe(false)
    expect(insideDesktop(join(bin, '$R1ABCDE.txt'))).toBe(false)
  })

  it('extendDesktopDirectories refuses it too, under a folder the tab does hold', () => {
    const bin = join(directory, 'C', '$Recycle.Bin', 'S-1')
    mkdirSync(bin, { recursive: true })
    grantDesktopDirectory('tab', directory)
    extendDesktopDirectories(directory, [bin, join(directory, 'C')])
    expect(ownsDesktopDirectory('tab', join(directory, 'C'))).toBe(true)
    expect(ownsDesktopDirectory('tab', bin)).toBe(false)
  })

  it('an ordinary folder is still granted (the segment must be the whole name)', () => {
    const ok = join(directory, 'my$Recycle.Bin notes')
    mkdirSync(ok)
    grantDesktopDirectory('tab', ok)
    expect(ownsDesktopDirectory('tab', ok)).toBe(true)
  })
})
