import { describe, expect, it } from 'vitest'
import { contrastRatio, luminance as coreLuminance, mixHex } from 'prism-term-core/renderer/lib/colourMath'
import { contrast, hexToRgb, luminance, mix, rgbToHex } from './colour'

describe('colour maths', () => {
  it('reads three, six and eight digits, the first six only', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#4682fb')).toEqual([70, 130, 251])
    // An alpha never shifts into the channels (the visualizer's old bug).
    expect(hexToRgb('#4682fb80')).toEqual([70, 130, 251])
  })

  it('writes six digits, rounded', () => {
    expect(rgbToHex([70, 130, 251])).toBe('#4682fb')
    expect(rgbToHex([0.4, 254.6, 15])).toBe('#00ff0f')
  })

  it("mix, luminance and contrast are the core's, not a copy (2026-10-28)", () => {
    expect(mix).toBe(mixHex)
    expect(luminance).toBe(coreLuminance)
    expect(contrast).toBe(contrastRatio)
  })

  it('mixes channel by channel', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030')
  })

  it('luminance and contrast are WCAG', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
})
