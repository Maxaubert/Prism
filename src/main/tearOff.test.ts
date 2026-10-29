import { describe, expect, it } from 'vitest'
import { createTearOff, type TearDeps, type TearWin } from './tearOff'
import type { Bounds, Point, TabCarry, TearEvent, TearRequest } from '@shared/tabTear'

// Main's half of the tear-off (step 3, 2026-10-29), driven with fake windows
// and a hand-turned clock: the loop, the snap back's dwell, the drop, the
// cancel, the only tab moving its window.

interface FakeWin extends TearWin {
  name: string
  bounds: Bounds
  max: boolean
  shown: boolean
  gone: boolean
  moves: Bounds[]
}
function fakeWin(name: string, bounds: Bounds, max = false): FakeWin {
  const w: FakeWin = {
    name,
    bounds: { ...bounds },
    max,
    shown: false,
    gone: false,
    moves: [],
    isDestroyed: () => w.gone,
    // A frame of 8 DIP on the left and none on top, as a hidden title bar has.
    getBounds: () => ({ ...w.bounds }),
    getContentBounds: () => ({ x: w.bounds.x + 8, y: w.bounds.y, width: w.bounds.width - 16, height: w.bounds.height - 8 }),
    getNormalBounds: () => ({ ...bounds }),
    setBounds: (b) => {
      w.bounds = { ...b }
      w.moves.push({ ...b })
    },
    isMaximized: () => w.max,
    maximize: () => {
      w.max = true
    },
    unmaximize: () => {
      w.max = false
    },
    showInactive: () => {
      w.shown = true
    }
  }
  return w
}

const carry: TabCarry = {
  tab: {
    id: 't2',
    root: 'C:\\x',
    browse: { path: 'C:\\x', history: [], cursor: 0, surface: 'folder', preview: false },
    files: [],
    index: -1
  },
  buffers: [{ path: 'C:\\x\\a.txt', text: 'unsaved' }]
}
const work = { x: 0, y: 0, width: 1920, height: 1040 }

function rig(options: { e2e?: boolean; listening?: boolean } = {}) {
  let t = 0
  let timer: (() => void) | null = null
  let cursor: Point = { x: 0, y: 0 }
  const source = fakeWin('source', { x: 100, y: 100, width: 1200, height: 800 })
  const spare = fakeWin('spare', { x: -4000, y: -4000, width: 1000, height: 700 })
  const log: string[] = []
  const told: TearEvent[] = []
  const moving = new Set<string>()
  let listening = options.listening ?? true
  const deps: TearDeps<FakeWin> = {
    e2e: !!options.e2e,
    cursor: () => cursor,
    workArea: () => work,
    takeSpare: () => spare,
    listening: () => listening,
    adopt: (w, c) => log.push(`adopt ${w.name} ${c.tab.id}`),
    moving: (id, on) => void (on ? moving.add(id) : moving.delete(id)),
    commit: (w) => log.push(`commit ${w.name}`),
    reveal: (w) => log.push(`reveal ${w.name}`),
    release: (w, id, s) => log.push(`release ${w.name} ${id} to ${s.name}`),
    tell: (_s, e) => told.push(e),
    spareSoon: () => log.push('spare soon'),
    now: () => t,
    every: (fn) => {
      timer = fn
      return 1
    },
    stop: () => {
      timer = null
    }
  }
  const tear = createTearOff(deps)
  const req = (only = false, point: Point = { x: 300, y: 120 }): TearRequest => ({
    tabId: 't2',
    only,
    carry: only ? undefined : carry,
    grab: { x: 50, y: 16 },
    origin: { x: 0, y: 40 },
    strip: { left: 0, top: 40, right: 1184, bottom: 72 },
    point
  })
  return {
    tear,
    source,
    spare,
    log,
    told,
    moving,
    req,
    setListening: (on: boolean) => (listening = on),
    /** Move the cursor and let `ms` pass, a tick every 8 ms. */
    move(to: Point, ms = 8) {
      cursor = to
      for (let left = ms; left > 0; left -= 8) {
        t += 8
        timer?.()
      }
    },
    running: () => timer !== null
  }
}

