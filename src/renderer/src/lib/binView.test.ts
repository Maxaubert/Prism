import { describe, expect, it } from 'vitest'
import { BIN_PLACE } from '@shared/binPlace'
import type { BrowseSort } from '@shared/browse'
import { BIN_EMPTY, BIN_SORT, binBytes, binColumns, binFacts, binnedOf, binnedPath } from './binView'
import { nextSort, viewSort } from './downloadsView'

const name: BrowseSort = { key: 'name', direction: 'asc' }

describe('the bin shows its own sort (D7; owner, 2026-11-10: newest deleted first)', () => {
  it('Date deleted, newest first, until one is picked there', () => {
    expect(BIN_SORT).toEqual({ key: 'deleted', direction: 'desc' })
    expect(viewSort({ path: BIN_PLACE, sort: name }, false)).toEqual(BIN_SORT)
    expect(viewSort({ path: BIN_PLACE, sort: name, sortChosen: true }, false)).toEqual(name)
  })
  it('leaves every other place alone', () => {
    expect(viewSort({ path: 'C:\\Users', sort: name }, false)).toEqual(name)
    expect(viewSort({ sort: name }, false)).toEqual(name)
  })
  it('a first click on Date deleted is newest first, as Downloads does for Date modified', () => {
    expect(nextSort(name, 'deleted', false)).toEqual({ key: 'deleted', direction: 'desc' })
    expect(nextSort(BIN_SORT, 'deleted', false)).toEqual({ key: 'deleted', direction: 'asc' })
    expect(nextSort(BIN_SORT, 'from', false)).toEqual({ key: 'from', direction: 'asc' })
  })
})

describe('the bin columns (D7)', () => {
  it('are Name, Original location, Date deleted, Size, Type, in that order', () => {
    expect(binColumns.map((c) => [c.key, c.label])).toEqual([
      ['name', 'Name'],
      ['from', 'Original location'],
      ['deleted', 'Date deleted'],
      ['size', 'Size'],
      ['type', 'Type']
    ])
  })
})

describe('where a bin row came from', () => {
  const at = { from: 'C:\\Users\\m', at: 1 }
  it('reads a file row and a folder row', () => {
    expect(binnedOf({ file: { binned: at } })).toBe(at)
    expect(binnedOf({ binned: at })).toBe(at)
    expect(binnedOf({})).toBeUndefined()
  })
  it('joins the folder and the name into the original path', () => {
    expect(binnedPath('C:\\Users\\m', 'a.txt')).toBe('C:\\Users\\m\\a.txt')
    expect(binnedPath('C:\\', 'a.txt')).toBe('C:\\a.txt')
    expect(binnedPath('', 'a.txt')).toBe('a.txt')
  })
})

describe('what the bin holds (#502, owner 2026-11-10: how many GB are stored in it)', () => {
  it('adds up the sizes main read from the records, files and folders alike', () => {
    expect(binBytes({ files: [{ size: 1000 }, { size: 24 }, {}], folders: [{ size: 2048 }, {}] })).toBe(3072)
    expect(binBytes({ files: [], folders: [] })).toBe(0)
    expect(binBytes(undefined)).toBe(0)
  })
  it('says the count and the size on one quiet line', () => {
    expect(binFacts(38, 1.4 * 1024 ** 3)).toBe('38 items · 1.4 GB')
    expect(binFacts(1, 4 * 1024)).toBe('1 item · 4.0 KB')
  })
  it('says only the count for an empty bin, or when no size is known', () => {
    expect(binFacts(0, 0)).toBe('0 items')
    expect(binFacts(3, 0)).toBe('3 items')
  })
})

describe('the empty bin', () => {
  it('says so in plain words', () => {
    expect(BIN_EMPTY).toBe('The Recycle Bin is empty.')
  })
})
