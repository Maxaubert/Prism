import { describe, expect, it } from 'vitest'
import { findMatches, stepMatch, type PageText } from './pdfSearch'

const page = (...items: string[]): PageText => ({ items })

describe('findMatches', () => {
  it('finds a match inside one item with its offsets', () => {
    const m = findMatches([page('the quick brown fox')], 'quick')
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ page: 0, item: 0, start: 4, end: 9 })
    expect(m[0].parts).toEqual([{ item: 0, start: 4, end: 9 }])
  })

  it('finds a match spanning two items', () => {
    const m = findMatches([page('Hel', 'lo world')], 'hello')
    expect(m).toHaveLength(1)
    expect(m[0].parts).toEqual([
      { item: 0, start: 0, end: 3 },
      { item: 1, start: 0, end: 2 }
    ])
  })

  it('is case-insensitive both ways', () => {
    expect(findMatches([page('GRAPE grape Grape')], 'grape')).toHaveLength(3)
    expect(findMatches([page('grape')], 'GRAPE')).toHaveLength(1)
  })

  it('finds several matches in one item, in order', () => {
    const m = findMatches([page('aaa')], 'a')
    expect(m.map((x) => x.start)).toEqual([0, 1, 2])
  })

  it('never matches across a page boundary', () => {
    expect(findMatches([page('gra'), page('pe')], 'grape')).toHaveLength(0)
  })

  it('counts matches across pages with page indices', () => {
    const m = findMatches([page('grape'), page('no'), page('grape grape')], 'grape')
    expect(m.map((x) => x.page)).toEqual([0, 2, 2])
  })

  it('returns nothing for an empty or whitespace query', () => {
    expect(findMatches([page('anything')], '')).toEqual([])
    expect(findMatches([page('anything')], '  ')).toEqual([])
  })

  it('skips empty items while spanning', () => {
    const m = findMatches([page('gra', '', 'pe')], 'grape')
    expect(m).toHaveLength(1)
    expect(m[0].parts).toEqual([
      { item: 0, start: 0, end: 3 },
      { item: 2, start: 0, end: 2 }
    ])
  })
})

describe('stepMatch', () => {
  it('wraps in both directions', () => {
    expect(stepMatch(4, 1, 5)).toBe(0)
    expect(stepMatch(0, -1, 5)).toBe(4)
    expect(stepMatch(2, 1, 5)).toBe(3)
  })
  it('is -1 when there is nothing to step through', () => {
    expect(stepMatch(0, 1, 0)).toBe(-1)
  })
})
