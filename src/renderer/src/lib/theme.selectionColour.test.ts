import { describe, expect, it } from 'vitest'
import { alphaOf, composite, opaque, withAlpha } from 'prism-term-core/renderer/lib/colour'
import {
  DEFAULT_STYLE,
  TINT_ALPHA,
  TINT_LINE,
  TINT_MIN,
  cleanDraft,
  cleanPresets,
  derive,
  selectionTintAlpha,
  selectionValue,
  sideGround,
  tintLineAlpha,
  type Style
} from './theme'
import { DERIVED_STYLES } from './themes/testStyles'

// THE SELECTION IS ITS OWN COLOUR (#257; owner, 2026-10-03: "the settings
// accent colour for the tab should be separated from the explorer accent
// colour ... called something like selected item colour"). A Style row of its
// own whose colour and alpha are the marked-file tint; unset, the accent's
// tint exactly as it was, so nobody's window moves until they pick.

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

/** The tint as the code before the Selection row derived it, verbatim. */
function before(s: Style): { tint: string; line: string } {
  const t = derive(s)
  // The tint's hue then was the accent's `hi`, published as --p-accent-hi.
  const hue = t['--p-accent-hi']
  const inks: Array<[string, number]> = [
    [t['--p-text'], 4.5],
    [t['--p-text-soft'], 4.5],
    [t['--p-dim'], 3.2]
  ]
  let a = TINT_MIN
  for (let step = Math.round(TINT_ALPHA * 100); step > Math.round(TINT_MIN * 100); step -= 1) {
    const x = step / 100
    const reads = [t['--p-bg'], sideGround(s)].every((g) =>
      inks.every(([ink, f]) => contrast(ink, composite(withAlpha(hue, x), g)) >= f)
    )
    if (reads) {
      a = x
      break
    }
  }
  return { tint: withAlpha(hue, a), line: withAlpha(hue, 0.5) }
}

describe('an unset Selection is the tint every style already had', () => {
  for (const s of DERIVED_STYLES) {
    it(`${s.id}: byte for byte, and its edge only softer`, () => {
      const t = derive(s)
      const was = before(s)
      expect(t['--p-sel-tint']).toBe(was.tint)
      expect(t['--p-sel-tint-seen']).toBe(composite(was.tint, t['--p-bg']))
      // Same hue as the old edge, at a lower alpha.
      expect(opaque(t['--p-sel-line'])).toBe(opaque(was.line))
      expect(alphaOf(t['--p-sel-line'])).toBeLessThan(alphaOf(was.line) - 0.15)
    })
  }

  it('the default style shows the accent tint in the picker', () => {
    const s = DERIVED_STYLES.find((x) => x.id === DEFAULT_STYLE) ?? DERIVED_STYLES[0]
    expect(selectionValue(s)).toBe(derive(s)['--p-sel-tint'])
  })
})

describe('the softer edge', () => {
  it('is TINT_LINE at the derived strength, scaled with a picked one and capped', () => {
    expect(tintLineAlpha(TINT_ALPHA)).toBeCloseTo(TINT_LINE, 10)
    expect(tintLineAlpha(0.11)).toBeCloseTo(TINT_LINE / 2, 10)
    expect(tintLineAlpha(1)).toBe(0.5)
  })
  it('stays visible: on every style it is a step off the tint', () => {
    for (const s of DERIVED_STYLES) {
      const t = derive(s)
      for (const g of [t['--p-bg'], sideGround(s)]) {
        const fill = composite(t['--p-sel-tint'], g)
        const edge = composite(t['--p-sel-line'], fill)
        expect(edge, s.id).not.toBe(fill)
        expect(contrast(edge, fill), s.id).toBeGreaterThan(1.05)
      }
    }
  })
})

