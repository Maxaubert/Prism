import { describe, expect, it } from 'vitest'
import {
  TEAR,
  attachRects,
  band,
  dwellStep,
  floatBounds,
  floatSize,
  freeRect,
  fullyOutside,
  ghostBounds,
  ghostRect,
  grow,
  inside,
  pastSlop,
  pull,
  rectOf,
  shouldTear,
  slotAt,
  snapTarget,
  stripUnder,
  tearZone,
  validCarry,
  validColour,
  validStripReport,
  validTabLook,
  validTearRequest,
  type TabCarry
} from './tabTear'

// The feel of the tear-off, pinned (spec 2026-10-29-tab-tearoff-design.md
// section 1). A strip 32 DIP tall at the top of the window, tabs 114 wide, the
// + button 28 wide after three of them.
const strip = { left: 0, top: 40, right: 800, bottom: 72 }
const tab = { width: 114, height: 32 }
const plusRight = 3 * 114 + 28
const zone = tearZone(strip, plusRight, tab.width)
/** A press in the middle of the second tab. */
const grab = { x: 57, y: 16 }
const at = (x: number, y: number): { x: number; y: number } => ({ x, y })

describe('the numbers', () => {
  it('are the ones the owner approved', () => {
    expect(TEAR.slop).toBe(4)
    expect(TEAR.pull).toBe(0.4)
    expect(TEAR.snapMargin).toBe(8)
    expect(TEAR.dwellMs).toBe(120)
    expect(TEAR.inset).toBe(10)
    expect(TEAR.tickMs).toBe(8)
    expect(TEAR.spareDelayMs).toBe(2000)
    expect(TEAR.tearGuard).toBeGreaterThan(TEAR.snapMargin)
  })
})

describe('a click is never a drag', () => {
  it('stays a click inside the slop, either way', () => {
    expect(pastSlop(0, 0)).toBe(false)
    expect(pastSlop(3, -3)).toBe(false)
    expect(pastSlop(-3.9, 0)).toBe(false)
  })
  it('becomes a drag at 4 DIP, horizontally or vertically', () => {
    expect(pastSlop(4, 0)).toBe(true)
    expect(pastSlop(0, -4)).toBe(true)
  })
})

describe('the tear zone', () => {
  it('is the strip, ending one tab width past the + button', () => {
    expect(zone).toEqual({ left: 0, top: 40, right: plusRight + 114, bottom: 72 })
  })
})

describe('the tear (fully outside the strip)', () => {
  const tabMid = 114 + 57 // the second tab's middle, where the press was
  it('does not tear from a short pull', () => {
    expect(shouldTear(at(tabMid, 56), grab, tab, zone)).toBe(false) // in the strip
    expect(shouldTear(at(tabMid, 80), grab, tab, zone)).toBe(false) // 8 below: half out
    expect(shouldTear(at(tabMid, 87), grab, tab, zone)).toBe(false) // 15 below: a sliver still in
  })
  it('tears once the tab rect is fully below the strip', () => {
    // Pressed 16 down the tab: its top leaves the strip's bottom at 72 + 16.
    expect(shouldTear(at(tabMid, 88), grab, tab, zone)).toBe(true)
    expect(shouldTear(at(tabMid, 160), grab, tab, zone)).toBe(true)
  })
  it('tears above the strip the same way', () => {
    expect(shouldTear(at(tabMid, 25), grab, tab, zone)).toBe(false)
    expect(shouldTear(at(tabMid, 24), grab, tab, zone)).toBe(true)
  })
  it('tears off the left end only when the whole tab has left it', () => {
    expect(shouldTear(at(56, 56), grab, tab, { ...zone, left: 60 })).toBe(false)
    expect(shouldTear(at(57 + 60 - 114 - 17, 56), grab, tab, { ...zone, left: 60 })).toBe(true)
  })
  it('gives one tab width of grace past the + button', () => {
    // The tab's left edge just short of the zone's end: still on.
    expect(shouldTear(at(plusRight + 114 - 1 + 57, 56), grab, tab, zone)).toBe(false)
    expect(shouldTear(at(plusRight + 114 + 57 + 16, 56), grab, tab, zone)).toBe(true)
  })
  it('a sideways tear past the + is never inside the snap target (review 2026-10-29: the window flickered)', () => {
    // The strip runs on to the window controls, well past the zone.
    const target = snapTarget(strip, zone)
    expect(target).toEqual({ left: 0, top: 40, right: zone.right, bottom: 72 })
    // The reviewer's point: a tear at (557, 56) is inside the whole strip's
    // snap zone, but not inside the target's.
    expect(shouldTear(at(557, 56), grab, tab, zone)).toBe(true)
    expect(inside(at(557, 56), grow(strip, TEAR.snapMargin))).toBe(true)
    expect(stripUnder(at(557, 56), [{ key: 0, rect: target }])).toBeNull()
    // And so for every point and every grab: a tear can never snap straight back.
    for (const g of [grab, { x: 2, y: 2 }, { x: 112, y: 30 }, { x: 57, y: 31 }])
      for (let x = -200; x <= 1000; x += 4)
        for (let y = -40; y <= 160; y += 3)
          if (shouldTear(at(x, y), g, tab, zone)) expect(stripUnder(at(x, y), [{ key: 0, rect: target }])).toBeNull()
  })
  it('the snap target never reaches past a strip narrower than the zone', () => {
    expect(snapTarget({ ...strip, right: 300 }, zone).right).toBe(300)
  })
  it('never tears inside the snap zone, whatever the grab (no flicker at the edge)', () => {
    // A press 2 DIP from the tab's top: the rect is fully out with the cursor
    // only 2 below the strip, inside the snap-back zone. It waits.
    const edge = { x: 57, y: 2 }
    expect(fullyOutside(freeRect(at(tabMid, 74), edge, tab), zone)).toBe(true)
    expect(shouldTear(at(tabMid, 74), edge, tab, zone)).toBe(false)
    expect(shouldTear(at(tabMid, 72 + 12), edge, tab, zone)).toBe(false)
    expect(shouldTear(at(tabMid, 72 + 13), edge, tab, zone)).toBe(true)
  })
})

