import { describe, expect, it } from 'vitest'
import { createTearOff, type TearDeps, type TearWin } from './tearOff'
import { TEAR, type Bounds, type Point, type StripReport, type TabCarry, type TabHover, type TearEvent, type TearRequest } from '@shared/tabTear'

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

interface RigOptions {
  e2e?: boolean
  listening?: boolean
  /** Step 4: another window of the session, and its strip report. */
  other?: Bounds
  otherStrip?: StripReport | null
  /** Front to back, by name (default: the source, then the other). */
  front?: Array<'source' | 'other'>
}
function rig(options: RigOptions = {}) {
  let t = 0
  let timer: (() => void) | null = null
  /** One-shot timers: when each is due. */
  const timeouts: Array<{ at: number; fn: () => void } | null> = []
  let cursor: Point = { x: 0, y: 0 }
  const source = fakeWin('source', { x: 100, y: 100, width: 1200, height: 800 })
  const spare = fakeWin('spare', { x: -4000, y: -4000, width: 1000, height: 700 })
  const other = fakeWin('other', options.other ?? { x: 1400, y: 200, width: 500, height: 600 })
  const hovers: Array<{ win: string; hover: TabHover | null }> = []
  let otherStrip: StripReport | null =
    options.otherStrip === undefined ? { strip: { left: 0, top: 0, right: 484, bottom: 32 }, plusRight: 200 } : options.otherStrip
  const log: string[] = []
  const told: TearEvent[] = []
  const moving = new Set<string>()
  let listening = options.listening ?? true
  const byName = { source, other }
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
    release: (w, id, s) => log.push(`release ${w.name} ${id} to ${s?.name ?? 'nobody'}`),
    tell: (_s, e) => told.push(e),
    spareSoon: () => log.push('spare soon'),
    windowsFront: () =>
      options.other ? (options.front ?? ['source', 'other']).map((n) => byName[n]).filter((w) => !w.gone) : [source],
    stripOf: (w) => (w === other ? otherStrip : null),
    name: (w) => w.name,
    hover: (w, h) => void hovers.push({ win: w.name, hover: h }),
    merge: (w, c, src, at) => log.push(`merge ${c.tab.id} into ${w.name} from ${src.name} at ${at ?? 'end'}`),
    raise: (w) => log.push(`raise ${w.name}`),
    hide: (w) => {
      w.shown = false
      log.push(`hide ${w.name}`)
    },
    fade: (w, out) => log.push(`fade ${w.name} ${out ? 'out' : 'in'}`),
    closeEmptied: (w) => log.push(`close ${w.name}`),
    now: () => t,
    every: (fn) => {
      timer = fn
      return 1
    },
    stop: () => {
      timer = null
    },
    after: (fn, ms) => timeouts.push({ at: t + ms, fn }) - 1,
    cancel: (h) => {
      timeouts[h as number] = null
    }
  }
  const tear = createTearOff(deps)
  const req = (only = false, point: Point = { x: 300, y: 120 }, withCarry = !only): TearRequest => ({
    tabId: 't2',
    only,
    carry: withCarry ? carry : undefined,
    size: { width: 100, height: 32 },
    label: 'x',
    grab: { x: 50, y: 16 },
    origin: { x: 0, y: 40 },
    strip: { left: 0, top: 40, right: 1184, bottom: 72 },
    point
  })
  return {
    tear,
    source,
    spare,
    other,
    hovers,
    setOtherStrip: (r: StripReport | null) => (otherStrip = r),
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
        timeouts.forEach((o, i) => {
          if (o && o.at <= t) {
            timeouts[i] = null
            o.fn()
          }
        })
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

  it('drop: the floating window becomes a window, in front, and the next spare is made', async () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 900, y: 600 }, 40)
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log).toEqual(['adopt spare t2', 'commit spare', 'spare soon', 'reveal spare'])
    expect(r.moving.has('t2')).toBe(false)
    expect(r.running()).toBe(false)
    expect(r.tear.state()).toMatchObject({ phase: 'idle', commits: 1 })
  })

  it('a drop before a slow window has drawn the tab commits only once it has, and shows it then', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    let answer: { committed: boolean } | null = null
    void r.tear.end(r.source, 'drop').then((a) => (answer = a))
    await Promise.resolve()
    // Nothing committed yet (review 2026-10-29): the source still has the tab.
    expect(answer).toBeNull()
    expect(r.log).toEqual([])
    expect(r.moving.has('t2')).toBe(true)
    expect(r.tear.busy(r.spare)).toBe(true)
    expect(r.tear.state()).toMatchObject({ phase: 'idle', waiting: true, commits: 0 })
    r.setListening(true)
    r.tear.listening(r.spare)
    expect(r.log).toEqual(['adopt spare t2'])
    r.tear.adopted(r.spare, null)
    await Promise.resolve()
    expect(answer).toEqual({ committed: true })
    expect(r.log).toEqual(['adopt spare t2', 'commit spare', 'spare soon', 'reveal spare'])
    expect(r.spare.shown).toBe(true)
    expect(r.moving.has('t2')).toBe(false)
    expect(r.tear.busy(r.spare)).toBe(false)
    expect(r.tear.state()).toMatchObject({ waiting: false, commits: 1 })
  })

  it('a window that never draws the tab commits nothing: after 10 s the tab goes back', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    const answer = r.tear.end(r.source, 'drop')
    r.move({ x: 0, y: 0 }, TEAR.lateDropMs - 8)
    expect(r.tear.state().waiting).toBe(true)
    r.move({ x: 0, y: 0 }, 8)
    expect(await answer).toEqual({ committed: false })
    expect(r.log).toEqual(['release spare t2 to source'])
    expect(r.moving.has('t2')).toBe(false)
    expect(r.tear.state()).toMatchObject({ waiting: false, commits: 0, cancels: 1 })
    // A page that turns up after all is the spare's again: nothing happens.
    r.tear.listening(r.spare)
    r.tear.adopted(r.spare, null)
    expect(r.log).toEqual(['release spare t2 to source'])
    expect(r.spare.shown).toBe(false)
  })

  it('a slow window dying before it draws the tab commits nothing', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    const answer = r.tear.end(r.source, 'drop')
    r.spare.gone = true
    r.tear.gone(r.spare)
    expect(await answer).toEqual({ committed: false })
    expect(r.moving.has('t2')).toBe(false)
    expect(r.log).toEqual([])
  })

  it('the source closing while a drop waits: the tab is nobody’s, and no longer moving', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    const answer = r.tear.end(r.source, 'drop')
    // Electron's 'closed': not destroyed yet, but gone for the tear.
    r.tear.gone(r.source)
    expect(await answer).toEqual({ committed: false })
    expect(r.log).toEqual(['release spare t2 to nobody'])
    expect(r.moving.has('t2')).toBe(false)
  })

  it('cancel: the floating window gives the tab back, and nothing is committed', async () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    expect(await r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
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

  it('the source closing mid-tear hides the floating window again, and the tab stops moving first', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    // Called from 'closed', before the window is destroyed and before it
    // leaves the registry (review 2026-10-29): its close must release the tab.
    r.tear.gone(r.source)
    expect(r.log.at(-1)).toBe('release spare t2 to nobody')
    expect(r.moving.has('t2')).toBe(false)
    expect(r.told).toEqual([])
    expect(r.tear.state().phase).toBe('idle')
  })

  it('the source page going away (a reload) ends the tear; a fresh window loading does not', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.lost(r.spare)
    expect(r.tear.state().phase).toBe('float')
    r.tear.lost(r.source)
    expect(r.tear.state().phase).toBe('idle')
    expect(r.log.at(-1)).toBe('release spare t2 to source')
    expect(r.running()).toBe(false)
  })
})

