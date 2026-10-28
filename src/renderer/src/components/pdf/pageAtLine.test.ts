import { describe, expect, it } from 'vitest'
import { pageAtLine } from './pageAtLine'

// Pages 100 tall with a 10 gap, the first at 0: page n's top is (n - 1) * 110.
const topOf = (n: number): number => (n - 1) * 110

describe('the page a PDF is on (perf review, 2026-10-28)', () => {
  it('names the page the line crosses', () => {
    expect(pageAtLine(1000, topOf, 0)).toBe(1)
    expect(pageAtLine(1000, topOf, 50)).toBe(1)
    expect(pageAtLine(1000, topOf, 110)).toBe(2)
    expect(pageAtLine(1000, topOf, 999 * 110 + 5)).toBe(1000)
  })

  it('names the page above when the line sits in the gap, and page 1 above the first', () => {
    expect(pageAtLine(1000, topOf, 105)).toBe(1)
    expect(pageAtLine(1000, topOf, -40)).toBe(1)
  })

  it('reads a handful of pages, not the whole document', () => {
    let reads = 0
    pageAtLine(1000, (n) => (reads++, topOf(n)), 500 * 110)
    expect(reads).toBeLessThanOrEqual(11)
  })

  it('falls back to reading every page when one has no element', () => {
    const top = (n: number): number | null => (n === 500 ? null : topOf(n))
    expect(pageAtLine(1000, top, 700 * 110 + 1)).toBe(701)
  })

  it('names page 1 for an empty document', () => {
    expect(pageAtLine(0, topOf, 50)).toBe(1)
  })
})
