import { describe, expect, it } from 'vitest'
import type { DirListing, ViewerFile } from '@shared/types'
import { browseEntries } from './entries'

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
})
