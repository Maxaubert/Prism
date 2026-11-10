import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPathWall, underDir, type WallDeps } from './pathWall'

// THE ROOT WALL (stage 9a): every guard pinned, so a refactor that loosens one
// fails here first. The fakes stand for a granted folder C:\Root, the member
// temp folder C:\Temp\members, and the renderer's asset tree C:\App\renderer.
// The old 'a tab's own root can never be renamed or binned' rule went with the
// roots (2026-10-28): no root had been registered since #439.
const ROOT = 'C:\\Root'
const inRoot = (p: string): boolean => p.toLowerCase().startsWith('c:\\root')
const deps: WallDeps = {
  insideDesktop: inRoot,
  memberOwns: (p) => typeof p === 'string' && p.toLowerCase().startsWith('c:\\temp\\members\\'),
  rendererDir: 'C:\\App\\renderer'
}

function wall() {
  return createPathWall(deps)
}

describe('underDir', () => {
  it('holds a child, refuses the folder itself and anything outside', () => {
    expect(underDir('C:\\A', 'C:\\A\\b.txt')).toBe(true)
    expect(underDir('C:\\A', 'c:\\a\\B\\c.txt')).toBe(true)
    expect(underDir('C:\\A', 'C:\\A')).toBe(false)
    expect(underDir('C:\\A', 'C:\\AB\\x')).toBe(false)
    expect(underDir('C:\\A', 'D:\\A\\x')).toBe(false)
  })
  it('cannot be walked out of with ..', () => {
    expect(underDir('C:\\A', 'C:\\A\\..\\B\\x')).toBe(false)
    expect(underDir('C:\\A', 'C:\\A\\b\\..\\..\\x')).toBe(false)
  })
  it('fails closed on a child named ..foo', () => {
    expect(underDir('C:\\A', 'C:\\A\\..foo')).toBe(false)
  })
})

