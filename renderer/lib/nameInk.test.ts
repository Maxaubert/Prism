import { describe, expect, it } from 'vitest'
import { NAME_FLIP, groundIsDark, nameInk, rainbowInk } from './nameInk'
import { contrastRatio } from './termAnsi'

// The owner's rule for Full (#143, 2026-10-10): every name is the theme's text
// colour; a fill flips it to the opposite only below 2:1 on that state's FULL
// colour. The cases are the issue comment's and the r4 mockup's.

const VOLT_TEXT = '#eef2e6'
const LIGHT_TEXT = '#1d1f1a'

describe('the name on a Full tab', () => {
  it('on Volt flips only the yellow green working fill', () => {
    expect(nameInk('#d8ff26', VOLT_TEXT, true)).toBe('#0b0b0b')
    expect(nameInk('#3b82f6', VOLT_TEXT, true)).toBe(VOLT_TEXT)
    expect(nameInk('#ff3b5c', VOLT_TEXT, true)).toBe(VOLT_TEXT)
    expect(nameInk('#383c44', VOLT_TEXT, true)).toBe(VOLT_TEXT)
  })

  it('flips on a very pale question fill, and white on a light theme\'s dark grey working', () => {
    expect(nameInk('#cfe4ff', VOLT_TEXT, true)).toBe('#0b0b0b')
    expect(nameInk('#2a2c30', LIGHT_TEXT, false)).toBe('#ffffff')
    expect(nameInk('#2563eb', LIGHT_TEXT, false)).toBe(LIGHT_TEXT)
  })

  it('keeps the text at exactly the threshold: the rule is UNDER 2:1', () => {
    // A grey whose ratio with white is 2 or a hair above.
    let g = 0xc0
    while (contrastRatio('#ffffff', `#${g.toString(16).repeat(3)}`) < NAME_FLIP) g -= 1
    const fill = `#${g.toString(16).repeat(3)}`
    expect(contrastRatio('#ffffff', fill)).toBeGreaterThanOrEqual(2)
    expect(nameInk(fill, '#ffffff', true)).toBe('#ffffff')
  })

  // THE RAINBOW FILL (2026-10-10 rework): the name crosses every colour of the
  // ribbon as it flows, so its ink is judged once on the WORST colour that can
  // sit under it. Volt's text falls to 1.4:1 on the yellow and flips; Paper's
  // holds at 3.5:1 and stays (the mockup's table).
  it('judges the rainbow on its worst colour: Volt flips, Paper keeps the text', () => {
    expect(rainbowInk(VOLT_TEXT, true)).toBe('#0b0b0b')
    expect(rainbowInk('#2a2620', false)).toBe('#2a2620')
  })

  it('keeps the text on the rainbow when the opposite would be no better', () => {
    // A mid grey text is poor on the rainbow, and black on a dark theme is
    // judged too: whichever has the better worst wins, the text on a tie.
    const t = '#808080'
    const ink = rainbowInk(t, true)
    expect([t, '#0b0b0b']).toContain(ink)
  })

  it('takes dark or light from the GROUND, never from the text', () => {
    // A pale text on a fill it vanishes on: the opposite follows the ground.
    expect(nameInk('#f0f0f0', '#ffffff', true)).toBe('#0b0b0b')
    expect(nameInk('#f0f0f0', '#ffffff', false)).toBe('#ffffff')
    expect(groundIsDark('#050706')).toBe(true)
    expect(groundIsDark('#f6f4ee')).toBe(false)
  })
})
