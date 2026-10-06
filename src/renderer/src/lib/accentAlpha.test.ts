import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alphaHex, composite, parseColour, selectionFor, withAlpha } from 'prism-term-core/renderer/lib/colour'
import { accentAlphaOf, fillOf } from './accentAlpha'
import { RETIRED_STYLES } from './themes/retired'
import { cleanDraft, derive, selectionBg, STYLES, variablesFor, type Style } from './theme'

// THE ACCENT CAN BE SEE-THROUGH (#249). The alpha reaches the fills; every
// derivation is handed the colour as seen; the selection's label clears 4.5:1
// on the selection as it is actually drawn.

const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1, 7), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** The opaque colour a token (hex, hex8 or rgba) shows over `ground`. */
const seenOn = (token: string, ground: string): string => {
  const p = parseColour(token)
  return p && p.a < 1 ? composite(token, ground) : token
}
const HEX8 = /^#[0-9a-f]{8}$/

const paletteHex = (s: Style): string => derive(s)['--p-accent']
const aurora = STYLES.find((s) => s.id === 'aurora')!
const paper = STYLES.find((s) => s.id === 'paper')!
const ruby = RETIRED_STYLES.find((s) => s.id === 'acrylic-red')!
const frost = STYLES.find((s) => s.id === 'frost')!

// The hex field itself is the core's ColourField now (its parsing is tested
// in prism-term-core); what is Prism's is the call site: the accent's alpha
// is written into the field as two more digits, and read back the same.
describe('the accent field shows the opacity as two more digits', () => {
  it('a stored alpha is a whole 1/255 step, so it reads back as typed', () => {
    for (const byte of [0x1a, 0x66, 0x81, 0xc0, 0xfe]) {
      const a = accentAlphaOf(byte / 255)
      const hex = byte.toString(16).padStart(2, '0')
      expect(alphaHex(a)).toBe(hex)
      expect(withAlpha('#4682fb', a)).toBe('#4682fb' + hex)
    }
  })
  it('solid shows six digits', () => {
    expect(withAlpha('#4682fb', accentAlphaOf(1))).toBe('#4682fb')
  })
})

describe('an opacity read from anywhere is made safe', () => {
  it('missing or nonsense reads as solid, the rest is held to a tenth .. 1', () => {
    for (const v of [undefined, null, 'x', NaN, Infinity, {}]) expect(accentAlphaOf(v)).toBe(1)
    // The floor is the first whole 1/255 step at or above a tenth.
    expect(accentAlphaOf(0)).toBe(26 / 255)
    expect(accentAlphaOf(-3)).toBe(26 / 255)
    expect(accentAlphaOf(7)).toBe(1)
    expect(accentAlphaOf(0.4)).toBe(0.4)
    expect(accentAlphaOf(0.5)).toBe(128 / 255)
  })
  it('a draft drops an opacity that is not a number and clamps the rest', () => {
    expect(cleanDraft({ accent: '#123456', accentAlpha: 'half' as unknown as number })).toEqual({ accent: '#123456' })
    expect(cleanDraft({ accentAlpha: 0.01 })).toEqual({ accentAlpha: 26 / 255 })
    expect(cleanDraft({ accentAlpha: 0.5 })).toEqual({ accentAlpha: 128 / 255 })
  })
})

describe('compositing over the ground', () => {
  it('is the ground at none and the colour at all of it', () => {
    expect(composite('#ff0000', '#000000')).toBe('#ff0000')
    expect(composite('#ff000066', '#000000')).toBe('#660000')
    expect(composite('#00000080', '#ffffff')).toBe('#7f7f7f')
  })
  it('a fill is the plain hex when solid and hex8 below, never rgba', () => {
    expect(fillOf('#4682fb', 1)).toBe('#4682fb')
    expect(fillOf('#4682fb', 0.4)).toBe('#4682fb66')
  })
})

