import { describe, expect, it } from 'vitest'
import { rowsToReink } from './linkInkRows'

describe('rowsToReink', () => {
  const run = (rows: string[], held: string[], holds: string[]): string[] =>
    rowsToReink(
      rows,
      (r) => held.includes(r),
      (r) => holds.includes(r)
    )

  it('re-inks a row that held ink and lost it (a hover redraw)', () => {
    expect(run(['a'], ['a'], [])).toEqual(['a'])
  })

  it('leaves a row that never held ink: onRender just looked at it', () => {
    expect(run(['a', 'b'], [], [])).toEqual([])
  })

  it('leaves a row that still holds ink (its own inking, or onRender re-inked it)', () => {
    expect(run(['a'], ['a'], ['a'])).toEqual([])
  })

  it('picks only the rows that lost ink out of a mixed batch', () => {
    expect(run(['a', 'b', 'c', 'd'], ['a', 'c', 'd'], ['c'])).toEqual(['a', 'd'])
  })
})
