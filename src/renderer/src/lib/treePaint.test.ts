import { describe, expect, it } from 'vitest'
import type { DirListing, ViewerFile } from '@shared/types'
import { visibleRows } from './fileTree'
import { OVERSCAN, paintRows, scrollForRow, treeWindow } from './treePaint'

const file = (dir: string, name: string): ViewerFile => ({
  path: `${dir}\\${name}`,
  name,
  ext: name.slice(name.lastIndexOf('.')).toLowerCase(),
  kind: 'image',
  size: 1,
  mtimeMs: 0
})
const folder = (dir: string, name: string): { path: string; name: string } => ({ path: `${dir}\\${name}`, name })
const opts = { orderFiles: (f: ViewerFile[]) => f, foldersReversed: false }

const children: Record<string, DirListing> = {
  'C:\\r': { folders: [folder('C:\\r', 'a'), folder('C:\\r', 'b'), folder('C:\\r', 'c')], files: [file('C:\\r', 'z.png')] },
  'C:\\r\\a': { folders: [folder('C:\\r\\a', 'deep')], files: [file('C:\\r\\a', 'x.png')] },
  'C:\\r\\a\\deep': { folders: [], files: [] },
  'C:\\r\\b': { folders: [], files: [], hidden: 2 },
  'C:\\r\\c': { folders: [], files: [], unreadable: true }
}

describe('paintRows', () => {
  it('draws folders, files and notes in the nested order, with depths', () => {
    const rows = paintRows('C:\\r', new Set(['C:\\r\\a', 'C:\\r\\a\\deep', 'C:\\r\\b', 'C:\\r\\c']), children, opts)
    expect(rows.map((r) => [r.kind, r.kind === 'note' ? r.text : r.name, r.depth])).toEqual([
      ['folder', 'a', 0],
      ['folder', 'deep', 1],
      ['note', 'empty', 2],
      ['file', 'x.png', 1],
      ['folder', 'b', 0],
      ['note', "2 files Prism can't open", 1],
      ['folder', 'c', 0],
      ['note', "can't read this folder", 1],
      ['file', 'z.png', 0]
    ])
  })

  it('an open folder not read yet says loading', () => {
    const rows = paintRows('C:\\r', new Set(['C:\\r\\missing']), { 'C:\\r': { folders: [folder('C:\\r', 'missing')], files: [] } }, opts)
    expect(rows.map((r) => (r.kind === 'note' ? r.text : r.name))).toEqual(['missing', 'loading…'])
  })

  it('without the notes, is exactly the order the keyboard walks', () => {
    const expanded = new Set(['C:\\r\\a', 'C:\\r\\a\\deep'])
    const painted = paintRows('C:\\r', expanded, children, opts).flatMap((r) => (r.kind === 'note' ? [] : [r.path]))
    expect(painted).toEqual(visibleRows('C:\\r', expanded, children, opts).map((r) => r.path))
  })

  it('keys are unique, so React keeps each row its own', () => {
    const rows = paintRows('C:\\r', new Set(Object.keys(children)), children, opts)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('a symlink loop does not hang it', () => {
    const loop: Record<string, DirListing> = { 'C:\\r': { folders: [{ path: 'C:\\r', name: 'self' }], files: [] } }
    expect(paintRows('C:\\r', new Set(['C:\\r']), loop, opts)).toHaveLength(1)
  })

  it('forty-eight thousand rows flatten in well under a frame budget', () => {
    const big: Record<string, DirListing> = {
      'C:\\r': { folders: [], files: Array.from({ length: 48000 }, (_, i) => file('C:\\r', `f${i}.png`)) }
    }
    const t = performance.now()
    expect(paintRows('C:\\r', new Set(), big, opts)).toHaveLength(48000)
    expect(performance.now() - t).toBeLessThan(100)
  })
})

describe('treeWindow', () => {
  it('draws the view and the overscan, never past the ends', () => {
    expect(treeWindow(48000, 26, 26 * 1000, 520)).toEqual({ first: 1000 - OVERSCAN, end: 1020 + OVERSCAN })
    expect(treeWindow(10, 26, 0, 520)).toEqual({ first: 0, end: 10 })
    expect(treeWindow(0, 26, 0, 520)).toEqual({ first: 0, end: 0 })
  })
})

describe('scrollForRow', () => {
  it('leaves a row alone that is comfortably in view', () => {
    expect(scrollForRow(10, 26, 0, 0, 520, 100000)).toBeNull()
  })
  it('places a row that is off screen near the top, with context above it', () => {
    expect(scrollForRow(1000, 26, 0, 0, 520, 100000)).toBe(26000 - 78)
  })
  it('nudges a row near the bottom edge just enough', () => {
    expect(scrollForRow(18, 26, 0, 0, 520, 100000)).toBe(18 * 26 + 26 - 520 + 78)
  })
})

describe('an archive in the tree (#300)', () => {
  const zipFile: ViewerFile = { path: 'C:\\p\\w.zip', name: 'w.zip', ext: '.zip', kind: 'archive', size: 1, mtimeMs: 0 }
  const kids: Record<string, DirListing> = {
    'C:\\p': { folders: [], files: [zipFile, file('C:\\p', 'a.png')] },
    'C:\\p\\w.zip': { folders: [folder('C:\\p\\w.zip', 'Wind')], files: [] }
  }
  it('is a folder row with the archive on it, and walks in when open', () => {
    const shut = paintRows('C:\\p', new Set(), kids, opts)
    expect(shut[0]).toMatchObject({ kind: 'folder', name: 'w.zip', zip: zipFile })
    const open = paintRows('C:\\p', new Set(['C:\\p\\w.zip']), kids, opts)
    expect(open.map((r) => (r.kind === 'note' ? r.text : r.name))).toEqual(['w.zip', 'Wind', 'a.png'])
    expect(visibleRows('C:\\p', new Set(['C:\\p\\w.zip']), kids, opts).map((r) => [r.name, r.isFolder])).toEqual([
      ['w.zip', true],
      ['Wind', true],
      ['a.png', false]
    ])
  })
})
