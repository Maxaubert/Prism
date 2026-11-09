import { describe, expect, it } from 'vitest'
import { landingTile } from './landingGrid'

// A landing tile (zoom grid spec 5.7): faded, inert, "Copying…" under a 4px
// bar across the bottom of the picture box. A percentage tick moves the bar's
// fill and nothing else.
describe('landingTile', () => {
  it('says Copying and draws the bar at the percent', () => {
    expect(landingTile(40)).toEqual({ caption: 'Copying…', pct: 40, fill: '40%' })
  })

  it('a tick changes the fill and the percent only', () => {
    const a = landingTile(10)
    const b = landingTile(55)
    expect(b.caption).toBe(a.caption)
    expect(b.fill).not.toBe(a.fill)
  })

  it('is clamped to a bar that can be drawn', () => {
    expect(landingTile(-5).fill).toBe('0%')
    expect(landingTile(180).fill).toBe('100%')
    expect(landingTile(Number.NaN).fill).toBe('0%')
    expect(landingTile(undefined).fill).toBe('0%')
  })

  it('reads whole percents', () => {
    expect(landingTile(33.6).pct).toBe(34)
  })
})
