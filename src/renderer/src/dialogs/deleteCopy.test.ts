import { describe, expect, it } from 'vitest'
import { plain } from './testing'
import { archiveBytes, deleteLine, deleteTitle, sizeText, sumDeleteSize } from './deleteCopy'

describe('archiveBytes: what a zip delete frees', () => {
  const entries = [
    { path: 'docs', dir: true, size: 0 },
    { path: 'docs/a.txt', dir: false, size: 10 },
    { path: 'docs/sub/b.txt', dir: false, size: 20 },
    { path: 'docsX/c.txt', dir: false, size: 99 },
    { path: 'top.txt', dir: false, size: 5 }
  ]
  it('counts a file, and a folder with its whole tree, but not a name that only starts alike', () => {
    expect(archiveBytes(entries, ['top.txt'])).toBe(5)
    expect(archiveBytes(entries, ['docs'])).toBe(30)
    expect(archiveBytes(entries, ['docs', 'top.txt'])).toBe(35)
    expect(archiveBytes(entries, ['nothing'])).toBe(0)
  })
})

describe('deleteTitle', () => {
  it('names one item, counts several', () => {
    expect(deleteTitle(['a.txt'], 1, false)).toBe('Delete a.txt?')
    expect(deleteTitle(['a', 'b'], 2, false)).toBe('Delete 2 items?')
    expect(deleteTitle(['a.txt'], 1, true)).toBe('Delete a.txt permanently?')
    expect(deleteTitle(['a', 'b'], 9, true)).toBe('Delete 9 items permanently?')
  })
})

describe('sizeText', () => {
  it('is an ellipsis while counting, the size when known, a lower bound when partial', () => {
    expect(sizeText({ state: 'counting' })).toBe('…')
    expect(sizeText(undefined)).toBe('…')
    expect(sizeText({ state: 'known', bytes: 1536 })).toBe('1.5 KB')
    expect(sizeText({ state: 'known', bytes: 1536, partial: true })).toBe('≥ 1.5 KB')
    expect(sizeText({ state: 'none' })).toBe('')
  })
})

describe('deleteLine', () => {
  it('one item is the size alone', () => {
    expect(plain(deleteLine(['a'], 1, { state: 'known', bytes: 10 }))).toBe('10 B')
  })
  it('several lists two names, the rest and the size', () => {
    expect(plain(deleteLine(['a', 'b', 'c'], 5, { state: 'known', bytes: 10 }))).toBe('a, b +3 · 10 B')
    expect(plain(deleteLine(['a', 'b'], 2, { state: 'counting' }))).toBe('a, b · …')
  })
})

describe('sumDeleteSize: the total, filling in as folders are counted', () => {
  const folder = (bytes: number, extra = {}) => ({
    bytes,
    files: 1,
    folders: 0,
    unreadable: 0,
    skippedLinks: 0,
    truncated: false,
    ...extra
  })
  it('files alone are known at once', () => {
    expect(sumDeleteSize({ files: [10, 20], folders: [], sizes: {} })).toEqual({ state: 'known', bytes: 30 })
  })
  it('a folder not yet counted keeps it counting', () => {
    expect(sumDeleteSize({ files: [10], folders: ['C:\\f'], sizes: {} })).toEqual({ state: 'counting' })
    expect(sumDeleteSize({ files: [10], folders: ['C:\\f'], sizes: { 'C:\\f': undefined } })).toEqual({
      state: 'counting'
    })
  })
  it('adds a counted folder, partial when it could not read everything', () => {
    expect(sumDeleteSize({ files: [10], folders: ['C:\\f'], sizes: { 'C:\\f': folder(90) } })).toEqual({
      state: 'known',
      bytes: 100
    })
    expect(
      sumDeleteSize({ files: [], folders: ['C:\\f'], sizes: { 'C:\\f': folder(90, { unreadable: 2 }) } })
    ).toEqual({ state: 'known', bytes: 90, partial: true })
  })
  it('a folder that cannot be counted at all leaves no size', () => {
    expect(sumDeleteSize({ files: [10], folders: ['C:\\f'], sizes: { 'C:\\f': null } })).toEqual({
      state: 'none'
    })
  })
  it('files still being read keep it counting', () => {
    expect(sumDeleteSize({ files: undefined, folders: [], sizes: {} })).toEqual({ state: 'counting' })
  })
})
