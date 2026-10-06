import { describe, expect, it } from 'vitest'
import {
  below,
  browsableArchive,
  containerCandidates,
  hasEntry,
  innerOf,
  levelOf,
  memberOf,
  placeOf,
  within
} from './archivePlace'
import { withImpliedFolders } from './archiveTree'
import type { ArchiveEntry } from './types'

const file = (path: string, size = 1, packed = 1): ArchiveEntry => ({
  path,
  name: path.split('/').pop() ?? path,
  dir: false,
  size,
  packed
})

describe('places inside archives (#300)', () => {
  it('knows the archive kinds and leaves comics as books', () => {
    expect(browsableArchive('Wind-0.2.2.zip')).toBe(true)
    expect(browsableArchive('x.7z')).toBe(true)
    expect(browsableArchive('disc.ISO')).toBe(true)
    expect(browsableArchive('book.cbz')).toBe(false)
    expect(browsableArchive('notes.txt')).toBe(false)
    expect(browsableArchive('zip')).toBe(false)
  })

  it('names only the segments that could be a container, shortest first', () => {
    expect(containerCandidates('C:\\Users\\a\\Downloads')).toEqual([])
    expect(containerCandidates('C:\\d\\x.zip\\Wind\\inner.7z\\docs')).toEqual([
      'C:\\d\\x.zip',
      'C:\\d\\x.zip\\Wind\\inner.7z'
    ])
    // A share's leading separators survive the round trip.
    expect(containerCandidates('\\\\srv\\share\\x.zip\\a')).toEqual(['\\\\srv\\share\\x.zip'])
  })

  it('turns places into member names and back', () => {
    const base = 'C:\\d\\x.zip'
    expect(innerOf(base, 'C:\\d\\x.zip')).toBe('')
    expect(innerOf(base, 'c:\\D\\X.zip\\Wind\\src')).toBe('Wind/src')
    expect(innerOf(base, 'C:\\d\\x.zipper\\a')).toBeNull()
    expect(innerOf(base, 'C:\\d')).toBeNull()
    expect(placeOf(base, 'Wind/src')).toBe('C:\\d\\x.zip\\Wind\\src')
    expect(placeOf(base, '')).toBe(base)
    expect(memberOf({ base }, 'C:\\d\\x.zip\\Wind\\a.txt')).toBe('Wind/a.txt')
    expect(within(base, 'C:\\d\\x.zip\\Wind')).toBe(true)
    expect(within(base, 'C:\\d\\x.zipx')).toBe(false)
  })

  it('lists one level with every folder total, implied folders included', () => {
    const entries = withImpliedFolders([
      file('Wind/README.md', 10),
      file('Wind/src/a.ts', 100),
      file('Wind/src/main/b.ts', 1000),
      file('top.txt', 5)
    ])
    const root = levelOf(entries, '')
    expect(root.folders.map((f) => f.name)).toEqual(['Wind'])
    expect(root.folders[0].size).toBe(1110)
    expect(root.files.map((f) => f.name)).toEqual(['top.txt'])
    const wind = levelOf(entries, 'Wind')
    expect(wind.folders.map((f) => [f.name, f.size])).toEqual([['src', 1100]])
    expect(wind.folders[0].items).toBe(3) // a.ts, main, main/b.ts
    expect(wind.files.map((f) => f.name)).toEqual(['README.md'])
    expect(levelOf(entries, 'Wind/src/main').files.map((f) => f.name)).toEqual(['b.ts'])
  })

  it('finds entries case-insensitively and scopes a search below a folder', () => {
    const entries = withImpliedFolders([file('A/B/c.txt'), file('d.txt')])
    expect(hasEntry(entries, 'a/b')?.dir).toBe(true)
    expect(hasEntry(entries, 'A/B/C.TXT')?.name).toBe('c.txt')
    expect(hasEntry(entries, 'nope')).toBeNull()
    expect(below(entries, 'A').map((e) => e.path).sort()).toEqual(['A/B', 'A/B/c.txt'])
    expect(below(entries, '').length).toBe(entries.length)
  })
})