describe('the pull (0.4x resistance)', () => {
  it('is nothing inside the band', () => {
    expect(pull(50, 40, 72)).toBe(0)
    expect(pull(40, 40, 72)).toBe(0)
  })
  it('is 0.4 of the overshoot, either side', () => {
    expect(pull(82, 40, 72)).toBeCloseTo(4)
    expect(pull(30, 40, 72)).toBeCloseTo(-4)
  })
  it('makes a rubber band, not a wall', () => {
    expect(band(10, 0, 100)).toBe(10)
    expect(band(110, 0, 100)).toBeCloseTo(104)
    expect(band(-10, 0, 100)).toBeCloseTo(-4)
  })
  it('draws the tab sliding in its row, pulled once the cursor leaves the strip', () => {
    const laneTop = 40
    // In the strip: it slides with the cursor, no vertical movement.
    expect(ghostRect(at(300, 60), grab, tab, strip, laneTop)).toMatchObject({ left: 243, top: 40 })
    // 10 below the strip: 4 down, the pull.
    expect(ghostRect(at(300, 82), grab, tab, strip, laneTop).top).toBeCloseTo(44)
    // 10 above: 4 up.
    expect(ghostRect(at(300, 30), grab, tab, strip, laneTop).top).toBeCloseTo(36)
    // Past the strip's left end: it holds back at 0.4x.
    expect(ghostRect(at(57 - 20, 60), grab, tab, strip, laneTop).left).toBeCloseTo(-8)
  })
})

describe('the snap back', () => {
  const targets = [{ key: 7, rect: strip }]
  it('is the strip plus 8 DIP', () => {
    expect(stripUnder(at(400, 80), targets)?.key).toBe(7)
    expect(stripUnder(at(400, 81), targets)).toBeNull()
    expect(stripUnder(at(400, 32), targets)?.key).toBe(7)
    expect(stripUnder(at(-8, 50), targets)?.key).toBe(7)
    expect(stripUnder(at(-9, 50), targets)).toBeNull()
  })
  it('is tighter than the tear: a point that snaps never tears', () => {
    for (let y = 30; y <= 82; y += 1)
      for (const gy of [0, 2, 16, 30, 32]) {
        const p = at(171, y)
        if (stripUnder(p, [{ key: 1, rect: zone }])) expect(shouldTear(p, { x: 57, y: gy }, tab, zone)).toBe(false)
      }
  })
  it('lets the first listed (front-most) strip win', () => {
    const two = [{ key: 1, rect: strip }, { key: 2, rect: strip }]
    expect(stripUnder(at(10, 50), two)?.key).toBe(1)
  })
  it('waits 120 ms over the same strip before it fires', () => {
    let s = dwellStep<number>(null, 7, 1000)
    expect(s.fire).toBe(false)
    s = dwellStep(s.dwell, 7, 1100)
    expect(s.fire).toBe(false)
    s = dwellStep(s.dwell, 7, 1120)
    expect(s.fire).toBe(true)
  })
  it('starts again when the cursor leaves, or moves to another strip', () => {
    let s = dwellStep<number>(null, 7, 0)
    s = dwellStep(s.dwell, null, 60)
    expect(s.dwell).toBeNull()
    s = dwellStep(s.dwell, 7, 100)
    expect(dwellStep(s.dwell, 7, 200).fire).toBe(false)
    s = dwellStep(s.dwell, 8, 210)
    expect(s.dwell).toEqual({ key: 8, since: 210 })
    expect(dwellStep(s.dwell, 8, 329).fire).toBe(false)
    expect(dwellStep(s.dwell, 8, 330).fire).toBe(true)
  })
})

