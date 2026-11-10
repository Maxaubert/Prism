import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insideDesktop, resetDesktopAccess } from '../desktopAccess'
import { localPath, phoneListed, phoneMay, phoneOnThisPc, phoneRelease } from './phoneAccess'

let dir: string
beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-phone-access-')))
  mkdirSync(join(dir, 'films', 'deeper'), { recursive: true })
  writeFileSync(join(dir, 'films', 'a.mp4'), 'a')
  writeFileSync(join(dir, 'films', 'deeper', 'b.mp4'), 'b')
  resetDesktopAccess()
})
afterEach(() => {
  resetDesktopAccess()
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

describe('nothing on another computer (2026-10-15)', () => {
  it('a mapped drive or a link to a share resolves to the share, and is refused', async () => {
    expect(await phoneOnThisPc('Z:\\films', async () => '\\\\server\\share\\films')).toBe(false)
    expect(await phoneOnThisPc('C:\\link', async () => '\\\\localhost\\C$\\films')).toBe(false)
  })
  it('a local folder, a subst drive and a junction to a local folder are on this PC', async () => {
    expect(await phoneOnThisPc('S:\\films', async () => 'C:\\films')).toBe(true)
    expect(await phoneOnThisPc(dir)).toBe(true)
  })
  it('a path that cannot be resolved, or is not spelled locally, is not', async () => {
    expect(await phoneOnThisPc(join(dir, 'gone'))).toBe(false)
    expect(await phoneOnThisPc('\\\\server\\share', async (p) => p)).toBe(false)
  })
})

// THE BIN IS NOT A PLAIN PATH ON THE PHONE (owner, 2026-11-10, Recycle Bin
// feature): `<drive>\$Recycle.Bin\<SID>` holds files the owner deleted, and the
// phone reaches the PC like the Explorer, without the Explorer's bin place. A
// path with a `$Recycle.Bin` segment is not a local path for the phone, so it is
// never listed, granted, read or offered, even from a folder it did list.
describe('the phone and the Recycle Bin (2026-11-10)', () => {
  it('a $Recycle.Bin path is not a local path, at any depth and in any case', () => {
    expect(localPath('C:\\$Recycle.Bin')).toBe(false)
    expect(localPath('C:\\$Recycle.Bin\\S-1-5-21-1-2-3-1001')).toBe(false)
    expect(localPath('d:/$recycle.bin/S-1-5-21/$R1ABCDE.txt')).toBe(false)
    expect(localPath('C:\\Users\\$RECYCLE.BIN\\x')).toBe(false)
    // a name that merely contains it is an ordinary folder
    expect(localPath('C:\\films\\my$Recycle.Bin stuff')).toBe(true)
  })

  it('listing the bin grants nothing, and no read of it is allowed', () => {
    const bin = join(dir, '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, '$R1ABCDE.txt'), 'secret')
    phoneListed('t', bin)
    expect(phoneMay('t', bin)).toBe(false)
    expect(phoneMay('t', join(bin, '$R1ABCDE.txt'))).toBe(false)
    expect(insideDesktop(join(bin, '$R1ABCDE.txt'))).toBe(false)
  })

  it('a folder the phone listed does not carry the bin inside it', () => {
    mkdirSync(join(dir, '$Recycle.Bin', 'S-1'), { recursive: true })
    phoneListed('t', dir)
    expect(phoneMay('t', join(dir, '$Recycle.Bin'))).toBe(false)
  })

  it('a link that resolves into the bin is not on this PC for the phone', async () => {
    expect(await phoneOnThisPc('C:\\films', async () => 'C:\\$Recycle.Bin\\S-1\\$RX.mp4')).toBe(false)
  })
})
