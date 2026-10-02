import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accentAlphaOf, alphaHex, composite, fillOf, parseHexAlpha } from './accentAlpha'
import { cleanDraft, derive, selectionFor, STYLES, type Style } from './theme'

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
/** The opaque colour an `rgba(...)` or hex token shows over `ground`. */
const seenOn = (token: string, ground: string): string => {
  const m = token.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/)
  if (!m) return token
  const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
  return composite(hex, Number(m[4]), ground)
}

const aurora = STYLES.find((s) => s.id === 'aurora')!
const paper = STYLES.find((s) => s.id === 'paper')!
const ruby = STYLES.find((s) => s.id === 'acrylic-red')!
const frost = STYLES.find((s) => s.id === 'frost')!

describe('the hex field takes an opacity', () => {
  it('reads eight digits as colour and alpha', () => {
    expect(parseHexAlpha('#4682fb66')).toEqual({ hex: '#4682fb', alpha: 0x66 / 255 })
    expect(parseHexAlpha('4682FBFF')).toEqual({ hex: '#4682fb', alpha: 1 })
  })
  it('reads four digits as the short form of eight', () => {
    expect(parseHexAlpha('#f008')).toEqual({ hex: '#ff0000', alpha: 0x88 / 255 })
  })
  it('six and three digits name a colour and leave the opacity alone', () => {
    expect(parseHexAlpha('#4682fb')).toEqual({ hex: '#4682fb', alpha: null })
    expect(parseHexAlpha('abc')).toEqual({ hex: '#aabbcc', alpha: null })
  })
  it('refuses anything else', () => {
    for (const bad of ['', '#12', '#12345', '#1234567', '#123456789', 'zzzzzz', '#4682fg'])
      expect(parseHexAlpha(bad), bad).toBeNull()
  })
  it('shows an opacity back as two digits', () => {
    expect(alphaHex(0.4)).toBe('66')
    expect(alphaHex(1)).toBe('ff')
  })
})

describe('an opacity read from anywhere is made safe', () => {
  it('missing or nonsense reads as solid, the rest is held to a tenth .. 1', () => {
    for (const v of [undefined, null, 'x', NaN, Infinity, {}]) expect(accentAlphaOf(v)).toBe(1)
    expect(accentAlphaOf(0)).toBe(0.1)
    expect(accentAlphaOf(-3)).toBe(0.1)
    expect(accentAlphaOf(7)).toBe(1)
    expect(accentAlphaOf(0.4)).toBe(0.4)
  })
  it('a draft drops an opacity that is not a number and clamps the rest', () => {
    expect(cleanDraft({ accent: '#123456', accentAlpha: 'half' as unknown as number })).toEqual({ accent: '#123456' })
    expect(cleanDraft({ accentAlpha: 0.01 })).toEqual({ accentAlpha: 0.1 })
    expect(cleanDraft({ accentAlpha: 0.5 })).toEqual({ accentAlpha: 0.5 })
  })
})

describe('compositing over the ground', () => {
  it('is the ground at none and the colour at all of it', () => {
    expect(composite('#ff0000', 1, '#000000')).toBe('#ff0000')
    expect(composite('#ff0000', 0.4, '#000000')).toBe('#660000')
    expect(composite('#000000', 0.5, '#ffffff')).toBe('#808080')
  })
  it('a fill is the plain hex when solid and rgba below', () => {
    expect(fillOf('#4682fb', 1)).toBe('#4682fb')
    expect(fillOf('#4682fb', 0.4)).toBe('rgba(70,130,251,0.4)')
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
        expect(t['--p-sel-bg']).toMatch(/^rgba\(/)
        expect(t['--p-accent']).toMatch(/^rgba\(/)
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
    const { fill, ink } = selectionFor('#4682fb', 0.4, grounds)
    const worst = Math.min(...grounds.map((g) => contrast(ink, composite(fill, 0.4, g))))
    expect(worst).toBeGreaterThan(3)
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
