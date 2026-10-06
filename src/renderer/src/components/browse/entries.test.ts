import { describe, expect, it } from 'vitest'
import type { DirListing, ViewerFile } from '@shared/types'
import { browseEntries, datesKnown } from './entries'

function file(name: string, kind: ViewerFile['kind'], size: number): ViewerFile {
  return {
    path: `C:\\Files\\${name}`,
    name,
    kind,
    ext: name.slice(name.lastIndexOf('.')),
    size,
    mtimeMs: 1
  }
}

const listing: DirListing = {
  folders: [
    { path: 'C:\\Files\\Folder 10', name: 'Folder 10' },
    { path: 'C:\\Files\\Folder 2', name: 'Folder 2' }
  ],
  files: [
    file('image 10.jpg', 'image', 100),
    file('unknown.bin', 'other', 300),
    file('image 2.jpg', 'image', 200)
  ]
}

describe('folder browser entries', () => {
  it('sorts search locations by parent path with a natural name tie-breaker', () => {
    const results: DirListing = {
      folders: [],
      files: [
        { ...file('a.dll', 'other', 1), path: 'C:\\Zebra\\a.dll' },
        { ...file('item 10.dll', 'other', 1), path: 'C:\\Alpha\\item 10.dll' },
        { ...file('item 2.dll', 'other', 1), path: 'C:\\Alpha\\item 2.dll' }
      ]
    }
    expect(
      browseEntries(results, '', { key: 'path', direction: 'asc' }).map((entry) => entry.name)
    ).toEqual(['item 2.dll', 'item 10.dll', 'a.dll'])
    expect(
      browseEntries(results, '', { key: 'path', direction: 'desc' }).map((entry) => entry.name)
    ).toEqual(['a.dll', 'item 10.dll', 'item 2.dll'])
  })

  it('keeps unsupported files and sorts numeric names with folders first', () => {
    expect(
      browseEntries(listing, '', { key: 'name', direction: 'asc' }).map((entry) => entry.name)
    ).toEqual(['Folder 2', 'Folder 10', 'image 2.jpg', 'image 10.jpg', 'unknown.bin'])
  })

  it('applies the existing search operators to the full listing', () => {
    expect(
      browseEntries(listing, 'ext:jpg -10', { key: 'size', direction: 'desc' }).map(
        (entry) => entry.name
      )
    ).toEqual(['image 2.jpg'])
    expect(
      browseEntries(listing, 'Folder 2', { key: 'name', direction: 'asc' }).map(
        (entry) => entry.name
      )
    ).toEqual(['Folder 2'])
  })

  it('leaves folders in natural order when sorting files by descending size', () => {
    expect(
      browseEntries(listing, '', { key: 'size', direction: 'desc' }).map((entry) => entry.name)
    ).toEqual(['Folder 2', 'Folder 10', 'unknown.bin', 'image 2.jpg', 'image 10.jpg'])
    expect(listing.folders[0].name).toBe('Folder 10')
  })

  it('sorts measured folder totals and leaves unknown sizes last in both directions', () => {
    const total = (bytes: number) => ({
      bytes,
      files: 1,
      folders: 0,
      unreadable: 0,
      skippedLinks: 0,
      truncated: false
    })
    const sizes = { 'C:\\Files\\Folder 10': total(0), 'C:\\Files\\Folder 2': total(2048) }
    expect(
      browseEntries(listing, '', { key: 'size', direction: 'asc' }, sizes)
        .slice(0, 2)
        .map((entry) => entry.name)
    ).toEqual(['Folder 10', 'Folder 2'])
    expect(
      browseEntries(listing, '', { key: 'size', direction: 'desc' }, sizes)
        .slice(0, 2)
        .map((entry) => entry.name)
    ).toEqual(['Folder 2', 'Folder 10'])
    for (const direction of ['asc', 'desc'] as const)
      expect(
        browseEntries(listing, '', { key: 'size', direction }, { 'C:\\Files\\Folder 10': total(0) })
          .slice(0, 2)
          .map((entry) => entry.name)
      ).toEqual(['Folder 10', 'Folder 2'])
  })

  describe("Downloads' date view (#285)", () => {
    const dated: DirListing = {
      folders: [
        { path: 'C:\\Dl\\Old folder', name: 'Old folder', mtimeMs: 100 },
        { path: 'C:\\Dl\\New folder', name: 'New folder', mtimeMs: 400 }
      ],
      files: [
        { ...file('b.zip', 'archive', 1), path: 'C:\\Dl\\b.zip', mtimeMs: 300 },
        { ...file('a.zip', 'archive', 1), path: 'C:\\Dl\\a.zip', mtimeMs: 300 },
        { ...file('c.exe', 'other', 1), path: 'C:\\Dl\\c.exe', mtimeMs: 200 }
      ]
    }
    const names = (mixed: boolean, direction: 'asc' | 'desc' = 'desc', key: 'modified' | 'name' = 'modified') =>
      browseEntries(dated, '', { key, direction }, {}, mixed).map((e) => e.name)

    it('mixes files and folders newest first, a name breaking a tie', () => {
      expect(names(true)).toEqual(['New folder', 'a.zip', 'b.zip', 'c.exe', 'Old folder'])
      expect(names(true, 'asc')).toEqual(['Old folder', 'c.exe', 'a.zip', 'b.zip', 'New folder'])
    })
    it('keeps folders first for any other sort, and anywhere else', () => {
      expect(names(true, 'asc', 'name')).toEqual(['New folder', 'Old folder', 'a.zip', 'b.zip', 'c.exe'])
      expect(names(false).slice(0, 2)).toEqual(['New folder', 'Old folder'])
    })
    it('waits for every date before it mixes (#271)', () => {
      const pending = { ...dated, folders: [{ path: 'C:\\Dl\\X', name: 'X' }, ...dated.folders] }
      expect(datesKnown(pending)).toBe(false)
      expect(browseEntries(pending, '', { key: 'modified', direction: 'desc' }, {}, true)[0].name).toBe('New folder')
      expect(browseEntries(pending, '', { key: 'modified', direction: 'desc' }, {}, true)[1].name).toBe('Old folder')
      expect(datesKnown(dated)).toBe(true)
    })
    it('orders folders by their dates too outside Downloads, still first', () => {
      const byDate = (direction: 'asc' | 'desc') =>
        browseEntries(
          {
            ...dated,
            folders: [
              { path: 'C:\\Dl\\A old', name: 'A old', mtimeMs: 100 },
              { path: 'C:\\Dl\\B new', name: 'B new', mtimeMs: 400 }
            ]
          },
          '',
          { key: 'modified', direction },
          {},
          false
        ).map((e) => e.name)
      expect(byDate('desc').slice(0, 2)).toEqual(['B new', 'A old'])
      expect(byDate('asc').slice(0, 2)).toEqual(['A old', 'B new'])
      // A folder still undated keeps the name order, so the rows move once.
      const undated = browseEntries(
        {
          ...dated,
          folders: [
            { path: 'C:\\Dl\\A old', name: 'A old', mtimeMs: 100 },
            { path: 'C:\\Dl\\B new', name: 'B new' }
          ]
        },
        '',
        { key: 'modified', direction: 'desc' },
        {},
        false
      ).map((e) => e.name)
      expect(undated.slice(0, 2)).toEqual(['A old', 'B new'])
    })
  })
})

