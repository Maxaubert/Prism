import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insideDesktop, resetDesktopAccess } from '../desktopAccess'
import { resetRoots } from '../roots'
import { localPath, phoneListed, phoneMay, phoneRelease } from './phoneAccess'

let dir: string
beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-phone-access-')))
  mkdirSync(join(dir, 'films', 'deeper'), { recursive: true })
  writeFileSync(join(dir, 'films', 'a.mp4'), 'a')
  writeFileSync(join(dir, 'films', 'deeper', 'b.mp4'), 'b')
  resetDesktopAccess()
  resetRoots()
})
afterEach(() => {
  resetDesktopAccess()
  resetRoots()
  rmSync(dir, { recursive: true, force: true })
})

describe('what a paired phone may read (2026-10-14)', () => {
  it('a listed folder and its direct entries, nothing deeper and nothing before', () => {
    const films = join(dir, 'films')
    expect(phoneMay('t', join(films, 'a.mp4'))).toBe(false)
    phoneListed('t', films)
    expect(phoneMay('t', films)).toBe(true)
    expect(phoneMay('t', join(films, 'a.mp4'))).toBe(true)
    expect(phoneMay('t', join(films, 'deeper', 'b.mp4'))).toBe(false)
    // main's media wall agrees, so /m/ serves what the route allowed
    expect(insideDesktop(join(films, 'a.mp4'))).toBe(true)
  })

  it("one phone's walk opens nothing for another", () => {
    phoneListed('t', join(dir, 'films'))
    expect(phoneMay('other', join(dir, 'films', 'a.mp4'))).toBe(false)
  })

  it('refuses shares, device paths and relative paths', () => {
    expect(localPath('C:\\Users')).toBe(true)
    expect(localPath('d:/films')).toBe(true)
    expect(localPath('\\\\server\\share\\a.mp4')).toBe(false)
    expect(localPath('\\\\?\\C:\\a.mp4')).toBe(false)
    expect(localPath('\\\\.\\PhysicalDrive0')).toBe(false)
    expect(localPath('films\\a.mp4')).toBe(false)
    expect(localPath('C:')).toBe(false)
    expect(localPath(42)).toBe(false)
  })

  it('a forgotten phone keeps nothing, and its token can never grant again', () => {
    phoneListed('t', join(dir, 'films'))
    phoneRelease('t')
    expect(phoneMay('t', join(dir, 'films', 'a.mp4'))).toBe(false)
    phoneListed('t', join(dir, 'films'))
    expect(phoneMay('t', join(dir, 'films', 'a.mp4'))).toBe(false)
  })
})