describe('the new window', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 }
  it("is the source's normal size", () => {
    expect(floatSize({ width: 1200, height: 800 }, false, work)).toEqual({ width: 1200, height: 800 })
  })
  it('is at least half the work area when the source was maximized', () => {
    expect(floatSize({ width: 700, height: 400 }, true, work)).toEqual({ width: 960, height: 520 })
    expect(floatSize({ width: 1400, height: 900 }, true, work)).toEqual({ width: 1400, height: 900 })
  })
  it('is never bigger than the work area less 10 DIP each side', () => {
    expect(floatSize({ width: 3000, height: 2000 }, false, work)).toEqual({ width: 1900, height: 1020 })
  })
  it('holds the tab under the cursor at the grab point', () => {
    const b = floatBounds(at(900, 500), { x: 171, y: 56 }, { width: 1000, height: 700 }, work)
    expect(b).toEqual({ x: 729, y: 444, width: 1000, height: 700 })
  })
  it('never puts its title row above the work area', () => {
    expect(floatBounds(at(900, 20), { x: 171, y: 56 }, { width: 1000, height: 700 }, work).y).toBe(0)
  })
  it('keeps some of itself on the display at every edge', () => {
    const size = { width: 1000, height: 700 }
    expect(floatBounds(at(5000, 500), { x: 10, y: 10 }, size, work).x).toBe(1920 - TEAR.keepVisible)
    expect(floatBounds(at(-5000, 500), { x: 10, y: 10 }, size, work).x).toBe(-1000 + TEAR.keepVisible)
    expect(floatBounds(at(500, 5000), { x: 10, y: 10 }, size, work).y).toBe(1040 - TEAR.keepVisible)
  })
  it('works on a display left of the primary (negative coordinates)', () => {
    const left = { x: -1600, y: 0, width: 1600, height: 860 }
    expect(floatBounds(at(-800, 300), { x: 100, y: 50 }, { width: 900, height: 600 }, left)).toEqual({
      x: -900,
      y: 250,
      width: 900,
      height: 600
    })
  })
  it('rounds to whole DIP (setBounds wants integers)', () => {
    const b = floatBounds(at(100.6, 100.4), { x: 0.2, y: 0.1 }, { width: 500, height: 400 }, work)
    expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true)
  })
})

