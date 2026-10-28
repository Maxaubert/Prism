import { describe, expect, it } from 'vitest'
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
