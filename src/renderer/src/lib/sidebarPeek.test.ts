import { describe, expect, it } from 'vitest'
import {
  PEEK_DWELL_MS,
  PEEK_EDGE_PX,
  PEEK_GRACE_MS,
  PEEK_IDLE,
  peekReduce,
  peekTimer,
  peekWhere,
  type PeekEvent,
  type PeekState
} from './sidebarPeek'

/** A clock for the reducer: what the hook does, without a DOM. Moves are
 *  applied at once; `wait` fires the state's timer each time it runs out. */
function sim(held: () => boolean = () => false) {
  let s: PeekState = PEEK_IDLE
  let due: number | null = null
  let now = 0
  const sync = (before: PeekState): void => {
    if (before.open !== s.open || before.at !== s.at || before.tick !== s.tick || due === null) {
      const t = peekTimer(s)
      due = t === null ? null : now + t
    }
  }
  const send = (e: PeekEvent): void => {
    const before = s
    s = peekReduce(s, e)
    sync(before)
  }
  return {
    send,
    move: (at: 'edge' | 'panel' | 'away') => send({ type: 'move', at }),
    wait(ms: number) {
      const end = now + ms
      while (due !== null && due <= end) {
        now = due
        due = null
        const before = s
        s = peekReduce(s, { type: 'timer', held: held() })
        sync(before)
      }
      now = end
    },
    get state() {
      return s
    }
  }
}

describe('sidebar peek', () => {
  it('uses the timings the design names', () => {
    expect(PEEK_DWELL_MS).toBe(150)
    expect(PEEK_GRACE_MS).toBe(300)
    expect(PEEK_EDGE_PX).toBeGreaterThanOrEqual(4)
    expect(PEEK_EDGE_PX).toBeLessThanOrEqual(8)
  })

  it('opens after the pointer rests on the edge, and not before', () => {
    const p = sim()
    p.move('edge')
    p.wait(PEEK_DWELL_MS - 1)
    expect(p.state.open).toBe(false)
    p.wait(1)
    expect(p.state.open).toBe(true)
  })

  it('does not open for a pointer that only crosses the edge', () => {
    const p = sim()
    p.move('edge')
    p.wait(80)
    p.move('away')
    p.wait(1000)
    expect(p.state.open).toBe(false)
    // and a second crossing starts its own dwell from nothing
    p.move('edge')
    p.wait(100)
    expect(p.state.open).toBe(false)
  })

  it('stays while the pointer is on the panel, and leaves a grace after it goes', () => {
    const p = sim()
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.move('panel')
    p.wait(5000)
    expect(p.state.open).toBe(true)
    p.move('away')
    p.wait(PEEK_GRACE_MS - 1)
    expect(p.state.open).toBe(true)
    p.wait(1)
    expect(p.state.open).toBe(false)
  })

  it('keeps it for a pointer that overshoots and comes straight back', () => {
    const p = sim()
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.move('away')
    p.wait(200)
    p.move('panel')
    p.wait(1000)
    expect(p.state.open).toBe(true)
  })

  it('treats the edge strip as part of the panel once it is out', () => {
    const p = sim()
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.move('edge')
    p.wait(2000)
    expect(p.state.open).toBe(true)
  })

  it('never closes while something in it is live, and closes once nothing is', () => {
    let live = true
    const p = sim(() => live)
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.move('away')
    p.wait(PEEK_GRACE_MS * 10)
    expect(p.state.open).toBe(true)
    live = false
    // asked again within one grace of the menu going
    p.wait(PEEK_GRACE_MS)
    expect(p.state.open).toBe(false)
  })

  it('ignores "over the panel" while there is no panel out', () => {
    const p = sim()
    p.move('panel')
    expect(p.state.at).toBe('away')
    p.wait(1000)
    expect(p.state.open).toBe(false)
  })

  it('closes on Escape unless something live owns that Escape', () => {
    const p = sim()
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.send({ type: 'escape', held: true })
    expect(p.state.open).toBe(true)
    p.send({ type: 'escape', held: false })
    expect(p.state.open).toBe(false)
    // a pointer still resting on the edge has to move to ask again
    p.wait(1000)
    expect(p.state.open).toBe(false)
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    expect(p.state.open).toBe(true)
  })

  it('ends at once on a pin or an opened file, whatever is live', () => {
    const p = sim(() => true)
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.move('panel')
    p.send({ type: 'end' })
    expect(p.state).toMatchObject({ open: false, at: 'away' })
    p.wait(1000)
    expect(p.state.open).toBe(false)
  })

  it('slides away after a close the pointer or Escape caused, and not after a pin', () => {
    const p = sim()
    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.move('away')
    p.wait(PEEK_GRACE_MS)
    expect(p.state).toMatchObject({ open: false, leaving: true })
    p.send({ type: 'settled' })
    expect(p.state.leaving).toBe(false)

    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    p.send({ type: 'escape', held: false })
    expect(p.state.leaving).toBe(true)

    p.move('edge')
    p.wait(PEEK_DWELL_MS)
    expect(p.state).toMatchObject({ open: true, leaving: false })
    p.send({ type: 'end' })
    expect(p.state).toMatchObject({ open: false, leaving: false })
  })

  it('an Escape with nothing out changes nothing', () => {
    expect(peekReduce(PEEK_IDLE, { type: 'escape', held: false })).toBe(PEEK_IDLE)
    expect(peekReduce(PEEK_IDLE, { type: 'end' })).toBe(PEEK_IDLE)
  })
})

describe('where the pointer is', () => {
  const zone = { left: 0, right: 1000, top: 70, bottom: 700 }
  it('finds the edge strip on the panel side, below the chrome only', () => {
    expect(peekWhere(0, 300, zone, 'left', null)).toBe('edge')
    expect(peekWhere(PEEK_EDGE_PX - 1, 300, zone, 'left', null)).toBe('edge')
    expect(peekWhere(PEEK_EDGE_PX, 300, zone, 'left', null)).toBe('away')
    expect(peekWhere(0, 30, zone, 'left', null)).toBe('away')
    expect(peekWhere(999, 300, zone, 'right', null)).toBe('edge')
    expect(peekWhere(0, 300, zone, 'right', null)).toBe('away')
  })
  it('puts a point inside the panel on the panel', () => {
    const panel = { left: 0, right: 260, top: 70, bottom: 700 }
    expect(peekWhere(200, 300, zone, 'left', panel)).toBe('panel')
    expect(peekWhere(2, 300, zone, 'left', panel)).toBe('panel')
    expect(peekWhere(300, 300, zone, 'left', panel)).toBe('away')
  })
})