describe('the snap back (its own strip, plus 8 DIP, for 120 ms)', () => {
  // The source's content starts at (108, 100), so its strip is at
  // x 108..1292, y 140..172 on screen.
  it('attaches after 120 ms over the strip', async () => {
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
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: false })
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
  it('follows the cursor with no second window, and a drop leaves it there', async () => {
    const r = rig()
    r.move({ x: 400, y: 200 }, 0)
    r.tear.start(r.source, r.req(true))
    expect(r.log).toEqual([])
    r.move({ x: 1000, y: 500 }, 16)
    expect(r.source.bounds).toMatchObject({ x: 1000 - 58, y: 500 - 56, width: 1200, height: 800 })
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: false })
    expect(r.source.bounds).toMatchObject({ x: 942, y: 444 })
    expect(r.tear.state().phase).toBe('idle')
  })

  it('restores a maximized window to its normal size under the cursor, and cancel puts it back maximized', async () => {
    const r = rig()
    r.source.max = true
    r.move({ x: 960, y: 20 }, 0)
    r.tear.start(r.source, r.req(true))
    expect(r.source.max).toBe(false)
    r.move({ x: 960, y: 300 }, 8)
    expect(r.source.bounds).toMatchObject({ width: 1200, height: 800, x: 960 - 58, y: 300 - 56 })
    await r.tear.end(r.source, 'cancel')
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
    // Read as if the window sat at the work area's top-left (the windows are
    // parked off every display): its frame (8, 0) + client (500, 300), less
    // the hold. Not the parked place, where every bound is held to an edge.
    expect(r.tear.state().bounds).toMatchObject({ x: 508 - 58, y: 300 - 56 })
    expect(r.spare.moves).toEqual([])
  })
  it('follows the pointer from a window parked off every display', () => {
    const r = rig({ e2e: true })
    r.source.bounds = { x: -4000, y: -4000, width: 1200, height: 800 }
    r.tear.start(r.source, r.req(false, { x: 300, y: 200 }))
    r.tear.adopted(r.spare, null)
    const first = r.tear.state().bounds
    r.tear.point(r.source, { x: 400, y: 300 })
    r.move({ x: 0, y: 0 }, 16)
    const next = r.tear.state().bounds
    expect(next).toMatchObject({ x: 408 - 58, y: 300 - 56 })
    expect(next).not.toEqual(first)
  })
  it('snaps back from the page’s pointer too', () => {
    const r = rig({ e2e: true })
    r.tear.start(r.source, r.req(false, { x: 300, y: 200 }))
    r.tear.point(r.source, { x: 300, y: 60 })
    r.move({ x: 0, y: 0 }, 128)
    expect(r.told.at(-1)).toEqual({ kind: 'attached', tabId: 't2' })
  })
})