describe('every style looks as it did at 100%', () => {
  it('an opacity of 1 and none at all publish the same tokens', () => {
    for (const s of STYLES) expect(derive({ ...s, accentAlpha: 1 })).toEqual(derive(s))
  })
  it('and the accent is still a plain hex', () => {
    for (const s of STYLES) expect(derive(s)['--p-accent']).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('the selected label reads on the selection as seen', () => {
  const cases: Array<[string, Style]> = [
    ['dark', aurora],
    ['light', paper],
    ['dark red', ruby],
    ['light teal', frost]
  ]
  for (const [name, style] of cases) {
    for (const alpha of [0.1, 0.4, 0.75]) {
      it(`${name} at ${alpha * 100}%`, () => {
        const t = derive({ ...style, accentAlpha: alpha })
        expect(t['--p-sel-bg']).toMatch(HEX8)
        expect(t['--p-accent']).toMatch(HEX8)
        const ground = t['--p-bg']
        const seen = seenOn(t['--p-sel-bg'], ground)
        expect(contrast(t['--p-on-accent'], seen)).toBeGreaterThanOrEqual(4.5)
        // Text, links and rings stay opaque hex whatever the fills do.
        expect(t['--p-accent-hi']).toMatch(/^#[0-9a-f]{6}$/i)
        expect(t['--p-accent-solid']).toMatch(/^#[0-9a-f]{6}$/i)
        expect(t['--p-sel-knockout']).toBe(seen)
      })
    }
  }
  it('on a sidebar of its own colour too', () => {
    const own: Style = { ...aurora, side: '#2a3142', sideOwn: true, accentAlpha: 0.4 }
    const t = derive(own)
    for (const g of [aurora.bg, '#2a3142'])
      expect(contrast(t['--p-on-accent'], seenOn(t['--p-sel-bg'], g))).toBeGreaterThanOrEqual(4.5)
  })
  it('grounds too far apart for one ink get the pair whose worse side reads best', () => {
    // Black beside a pale grey at 40%: neither ink can clear 4.5 on both.
    const grounds = ['#0b0d12', '#e8e8e8']
    const { fill, ink } = selectionFor('#4682fb66', grounds)
    const worst = Math.min(...grounds.map((g) => contrast(ink, composite(withAlpha(fill, 0.4), g))))
    expect(worst).toBeGreaterThan(3)
  })
})

// Buttons and chips print --p-on-accent on --p-accent (#249 review): with the
// raw accent see-through there, Frost at 80% gave 3.78:1. The fill below 100%
// is the selection's, so the one ink reads on both, on every ground a button
// sits on (the viewer, and the sidebar's flat colour a dialog box wears).
describe('a button label reads on the accent fill as seen', () => {
  for (const base of STYLES) {
    for (const s of [base, { ...base, material: 'tinted' as const }, { ...base, accent: '#5b5bd6' }]) {
      it(`${base.id} ${s.material} ${s.accent}`, () => {
        for (const alpha of [0.1, 0.25, 0.4, 0.6, 0.8, 0.95]) {
          const t = variablesFor({ ...s, accentAlpha: alpha }, true)
          for (const g of [t['--p-bg'], t['--p-side-flat']]) {
            const seen = seenOn(t['--p-accent'], g)
            expect(contrast(t['--p-on-accent'], seen), `${alpha} on ${g}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      })
    }
  }
})

describe('an icon knockout matches the row it sits on', () => {
  it('a sidebar row of its own colour gets its own knockout', () => {
    const own: Style = { ...aurora, side: '#2a3142', sideOwn: true, accentAlpha: 0.4 }
    const t = derive(own)
    expect(t['--p-sel-knockout-side']).toBe(seenOn(t['--p-sel-bg'], '#2a3142'))
    expect(t['--p-sel-knockout']).toBe(seenOn(t['--p-sel-bg'], t['--p-bg']))
  })
  it('the browse list knockout is the selection as seen, and the selection itself at 100%', () => {
    const t = derive({ ...aurora, accentAlpha: 0.4 })
    expect(t['--p-sel-seen']).toBe(seenOn(t['--p-sel-bg'], t['--p-bg']))
    expect(t['--p-sel-seen']).toMatch(/^#[0-9a-f]{6}$/i)
    for (const s of STYLES) {
      const solid = derive(s)
      expect(solid['--p-sel-seen']).toBe(selectionBg(paletteHex(s)))
      expect(solid['--p-sel-knockout-side']).toBe(solid['--p-accent'])
    }
  })
})

describe('the opacity is stored with the style', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('is an edit, saved in the draft, kept by a saved preset, and read back', async () => {
    const theme = await import('./theme')
    expect(theme.isEdited()).toBe(false)
    theme.setAccentAlpha(0.4)
    expect(theme.isEdited()).toBe(true)
    expect(JSON.parse(localStorage.getItem('prism.style.draft')!)).toEqual({ accentAlpha: 0.4 })
    // Any alpha lands on a whole 1/255 step.
    theme.setAccentAlpha(0.333)
    expect(JSON.parse(localStorage.getItem('prism.style.draft')!).accentAlpha).toBe(85 / 255)
    theme.setAccentAlpha(0.4)
    theme.savePreset()
    const saved = JSON.parse(localStorage.getItem('prism.style.presets')!) as Style[]
    expect(saved[0].accentAlpha).toBe(0.4)
    vi.resetModules()
    const again = await import('./theme')
    const back = again.allStyles().find((s) => s.id === saved[0].id)!
    expect(accentAlphaOf(back.accentAlpha)).toBe(0.4)
  })

  it('a style saved before the opacity existed reads as solid', async () => {
    const old = { ...aurora, id: 'custom-old', name: 'Custom theme 1', custom: true } as Style
    delete old.accentAlpha
    localStorage.setItem('prism.style.presets', JSON.stringify([old]))
    localStorage.setItem('prism.style', 'custom-old')
    const theme = await import('./theme')
    const s = theme.allStyles().find((x) => x.id === 'custom-old')!
    expect(accentAlphaOf(s.accentAlpha)).toBe(1)
    expect(theme.isEdited()).toBe(false)
  })

  it('nonsense in a stored draft is not an edit', async () => {
    localStorage.setItem('prism.style.draft', JSON.stringify({ accentAlpha: 'lots' }))
    const theme = await import('./theme')
    expect(theme.isEdited()).toBe(false)
  })

  it("putting the style's own opacity back, or Reset, is no edit", async () => {
    const theme = await import('./theme')
    theme.setAccentAlpha(0.5)
    theme.setAccentAlpha(1)
    expect(theme.isEdited()).toBe(false)
    theme.setOverride('accent', '#ff0000')
    theme.setAccentAlpha(0.3)
    theme.resetAccent()
    expect(theme.isEdited()).toBe(false)
    expect(JSON.parse(localStorage.getItem('prism.style.draft')!)).toEqual({})
  })
})
