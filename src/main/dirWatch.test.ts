import { describe, expect, it } from 'vitest'
import { isMuted, muteDir, shouldReport } from './dirWatch'

const skip = (n: string): boolean =>
  new Set(['desktop.ini', 'thumbs.db', '$recycle.bin']).has(n.toLowerCase())
describe('what is worth waking the renderer for', () => {
  it('reports a change to a file the tree would draw', () => {
    expect(shouldReport('photo.jpg', skip)).toBe(true)
  })

  it('reports a file the tree cannot draw, because the count of those is a row too', () => {
    expect(shouldReport('build.o', skip)).toBe(true)
  })

  it('says nothing about Windows clutter or a dotfile', () => {
    expect(shouldReport('desktop.ini', skip)).toBe(false)
    expect(shouldReport('.gitignore', skip)).toBe(false)
  })

  it('reports a folder whose name has a dot in it', () => {
    // The bug this replaced: `.3` is not a viewable extension, so `v1.2.3`
    // was read as an unviewable FILE and the new folder never appeared.
    expect(shouldReport('v1.2.3', skip)).toBe(true)
    expect(shouldReport('dist.old', skip)).toBe(true)
  })

  it('reports something with no extension at all', () => {
    expect(shouldReport('assets', skip)).toBe(true)
  })

  it('reports a nameless change, which is what Windows sometimes gives', () => {
    expect(shouldReport(null, skip)).toBe(true)
  })

  it('looks at the base name, not the path it arrived under', () => {
    expect(shouldReport('sub\\dir\\photo.jpg', skip)).toBe(true)
    expect(shouldReport('sub/dir/desktop.ini', skip)).toBe(false)
  })

  it('ignores a change under a dot directory by its own name', () => {
    expect(shouldReport('.git/HEAD', skip)).toBe(false)
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