// STEP 4: ANY WINDOW'S STRIP TAKES THE TAB (owner, 2026-10-29). The other
// window's content starts at (1408, 200); its strip report is x 0..484, y
// 0..32 with the + ending at 200, so with a 100 DIP tab its target is x
// 1408..1708 on screen (the + plus one tab), y 200..232, and the tab tears
// out of it once the cursor is 12 DIP clear of that and the tab fully out.
describe('attaching into another window (step 4)', () => {
  const overStrip = { x: 1500, y: 216 }
  it('after 120 ms over its strip the tab is in it, live: the floating window hides, the strip is told where', async () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 1350, y: 600 }, 40)
    r.move(overStrip, 112)
    expect(r.tear.state().over).toBeNull()
    r.move(overStrip, 16)
    expect(r.tear.state()).toMatchObject({ phase: 'float', over: 'other', enters: 1 })
    expect(r.log).toContain('hide spare')
    expect(r.told.at(-1)).toEqual({ kind: 'over', tabId: 't2' })
    expect(r.hovers.at(-1)).toEqual({
      win: 'other',
      hover: { tabId: 't2', point: { x: 92, y: 16 }, grab: { x: 50, y: 16 }, size: { width: 100, height: 32 }, label: 'x' }
    })
    // It slides along: every move is told, an unmoved cursor is not.
    const n = r.hovers.length
    r.move({ x: 1560, y: 214 }, 8)
    r.move({ x: 1560, y: 214 }, 24)
    expect(r.hovers.length).toBe(n + 1)
    expect(r.hovers.at(-1)?.hover?.point).toEqual({ x: 152, y: 14 })
    // Its strip says where the gap is; the drop lands there.
    r.tear.slot(r.other, 't2', 1)
    expect(r.tear.state().slot).toBe(1)
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log.slice(-3)).toEqual(['release spare t2 to other', 'merge t2 into other from source at 1', 'reveal other'])
    expect(r.moving.has('t2')).toBe(false)
    expect(r.running()).toBe(false)
    expect(r.tear.state()).toMatchObject({ phase: 'idle', merges: 1, commits: 0 })
  })

  it('fully out of that strip it tears off again: the gap closes, the floating window is back, and it does not flicker', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
    // 13 below the strip: the tab (grabbed 16 down) still overlaps it.
    r.move({ x: 1500, y: 245 }, 40)
    expect(r.tear.state().over).toBe('other')
    r.move({ x: 1500, y: 260 }, 8)
    expect(r.tear.state()).toMatchObject({ over: null, leaves: 1, shown: true })
    expect(r.hovers.at(-1)).toEqual({ win: 'other', hover: null })
    expect(r.told.slice(-2)).toEqual([
      { kind: 'off', tabId: 't2' },
      { kind: 'shown', tabId: 't2' }
    ])
    expect(r.spare.shown).toBe(true)
    // Held there, it never takes the tab again by itself.
    r.move({ x: 1500, y: 260 }, 400)
    expect(r.tear.state()).toMatchObject({ over: null, enters: 1 })
    // Back over it, the same dwell again.
    r.move(overStrip, 128)
    expect(r.tear.state()).toMatchObject({ over: 'other', enters: 2 })
  })

  it('a cancel over it closes the gap and gives the tab back to the source', async () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move(overStrip, 128)
    expect(await r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
    expect(r.hovers.at(-1)).toEqual({ win: 'other', hover: null })
    expect(r.log.at(-1)).toBe('release spare t2 to source')
    expect(r.log.some((l) => l.startsWith('merge'))).toBe(false)
    expect(r.moving.has('t2')).toBe(false)
    expect(r.tear.state()).toMatchObject({ cancels: 1, merges: 0 })
  })

  it('a window in front hides the strips behind it, until the cursor has stayed 750 ms over the one behind', () => {
    // The other window under the source's lower right: its strip at y 500..532
    // is covered by the source's body (x 100..1300, y 100..900) up to x 1300.
    const r = rig({ other: { x: 700, y: 500, width: 1000, height: 500 }, front: ['source', 'other'] })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    expect(r.tear.state().front).toBe('source')
    r.move({ x: 800, y: 516 }, 400)
    expect(r.tear.state()).toMatchObject({ over: null, raises: 0 })
    // Over the part of it that shows: a pass raises nothing...
    r.move({ x: 1500, y: 700 }, 400)
    r.move({ x: 1200, y: 700 }, 16)
    r.move({ x: 1500, y: 700 }, 400)
    expect(r.tear.state()).toMatchObject({ raises: 0, front: 'source' })
    // ...750 ms there brings it to the front, and its whole strip is open.
    r.move({ x: 1500, y: 700 }, 360)
    expect(r.tear.state()).toMatchObject({ raises: 1, front: 'other' })
    // Without the focus, and the floating window stays above it.
    expect(r.log.slice(-2)).toEqual(['raise other', 'raise spare'])
    r.move({ x: 800, y: 516 }, 128)
    expect(r.tear.state().over).toBe('other')
  })

  it('the window in front takes it when two strips overlap', () => {
    const r = rig({ other: { x: 100, y: 100, width: 1200, height: 800 }, front: ['other', 'source'] })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    // Both strips are here (the source's at y 140..172, the other's at 100..132).
    r.move({ x: 300, y: 135 }, 128)
    expect(r.tear.state().over).toBe('other')
    expect(r.told.some((e) => e.kind === 'attached')).toBe(false)
  })

  it('a window with no strip on screen takes nothing', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 }, otherStrip: null })
    r.tear.start(r.source, r.req())
    r.move(overStrip, 400)
    expect(r.tear.state()).toMatchObject({ over: null, enters: 0 })
  })

  it('the strip it hovers in going away (reloaded, off the screen, closed): it tears out and flies on', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move(overStrip, 128)
    r.tear.lost(r.other)
    expect(r.tear.state()).toMatchObject({ phase: 'float', over: null, shown: true })
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
    r.setOtherStrip(null)
    r.move(overStrip, 8)
    expect(r.tear.state()).toMatchObject({ phase: 'float', over: null })
    r.setOtherStrip({ strip: { left: 0, top: 0, right: 484, bottom: 32 }, plusRight: 200 })
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
    r.other.gone = true
    r.tear.gone(r.other)
    expect(r.tear.state()).toMatchObject({ phase: 'float', over: null })
  })

  it('dropped there before the floating page had drawn the tab, it merges all the same', async () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 }, listening: false })
    r.tear.start(r.source, r.req())
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.tear.state()).toMatchObject({ waiting: false, merges: 1 })
    // The slow page turning up later is handed nothing.
    r.setListening(true)
    r.tear.listening(r.spare)
    expect(r.log.some((l) => l.startsWith('adopt'))).toBe(false)
  })
})

