import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { grantDesktopDirectory, insideDesktop, resetDesktopAccess } from './desktopAccess'
import { resetRoots } from './roots'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'prism-desktop-access-'))
  resetDesktopAccess()
  resetRoots()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetDesktopAccess()
  resetRoots()
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