describe('the Packed column (#300)', () => {
  const zipped = (name: string, size: number, packed: number): ViewerFile => ({
    ...file(name, 'text', size),
    member: true,
    packed
  })
  const inZip: DirListing = {
    folders: [
      { path: 'C:\\z.zip\\big', name: 'big', size: 900, items: 2 },
      { path: 'C:\\z.zip\\small', name: 'small', size: 10, items: 1 }
    ],
    files: [zipped('a.txt', 100, 90), zipped('b.txt', 500, 10), zipped('c.txt', 50, 40)],
    archive: {
      container: 'C:\\z.zip', base: 'C:\\z.zip', chain: ['C:\\z.zip'], outer: 'C:\\z.zip', inner: '',
      display: 'z.zip', files: 3, folders: 2, packed: 1, unpacked: 1, readOnly: false, nested: false, encryption: 'none'
    }
  }
  it('sorts members by what they occupy in the container', () => {
    const rows = browseEntries(inZip, '', { key: 'packed', direction: 'asc' })
    expect(rows.filter((r) => !r.isFolder).map((r) => r.name)).toEqual(['b.txt', 'c.txt', 'a.txt'])
  })
  it('folders sort by their summed size', () => {
    const sizes = { 'C:\\z.zip\\big': { bytes: 900, files: 2, folders: 0, unreadable: 0, skippedLinks: 0, truncated: false }, 'C:\\z.zip\\small': { bytes: 10, files: 1, folders: 0, unreadable: 0, skippedLinks: 0, truncated: false } }
    const rows = browseEntries(inZip, '', { key: 'size', direction: 'asc' }, sizes)
    expect(rows.filter((r) => r.isFolder).map((r) => r.name)).toEqual(['small', 'big'])
  })
  it('outside an archive Packed reads as Size', () => {
    const rows = browseEntries({ ...inZip, archive: undefined }, '', { key: 'packed', direction: 'asc' })
    expect(rows.filter((r) => !r.isFolder).map((r) => r.name)).toEqual(['c.txt', 'a.txt', 'b.txt'])
  })
})