describe('small pieces', () => {
  it('slots by the lanes’ middles', () => {
    expect(slotAt([50, 150, 250], 10)).toBe(0)
    expect(slotAt([50, 150, 250], 160)).toBe(2)
    expect(slotAt([50, 150, 250], 400)).toBe(3)
  })
  it('converts and grows rects', () => {
    expect(rectOf({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ left: 1, top: 2, right: 4, bottom: 6 })
    expect(grow(strip, 8)).toEqual({ left: -8, top: 32, right: 808, bottom: 80 })
    expect(inside(at(0, 40), strip)).toBe(true)
  })
})

describe('what main accepts from a page', () => {
  const carry: TabCarry = {
    tab: {
      id: 't1',
      root: 'C:\\x',
      browse: { path: 'C:\\x', history: [], cursor: 0, surface: 'folder', preview: false },
      files: [],
      index: -1
    },
    buffers: []
  }
  const base = { tabId: 't1', grab: at(1, 2), origin: at(0, 40), strip, point: at(3, 4) }
  it('a carry with an id, a root, a browse, files and buffers', () => {
    expect(validCarry(carry)).toBe(true)
    expect(validCarry({ tab: { id: '', root: 'x' }, buffers: [] })).toBe(false)
    expect(validCarry(null)).toBe(false)
  })
  it('a tear with its geometry, and a carry for the same tab unless it is the only one', () => {
    expect(validTearRequest({ ...base, only: false, carry })).toBe(true)
    expect(validTearRequest({ ...base, only: true })).toBe(true)
    expect(validTearRequest({ ...base, only: false })).toBe(false)
    expect(validTearRequest({ ...base, only: false, carry, tabId: 'other' })).toBe(false)
    expect(validTearRequest({ ...base, only: true, grab: { x: NaN, y: 0 } })).toBe(false)
    expect(validTearRequest({ ...base, only: true, strip: { left: 0 } })).toBe(false)
    expect(validTearRequest({ ...base, only: true, origin: undefined })).toBe(false)
  })
  it('step 4: the only tab may carry itself too, with a size and a label; a carry must be its own', () => {
    expect(validTearRequest({ ...base, only: true, carry, size: { width: 100, height: 32 }, label: 'x' })).toBe(true)
    expect(validTearRequest({ ...base, only: true, carry: { ...carry, tab: { ...carry.tab, id: 'other' } } })).toBe(false)
    expect(validTearRequest({ ...base, only: true, size: { width: 0, height: 32 } })).toBe(false)
    expect(validTearRequest({ ...base, only: true, label: 3 })).toBe(false)
  })
  it('a strip report is a rect and the right edge of its +', () => {
    expect(validStripReport({ strip, plusRight: 300 })).toBe(true)
    expect(validStripReport({ strip, plusRight: NaN })).toBe(false)
    expect(validStripReport({ strip: { left: 0 }, plusRight: 3 })).toBe(false)
    expect(validStripReport(null)).toBe(false)
  })
})

describe('another window as a target (step 4)', () => {
  const report = { strip, plusRight }
  it('takes the tab over the same rect as its own strip, and lets it go by the same rule', () => {
    const { snap, zone: z } = attachRects(report, tab.width)
    expect(z).toEqual(zone)
    expect(snap).toEqual(snapTarget(strip, zone))
  })
  it('never tears the tab out at a point that would take it again (the hysteresis holds)', () => {
    const { snap, zone: z } = attachRects(report, tab.width)
    for (let y = strip.top - 80; y <= strip.bottom + 80; y += 1)
      for (let x = -60; x <= 900; x += 7) {
        const p = at(x, y)
        if (shouldTear(p, grab, tab, z)) expect(inside(p, grow(snap, TEAR.snapMargin))).toBe(false)
      }
  })
  it('raises a window after 750 ms, as Chrome does', () => {
    expect(TEAR.raiseMs).toBe(750)
    expect(dwellStep(dwellStep(null, 'w', 0, TEAR.raiseMs).dwell, 'w', 749, TEAR.raiseMs).fire).toBe(false)
    expect(dwellStep(dwellStep(null, 'w', 0, TEAR.raiseMs).dwell, 'w', 750, TEAR.raiseMs).fire).toBe(true)
  })
})

// THE GHOST (owner, 2026-10-30: "let it just be the tab you're carrying,
// that's how file explorer does it"): a tab-sized window at the cursor.
describe('the ghost', () => {
  it('sits where the tab was held, its shadow room round it, whatever the display', () => {
    expect(ghostBounds({ x: 500, y: 400 }, { x: 50, y: 16 }, { width: 114, height: 32 })).toEqual({
      x: 500 - 50 - TEAR.ghostPad,
      y: 400 - 16 - TEAR.ghostPad,
      width: 114 + TEAR.ghostPad * 2,
      height: 32 + TEAR.ghostPad * 2
    })
    // Never held to a work area: off the left edge it is still the cursor's.
    expect(ghostBounds({ x: 2, y: 2 }, { x: 50, y: 16 }, { width: 100.4, height: 32 }, 0)).toEqual({ x: -48, y: -14, width: 100, height: 32 })
  })

  it('takes only plain colours and font names from the page', () => {
    const look = { ground: 'rgb(26, 29, 33)', ink: 'rgba(227, 230, 234, 0.9)', edge: 'color(srgb 1 1 1 / 0.07)', accent: '#6a7f99', font: '"Segoe UI Variable", system-ui, sans-serif' }
    expect(validTabLook(look)).toBe(true)
    expect(validColour('oklch(0.7 0.1 250)')).toBe(true)
    for (const bad of ['url(x)', 'red; background: url(x)', 'rgb(1,2,3) url(x)', 'var(--p-tabs)', 'expression(alert(1))', '', 'x'.repeat(81)])
      expect(validColour(bad), bad).toBe(false)
    expect(validTabLook({ ...look, font: 'a</style><script>' })).toBe(false)
    expect(validTabLook({ ...look, ink: 42 })).toBe(false)
    expect(validTabLook(null)).toBe(false)
  })
})
