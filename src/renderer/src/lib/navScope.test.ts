import { describe, expect, it } from 'vitest'
import type { FileKind, ViewerFile } from '@shared/types'
import { scopeFiles } from './navScope'

function f(name: string, kind: FileKind): ViewerFile {
  return { path: `C:/f/${name}`, name, ext: name.slice(name.lastIndexOf('.')), kind, size: 0 }
}

// A folder with one of everything, in the order the main process would sort it.
const FOLDER: ViewerFile[] = [
  f('a.jpg', 'image'),
  f('b.mp3', 'audio'),
  f('c.pdf', 'pdf'),
  f('d.md', 'text'),
  f('e.mp4', 'video'),
  f('g.png', 'image')
]
const at = (name: string): number => FOLDER.findIndex((x) => x.name === name)
const names = (list: ViewerFile[]): string[] => list.map((x) => x.name)

describe('scopeFiles', () => {
  it('leaves the list untouched in "all"', () => {
    const r = scopeFiles(FOLDER, at('a.jpg'), 'all')
    expect(names(r.files)).toEqual(names(FOLDER))
    expect(r.index).toBe(at('a.jpg'))
  })

  it('keeps media together in "group"', () => {
    const r = scopeFiles(FOLDER, at('a.jpg'), 'group')
    expect(names(r.files)).toEqual(['a.jpg', 'b.mp3', 'e.mp4', 'g.png'])
  })

  it('keeps documents together in "group"', () => {
    const r = scopeFiles(FOLDER, at('c.pdf'), 'group')
    expect(names(r.files)).toEqual(['c.pdf', 'd.md'])
  })

  it('keeps only the opened kind in "type"', () => {
    expect(names(scopeFiles(FOLDER, at('a.jpg'), 'type').files)).toEqual(['a.jpg', 'g.png'])
    expect(names(scopeFiles(FOLDER, at('d.md'), 'type').files)).toEqual(['d.md'])
  })

  it('still points at the opened file after filtering', () => {
    for (const scope of ['all', 'group', 'type'] as const) {
      for (const file of FOLDER) {
        const r = scopeFiles(FOLDER, at(file.name), scope)
        expect(r.files[r.index]).toBe(file)
      }
    }
  })

  it('never filters the opened file away', () => {
    // 'other' belongs to no group, so nothing else can match it.
    const odd = [...FOLDER, f('h.zip', 'other')]
    const r = scopeFiles(odd, odd.length - 1, 'group')
    expect(names(r.files)).toEqual(['h.zip'])
    expect(r.index).toBe(0)
  })

  it('survives empty, single-file, and out-of-range input', () => {
    expect(scopeFiles([], 0, 'group')).toEqual({ files: [], index: 0 })
    const one = [f('a.jpg', 'image')]
    expect(scopeFiles(one, 0, 'type')).toEqual({ files: one, index: 0 })
    // Out-of-range clamps to an end of the list, then anchors there as usual.
    expect(scopeFiles(FOLDER, 99, 'group').files[scopeFiles(FOLDER, 99, 'group').index].name).toBe('g.png')
    expect(scopeFiles(FOLDER, -3, 'group').files[scopeFiles(FOLDER, -3, 'group').index].name).toBe('a.jpg')
  })
})
