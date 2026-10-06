import { describe, expect, it } from 'vitest'
import { columnsFor, rowOf, staggerDelay, visibleIndices, wallTarget } from './wall'

describe('the wall', () => {
  it('is six across, three when six 124px cards do not fit', () => {
    // 6 x 124 + 5 x 16 + 2 x 10 = 844
    expect(columnsFor(844)).toBe(6)
    expect(columnsFor(843)).toBe(3)
    expect(columnsFor(1200)).toBe(6)
  })

  it('three across keeps the halves on their own rows (six across mixes the middle row, as the mockup does)', () => {
    for (const cols of [3]) {
      const darkRows = new Set(Array.from({ length: 9 }, (_, i) => rowOf(i, cols)))
      const lightRows = new Set(Array.from({ length: 9 }, (_, i) => rowOf(i + 9, cols)))
      expect([...darkRows].some((r) => lightRows.has(r)), `${cols} across`).toBe(false)
    }
  })

  it('collapsed shows exactly the chosen row; open shows all', () => {
    expect(visibleIndices(18, 6, 0, false)).toEqual([0, 1, 2, 3, 4, 5])
    expect(visibleIndices(18, 6, 10, false)).toEqual([6, 7, 8, 9, 10, 11])
    expect(visibleIndices(18, 3, 10, false)).toEqual([9, 10, 11])
    expect(visibleIndices(18, 6, 4, true)).toHaveLength(18)
    // own copies after the 18 make a short last row
    expect(visibleIndices(20, 6, 19, false)).toEqual([18, 19])
    expect(visibleIndices(20, 6, -1, false)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('the keys', () => {
  for (const cols of [6, 3]) {
    describe(`${cols} across`, () => {
      const n = 18
      it('Left and Right wrap through the whole list', () => {
        expect(wallTarget(0, 'ArrowRight', n, cols)).toBe(1)
        expect(wallTarget(17, 'ArrowRight', n, cols)).toBe(0)
        expect(wallTarget(0, 'ArrowLeft', n, cols)).toBe(17)
        expect(wallTarget(cols, 'ArrowLeft', n, cols)).toBe(cols - 1)
      })
      it('Down and Up go a row and wrap by column', () => {
        expect(wallTarget(1, 'ArrowDown', n, cols)).toBe(1 + cols)
        expect(wallTarget(n - cols + 1, 'ArrowDown', n, cols)).toBe(1)
        expect(wallTarget(1 + cols, 'ArrowUp', n, cols)).toBe(1)
        expect(wallTarget(1, 'ArrowUp', n, cols)).toBe(n - cols + 1)
      })
      it('Home and End go to the ends; other keys are not the wall\'s', () => {
        expect(wallTarget(7, 'Home', n, cols)).toBe(0)
        expect(wallTarget(7, 'End', n, cols)).toBe(17)
        expect(wallTarget(7, 'Enter', n, cols)).toBe(-1)
        expect(wallTarget(7, 'a', n, cols)).toBe(-1)
      })
    })
  }

  it('with own copies the short last row is skipped by Up and Down', () => {
    // 20 cards at 6 across: the last row holds 18 and 19 only.
    expect(wallTarget(4, 'ArrowUp', 20, 6)).toBe(16)
    expect(wallTarget(1, 'ArrowUp', 20, 6)).toBe(19)
    expect(wallTarget(16, 'ArrowDown', 20, 6)).toBe(4)
    expect(wallTarget(13, 'ArrowDown', 20, 6)).toBe(19)
    expect(wallTarget(19, 'ArrowRight', 20, 6)).toBe(0)
  })

  it('an empty wall takes no key', () => {
    expect(wallTarget(0, 'ArrowRight', 0, 6)).toBe(-1)
  })
})

describe('the stagger', () => {
  it('fades the neighbouring rows first, then a step per row, capped', () => {
    expect(staggerDelay(1, 1)).toBe(30)
    expect(staggerDelay(0, 1)).toBe(30)
    expect(staggerDelay(2, 1)).toBe(30)
    expect(staggerDelay(3, 1)).toBe(75)
    expect(staggerDelay(2, 0)).toBe(75)
    expect(staggerDelay(5, 0)).toBe(120)
    expect(staggerDelay(9, 0)).toBe(120)
  })
})
