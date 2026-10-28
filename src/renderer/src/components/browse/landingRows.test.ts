import { describe, expect, it } from 'vitest'
import type { DirListing } from '@shared/types'
import type { LandingRow } from '../../lib/jobs'
import { landingPcts, listedPaths, rowsKey, unlisted, withLanding } from './landingRows'

const listing = {
  folders: [{ path: 'C:\\into\\Sub', name: 'Sub', mtimeMs: 1 }],
  files: [{ path: 'C:\\into\\a.txt', name: 'a.txt', ext: '.txt', kind: 'code', size: 1, mtimeMs: 1 }]
} as unknown as DirListing

const row = (name: string, pct: number, isFolder = false): LandingRow => ({
  path: `C:\\into\\${name}`,
  name,
  isFolder,
  pct,
  since: 5
})

describe('landing rows (review, 2026-10-28)', () => {
  it('drops a row once the listing has its file, in any case', () => {
    const listed = listedPaths(listing)
    expect(unlisted([row('A.TXT', 100), row('b.jpg', 40), row('sub', 0, true)], listed)).toEqual([
      row('b.jpg', 40)
    ])
    expect(listedPaths(null).size).toBe(0)
  })

  it('keys the row set without the percentages, so a tick never rebuilds the listing', () => {
    expect(rowsKey([row('b.jpg', 10)])).toBe(rowsKey([row('b.jpg', 90)]))
    expect(rowsKey([row('b.jpg', 10)])).not.toBe(rowsKey([row('b.jpg', 10), row('c.jpg', 0)]))
    expect(rowsKey([])).toBe('')
  })

  it('joins the rows into the listing, files with their kind and folders apart', () => {
    expect(withLanding(listing, '')).toBe(listing)
    expect(withLanding(null, rowsKey([row('b.jpg', 1)]))).toBeNull()
    const merged = withLanding(listing, rowsKey([row('b.jpg', 1), row('New', 0, true)]))!
    expect(merged.files.map((f) => [f.name, f.ext, f.size, f.mtimeMs])).toEqual([
      ['a.txt', '.txt', 1, 1],
      ['b.jpg', '.jpg', 0, 5]
    ])
    expect(merged.files[1].kind).toBe('image')
    expect(merged.folders.map((f) => f.name)).toEqual(['Sub', 'New'])
  })

  it('hands the bars each row by lower-cased path', () => {
    expect(landingPcts([])).toBeUndefined()
    expect(landingPcts([row('B.jpg', 40)])?.get('c:\\into\\b.jpg')).toBe(40)
  })
})
