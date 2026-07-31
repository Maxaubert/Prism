import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { isInsideRoot, listDir } from './dirList'

// A real temp folder, since both functions are about the filesystem.
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'prism-tree-'))
  mkdirSync(join(root, 'sub'))
  mkdirSync(join(root, '$RECYCLE.BIN'))
  writeFileSync(join(root, 'b.jpg'), '')
  writeFileSync(join(root, 'a10.png'), '')
  writeFileSync(join(root, 'a9.png'), '')
  writeFileSync(join(root, 'notes.md'), '')
  writeFileSync(join(root, 'archive.zip'), '') // not viewable
  writeFileSync(join(root, 'desktop.ini'), '') // system noise
  writeFileSync(join(root, '.hidden.jpg'), '')
  writeFileSync(join(root, 'sub', 'deep.mp4'), '')
  return root
}

describe('isInsideRoot', () => {
  const root = fixture()

  it('accepts the root itself and its children', () => {
    expect(isInsideRoot(root, root)).toBe(true)
    expect(isInsideRoot(root, join(root, 'b.jpg'))).toBe(true)
    expect(isInsideRoot(root, join(root, 'sub'))).toBe(true)
    expect(isInsideRoot(root, join(root, 'sub', 'deep.mp4'))).toBe(true)
  })

  it('rejects an escape through ..', () => {
    expect(isInsideRoot(root, join(root, '..'))).toBe(false)
    expect(isInsideRoot(root, join(root, 'sub', '..', '..', 'elsewhere'))).toBe(false)
  })

  it('rejects a sibling that merely shares the name prefix', () => {
    expect(isInsideRoot(root, `${root}-other`)).toBe(false)
    expect(isInsideRoot(root, `${root}-other/x.jpg`)).toBe(false)
  })

  it('ignores case and trailing separators on Windows', () => {
    if (process.platform !== 'win32') return
    expect(isInsideRoot(root, join(root.toUpperCase(), 'b.jpg'))).toBe(true)
    expect(isInsideRoot(`${root}\\`, join(root, 'sub'))).toBe(true)
  })

  it('rejects anything when the root is missing', () => {
    expect(isInsideRoot('', join(root, 'b.jpg'))).toBe(false)
  })
})

describe('listDir', () => {
  const root = fixture()

  it('lists folders and viewable files, hiding the rest', () => {
    const l = listDir(root)
    expect(l.folders.map((f) => f.name)).toEqual(['sub'])
    expect(l.files.map((f) => f.name)).toEqual(['a9.png', 'a10.png', 'b.jpg', 'notes.md'])
  })

  it('sorts numbers naturally, not lexically', () => {
    const names = listDir(root).files.map((f) => f.name)
    expect(names.indexOf('a9.png')).toBeLessThan(names.indexOf('a10.png'))
  })

  it('carries the kind of each file', () => {
    const byName = Object.fromEntries(listDir(root).files.map((f) => [f.name, f.kind]))
    expect(byName['b.jpg']).toBe('image')
    expect(byName['notes.md']).toBe('text')
  })

  it('flags an unreadable path instead of throwing', () => {
    const l = listDir(join(root, 'does-not-exist'))
    expect(l).toEqual({ folders: [], files: [], unreadable: true })
  })

  it('does not flag a readable folder', () => {
    expect(listDir(root).unreadable).toBeUndefined()
  })
})