describe('the path wall', () => {
  it('reads: inside the wall, or extracted; never a non-string', () => {
    const w = wall()
    expect(w.readable(`${ROOT}\\a.txt`)).toBe(true)
    expect(w.readable('C:\\Elsewhere\\a.txt')).toBe(false)
    expect(w.readable('C:\\Temp\\members\\run\\a.txt')).toBe(true)
    expect(w.readable(undefined)).toBe(false)
    expect(w.readable(42)).toBe(false)
    w.grantExtracted('C:\\Temp\\x.png')
    expect(w.readable('C:\\Temp\\x.png')).toBe(true)
    // A grant is one exact path, not its folder.
    expect(w.readable('C:\\Temp\\y.png')).toBe(false)
  })

  it('extracted: an exact grant or the member folder, nothing else', () => {
    const w = wall()
    expect(w.extracted(`${ROOT}\\a.txt`)).toBe(false)
    expect(w.extracted('C:\\Temp\\members\\run\\a.txt')).toBe(true)
    expect(w.extracted(null)).toBe(false)
    w.grantExtracted('C:\\Temp\\x.png')
    expect(w.extracted('C:\\Temp\\x.png')).toBe(true)
  })

  it('a servable grant opens the media wall only', () => {
    const w = wall()
    w.grantServable('C:\\Data\\converted.mp4')
    expect(w.mediaAllowed('C:\\Data\\converted.mp4')).toBe(true)
    expect(w.readable('C:\\Data\\converted.mp4')).toBe(false)
    expect(w.movable('C:\\Data\\converted.mp4')).toBe(false)
  })

  it('edits stay inside the wall', () => {
    const w = wall()
    expect(w.editable(`${ROOT}\\a.txt`)).toBe(true)
    expect(w.editable('C:\\Elsewhere\\a.txt')).toBe(false)
    w.grantExtracted('C:\\Temp\\x.txt')
    expect(w.editable('C:\\Temp\\x.txt')).toBe(false)
    expect(w.editable('C:\\Temp\\members\\run\\a.txt')).toBe(false)
  })

  it('moves: inside or extracted', () => {
    const w = wall()
    expect(w.movable(`${ROOT}\\a.txt`)).toBe(true)
    expect(w.movable('C:\\Elsewhere\\a.txt')).toBe(false)
    expect(w.movable('C:\\Temp\\members\\run\\a.txt')).toBe(true)
    expect(w.movable(7)).toBe(false)
  })

  it('archive writes: an archive inside the wall, never an extracted one', () => {
    const w = wall()
    expect(w.archiveOk(`${ROOT}\\a.zip`)).toBe(true)
    expect(w.archiveOk(`${ROOT}\\a.ZIP`)).toBe(true)
    expect(w.archiveOk(`${ROOT}\\a.txt`)).toBe(false)
    expect(w.archiveOk(`${ROOT}\\a.cbz`)).toBe(false)
    expect(w.archiveOk('C:\\Elsewhere\\a.zip')).toBe(false)
    expect(w.archiveOk('C:\\Temp\\members\\run\\inner.zip')).toBe(false)
    w.grantExtracted('C:\\Temp\\inner.zip')
    expect(w.archiveOk('C:\\Temp\\inner.zip')).toBe(false)
    expect(w.archiveOk(undefined)).toBe(false)
  })

  it('archive reads: also an archive main extracted', () => {
    const w = wall()
    expect(w.archiveReadOk(`${ROOT}\\a.zip`)).toBe(true)
    expect(w.archiveReadOk('C:\\Temp\\members\\run\\inner.zip')).toBe(true)
    expect(w.archiveReadOk('C:\\Temp\\members\\run\\inner.txt')).toBe(false)
    expect(w.archiveReadOk('C:\\Elsewhere\\a.zip')).toBe(false)
    w.grantExtracted('C:\\Temp\\inner.7z')
    expect(w.archiveReadOk('C:\\Temp\\inner.7z')).toBe(true)
  })

  it('comics have their own guard', () => {
    const w = wall()
    expect(w.comicOk(`${ROOT}\\book.cbz`)).toBe(true)
    expect(w.comicOk(`${ROOT}\\book.zip`)).toBe(false)
    expect(w.comicOk('C:\\Elsewhere\\book.cbz')).toBe(false)
    expect(w.comicOk('C:\\Temp\\members\\run\\book.cbz')).toBe(false)
    expect(w.archiveOk(`${ROOT}\\book.cbz`)).toBe(false)
  })


  it('media: roots, extracted, servable, the app tree and the comics folder', () => {
    const w = wall()
    expect(w.mediaAllowed(`${ROOT}\\v.mp4`)).toBe(true)
    expect(w.mediaAllowed('C:\\Temp\\members\\run\\v.mp4')).toBe(true)
    expect(w.mediaAllowed('C:\\App\\renderer\\pdf\\cmaps\\a.bcmap')).toBe(true)
    expect(w.mediaAllowed('C:\\App\\renderer')).toBe(false)
    expect(w.mediaAllowed('C:\\App\\renderer\\..\\main\\index.js')).toBe(false)
    expect(w.mediaAllowed('C:\\Data\\comics\\b\\1.jpg')).toBe(false)
    w.setComicsDir('C:\\Data\\comics')
    expect(w.comicsDir()).toBe('C:\\Data\\comics')
    expect(w.mediaAllowed('C:\\Data\\comics\\b\\1.jpg')).toBe(true)
    expect(w.mediaAllowed('C:\\Data\\comics')).toBe(false)
    expect(w.mediaAllowed('C:\\Data\\other.jpg')).toBe(false)
  })
})

