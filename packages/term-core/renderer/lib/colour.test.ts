import { describe, expect, it } from 'vitest'
import {
  alphaHex,
  alphaPct,
  saysAlpha,
  snapAlphaStep,
  alphaOf,
  colourCommit,
  composite,
  format,
  hslToRgb,
  hsvToRgb,
  inkOn,
  legibleOn,
  legibleOnStrict,
  opaque,
  parseColour,
  rgbToHsl,
  rgbToHsv,
  selectionFor,
  toStored,
  withAlpha,
  type Rgba
} from './colour'
import { contrastRatio } from './termAnsi'

const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a })

describe('parseColour', () => {
  it('reads every hex form, with or without the hash', () => {
    expect(parseColour('#abc')).toEqual(rgba(0xaa, 0xbb, 0xcc))
    expect(parseColour('abc')).toEqual(rgba(0xaa, 0xbb, 0xcc))
    expect(parseColour('#abcd')).toEqual(rgba(0xaa, 0xbb, 0xcc, 0xdd / 255))
    expect(parseColour('#AABBCC')).toEqual(rgba(0xaa, 0xbb, 0xcc))
    expect(parseColour('aabbcc80')).toEqual(rgba(0xaa, 0xbb, 0xcc, 0x80 / 255))
  })
  it('reads rgb and rgba in comma and space syntax, alpha as a fraction or a percentage', () => {
    expect(parseColour('rgb(1, 2, 3)')).toEqual(rgba(1, 2, 3))
    expect(parseColour('rgba(1,2,3,0.5)')).toEqual(rgba(1, 2, 3, 0.5))
    expect(parseColour('rgba(1, 2, 3, 50%)')).toEqual(rgba(1, 2, 3, 0.5))
    expect(parseColour('rgb(1 2 3 / 0.25)')).toEqual(rgba(1, 2, 3, 0.25))
    expect(parseColour('RGBA(1 2 3 / 25%)')).toEqual(rgba(1, 2, 3, 0.25))
  })
  it('reads hsl and hsla, hue in deg or unitless', () => {
    expect(toStored(parseColour('hsl(0, 100%, 50%)')!)).toBe('#ff0000')
    expect(toStored(parseColour('hsl(120deg 100% 25%)')!)).toBe('#008000')
    expect(toStored(parseColour('hsla(240, 100%, 50%, 0.5)')!)).toBe('#0000ff80')
    expect(toStored(parseColour('hsl(240 100% 50% / 50%)')!)).toBe('#0000ff80')
  })
  it('rejects what is not a colour', () => {
    for (const bad of ['', '   ', '#12345', '#1234567', 'rgb(300,0,0)', 'rgb(1,2)', 'rgba(1,2,3,2)', 'hsl(200, 50, 40)', 'hsl(200, 50%, 40)', 'red', 'rgb(1,2,3', '#ggg'])
      expect(parseColour(bad), bad).toBeNull()
  })
})

describe('toStored and format', () => {
  it('is six lower-case digits when opaque and eight otherwise', () => {
    expect(toStored(rgba(0xaa, 0xbb, 0xcc))).toBe('#aabbcc')
    expect(toStored(rgba(0xaa, 0xbb, 0xcc, 0.5))).toBe('#aabbcc80')
    expect(toStored(rgba(0, 0, 0, 0))).toBe('#00000000')
  })
  it('shows each format', () => {
    const c = rgba(59, 130, 246, 0.5)
    expect(format(c, 'hex')).toBe('#3b82f680')
    expect(format(c, 'rgba')).toBe('rgba(59, 130, 246, 0.5)')
    expect(format(c, 'hsla')).toMatch(/^hsla\(217, 91%, 60%, 0\.5\)$/)
    expect(format(rgba(255, 0, 0), 'hex')).toBe('#ff0000')
  })
  it('every typed alpha byte reads back as itself', () => {
    for (let a = 0; a < 256; a += 1) {
      const s = '#123456' + a.toString(16).padStart(2, '0')
      expect(toStored(parseColour(s)!)).toBe(a === 255 ? '#123456' : s)
    }
  })
})

describe('round trips', () => {
  const steps = [0, 51, 102, 153, 204, 255]
  it('hex8 to Rgba to hex8, and Rgba to numeric Hsla and back, are exact', () => {
    for (const r of steps)
      for (const g of steps)
        for (const b of steps)
          for (let a = 0; a < 256; a += 1) {
            const hex = toStored(rgba(r, g, b, a / 255))
            const c = parseColour(hex)!
            expect(toStored(c)).toBe(hex)
            expect(toStored(hslToRgb(rgbToHsl(c)))).toBe(hex)
          }
  })
  it('hsv to rgb to hsv within half a unit', () => {
    for (let h = 0; h < 360; h += 30)
      for (const s of [20, 50, 100])
        for (const v of [30, 60, 100]) {
          const back = rgbToHsv(hsvToRgb({ h, s, v, a: 1 }))
          expect(Math.abs(back.h - h)).toBeLessThan(0.5)
          expect(Math.abs(back.s - s)).toBeLessThan(0.5)
          expect(Math.abs(back.v - v)).toBeLessThan(0.5)
        }
  })
  it('a shown string re-parses to a colour colourCommit calls the same', () => {
    for (const r of steps)
      for (const g of steps)
        for (const a of [0, 1, 37, 127, 128, 200, 255]) {
          const value = toStored(rgba(r, g, 77, a / 255))
          for (const f of ['hex', 'rgba', 'hsla'] as const) {
            const shown = format(parseColour(value)!, f)
            expect(parseColour(shown), shown).not.toBeNull()
            expect(colourCommit(shown, value), `${f} ${shown}`).toBeNull()
          }
        }
  })
})

