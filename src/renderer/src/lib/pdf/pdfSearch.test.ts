import { describe, expect, it } from 'vitest'
import { cachedPageText, findMatches, pageSize, stepMatch, type PageSource, type PageText } from './pdfSearch'

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

describe('findMatches with a letter whose lower case is longer (audit #67)', () => {
  it('keeps item offsets on the original text', () => {
    const m = findMatches([page('İstanbul foo')], 'foo')
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ item: 0, start: 9, end: 12 })
  })
})

/** A document whose listed pages fail to load. */
function doc(broken: number[], calls: number[] = []): PageSource {
  return {
    getPage: async (n) => {
      calls.push(n)
      if (broken.includes(n)) throw new Error('bad page')
      return {
        getTextContent: async () => ({ items: [{ str: `text ${n}` }, {}] }),
        getViewport: () => ({ width: 100 + n, height: 200 + n })
      }
    }
  }
}

describe('a damaged page does not sink the find (audit #86)', () => {
  it('reads a broken page as empty and does not cache the failure', async () => {
    const cache = new Map<number, Promise<PageText>>()
    const calls: number[] = []
    const d = doc([2], calls)
    expect(await cachedPageText(cache, d, 1)).toEqual({ items: ['text 1', ''] })
    expect(await cachedPageText(cache, d, 2)).toEqual({ items: [] })
    expect(cache.has(2)).toBe(false)
    expect(cache.has(1)).toBe(true)
    await cachedPageText(cache, d, 2)
    expect(calls.filter((n) => n === 2)).toHaveLength(2)
  })
})

describe('a damaged page does not stop the size prefetch (audit #87)', () => {
  it('answers null for a broken page and the size for the rest', async () => {
    const d = doc([3])
    expect(await pageSize(d, 2)).toEqual({ w: 102, h: 202 })
    expect(await pageSize(d, 3)).toBeNull()
  })
})
