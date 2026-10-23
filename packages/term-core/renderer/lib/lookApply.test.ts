import { describe, expect, it } from 'vitest'
import { lookChanged, oncePerFrame, type LookSeen } from './lookApply'

describe('a look change does only what differs (perf review 2026-10-16)', () => {
  it('says a value changed the first time, then only when it differs', () => {
    const seen: LookSeen = {}
    expect(lookChanged(seen, 'theme', 'T1')).toBe(true)
    expect(lookChanged(seen, 'ink', '#58a6ff')).toBe(true)
    // An agent colour drag: nothing the terminal wears moved.
    expect(lookChanged(seen, 'theme', 'T1')).toBe(false)
    expect(lookChanged(seen, 'ink', '#58a6ff')).toBe(false)
    // A see-through drag: the theme's ground alpha moves, the ink does not.
    expect(lookChanged(seen, 'theme', 'T2')).toBe(true)
    expect(lookChanged(seen, 'ink', '#58a6ff')).toBe(false)
    expect(lookChanged(seen, 'ink', '#79c0ff')).toBe(true)
  })

  it('runs a burst of calls once, on the next frame', () => {
    const frames: Array<() => void> = []
    let runs = 0
    const soon = oncePerFrame(
      () => (runs += 1),
      (cb) => frames.push(cb)
    )
    soon()
    soon()
    soon()
    expect(frames).toHaveLength(1)
    expect(runs).toBe(0)
    frames.shift()?.()
    expect(runs).toBe(1)
    soon()
    expect(frames).toHaveLength(1)
  })
})
