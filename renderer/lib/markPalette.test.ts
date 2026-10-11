import { describe, expect, it } from 'vitest'
import { ICON_RAINBOW } from './markColours'
import { markPalette } from './markPalette'
import { contrastRatio, mixHex } from './termAnsi'

// Volt as the r4 mockup computed it.
const VOLT = { working: '#d8ff26', finished: '#22c55e', question: '#3b82f6', failed: '#ff3b5c' }
const GROUND = '#050706'
const TEXT = '#eef2e6'
// Paper, the light row of the 2026-10-10 full-style mockup.
const PAPER = { working: '#3f8ccb', finished: '#1b9a49', question: '#3b82f6', failed: '#e05561' }
const PAPER_GROUND = '#f6f4ee'
const PAPER_TEXT = '#2a2620'

const volt = (rainbow = true) => markPalette({ colours: VOLT, grounds: [GROUND], solidGround: GROUND, text: TEXT, rainbow })
const paper = (rainbow = true) =>
  markPalette({ colours: PAPER, grounds: [PAPER_GROUND], solidGround: PAPER_GROUND, text: PAPER_TEXT, rainbow })

describe('the marks palette (#143)', () => {
  it('leaves Volt\'s bright marks as they are, and floors every line to 3:1 on the ground', () => {
    const p = volt()
    expect(p.line.working).toBe('#d8ff26')
    for (const c of Object.values(p.line)) expect(contrastRatio(c, GROUND)).toBeGreaterThanOrEqual(3)
  })

  it('names Volt\'s Full inks by the owner\'s rule: working and the rainbow flip', () => {
    expect(volt().ink).toEqual({ working: '#0b0b0b', done: '#0b0b0b', question: TEXT, failed: TEXT })
    // With the rainbow off, finished is the green fill, where the text holds.
    expect(volt(false).ink.done).toBe(TEXT)
  })

  it('keeps Paper\'s text on every fill, the rainbow included', () => {
    expect(paper().ink).toEqual({ working: PAPER_TEXT, done: PAPER_TEXT, question: PAPER_TEXT, failed: PAPER_TEXT })
  })

  it('fills finished with the icon\'s seven, raw, while the rainbow is on', () => {
    const on = volt().fill.done
    expect(on.startsWith('linear-gradient(90deg, ')).toBe(true)
    for (const c of ICON_RAINBOW) expect(on).toContain(c)
    expect(volt(false).fill.done).toBe('#22c55e')
  })

  it('fills SOLID: a half-alpha working colour is laid on the ground first', () => {
    const p = markPalette({ colours: { ...VOLT, working: '#d8ff2680' }, grounds: [GROUND], solidGround: GROUND, text: TEXT, rainbow: true })
    expect(p.fill.working).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.fill.working).toBe(mixHex(GROUND, '#d8ff26', 0x80 / 255))
  })

  // THE WORKING MARK ON THE WORKING FILL (owner, 2026-10-10: "if the tab is
  // yellow ... the working bar that is on that tab, like the minimal bar,
  // should be black and not like a faded arc yellow"). Classic's run is the
  // NAME'S ink; Prompt's edge sits in the ground-coloured gap, where black
  // would vanish on a dark theme, so it keeps the shade (variant 2A).
  it('draws Classic\'s run on a working fill in the name\'s ink', () => {
    expect(volt().overlay.run).toBe('#0b0b0b')
    expect(volt().overlay.run).toBe(volt().ink.working)
    expect(paper().overlay.run).toBe(PAPER_TEXT)
  })

  it('loops both rainbow gradients', () => {
    const p = volt()
    expect(p.rainbowX.startsWith('linear-gradient(90deg, #12cee5')).toBe(true)
    expect(p.rainbowY.startsWith('linear-gradient(180deg, #12cee5')).toBe(true)
    expect(p.rainbowX.endsWith('#12cee5)')).toBe(true)
  })
})
