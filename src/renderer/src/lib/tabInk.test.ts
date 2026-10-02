import { describe, expect, it } from 'vitest'
import { contrastRatio } from 'prism-term-core/renderer/lib/termAnsi'
import { tabInk, tintOver } from './tabInk'

describe('tintOver', () => {
  it('leaves an opaque tint alone, whatever the ground', () => {
    expect(tintOver('#ec9448', '#101010')).toBe('#ec9448')
    expect(tintOver('#EC9448', '')).toBe('#ec9448')
    expect(tintOver('#f80', '#000000')).toBe('#ff8800')
  })

  it('lays a see-through tint on the ground', () => {
    expect(tintOver('#ffffff80', '#000000')).toBe('#808080')
    expect(tintOver('#ff000000', '#123456')).toBe('#123456')
    expect(tintOver('#ff0000ff', '#123456')).toBe('#ff0000')
    expect(tintOver('#fff8', '#000000')).toBe('#888888')
  })

  it('reads a ground it cannot use as no ground: the tint as solid', () => {
    expect(tintOver('#ffffff80', 'rgba(0,0,0,0.5)')).toBe('#ffffff')
    expect(tintOver('#ffffff80', '')).toBe('#ffffff')
  })
})

describe('tabInk', () => {
  it('is what it always was for an opaque tint', () => {
    // The white bias: white on the default orange, black only on a light fill.
    expect(tabInk('#ec9448', '#101010')).toBe('#ffffff')
    expect(tabInk('#f5f5f5', '#101010')).toBe('#000000')
  })

  it('chooses on the composite, not on the tint as if it were solid', () => {
    // A light tint at a quarter over a dark strip reads dark: solid it would
    // take black, which on the composite is unreadable.
    expect(tabInk('#f5f5f5', '#101010')).toBe('#000000')
    const tint = '#f5f5f540'
    const ink = tabInk(tint, '#101010')
    expect(ink).toBe('#ffffff')
    expect(contrastRatio(ink, tintOver(tint, '#101010'))).toBeGreaterThanOrEqual(4.5)
  })

  it('holds 4.5:1 for a half see-through accent over a dark strip', () => {
    for (const accent of ['#ec9448', '#3b82f6', '#22c55e', '#a855f7', '#ef4444']) {
      const tint = accent + '80'
      const ink = tabInk(tint, '#121212')
      expect(contrastRatio(ink, tintOver(tint, '#121212'))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
