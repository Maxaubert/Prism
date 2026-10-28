import { describe, expect, it } from 'vitest'
import { thumbFor } from './overlayScroll'

const m = {
  scrollTop: 0,
  scrollLeft: 0,
  scrollHeight: 1000,
  scrollWidth: 300,
  clientHeight: 250,
  clientWidth: 300
}

describe('thumbFor', () => {
  it('sizes the thumb by the share in view, at least 28 px', () => {
    expect(thumbFor(m, 'y')).toEqual({ scrollable: true, start: 0, size: 62.5 })
    expect(thumbFor({ ...m, scrollHeight: 100_000 }, 'y').size).toBe(28)
  })
  it('places it by how far the content has scrolled', () => {
    expect(thumbFor({ ...m, scrollTop: 750 }, 'y').start).toBeCloseTo(250 - 62.5)
    expect(thumbFor({ ...m, scrollTop: 375 }, 'y').start).toBeCloseTo((250 - 62.5) / 2)
  })
  it('draws nothing for an axis that does not scroll', () => {
    expect(thumbFor(m, 'x').scrollable).toBe(false)
    expect(thumbFor({ ...m, scrollWidth: 900 }, 'x').scrollable).toBe(true)
  })
})