describe('tearing a tab off (one of several)', () => {
  it('hands the tab to the spare, places it under the cursor and moves it from main', () => {
    const r = rig()
    r.move({ x: 500, y: 400 }, 0)
    expect(r.tear.start(r.source, r.req())).toBe(true)
    expect(r.moving.has('t2')).toBe(true)
    expect(r.log).toEqual(['adopt spare t2'])
    // Placed while hidden: the cursor holds the first tab's grab point
    // (frame 8 + origin 0 + grab 50, origin 40 + grab 16).
    expect(r.spare.bounds).toMatchObject({ x: 500 - 58, y: 400 - 56, width: 1200, height: 800 })
    expect(r.spare.shown).toBe(false)
    r.tear.adopted(r.spare, { x: 0, y: 40 })
    expect(r.spare.shown).toBe(true)
    expect(r.told).toEqual([{ kind: 'shown', tabId: 't2' }])
    r.move({ x: 900, y: 600 }, 16)
    expect(r.spare.bounds).toMatchObject({ x: 842, y: 544, width: 1200, height: 800 })
    expect(r.tear.state()).toMatchObject({ phase: 'float', tabId: 't2', shown: true })
  })

  it('takes the new page’s own tab place once it has drawn it', () => {
    const r = rig()
    r.move({ x: 500, y: 400 }, 0)
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, { x: 40, y: 44 })
    expect(r.spare.bounds).toMatchObject({ x: 500 - 98, y: 400 - 60 })
  })

  it('waits for a fresh window’s page before handing the tab over', () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    expect(r.log).toEqual([])
    r.setListening(true)
    r.tear.listening(r.spare)
    expect(r.log).toEqual(['adopt spare t2'])
  })

  it('drop: the floating window becomes a window, in front, and the next spare is made', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 900, y: 600 }, 40)
    expect(r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log).toEqual(['adopt spare t2', 'commit spare', 'reveal spare', 'spare soon'])
    expect(r.moving.has('t2')).toBe(false)
    expect(r.running()).toBe(false)
    expect(r.tear.state()).toMatchObject({ phase: 'idle', commits: 1 })
  })

  it('a drop before a slow window has drawn the tab still commits, and shows it when it has', () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    expect(r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log).toEqual(['commit spare', 'spare soon'])
    r.setListening(true)
    r.tear.listening(r.spare)
    r.tear.adopted(r.spare, null)
    expect(r.log).toEqual(['commit spare', 'spare soon', 'adopt spare t2', 'reveal spare'])
    expect(r.spare.shown).toBe(true)
    expect(r.tear.busy(r.spare)).toBe(false)
  })

  it('cancel: the floating window gives the tab back, and nothing is committed', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    expect(r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
    expect(r.log).toEqual(['adopt spare t2', 'release spare t2 to source'])
    expect(r.moving.has('t2')).toBe(false)
    // The page cancelled: it needs no word back.
    expect(r.told.filter((e) => e.kind === 'ended')).toEqual([])
  })

  it('the floating window dying ends the tear, and the source page is told', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.spare.gone = true
    r.move({ x: 1, y: 1 })
    expect(r.told.at(-1)).toEqual({ kind: 'ended', tabId: 't2' })
    expect(r.tear.state().phase).toBe('idle')
  })

  it('the source closing mid-tear hides the floating window again', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.source.gone = true
    r.tear.gone(r.source)
    expect(r.log.at(-1)).toBe('release spare t2 to source')
    expect(r.tear.state().phase).toBe('idle')
  })
})

