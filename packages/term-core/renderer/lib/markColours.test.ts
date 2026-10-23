import { describe, expect, it } from 'vitest'
import { ICON_RAINBOW, floorMark, opaqueOver, rainbowFillX, rainbowGradient, rainbowOn } from './markColours'
import { contrastRatio, mixHex } from './termAnsi'
import { rgbToHsl, parseColour } from './colour'

const minOn = (c: string, grounds: string[]): number => Math.min(...grounds.map((g) => contrastRatio(c, g)))
const hue = (c: string): number => rgbToHsl(parseColour(c)!).h

// Volt and Paper as the mockups computed them: the strip, and the two Prompt
// segments (the text mixed into the strip at 4% and 11%).
const VOLT = ['#050706', mixHex('#050706', '#eef2e6', 0.04), mixHex('#050706', '#eef2e6', 0.11)]
const PAPER = ['#f6f4ee', mixHex('#f6f4ee', '#2a2620', 0.04), mixHex('#f6f4ee', '#2a2620', 0.11)]

describe('the rainbow of the app icon (#143)', () => {
  it('is the seven colours of build/icon-source.png, in order', () => {
    expect(ICON_RAINBOW).toEqual(['#12cee5', '#2179fa', '#945af5', '#e84fd2', '#fb7f6c', '#f0a934', '#e8d021'])
  })

  it('leaves every colour alone where it already clears 3:1 (Volt)', () => {
    for (const c of ICON_RAINBOW) expect(floorMark(c, VOLT, 3)).toBe(c)
    expect(Math.min(...rainbowOn(VOLT).map((c) => minOn(c, VOLT)))).toBeGreaterThan(3.8)
  })

  it('darkens what falls short on Paper until it clears 3:1 on every ground, keeping its hue', () => {
    for (const c of ICON_RAINBOW) {
      const m = floorMark(c, PAPER, 3)
      expect(minOn(m, PAPER), `${c} -> ${m}`).toBeGreaterThanOrEqual(3)
      const dh = Math.abs(hue(m) - hue(c))
      expect(Math.min(dh, 360 - dh), `${c} -> ${m}`).toBeLessThanOrEqual(2)
    }
    // The mockup's own table: the closest is just over the floor, not far past it.
    expect(Math.min(...rainbowOn(PAPER).map((c) => minOn(c, PAPER)))).toBeLessThan(3.2)
  })

  it('LIGHTENS a short colour on a dark mid grey, never darkens it', () => {
    const cinder = ['#383c44']
    const m = floorMark('#2179fa', cinder, 3)
    expect(minOn(m, cinder)).toBeGreaterThanOrEqual(3)
    expect(parseColour(m)!.r).toBeGreaterThan(parseColour('#2179fa')!.r)
  })

  it('hands back the nearest it got when the floor cannot be reached, and never throws', () => {
    const grey = ['#777777']
    expect(() => floorMark('#7a7a7a', grey, 21)).not.toThrow()
    const m = floorMark('#7a7a7a', grey, 21)
    expect(minOn(m, grey)).toBeGreaterThan(minOn('#7a7a7a', grey))
  })

  it('loops its gradient, along x or down y', () => {
    expect(rainbowGradient(['#111111', '#222222'], 'x')).toBe('linear-gradient(90deg, #111111, #222222, #111111)')
    expect(rainbowGradient(['#111111', '#222222'], 'y')).toBe('linear-gradient(180deg, #111111, #222222, #111111)')
  })

  it('lays the icon\'s seven, raw, across a whole fill as a looping gradient', () => {
    expect(rainbowFillX()).toBe(`linear-gradient(90deg, ${[...ICON_RAINBOW, ICON_RAINBOW[0]].join(', ')})`)
  })

  it('makes a see-through colour opaque over the solid ground, for Full', () => {
    expect(opaqueOver('#d8ff2680', '#050706')).toMatch(/^#[0-9a-f]{6}$/)
    expect(opaqueOver('#d8ff2680', '#050706')).toBe(mixHex('#050706', '#d8ff26', 0x80 / 255))
    expect(opaqueOver('#d8ff26', '#050706')).toBe('#d8ff26')
  })
})