// D12: a binned file can be READ (preview, viewer) through a grant for exactly
// the `$R` entries a listing returned, and never written, renamed, moved,
// zipped or dragged out. Real temp files, since the grant checks the disk.
describe('the bin grant (D12)', () => {
  let tmp: string
  let bin: string
  beforeEach(() => {
    tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-wall-bin-')))
    bin = join(tmp, 'C', '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, '$R1ABCDE.txt'), 'a')
    writeFileSync(join(bin, '$I1ABCDE.txt'), 'i')
    writeFileSync(join(bin, '$R2FGHIJ.zip'), 'z')
    writeFileSync(join(bin, '$R3KLMNO.cbz'), 'c')
    writeFileSync(join(bin, 'desktop.ini'), 'd')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('a granted $R is readable and servable, and nothing that writes', async () => {
    const w = wall()
    const r = join(bin, '$R1ABCDE.txt')
    expect(w.readable(r)).toBe(false)
    await w.grantBin([r])
    expect(w.readable(r)).toBe(true)
    expect(w.mediaAllowed(r)).toBe(true)
    expect(w.binGranted(r)).toBe(true)
    expect(w.editable(r)).toBe(false)
    expect(w.movable(r)).toBe(false)
    expect(w.extracted(r)).toBe(false)
    await w.grantBin([join(bin, '$R2FGHIJ.zip'), join(bin, '$R3KLMNO.cbz')])
    expect(w.archiveOk(join(bin, '$R2FGHIJ.zip'))).toBe(false)
    expect(w.archiveReadOk(join(bin, '$R2FGHIJ.zip'))).toBe(false)
    expect(w.comicOk(join(bin, '$R3KLMNO.cbz'))).toBe(false)
  })

  it('is case-insensitive like the disk, and exact: the $I, desktop.ini and the folder are not readable', async () => {
    const w = wall()
    await w.grantBin([join(bin, '$R1ABCDE.txt')])
    expect(w.readable(join(bin, '$R1ABCDE.txt').toUpperCase())).toBe(true)
    expect(w.readable(join(bin, '$I1ABCDE.txt'))).toBe(false)
    expect(w.readable(join(bin, 'desktop.ini'))).toBe(false)
    expect(w.readable(bin)).toBe(false)
    expect(w.mediaAllowed(join(bin, '$I1ABCDE.txt'))).toBe(false)
    expect(w.mediaAllowed(join(bin, '$R2FGHIJ.zip'))).toBe(false)
  })

  it('a second listing REPLACES the set', async () => {
    const w = wall()
    await w.grantBin([join(bin, '$R1ABCDE.txt')])
    await w.grantBin([join(bin, '$R2FGHIJ.zip')])
    expect(w.readable(join(bin, '$R1ABCDE.txt'))).toBe(false)
    expect(w.mediaAllowed(join(bin, '$R1ABCDE.txt'))).toBe(false)
    expect(w.readable(join(bin, '$R2FGHIJ.zip'))).toBe(true)
    await w.grantBin([])
    expect(w.readable(join(bin, '$R2FGHIJ.zip'))).toBe(false)
  })

  it('grants only $R entries that sit in a $Recycle.Bin folder', async () => {
    const w = wall()
    writeFileSync(join(tmp, '$R9XXXXX.txt'), 'x')
    writeFileSync(join(tmp, 'plain.txt'), 'x')
    await w.grantBin([
      join(bin, '$I1ABCDE.txt'),
      join(bin, 'desktop.ini'),
      join(tmp, '$R9XXXXX.txt'),
      join(tmp, 'plain.txt'),
      'rel\\$R1.txt'
    ])
    expect(w.readable(join(bin, '$I1ABCDE.txt'))).toBe(false)
    expect(w.readable(join(bin, 'desktop.ini'))).toBe(false)
    expect(w.readable(join(tmp, '$R9XXXXX.txt'))).toBe(false)
    expect(w.readable(join(tmp, 'plain.txt'))).toBe(false)
  })

  it('a symlink in the bin is never granted', async () => {
    const w = wall()
    const target = join(tmp, 'secret.txt')
    writeFileSync(target, 's')
    const link = join(bin, '$R4LINKX.txt')
    try {
      symlinkSync(target, link)
    } catch {
      return // no symlink right on this machine: nothing to prove
    }
    await w.grantBin([link, join(bin, '$R1ABCDE.txt')])
    expect(w.readable(link)).toBe(false)
    expect(w.readable(join(bin, '$R1ABCDE.txt'))).toBe(true)
  })

  it('binGranted is false for a non-string', () => {
    expect(wall().binGranted(undefined)).toBe(false)
  })

  // Review, 2026-11-10: the clipboard (Copy, Cut) and the drag out asked only
  // `readable`, which the bin grant answers, so a renderer could hand a `$R` to
  // Windows as a CUT: pasted in File Explorer it moves out of the bin and
  // leaves its `$I`. D12: never "dragged out through the existing IPC".
  it('a granted $R can never be put on the clipboard or dragged out', async () => {
    const w = wall()
    const r = join(bin, '$R1ABCDE.txt')
    await w.grantBin([r])
    expect(w.readable(r)).toBe(true)
    expect(w.copyable(r)).toBe(false)
    expect(w.copyable('C:\\Root\\a.txt')).toBe(true)
    expect(w.copyable('C:\\Temp\\members\\m.txt')).toBe(true)
    expect(w.copyable('C:\\Elsewhere\\a.txt')).toBe(false)
    expect(w.copyable(undefined)).toBe(false)
  })

  // Restore and Delete permanently act on folders too (D13, D14), but a binned
  // folder is never opened (D10): its entry may be ACTED ON, never read.
  describe('binned folders (acted on, never read)', () => {
    beforeEach(() => {
      mkdirSync(join(bin, '$R5DIRXX', 'inner'), { recursive: true })
      writeFileSync(join(bin, '$R5DIRXX', 'inner', 'deep.txt'), 'deep')
    })
    it('a granted folder entry may be acted on but not read, served or touched by the file verbs', async () => {
      const w = wall()
      const dir = join(bin, '$R5DIRXX')
      await w.grantBin([join(bin, '$R1ABCDE.txt')], [dir])
      expect(w.binActs(dir)).toBe(true)
      expect(w.binActs(join(bin, '$R1ABCDE.txt'))).toBe(true)
      expect(w.readable(dir)).toBe(false)
      expect(w.mediaAllowed(dir)).toBe(false)
      expect(w.binGranted(dir)).toBe(false)
      expect(w.editable(dir)).toBe(false)
      expect(w.movable(dir)).toBe(false)
      // what is inside the folder is nobody's
      expect(w.binActs(join(dir, 'inner'))).toBe(false)
      expect(w.readable(join(dir, 'inner', 'deep.txt'))).toBe(false)
    })
    it('a second listing replaces the folders too', async () => {
      const w = wall()
      const dir = join(bin, '$R5DIRXX')
      await w.grantBin([], [dir])
      expect(w.binActs(dir)).toBe(true)
      await w.grantBin([join(bin, '$R1ABCDE.txt')], [])
      expect(w.binActs(dir)).toBe(false)
    })
    it('only a $R in a bin folder, and never a link', async () => {
      const w = wall()
      mkdirSync(join(tmp, '$R6OUTSD'))
      const target = join(tmp, 'elsewhere')
      mkdirSync(target)
      const link = join(bin, '$R7LINKD')
      let linked = true
      try {
        symlinkSync(target, link, 'junction')
      } catch {
        linked = false
      }
      await w.grantBin([], [join(tmp, '$R6OUTSD'), join(bin, '$I1ABCDE.txt'), link])
      expect(w.binActs(join(tmp, '$R6OUTSD'))).toBe(false)
      expect(w.binActs(join(bin, '$I1ABCDE.txt'))).toBe(false)
      if (linked) expect(w.binActs(link)).toBe(false)
    })
  })
})