describe('the only tab over another window (step 4)', () => {
  const overStrip = { x: 1500, y: 216 }
  it('its window goes clear while the tab is in that strip, and comes back when it tears out', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req(true, undefined, true))
    r.move(overStrip, 128)
    expect(r.tear.state()).toMatchObject({ phase: 'window', over: 'other' })
    expect(r.log).toContain('fade source out')
    r.move({ x: 1500, y: 300 }, 8)
    expect(r.tear.state().over).toBeNull()
    expect(r.log.at(-1)).toBe('fade source in')
  })

  it('a drop merges it there and closes the emptied window; the tab stays moving until that window has gone', async () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req(true, undefined, true))
    r.move(overStrip, 128)
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log.slice(-3)).toEqual(['merge t2 into other from source at end', 'close source', 'reveal other'])
    expect(r.moving.has('t2')).toBe(true)
    r.tear.gone(r.source)
    expect(r.moving.has('t2')).toBe(true)
    r.move({ x: 0, y: 0 }, 8)
    expect(r.moving.has('t2')).toBe(false)
  })

  it('a cancel there puts everything back: clear no more, where it was, maximized if it was', async () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.source.max = true
    r.tear.start(r.source, r.req(true, undefined, true))
    r.move(overStrip, 128)
    expect(await r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
    expect(r.log.slice(-1)).toEqual(['fade source in'])
    expect(r.hovers.at(-1)).toEqual({ win: 'other', hover: null })
    expect(r.source.max).toBe(true)
    expect(r.source.moves.at(-1)).toEqual({ x: 100, y: 100, width: 1200, height: 800 })
    expect(r.moving.has('t2')).toBe(false)
  })

  it('without a carry it moves its window and merges nowhere', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req(true))
    r.move(overStrip, 400)
    expect(r.tear.state()).toMatchObject({ phase: 'window', over: null, enters: 0 })
  })
})

describe('step 4 under --e2e', () => {
  it('a parked window is a target only where the e2e says it is, from the page pointer', () => {
    const r = rig({ e2e: true, other: { x: -4000, y: -4000, width: 500, height: 600 } })
    r.source.bounds = { x: -4000, y: -4000, width: 1200, height: 800 }
    r.tear.start(r.source, r.req(false, { x: 300, y: 200 }))
    r.tear.adopted(r.spare, null)
    // The other window pretends to sit at (1400, 200); the source at (0, 0),
    // its frame 8: the page's (1492, 216) is the screen's (1500, 216).
    r.tear.point(r.source, { x: 1492, y: 216 })
    r.move({ x: 0, y: 0 }, 200)
    expect(r.tear.state().over).toBeNull()
    r.tear.e2eAt(r.other, { x: 1400, y: 200 })
    r.move({ x: 0, y: 0 }, 128)
    expect(r.tear.state().over).toBe('other')
    expect(r.hovers.at(-1)?.hover?.point).toEqual({ x: 92, y: 16 })
    expect(r.log).not.toContain('raise other')
  })
})