describe('helpers', () => {
  it('alphaHex is round(a * 255) in two digits, no clamp', () => {
    expect(alphaHex(1)).toBe('ff')
    expect(alphaHex(0)).toBe('00')
    expect(alphaHex(0.5)).toBe('80')
    expect(alphaHex(0.3)).toBe('4d')
  })
  it('opaque, alphaOf and withAlpha', () => {
    expect(opaque('#aabbcc80')).toBe('#aabbcc')
    expect(opaque('junk', '#010203')).toBe('#010203')
    expect(alphaOf('#aabbcc80')).toBeCloseTo(0x80 / 255)
    expect(alphaOf('#aabbcc')).toBe(1)
    expect(withAlpha('#aabbcc', 0.5)).toBe('#aabbcc80')
    expect(withAlpha('#aabbcc80', 1)).toBe('#aabbcc')
  })
})

describe('composite', () => {
  it('alpha 0 is the ground and alpha 1 the colour', () => {
    expect(composite('#ff000000', '#102030')).toBe('#102030')
    expect(composite('#ff0000', '#102030')).toBe('#ff0000')
    expect(composite('#ffffff80', '#000000')).toBe('#808080')
  })
})

describe('legibleOn', () => {
  it('at alpha 1 returns the pick unchanged, even one that fails the floor', () => {
    expect(legibleOn('#222222', '#111111', 4.5)).toBe('#222222')
    expect(legibleOn('#d7dae1', '#0b0b0f', 4.5)).toBe('#d7dae1')
  })
  it('is never less legible than the opaque pick, up to the floor', () => {
    for (const ground of ['#0b0b0f', '#ffffff', '#3c3c64', '#808080'])
      for (const pick of ['#e05561', '#d7dae1', '#4aa5f0', '#222222', '#fafafa'])
        for (let a = 1; a <= 10; a += 1) {
          const c = withAlpha(pick, a / 10)
          const want = Math.min(4.5, contrastRatio(pick, ground))
          expect(contrastRatio(legibleOn(c, ground, 4.5), ground), `${c} on ${ground}`).toBeGreaterThanOrEqual(want - 0.02)
        }
  })
  it('is continuous in alpha: one alpha step moves the result a little', () => {
    const lum = (h: string): number => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    let prev = legibleOn(withAlpha('#4aa5f0', 0), '#0b0b0f', 4.5)
    for (let a = 1; a <= 255; a += 1) {
      const next = legibleOn(withAlpha('#4aa5f0', a / 255), '#0b0b0f', 4.5)
      expect(Math.abs(lum(next) - lum(prev)), `alpha ${a}`).toBeLessThanOrEqual(12)
      prev = next
    }
  })
  it('legibleOnStrict floors even an opaque pick', () => {
    expect(contrastRatio(legibleOnStrict('#222222', '#111111', 3), '#111111')).toBeGreaterThanOrEqual(3)
  })
})

describe('inkOn', () => {
  it('a see-through light tint over a dark ground takes white', () => {
    expect(inkOn('#ffd0a040', '#101010')).toBe('#ffffff')
  })
  it('a see-through tint over a light ground takes black', () => {
    expect(inkOn('#3b82f680', '#fafafa')).toBe('#000000')
  })
  it('an opaque tint keeps the strip rule: white unless genuinely light', () => {
    expect(inkOn('#ec9448', '#101010')).toBe('#ffffff')
    expect(inkOn('#f0f0f0', '#101010')).toBe('#000000')
  })
  it('any see-through tint reads at 4.5:1 on its composite', () => {
    for (const ground of ['#000000', '#1e1f29', '#808080', '#d4d4d4', '#ffffff'])
      for (let h = 0; h < 360; h += 30)
        for (let a = 1; a < 10; a += 1) {
          const tint = withAlpha(toStored(hslToRgb({ h, s: 80, l: 55, a: 1 })), a / 10)
          expect(contrastRatio(inkOn(tint, ground), composite(tint, ground))).toBeGreaterThanOrEqual(4.5)
        }
  })
})

