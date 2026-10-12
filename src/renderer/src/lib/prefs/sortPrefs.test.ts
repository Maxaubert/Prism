import { describe, expect, it } from 'vitest'
import type { FileKind, ViewerFile } from '@shared/types'
import { sortFiles } from './sortPrefs'

const f = (name: string, kind: FileKind, size: number, mtimeMs: number): ViewerFile => ({
  path: `C:/f/${name}`,
  name,
  ext: name.slice(name.lastIndexOf('.')),
  kind,
  size,
  mtimeMs
})

const FILES = [
  f('ep10.mp4', 'video', 500, 30),
  f('ep2.mp4', 'video', 900, 10),
  f('cover.png', 'image', 100, 40),
  f('notes.txt', 'text', 100, 20)
]
const names = (list: ViewerFile[]): string[] => list.map((x) => x.name)

describe('sortFiles', () => {
  it('sorts names naturally, so ep2 comes before ep10', () => {
    expect(names(sortFiles(FILES, 'name', 'asc'))).toEqual(['cover.png', 'ep2.mp4', 'ep10.mp4', 'notes.txt'])
  })

  it('descending reverses', () => {
    expect(names(sortFiles(FILES, 'name', 'desc'))).toEqual(['notes.txt', 'ep10.mp4', 'ep2.mp4', 'cover.png'])
  })

  it('sorts by size with a name tie-break', () => {
    expect(names(sortFiles(FILES, 'size', 'asc'))).toEqual(['cover.png', 'notes.txt', 'ep10.mp4', 'ep2.mp4'])
  })

  it('sorts by modified time', () => {
    expect(names(sortFiles(FILES, 'modified', 'desc'))).toEqual(['cover.png', 'ep10.mp4', 'notes.txt', 'ep2.mp4'])
  })

  it('sorts by type, grouping kinds together', () => {
    expect(names(sortFiles(FILES, 'type', 'asc'))).toEqual(['cover.png', 'notes.txt', 'ep2.mp4', 'ep10.mp4'])
  })

  it('returns a new array of the same objects', () => {
    const out = sortFiles(FILES, 'name', 'asc')
    expect(out).not.toBe(FILES)
    expect(out[0]).toBe(FILES[2]) // same reference, so indexOf keeps working
  })
})
