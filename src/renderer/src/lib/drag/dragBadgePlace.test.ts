import { describe, expect, it } from 'vitest'
import { DRAG_BADGE_GAP, dragBadgePlace } from './dragBadgePlace'

describe('dragBadgePlace', () => {
  it('hangs the label off the bottom right of the pointer, a small gap away', () => {
    expect(dragBadgePlace(300, 200, 120, 34, 1200, 800)).toEqual({
      left: 300 + DRAG_BADGE_GAP,
      top: 200 + DRAG_BADGE_GAP
    })
  })
  it('the gap is a few pixels, not the 10 to 20 the owner saw', () => {
    expect(DRAG_BADGE_GAP).toBeGreaterThanOrEqual(4)
    expect(DRAG_BADGE_GAP).toBeLessThanOrEqual(8)
  })
  it('never puts the label left of the pointer while there is room on the right', () => {
    const { left } = dragBadgePlace(50, 50, 200, 34, 1200, 800)
    expect(left).toBeGreaterThan(50)
  })
  it('flips to the left near the right edge instead of sliding under the pointer', () => {
    const { left } = dragBadgePlace(1150, 200, 120, 34, 1200, 800)
    expect(left + 120).toBe(1150 - DRAG_BADGE_GAP)
  })
  it('flips above near the bottom edge', () => {
    const { top } = dragBadgePlace(300, 790, 120, 34, 1200, 800)
    expect(top + 34).toBe(790 - DRAG_BADGE_GAP)
  })
  it('a label too wide for either side stays inside the window', () => {
    const { left } = dragBadgePlace(200, 100, 380, 34, 400, 800)
    expect(left).toBeGreaterThanOrEqual(4)
    expect(left + 380).toBeLessThanOrEqual(400)
  })
})
