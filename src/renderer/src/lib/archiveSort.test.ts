import { describe, expect, it } from 'vitest'
import type { Entry } from '../components/archive/entry'
import { ARCHIVE_DEFAULT_SORT, sortMembers } from './archiveSort'

const f = (name: string, size: number, mtime = 0, packed?: number): Entry => ({
  path: name,
  name,
  dir: false,
  size,
  mtime,
  packed
})
const d = (name: string): Entry => ({ path: name, name, dir: true, size: 0 })
const names = (r: Entry[]): string[] => r.map((e) => e.name)

describe('sortMembers (#519)', () => {
  const rows = [f('b.txt', 5, 30), d('z'), f('a10.txt', 50, 10, 1), f('a2.txt', 500, 20, 400), d('m')]

  it('name ascending keeps folders first and orders naturally', () => {
    expect(names(sortMembers(rows, ARCHIVE_DEFAULT_SORT))).toEqual(['m', 'z', 'a2.txt', 'a10.txt', 'b.txt'])
  })
  it('name descending turns each group round, folders still first', () => {
    expect(names(sortMembers(rows, { key: 'name', direction: 'desc' }))).toEqual(['z', 'm', 'b.txt', 'a10.txt', 'a2.txt'])
  })
  it('sorts by size, packed and modified', () => {
    expect(names(sortMembers(rows, { key: 'size', direction: 'desc' })).slice(2)).toEqual(['a2.txt', 'a10.txt', 'b.txt'])
    expect(names(sortMembers(rows, { key: 'packed', direction: 'asc' })).slice(2)).toEqual(['a10.txt', 'b.txt', 'a2.txt'])
    expect(names(sortMembers(rows, { key: 'modified', direction: 'asc' })).slice(2)).toEqual(['a10.txt', 'a2.txt', 'b.txt'])
  })
  it('does not change its input', () => {
    const copy = [...rows]
    sortMembers(rows, { key: 'size', direction: 'desc' })
    expect(rows).toEqual(copy)
  })
})