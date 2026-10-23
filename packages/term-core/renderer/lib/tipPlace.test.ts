import { describe, expect, it } from 'vitest'
import { placeTip, TIP_GAP, TIP_MARGIN } from './tipPlace'

const view = { width: 1200, height: 800 }
const tip = { width: 120, height: 26 }

describe('placeTip', () => {
  it('centres the tip under the item', () => {
    const item = { left: 500, top: 4, width: 32, height: 32 }
    const s = placeTip(item, tip, view)
    expect(s.side).toBe('below')
    expect(s.x + tip.width / 2).toBe(516)
    expect(s.y).toBe(4 + 32 + TIP_GAP)
  })
  it('keeps it inside the window at the right edge', () => {
    const s = placeTip({ left: 1160, top: 4, width: 36, height: 32 }, tip, view)
    expect(s.x + tip.width).toBe(view.width - TIP_MARGIN)
  })
  it('goes above when there is no room below', () => {
    const s = placeTip({ left: 500, top: 770, width: 32, height: 24 }, tip, view)
    expect(s.side).toBe('above')
    expect(s.y).toBe(770 - TIP_GAP - tip.height)
  })
  it('sits beside the item where asked, centred on it, and flips at the edge', () => {
    const row = { left: 8, top: 200, width: 220, height: 34 }
    const s = placeTip(row, tip, view, 'right')
    expect(s.side).toBe('right')
    expect(s.x).toBe(8 + 220 + TIP_GAP)
    expect(s.y + tip.height / 2).toBe(217)
    expect(placeTip({ ...row, left: 1000 }, tip, view, 'right').side).toBe('left')
  })
})
