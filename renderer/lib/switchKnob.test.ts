import { describe, expect, it } from 'vitest'
import { KNOB_DARK, KNOB_LIGHT, switchKnob } from './switchKnob'
import { contrastRatio } from './termAnsi'

// THE ON SWITCH'S KNOB (owner, 2026-10-10: "keep that to being black on dark
// themes and white on light themes ... only when the color is very close"):
// black on a dark theme, white on a light one, the theme measured off the
// ground; the opposite only where that reads under 2:1 on the ON track.
describe('the on switch knob', () => {
  it('is black on a dark theme and white on a light one', () => {
    // PT Default's orange, Volt's yellow-green on dark; a mid blue on Paper.
    expect(switchKnob('#fe8f34', true)).toBe(KNOB_DARK)
    expect(switchKnob('#d8ff26', true)).toBe(KNOB_DARK)
    expect(switchKnob('#3a73a0', false)).toBe(KNOB_LIGHT)
  })

  it('flips on a very light accent on a light theme: black', () => {
    expect(contrastRatio(KNOB_LIGHT, '#cfe4ff')).toBeLessThan(2)
    expect(switchKnob('#cfe4ff', false)).toBe(KNOB_DARK)
  })

  it('flips on a very dark accent on a dark theme: white', () => {
    expect(contrastRatio(KNOB_DARK, '#2a2c30')).toBeLessThan(2)
    expect(switchKnob('#2a2c30', true)).toBe(KNOB_LIGHT)
  })

  it('keeps the default at exactly 2:1: the rule is UNDER 2:1', () => {
    let g = 0
    const grey = (n: number): string => `#${n.toString(16).padStart(2, '0').repeat(3)}`
    while (contrastRatio(KNOB_DARK, grey(g)) < 2) g += 1
    expect(switchKnob(grey(g), true)).toBe(KNOB_DARK)
    expect(switchKnob(grey(g - 1), true)).toBe(KNOB_LIGHT)
  })
})
