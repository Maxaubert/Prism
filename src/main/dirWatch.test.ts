import { describe, expect, it } from 'vitest'
import { isMuted, muteDir, shouldReport } from './dirWatch'

const skip = (n: string): boolean =>
  new Set(['desktop.ini', 'thumbs.db', '$recycle.bin']).has(n.toLowerCase())
const viewable = (n: string): boolean => /\.(jpg|png|md|mp4)$/i.test(n)

describe('what is worth waking the renderer for', () => {
  it('reports a change to a file the tree would draw', () => {
    expect(shouldReport('photo.jpg', skip, viewable)).toBe(true)
  })

  it('says nothing about a file it would never draw a row for', () => {
    expect(shouldReport('build.o', skip, viewable)).toBe(false)
  })

  it('says nothing about Windows clutter or a dotfile', () => {
    expect(shouldReport('desktop.ini', skip, viewable)).toBe(false)
    expect(shouldReport('.gitignore', skip, viewable)).toBe(false)
  })

  it('always reports something with no extension: a new subfolder is a new row', () => {
    expect(shouldReport('assets', skip, viewable)).toBe(true)
  })

  it('reports a nameless change, which is what Windows sometimes gives', () => {
    expect(shouldReport(null, skip, viewable)).toBe(true)
  })

  it('looks at the base name, not the path it arrived under', () => {
    expect(shouldReport('sub\\dir\\photo.jpg', skip, viewable)).toBe(true)
    expect(shouldReport('sub/dir/desktop.ini', skip, viewable)).toBe(false)
  })

  it('ignores a change under a dot directory by its own name', () => {
    expect(shouldReport('.git/HEAD', skip, viewable)).toBe(false)
  })
})

describe('muting Prism own writes', () => {
  it('silences a directory for a while, then stops', () => {
    muteDir('C:\\work', 1000, 500)
    expect(isMuted('C:\\work', 1200)).toBe(true)
    expect(isMuted('C:\\work', 1600)).toBe(false)
  })

  it('is case-insensitive, as Windows paths are', () => {
    muteDir('C:\\Work', 1000, 500)
    expect(isMuted('c:\\work', 1100)).toBe(true)
  })

  it('says nothing about a directory nobody muted', () => {
    expect(isMuted('C:\\elsewhere', 1)).toBe(false)
  })

  it('ignores an empty path rather than muting everything', () => {
    muteDir('', 1000, 500)
    expect(isMuted('', 1100)).toBe(false)
  })
})
