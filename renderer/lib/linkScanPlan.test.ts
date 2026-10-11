import { describe, expect, it } from 'vitest'
import { liveRange, sliceRows } from './linkScanPlan'

describe('liveRange', () => {
  it('is the screen: baseY to baseY + rows - 1', () => {
    expect(liveRange(9970, 30, 10000)).toEqual({ first: 9970, last: 9999 })
  })
  it('stops at the last line of a buffer shorter than the screen', () => {
    expect(liveRange(0, 30, 12)).toEqual({ first: 0, last: 11 })
  })
})

describe('sliceRows (#167)', () => {
  /** A clock that moves only when a line is painted: 1 ms of work per line. */
  const work = (): { now: () => number; paint: (line: number) => void; painted: number[] } => {
    let t = 0
    const painted: number[] = []
    return {
      now: () => t,
      paint: (line) => {
        painted.push(line)
        t += 1
      },
      painted
    }
  }

  it('walks a 10,000-line backlog bottom up, in slices of at most 8 ms of painting, every line once', () => {
    const w = work()
    const plan = sliceRows(0, 9999, 8, w.now)
    let slices = 0
    for (let slice = plan.next(w.paint); slice; slice = plan.next(w.paint)) {
      slices += 1
      expect(slice.length).toBeGreaterThan(0)
      expect(slice.length).toBeLessThanOrEqual(8)
    }
    const seen = w.painted
    expect(seen.length).toBe(10000)
    expect(new Set(seen).size).toBe(10000)
    expect(seen[0]).toBe(9999)
    expect(seen[seen.length - 1]).toBe(0)
    // Bottom up all the way: each line is above the one before it.
    expect(seen.every((v, i) => i === 0 || v === seen[i - 1] - 1)).toBe(true)
    expect(slices).toBe(1250)
  })

  it('the budget covers the painting, not only the walk', () => {
    // A clock that never moves while walking: only the paint spends time.
    const w = work()
    const plan = sliceRows(0, 99, 8, w.now)
    expect(plan.next(w.paint)?.length).toBe(8)
  })

  it('cheap lines all go in one slice', () => {
    const plan = sliceRows(10, 19, 8, () => 0)
    expect(plan.next()).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10])
    expect(plan.next()).toBeNull()
  })

  it('an empty range yields nothing', () => {
    expect(sliceRows(5, 4, 8, () => 0).next()).toBeNull()
  })

  it('resumes where it is told, when the buffer trimmed lines under the walk', () => {
    const w = work()
    const plan = sliceRows(0, 99, 8, w.now)
    expect(plan.next(w.paint)?.[0]).toBe(99)
    // 50 lines trimmed off the top: the walk stood on 91, it now stands on 41.
    expect(plan.next(w.paint, 41)?.slice(0, 2)).toEqual([41, 40])
  })

  it('a cancelled plan yields nothing more, even mid-slice', () => {
    const w = work()
    const plan = sliceRows(0, 99, 8, w.now)
    expect(plan.next(w.paint)).not.toBeNull()
    plan.cancel()
    expect(plan.next(w.paint)).toBeNull()
    const other = sliceRows(0, 99, 8, () => 0)
    expect(other.next(() => other.cancel())).toEqual([99])
  })
})