describe('selectionFor', () => {
  it('its ink clears 4.5:1 on the fill as seen over every ground', () => {
    const grounds = ['#0b0b0f', '#1b1d24']
    for (const accent of ['#4682fb', '#ec9448', '#5b5bd6', '#a6e22e'])
      for (const a of [0.4, 0.6, 0.8, 1]) {
        const { fill, ink } = selectionFor(withAlpha(accent, a), grounds)
        expect(fill).toMatch(/^#[0-9a-f]{6}$/)
        for (const g of grounds) expect(contrastRatio(ink, composite(withAlpha(fill, a), g))).toBeGreaterThanOrEqual(4.5)
      }
  })
  it('keeps the best pair when no fill can serve grounds far apart', () => {
    const { ink } = selectionFor('#4682fb66', ['#000000', '#f5f5f5'])
    expect(['#ffffff', '#0b0d12']).toContain(ink)
  })
})

describe('colourCommit', () => {
  it('commits nothing when nothing was typed', () => {
    expect(colourCommit(null, '#aabbcc')).toBeNull()
  })
  it('commits nothing for the same colour, in any form', () => {
    expect(colourCommit('#AABBCC', '#aabbcc')).toBeNull()
    expect(colourCommit('abc', '#aabbcc')).toBeNull()
    expect(colourCommit('rgb(170, 187, 204)', '#aabbcc')).toBeNull()
    expect(colourCommit('#aabbccff', '#aabbcc')).toBeNull()
  })
  it('commits a new alpha', () => {
    expect(colourCommit('#aabbcc80', '#aabbcc')).toBe('#aabbcc80')
    expect(colourCommit('hsla(200, 50%, 40%, 0.5)', '#aabbcc')).toBe(toStored(parseColour('hsla(200, 50%, 40%, 0.5)')!))
  })
  it('commits nothing for junk', () => {
    expect(colourCommit('zz', '#aabbcc')).toBeNull()
  })
  it('alpha:false drops a typed alpha', () => {
    expect(colourCommit('#11223380', '#aabbcc', { alpha: false })).toBe('#112233')
    expect(colourCommit('#aabbcc80', '#aabbcc', { alpha: false })).toBeNull()
  })
  it('a code with no alpha keeps the alpha in force (owner, 2026-10-03)', () => {
    expect(colourCommit('#203040', '#0b0d12cb')).toBe('#203040cb')
    expect(colourCommit('203040', '#0b0d12cb')).toBe('#203040cb')
    expect(colourCommit('rgb(32, 48, 64)', '#0b0d1280')).toBe('#20304080')
    expect(colourCommit('hsl(210, 33%, 19%)', '#0b0d1280')).toBe(toStored({ ...parseColour('hsl(210, 33%, 19%)')!, a: 128 / 255 }))
  })
  it('a code that says an alpha sets it, solid included', () => {
    expect(colourCommit('#203040ff', '#0b0d12cb')).toBe('#203040')
    expect(colourCommit('#20304080', '#0b0d12cb')).toBe('#20304080')
    expect(colourCommit('rgba(32, 48, 64, 1)', '#0b0d1280')).toBe('#203040')
  })
  it('saysAlpha reads the code, not the colour', () => {
    expect([saysAlpha('#abc'), saysAlpha('#abcd'), saysAlpha('aabbcc'), saysAlpha('#aabbcc80')]).toEqual([false, true, false, true])
    expect([saysAlpha('rgb(1,2,3)'), saysAlpha('rgba(1,2,3,0.5)'), saysAlpha('hsl(1 2% 3% / 50%)')]).toEqual([false, true, true])
  })
  it('clamps to alphaMin and alphaMax', () => {
    expect(colourCommit('#11223300', '#aabbcc', { alphaMin: 0.3 })).toBe('#1122334d')
    expect(colourCommit('#112233', '#aabbcc', { alphaMax: 254 / 255 })).toBe('#112233fe')
  })
})

describe('alphaPct (#113 review)', () => {
  it('only opaque reads 100 and only clear reads 0', () => {
    expect(alphaPct(1)).toBe(100)
    expect(alphaPct(254 / 255)).toBe(99)
    expect(alphaPct(0.995)).toBe(99)
    expect(alphaPct(0)).toBe(0)
    expect(alphaPct(1 / 255)).toBe(1)
  })
  it('is the whole percent everywhere else', () => {
    expect(alphaPct(0.5)).toBe(50)
    expect(alphaPct(0.3)).toBe(30)
    expect(alphaPct(128 / 255)).toBe(50)
  })
})

describe('snapAlphaStep', () => {
  // Prism's glass: 100% is solid, anything from 95% up to it is 95%.
  const snap = (a: number): number => (a >= 1 ? 1 : Math.min(a, 0.95))
  it('without host steps, the value as it is', () => {
    expect(snapAlphaStep(0.42, 1, true)).toBe(0.42)
  })
  it('shows the stored step, not the pointer value', () => {
    expect(snapAlphaStep(0.98, 1, false, { snap })).toBe(0.95)
  })
  it('one key press down from solid lands on 95', () => {
    expect(snapAlphaStep(0.99, 1, true, { snap })).toBe(0.95)
  })
  it('one key press up from 95 reaches solid, never a dead press', () => {
    expect(snapAlphaStep(0.96, 0.95, true, { snap })).toBe(1)
  })
  it('below the steps a key press moves one percent', () => {
    expect(snapAlphaStep(0.6, 0.61, true, { snap })).toBe(0.6)
  })
})
