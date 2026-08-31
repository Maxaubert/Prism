import { describe, expect, it } from 'vitest'
import { firstAfter, matchRanges, stepMatch } from './findInText'

describe('finding a string in a document', () => {
  it('finds nothing for an empty query, rather than everything', () => {
    expect(matchRanges('hello world', '')).toEqual([])
  })

  it('finds every occurrence', () => {
    expect(matchRanges('the cat sat on the mat', 'at')).toEqual([
      { start: 5, end: 7 },
      { start: 9, end: 11 },
      { start: 20, end: 22 }
    ])
  })

  it('ignores case, both ways round', () => {
    expect(matchRanges('Hello HELLO hello', 'hello')).toHaveLength(3)
    expect(matchRanges('hello', 'HELLO')).toHaveLength(1)
  })

  it('does not overlap: "aa" in "aaaa" is two matches, not three', () => {
    // Overlapping hits could not both be highlighted anyway.
    expect(matchRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
  })

  it('caps a pathological document rather than hanging', () => {
    expect(matchRanges('a'.repeat(20000), 'a')).toHaveLength(5000)
  })

  it('handles a query longer than the text', () => {
    expect(matchRanges('hi', 'hello')).toEqual([])
  })
})

describe('which match to land on', () => {
  const ms = [
    { start: 10, end: 12 },
    { start: 50, end: 52 },
    { start: 90, end: 92 }
  ]
  it('is the first at or after where you are looking', () => {
    expect(firstAfter(ms, 0)).toBe(0)
    expect(firstAfter(ms, 20)).toBe(1)
    expect(firstAfter(ms, 50)).toBe(1)
  })
  it('wraps to the top when everything is behind you', () => {
    expect(firstAfter(ms, 999)).toBe(0)
  })
  it('says nowhere when there is nothing', () => {
    expect(firstAfter([], 0)).toBe(-1)
  })
})

describe('stepping', () => {
  it('goes forwards and wraps', () => {
    expect(stepMatch(3, 0, 1)).toBe(1)
    expect(stepMatch(3, 2, 1)).toBe(0)
  })
  it('goes backwards and wraps', () => {
    expect(stepMatch(3, 0, -1)).toBe(2)
  })
  it('has nowhere to go with no matches', () => {
    expect(stepMatch(0, -1, 1)).toBe(-1)
  })
})
