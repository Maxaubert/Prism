import { describe, expect, it } from 'vitest'
import { withImpliedFolders } from './archiveTree'
import type { ArchiveEntry } from './types'

const file = (path: string): ArchiveEntry => ({
  path,
  name: path.split('/').pop() ?? path,
  dir: false,
  size: 1
})
const dir = (path: string): ArchiveEntry => ({
  path,
  name: path.split('/').pop() ?? path,
  dir: true,
  size: 0
})

const paths = (list: readonly ArchiveEntry[]): string[] => list.map((e) => e.path).sort()

describe('the folders an archive implies but does not record', () => {
  it('invents the whole chain above a deep member', () => {
    // The Google Takeout case: no directory records at all, so the panel's
    // root had nothing whose parent was the root.
    expect(paths(withImpliedFolders([file('Collection/Art/cover.cbz')]))).toEqual([
      'Collection',
      'Collection/Art',
      'Collection/Art/cover.cbz'
    ])
  })

  it('leaves an archive that records its own folders alone', () => {
    const given = [dir('Collection'), dir('Collection/Art'), file('Collection/Art/cover.cbz')]
    expect(withImpliedFolders(given)).toHaveLength(3)
  })

  it('does not duplicate a folder two members share', () => {
    const out = withImpliedFolders([
      file('a/b/one.txt'),
      file('a/b/two.txt'),
      file('a/c/three.txt')
    ])
    expect(paths(out)).toEqual(['a', 'a/b', 'a/b/one.txt', 'a/b/two.txt', 'a/c', 'a/c/three.txt'])
  })

  it('matches an existing folder case-insensitively, since Windows paths do', () => {
    const out = withImpliedFolders([dir('Collection'), file('collection/x.txt')])
    expect(out.filter((e) => e.dir)).toHaveLength(1)
  })

  it('normalises the backslashes 7-Zip reports on Windows', () => {
    expect(paths(withImpliedFolders([file('a\\b\\c.txt')]))).toContain('a/b')
  })

  it('marks what it invents as a folder, with no size', () => {
    const made = withImpliedFolders([file('x/y.txt')]).find((e) => e.path === 'x')
    expect(made).toMatchObject({ dir: true, size: 0, name: 'x' })
  })

  it('adds nothing for members already at the top level', () => {
    expect(withImpliedFolders([file('readme.txt')])).toHaveLength(1)
  })

  it('handles an empty archive', () => {
    expect(withImpliedFolders([])).toEqual([])
  })
})
