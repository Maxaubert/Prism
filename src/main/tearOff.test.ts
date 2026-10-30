import { describe, expect, it } from 'vitest'
import { createTearOff, type TearDeps, type TearWin } from './tearOff'
import { TEAR, type Bounds, type Point, type StripReport, type TabCarry, type TabHover, type TabLook, type TearEvent, type TearRequest } from '@shared/tabTear'

// Main's half of the tear-off (step 3, 2026-10-29), driven with fake windows
// and a hand-turned clock: the loop, the snap back's dwell, the drop, the
// cancel, the only tab moving its window. Since 2026-10-30 only the tab (the
// ghost) follows the cursor; the floating window stays hidden until the drop.

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
  /** Another app's window, in front of every Prism window, over this rect. */
  foreign?: Bounds
  /** The ghost's page has not loaded yet: it shows when `ghostReady()` is called. */
  slowGhost?: boolean
  /** A window shown at a drop says it has drawn only when `drawnReady()` is called. */
  drawn?: boolean
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
  /** The system's order: asked every tick, a raise moves a window up. */
  let front: Array<'source' | 'other'> = [...(options.front ?? ['source', 'other'])]
  let foreign: Bounds | null = options.foreign ?? null
  /** The ghost, as main's window would be. */
  const ghost = {
    shown: false,
    at: null as Bounds | null,
    face: null as { label: string; look?: TabLook } | null,
    moves: [] as Bounds[],
    pending: null as (() => void) | null
  }
  /** Windows shown at a drop, waiting to say they have drawn. */
  const drawnWaits: Array<() => void> = []
  const within = (p: Point, b: Bounds): boolean =>
    p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
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
    windowsFront: () => (options.other ? front.map((n) => byName[n]).filter((w) => !w.gone) : [source]),
    covered: (p) => !!foreign && within(p, foreign),
    raised: (w) => {
      log.push(`raised ${w.name}`)
      if (w === source || w === other) front = [w.name as 'source' | 'other', ...front.filter((n) => n !== w.name)]
    },
    stripOf: (w) => (w === other ? otherStrip : null),
    name: (w) => w.name,
    hover: (w, h) => void hovers.push({ win: w.name, hover: h }),
    merge: (w, c, src, at) => log.push(`merge ${c.tab.id} into ${w.name} from ${src.name} at ${at ?? 'end'}`),
    raise: (w) => log.push(`raise ${w.name}`),
    ghost: {
      show: (face, at, shown) => {
        log.push(`ghost show ${face.label}`)
        ghost.at = { ...at }
        ghost.face = { label: face.label, look: face.look }
        const up = (): void => {
          ghost.pending = null
          ghost.shown = true
          shown()
        }
        if (options.slowGhost) ghost.pending = up
        else up()
      },
      move: (at) => {
        ghost.at = { ...at }
        ghost.moves.push({ ...at })
      },
      hide: () => {
        ghost.shown = false
        ghost.at = null
        ghost.pending = null
        log.push('ghost hide')
      }
    },
    drawn: options.drawn ? (_w, fn) => void drawnWaits.push(fn) : undefined,
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
    ghost,
    /** The ghost's page has loaded: a show asked for goes on screen. */
    ghostReady: () => ghost.pending?.(),
    /** The window shown at a drop has drawn a frame on screen. */
    drawnReady: () => drawnWaits.splice(0).forEach((fn) => fn()),
    setOtherStrip: (r: StripReport | null) => (otherStrip = r),
    /** The system's order changes (a window focused or closed elsewhere). */
    setFront: (f: Array<'source' | 'other'>) => (front = [...f]),
    front: () => [...front],
    setForeign: (b: Bounds | null) => (foreign = b),
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
  it('hands the tab to the hidden spare, and only the tab (the ghost) follows the cursor', () => {
    const r = rig()
    r.move({ x: 500, y: 400 }, 0)
    expect(r.tear.start(r.source, r.req())).toBe(true)
    expect(r.moving.has('t2')).toBe(true)
    expect(r.log).toEqual(['adopt spare t2', 'ghost show x'])
    // THE GHOST (owner, 2026-10-30: "let it just be the tab you're
    // carrying"): the tab's own size with its shadow's room, held at the same
    // grab point as in the strip (50, 16), so it does not jump at the tear.
    expect(r.ghost.at).toEqual({ x: 500 - 50 - 20, y: 400 - 16 - 20, width: 140, height: 72 })
    expect(r.told).toEqual([{ kind: 'shown', tabId: 't2' }])
    // Where the window WOULD go: the cursor holds the first tab's grab point
    // (frame 8 + origin 0 + grab 50, origin 40 + grab 16). It is not moved.
    expect(r.tear.state().bounds).toMatchObject({ x: 500 - 58, y: 400 - 56, width: 1200, height: 800 })
    r.tear.adopted(r.spare, { x: 0, y: 40 })
    // It stays hidden all through the drag, and is never raised.
    expect(r.spare.shown).toBe(false)
    expect(r.log).not.toContain('raise spare')
    r.move({ x: 900, y: 600 }, 16)
    expect(r.ghost.at).toEqual({ x: 830, y: 564, width: 140, height: 72 })
    expect(r.tear.state()).toMatchObject({
      phase: 'float',
      tabId: 't2',
      shown: true,
      ghost: { x: 830, y: 564, width: 140, height: 72 },
      bounds: { x: 842, y: 544, width: 1200, height: 800 }
    })
    expect(r.spare.moves).toEqual([])
    expect(r.spare.shown).toBe(false)
  })

  it('moves the ghost only when the cursor moves', () => {
    const r = rig()
    r.move({ x: 500, y: 400 }, 0)
    r.tear.start(r.source, r.req())
    r.move({ x: 600, y: 400 }, 8)
    r.move({ x: 600, y: 400 }, 80)
    expect(r.ghost.moves).toEqual([{ x: 530, y: 364, width: 140, height: 72 }])
  })

  it('a ghost whose page is not ready yet shows once it is; the source keeps its chip until then', () => {
    const r = rig({ slowGhost: true })
    r.tear.start(r.source, r.req())
    expect(r.tear.state().shown).toBe(false)
    expect(r.told).toEqual([])
    r.ghostReady()
    expect(r.tear.state().shown).toBe(true)
    expect(r.told).toEqual([{ kind: 'shown', tabId: 't2' }])
  })

  it('a ghost that comes after its tear has ended says nothing', async () => {
    const r = rig({ slowGhost: true })
    r.tear.start(r.source, r.req())
    const late = r.ghost.pending
    expect(await r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
    expect(r.log).toContain('ghost hide')
    late?.()
    expect(r.told).toEqual([])
  })

  it('draws the tab with the look its strip sent, and its own colours for one that fails the check', () => {
    const look: TabLook = { ground: 'rgb(26, 29, 33)', ink: 'rgb(227, 230, 234)', edge: 'rgba(255, 255, 255, 0.07)', accent: 'rgb(106, 127, 153)', font: '"Segoe UI", sans-serif' }
    const r = rig()
    r.tear.start(r.source, { ...r.req(), look })
    expect(r.ghost.face).toEqual({ label: 'x', look })
    const bad = rig()
    bad.tear.start(bad.source, { ...bad.req(), look: { ...look, ground: 'url(https://example.com/x.png)' } })
    expect(bad.ghost.face).toEqual({ label: 'x', look: undefined })
  })

  it('takes the new page’s own tab place once it has drawn it', () => {
    const r = rig()
    r.move({ x: 500, y: 400 }, 0)
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, { x: 40, y: 44 })
    expect(r.tear.state().bounds).toMatchObject({ x: 500 - 98, y: 400 - 60 })
  })

  it('waits for a fresh window’s page before handing the tab over', () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    expect(r.log).toEqual(['ghost show x'])
    r.setListening(true)
    r.tear.listening(r.spare)
    expect(r.log).toEqual(['ghost show x', 'adopt spare t2'])
  })

  it('drop: the floating window is placed where the ghost was, shown in front, then the ghost goes', async () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 900, y: 600 }, 40)
    expect(r.spare.moves).toEqual([])
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log).toEqual(['adopt spare t2', 'ghost show x', 'commit spare', 'spare soon', 'reveal spare', 'ghost hide'])
    // Its tab under the cursor: placed once, before it shows.
    expect(r.spare.moves).toEqual([{ x: 842, y: 544, width: 1200, height: 800 }])
    expect(r.ghost.shown).toBe(false)
    expect(r.moving.has('t2')).toBe(false)
    expect(r.running()).toBe(false)
    expect(r.tear.state()).toMatchObject({ phase: 'idle', commits: 1, shown: false, ghost: null })
  })

  it('the ghost stays up after the drop until the window just shown has drawn (review 2026-10-30)', async () => {
    const r = rig({ drawn: true })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 900, y: 600 }, 40)
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log.at(-1)).toBe('reveal spare')
    expect(r.ghost.shown).toBe(true)
    r.drawnReady()
    expect(r.log.at(-1)).toBe('ghost hide')
    expect(r.ghost.shown).toBe(false)
  })

  it('a window that never says it drew: the ghost goes after a short while all the same', async () => {
    const r = rig({ drawn: true })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    await r.tear.end(r.source, 'drop')
    r.move({ x: 0, y: 0 }, TEAR.drawnMs - 8)
    expect(r.ghost.shown).toBe(true)
    r.move({ x: 0, y: 0 }, 8)
    expect(r.ghost.shown).toBe(false)
    // The frame that comes late hides nothing more.
    r.drawnReady()
    expect(r.log.filter((x) => x === 'ghost hide')).toHaveLength(1)
  })

  it('a tear while the last drop still waits to hide the ghost: that wait hides nothing', async () => {
    const r = rig({ drawn: true })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    await r.tear.end(r.source, 'drop')
    r.tear.start(r.source, r.req())
    expect(r.log.at(-1)).toBe('ghost show x')
    r.drawnReady()
    r.move({ x: 0, y: 0 }, TEAR.drawnMs + 8)
    expect(r.ghost.shown).toBe(true)
    expect(r.log).not.toContain('ghost hide')
  })

  it('a late drop that fails while a later tear has the ghost leaves that ghost up', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    const answer = r.tear.end(r.source, 'drop')
    r.tear.start(r.source, r.req())
    r.move({ x: 0, y: 0 }, TEAR.lateDropMs)
    expect(await answer).toEqual({ committed: false })
    expect(r.log).toEqual(['ghost show x', 'ghost show x', 'release spare t2 to source'])
    expect(r.ghost.shown).toBe(true)
  })

  it('a page saying its tab is huge gets a tab-sized ghost (review 2026-10-30)', () => {
    const r = rig()
    r.tear.start(r.source, { ...r.req(), size: { width: 1e5, height: 1e5 } })
    expect(r.ghost.at?.width).toBe(TEAR.tabMaxWidth + 2 * TEAR.ghostPad)
    expect(r.ghost.at?.height).toBe(TEAR.tabMaxHeight + 2 * TEAR.ghostPad)
  })

  it('a drop before a slow window has drawn the tab commits only once it has, and shows it then', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    let answer: { committed: boolean } | null = null
    void r.tear.end(r.source, 'drop').then((a) => (answer = a))
    await Promise.resolve()
    // Nothing committed yet (review 2026-10-29): the source still has the tab.
    // The ghost stays where it was dropped, holding it (review 2026-10-30:
    // nothing was on screen until the page was ready).
    expect(answer).toBeNull()
    expect(r.log).toEqual(['ghost show x'])
    expect(r.ghost.shown).toBe(true)
    r.move({ x: 1500, y: 900 }, 40)
    expect(r.ghost.moves).toEqual([])
    expect(r.moving.has('t2')).toBe(true)
    expect(r.tear.busy(r.spare)).toBe(true)
    expect(r.tear.state()).toMatchObject({ phase: 'idle', waiting: true, commits: 0, ghost: null })
    r.setListening(true)
    r.tear.listening(r.spare)
    expect(r.log).toEqual(['ghost show x', 'adopt spare t2'])
    r.tear.adopted(r.spare, null)
    await Promise.resolve()
    expect(answer).toEqual({ committed: true })
    expect(r.log).toEqual(['ghost show x', 'adopt spare t2', 'commit spare', 'spare soon', 'reveal spare', 'ghost hide'])
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
    expect(r.log).toEqual(['ghost show x', 'ghost hide', 'release spare t2 to source'])
    expect(r.moving.has('t2')).toBe(false)
    expect(r.tear.state()).toMatchObject({ waiting: false, commits: 0, cancels: 1 })
    // A page that turns up after all is the spare's again: nothing happens.
    r.tear.listening(r.spare)
    r.tear.adopted(r.spare, null)
    expect(r.log).toEqual(['ghost show x', 'ghost hide', 'release spare t2 to source'])
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
    expect(r.log).toEqual(['ghost show x', 'ghost hide'])
  })

  it('the source closing while a drop waits: the tab is nobody’s, and no longer moving', async () => {
    const r = rig({ listening: false })
    r.tear.start(r.source, r.req())
    const answer = r.tear.end(r.source, 'drop')
    // Electron's 'closed': not destroyed yet, but gone for the tear.
    r.tear.gone(r.source)
    expect(await answer).toEqual({ committed: false })
    expect(r.log).toEqual(['ghost show x', 'ghost hide', 'release spare t2 to nobody'])
    expect(r.moving.has('t2')).toBe(false)
  })

  it('cancel: the floating window gives the tab back, and nothing is committed', async () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    expect(await r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
    expect(r.log).toEqual(['adopt spare t2', 'ghost show x', 'ghost hide', 'release spare t2 to source'])
    expect(r.ghost.shown).toBe(false)
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
    expect(r.ghost.shown).toBe(false)
  })

  it('the source closing mid-tear hides the floating window again, and the tab stops moving first', () => {
    const r = rig()
    r.tear.start(r.source, r.req())
    // Called from 'closed', before the window is destroyed and before it
    // leaves the registry (review 2026-10-29): its close must release the tab.
    r.tear.gone(r.source)
    expect(r.log.slice(-2)).toEqual(['ghost hide', 'release spare t2 to nobody'])
    expect(r.moving.has('t2')).toBe(false)
    expect(r.told).toEqual([{ kind: 'shown', tabId: 't2' }])
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
    // The ghost goes: the strip draws the tab again.
    expect(r.log.slice(-2)).toEqual(['ghost hide', 'release spare t2 to source'])
    expect(r.ghost.shown).toBe(false)
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
    // The owner's earlier choice stands: no ghost, the window itself.
    expect(r.log).toEqual([])
    expect(r.ghost.at).toBeNull()
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
    // The ghost's would-be place, from the same pointer (its window parks it).
    expect(r.tear.state().ghost).toEqual({ x: 508 - 50 - 20, y: 300 - 16 - 20, width: 140, height: 72 })
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
  it('after 120 ms over its strip the tab is in it, live: the ghost hides, the strip is told where', async () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 1350, y: 600 }, 40)
    r.move(overStrip, 112)
    expect(r.tear.state().over).toBeNull()
    r.move(overStrip, 16)
    expect(r.tear.state()).toMatchObject({ phase: 'float', over: 'other', enters: 1 })
    expect(r.log.at(-1)).toBe('ghost hide')
    expect(r.tear.state()).toMatchObject({ shown: false, ghost: null })
    expect(r.spare.shown).toBe(false)
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

  it('fully out of that strip it tears off again: the gap closes, the ghost is back, and it does not flicker', () => {
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
    expect(r.ghost.shown).toBe(true)
    expect(r.ghost.at).toEqual({ x: 1430, y: 224, width: 140, height: 72 })
    expect(r.spare.shown).toBe(false)
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
    // Without the focus; the ghost is above every app already, and the
    // hidden floating window is never raised.
    expect(r.log.slice(-2)).toEqual(['raise other', 'raised other'])
    expect(r.log).not.toContain('raise spare')
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

// REVIEW 2026-10-30: the order is the system's, asked every tick; another
// app's window hides what is under it; a raise outlives the tear.
describe('what is really in front (step 4 review)', () => {
  const overStrip = { x: 1500, y: 216 }
  it('a strip under another app’s window takes nothing and raises nothing', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 }, foreign: { x: 1300, y: 0, width: 620, height: 1040 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move(overStrip, 1000)
    expect(r.tear.state()).toMatchObject({ over: null, enters: 0, raises: 0, shown: true })
    // That app gone, the same place takes it.
    r.setForeign(null)
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
  })

  it('another app’s window coming over the strip it is in: it tears out', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
    r.setForeign({ x: 1450, y: 0, width: 200, height: 1040 })
    r.move(overStrip, 8)
    expect(r.tear.state()).toMatchObject({ over: null, leaves: 1, shown: true })
    expect(r.hovers.at(-1)).toEqual({ win: 'other', hover: null })
  })

  it('in a strip, onto a window in front of it: it tears out there, and that window is not raised behind it', () => {
    // The other window behind the source: its strip shows right of x 1300.
    const r = rig({
      other: { x: 700, y: 500, width: 1000, height: 500 },
      otherStrip: { strip: { left: 0, top: 0, right: 984, bottom: 32 }, plusRight: 800 },
      front: ['source', 'other']
    })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 1500, y: 516 }, 128)
    expect(r.tear.state().over).toBe('other')
    // Still in its zone, but over the source's body, which hides it there.
    r.move({ x: 1250, y: 516 }, 8)
    expect(r.tear.state()).toMatchObject({ over: null, leaves: 1 })
    r.move({ x: 1250, y: 516 }, 1000)
    expect(r.tear.state()).toMatchObject({ over: null, raises: 0, front: 'source' })
  })

  it('follows the system’s order as it changes under the drag', () => {
    const r = rig({ other: { x: 700, y: 500, width: 1000, height: 500 }, front: ['source', 'other'] })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 800, y: 516 }, 400)
    expect(r.tear.state().over).toBeNull()
    r.setFront(['other', 'source'])
    r.move({ x: 800, y: 516 }, 128)
    expect(r.tear.state()).toMatchObject({ over: 'other', front: 'other' })
  })

  it('a window that stops taking tabs under the drag (reloading, minimized) lets it go', () => {
    const r = rig({ other: { x: 1400, y: 200, width: 500, height: 600 } })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move(overStrip, 128)
    expect(r.tear.state().over).toBe('other')
    r.setFront(['source'])
    r.move(overStrip, 8)
    expect(r.tear.state()).toMatchObject({ over: null, leaves: 1 })
    r.move(overStrip, 400)
    expect(r.tear.state()).toMatchObject({ over: null, enters: 1 })
  })

  it('a raise outlives the tear, and a cancel after one brings the focused source to the front again', async () => {
    const r = rig({ other: { x: 700, y: 500, width: 1000, height: 500 }, front: ['source', 'other'] })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 1500, y: 700 }, 760)
    expect(r.tear.state()).toMatchObject({ raises: 1, front: 'other' })
    expect(r.front()).toEqual(['other', 'source'])
    expect(await r.tear.end(r.source, 'cancel')).toEqual({ committed: false })
    expect(r.log.slice(-2)).toEqual(['raise source', 'raised source'])
    expect(r.front()).toEqual(['source', 'other'])
  })

  it('a tab that goes back to its source after a raise brings the source to the front', () => {
    const r = rig({ other: { x: 700, y: 500, width: 1000, height: 500 }, front: ['source', 'other'] })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 1500, y: 700 }, 760)
    expect(r.front()).toEqual(['other', 'source'])
    // The source's strip (y 140..172) where the other window does not cover it.
    r.move({ x: 300, y: 150 }, 128)
    expect(r.told.at(-1)).toEqual({ kind: 'attached', tabId: 't2' })
    expect(r.front()).toEqual(['source', 'other'])
  })

  it('a drop after a raise leaves the order as it is', async () => {
    const r = rig({ other: { x: 700, y: 500, width: 1000, height: 500 }, front: ['source', 'other'] })
    r.tear.start(r.source, r.req())
    r.tear.adopted(r.spare, null)
    r.move({ x: 1500, y: 700 }, 760)
    expect(await r.tear.end(r.source, 'drop')).toEqual({ committed: true })
    expect(r.log).not.toContain('raised source')
  })

  it('under --e2e a raise is only bookkeeping', () => {
    const r = rig({ e2e: true, other: { x: -4000, y: -4000, width: 1000, height: 500 }, front: ['source', 'other'] })
    r.source.bounds = { x: -4000, y: -4000, width: 1200, height: 800 }
    r.tear.e2eAt(r.other, { x: 600, y: 400 })
    r.tear.start(r.source, r.req(false, { x: 300, y: 200 }))
    r.tear.adopted(r.spare, null)
    // The source at (0, 0) frame 8: the page's (1492, 600) is the screen's (1500, 600).
    r.tear.point(r.source, { x: 1492, y: 600 })
    r.move({ x: 0, y: 0 }, 760)
    expect(r.tear.state()).toMatchObject({ raises: 1, front: 'other' })
    expect(r.log).toContain('raised other')
    expect(r.log).not.toContain('raise other')
  })
})