describe('the snap back (its own strip, plus 8 DIP, for 120 ms)', () => {
  // The source's content starts at (108, 100), so its strip is at
  // x 108..1292, y 140..172 on screen.
  it('attaches after 120 ms over the strip', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 600, y: 400 }, 40)
    // The first tick over it starts the clock; 120 ms on, it attaches.
    r.move({ x: 600, y: 178 }, 112)
    expect(r.told.some((e) => e.kind === 'attached')).toBe(false)
    r.move({ x: 600, y: 178 }, 16)
    expect(r.told.at(-1)).toEqual({ kind: 'attached', tabId: 't2' })
    expect(r.log.at(-1)).toBe('release spare t2 to source')
    expect(r.moving.has('t2')).toBe(false)
    expect(r.running()).toBe(false)
    // Main's part is over: the pointer-up that follows commits nothing.
    expect(r.tear.end(r.source, 'drop')).toEqual({ committed: false })
    expect(r.tear.state()).toMatchObject({ attaches: 1, commits: 0 })
  })

  it('does not attach just outside the margin, or on a pass that does not stay', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.move({ x: 600, y: 181 }, 400) // 9 below the strip
    expect(r.told.some((e) => e.kind === 'attached')).toBe(false)
    for (let i = 0; i < 10; i++) {
      r.move({ x: 600, y: 160 }, 80)
      r.move({ x: 600, y: 300 }, 16)
    }
    expect(r.told.some((e) => e.kind === 'attached')).toBe(false)
  })
})

describe('the only tab moves the whole window', () => {
  it('follows the cursor with no second window, and a drop leaves it there', () => {
    const r = rig()
    r.move({ x: 400, y: 200 }, 0)
    r.tear.start(r.source, r.req(true))
    expect(r.log).toEqual([])
    r.move({ x: 1000, y: 500 }, 16)
    expect(r.source.bounds).toMatchObject({ x: 1000 - 58, y: 500 - 56, width: 1200, height: 800 })
    expect(r.tear.end(r.source, 'drop')).toEqual({ committed: false })
    expect(r.source.bounds).toMatchObject({ x: 942, y: 444 })
    expect(r.tear.state().phase).toBe('idle')
  })

  it('restores a maximized window to its normal size under the cursor, and cancel puts it back maximized', () => {
    const r = rig()
    r.source.max = true
    r.move({ x: 960, y: 20 }, 0)
    r.tear.start(r.source, r.req(true))
    expect(r.source.max).toBe(false)
    r.move({ x: 960, y: 300 }, 8)
    expect(r.source.bounds).toMatchObject({ width: 1200, height: 800, x: 960 - 58, y: 300 - 56 })
    r.tear.end(r.source, 'cancel')
    expect(r.source.max).toBe(true)
    expect(r.source.moves.at(-1)).toEqual({ x: 100, y: 100, width: 1200, height: 800 })
  })
})

describe('under --e2e', () => {
  it('moves nothing, follows the page’s pointer, and keeps where the window would be', () => {
    const r = rig({ e2e: true })
    r.tear.start(r.source, r.req(false, { x: 300, y: 200 }))
    r.tear.adopted(r.spare, null)
    expect(r.spare.moves).toEqual([])
    r.tear.point(r.source, { x: 500, y: 300 })
    r.move({ x: 0, y: 0 }, 16) // the system cursor is ignored
    // Screen = content origin (108, 100) + client (500, 300), less the hold.
    expect(r.tear.state().bounds).toMatchObject({ x: 608 - 58, y: 400 - 56 })
    expect(r.spare.moves).toEqual([])
  })
  it('snaps back from the page’s pointer too', () => {
    const r = rig({ e2e: true })
    r.tear.start(r.source, r.req(false, { x: 300, y: 200 }))
    r.tear.point(r.source, { x: 300, y: 60 })
    r.move({ x: 0, y: 0 }, 128)
    expect(r.told.at(-1)).toEqual({ kind: 'attached', tabId: 't2' })
  })
})