describe('a picked Selection is the tint', () => {
  const dark = DERIVED_STYLES.find((s) => s.mode === 'dark') as Style
  const light = DERIVED_STYLES.find((s) => s.mode === 'light') as Style

  it('its colour and alpha are used as picked when the inks read', () => {
    const t = derive({ ...dark, selection: '#2ecc7138' })
    expect(t['--p-sel-tint']).toBe('#2ecc7138')
    expect(opaque(t['--p-sel-line'])).toBe('#2ecc71')
    expect(t['--p-sel-tint-seen']).toBe(composite('#2ecc7138', t['--p-bg']))
  })

  it('six digits is a solid pick, and is capped to what the names read on', () => {
    const t = derive({ ...light, selection: '#1d4ed8' })
    const a = alphaOf(t['--p-sel-tint'])
    expect(a).toBeLessThan(1)
    expect(opaque(t['--p-sel-tint'])).toBe('#1d4ed8')
    for (const g of [t['--p-bg'], sideGround(light)]) {
      const seen = composite(t['--p-sel-tint'], g)
      expect(contrast(t['--p-text'], seen)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['--p-dim'], seen)).toBeGreaterThanOrEqual(3.2)
    }
  })

  it('every style holds its floors under a strong pick of either ink', () => {
    for (const s of DERIVED_STYLES) {
      for (const pick of ['#ff00ffcc', '#000000cc', '#ffffffcc']) {
        const t = derive({ ...s, selection: pick })
        for (const g of [t['--p-bg'], sideGround(s)]) {
          const seen = composite(t['--p-sel-tint'], g)
          expect(contrast(t['--p-text'], seen), `${s.id} ${pick}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(t['--p-text-soft'], seen), `${s.id} ${pick}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(t['--p-dim'], seen), `${s.id} ${pick}`).toBeGreaterThanOrEqual(3.2)
        }
      }
    }
  })

  it('does not move the accent or the selection fill', () => {
    const plain = derive(dark)
    const picked = derive({ ...dark, selection: '#2ecc7180' })
    for (const k of ['--p-accent', '--p-accent-hi', '--p-sel-bg'])
      expect(picked[k], k).toBe(plain[k])
  })

  it('the picker shows a pick as stored', () => {
    expect(selectionValue({ ...dark, selection: '#2ecc7138' })).toBe('#2ecc7138')
  })
})

describe('the cap', () => {
  it('a pick that reads is kept at its exact alpha, not rounded to a percent', () => {
    expect(selectionTintAlpha('#3b82f6', [['#ffffff', 4.5]], ['#101215'], 0x38 / 255)).toBe(0x38 / 255)
  })
  it('a pick that does not read steps down until it does', () => {
    const a = selectionTintAlpha('#ffffff', [['#ffffff', 4.5]], ['#101215'], 0.9)
    expect(a).toBeLessThan(0.9)
    expect(contrast('#ffffff', composite(withAlpha('#ffffff', a), '#101215'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('it is stored with the style', () => {
  it('a draft keeps six and eight digits, and forgets junk', () => {
    expect(cleanDraft({ selection: '#2ECC7138' }).selection).toBe('#2ecc7138')
    expect(cleanDraft({ selection: '#2ecc71' }).selection).toBe('#2ecc71')
    expect(cleanDraft({ selection: 'nonsense' }).selection).toBeUndefined()
    expect('selection' in cleanDraft({ selection: 42 as unknown as string })).toBe(false)
  })
  it('a saved preset keeps its pick, and loses one that is not a colour', () => {
    const base = { ...DERIVED_STYLES[0], id: 'custom-1', custom: true }
    expect(cleanPresets([{ ...base, selection: '#2ecc7138' }])[0].selection).toBe('#2ecc7138')
    expect(cleanPresets([{ ...base, selection: 'x' }])[0].selection).toBeUndefined()
  })
})

describe('the sweep band', () => {
  // Windows draws its drag box in the selection colour, so a box dragged over
  // green marks must not be blue; unset, it is the accent it always was.
  it('unset, is drawn from the accent fill and its lifted hi, on every built-in style', () => {
    for (const s of DERIVED_STYLES) {
      const t = derive(s)
      expect(t['--p-sel-hue'], s.id).toBe(t['--p-accent'])
      expect(t['--p-sel-hue-hi'], s.id).toBe(t['--p-accent-hi'])
    }
  })
  it('picked, is drawn from the pick, with an edge that reads on the stage', () => {
    for (const s of DERIVED_STYLES) {
      const t = derive({ ...s, selection: '#2ecc7138' })
      expect(t['--p-sel-hue'], s.id).toBe('#2ecc71')
      expect(contrast(opaque(t['--p-sel-hue-hi']), t['--p-preview']), s.id).toBeGreaterThanOrEqual(2.9)
    }
  })
})
