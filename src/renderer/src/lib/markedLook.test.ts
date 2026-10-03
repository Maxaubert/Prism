import { describe, expect, it } from 'vitest'
import { ALONE, markedLook } from './markedLook'

// A run of marked rows is one block: the tint on every row, the edge round
// the outside only (owner, 2026-10-03).
describe('markedLook', () => {
  const edges = (s: string): number => s.split(', ').length

  it('a row alone is the tint with an edge on all four sides, its corners kept', () => {
    const s = markedLook(ALONE)
    expect(s.background).toBe('var(--p-sel-tint)')
    expect(edges(String(s.boxShadow))).toBe(4)
    expect(s.borderTopLeftRadius).toBeUndefined()
  })

  it('a row inside a run has its sides only, and square corners', () => {
    const s = markedLook({ top: true, bottom: true })
    expect(String(s.boxShadow)).not.toMatch(/inset 0 (-?)1px/)
    expect(edges(String(s.boxShadow))).toBe(2)
    expect([s.borderTopLeftRadius, s.borderBottomRightRadius]).toEqual([0, 0])
  })

  it('the first row of a run keeps its top edge, the last its bottom', () => {
    expect(String(markedLook({ top: false, bottom: true }).boxShadow)).toContain('inset 0 1px 0')
    expect(String(markedLook({ top: true, bottom: false }).boxShadow)).toContain('inset 0 -1px 0')
  })

  it('never paints the old accent slab or its ink', () => {
    expect(JSON.stringify(markedLook(ALONE))).not.toMatch(/sel-bg|on-accent/)
  })
})
