import { describe, expect, it } from 'vitest'
import { alphaOf, composite } from 'prism-term-core/renderer/lib/colour'
import { derive, sideGround, STYLES, TINT_ALPHA, TINT_MIN, selectionTintAlpha, type Style } from './theme'

// TWO HIGHLIGHTS FROM ONE ACCENT (owner, 2026-10-03: "i cant seem to make it
// look good both in the settings highlighting for the selected tab which i want
// more saturated and the explorer which i want to be more transparent like
// selecting files in file explorer"). A marked FILE is a tint the row's own
// text still reads on; a chosen PAGE is the accent solid. Neither moves with
// the accent's alpha, which stays a choice about fills.

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
const ALPHAS = [0.1, 0.35, 0.6, 0.85, 1]
const at = (s: Style, a: number): Record<string, string> => derive({ ...s, accentAlpha: a })

describe('a marked file is a tint the row still reads on', () => {
  it('there are built-in styles of both modes to hold to it', () => {
    expect(STYLES.some((s) => s.mode === 'light')).toBe(true)
    expect(STYLES.some((s) => s.mode === 'dark')).toBe(true)
  })

  for (const s of STYLES) {
    it(`${s.id}: names 4.5:1 and the quiet columns 3.2:1 on the tint, at every accent alpha`, () => {
      for (const a of ALPHAS) {
        const t = at(s, a)
        const tint = t['--p-sel-tint']
        expect(tint, `${s.id} at ${a}`).toMatch(/^#[0-9a-f]{8}$/)
        const alpha = alphaOf(tint)
        expect(alpha).toBeGreaterThanOrEqual(TINT_MIN - 0.005)
        expect(alpha).toBeLessThanOrEqual(TINT_ALPHA + 0.005)
        for (const ground of [t['--p-bg'], sideGround(s)]) {
          const seen = composite(tint, ground)
          expect(contrast(t['--p-text'], seen), `${s.id} text at ${a}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(t['--p-text-soft'], seen), `${s.id} soft at ${a}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(t['--p-dim'], seen), `${s.id} dim at ${a}`).toBeGreaterThanOrEqual(3.2)
        }
      }
    })

    it(`${s.id}: the tint is the same whatever the accent's alpha`, () => {
      const solid = at(s, 1)
      for (const a of ALPHAS) {
        const t = at(s, a)
        for (const k of ['--p-sel-tint', '--p-sel-line', '--p-sel-tint-seen', '--p-sel-tint-side'])
          expect(t[k], `${s.id} ${k} at ${a}`).toBe(solid[k])
      }
    })
  }

  it('is a light tint, not a slab: most styles get the full fifth', () => {
    const full = STYLES.filter((s) => alphaOf(at(s, 1)['--p-sel-tint']) >= TINT_ALPHA - 0.005)
    expect(full.length / STYLES.length).toBeGreaterThan(0.6)
  })

  it('the knockout tokens are the tint as seen, opaque', () => {
    for (const s of STYLES) {
      const t = at(s, 0.5)
      expect(t['--p-sel-tint-seen']).toBe(composite(t['--p-sel-tint'], t['--p-bg']))
      expect(t['--p-sel-tint-side']).toBe(composite(t['--p-sel-tint'], sideGround(s)))
      expect(alphaOf(t['--p-sel-tint-seen'])).toBe(1)
    }
  })
})

describe('the tint gives way, never the ink', () => {
  it('is TINT_ALPHA where the ink reads on it', () => {
    expect(selectionTintAlpha('#3b82f6', [['#ffffff', 4.5]], ['#101215'])).toBe(TINT_ALPHA)
  })
  it('steps down until the ink reads, and stops at TINT_MIN', () => {
    const a = selectionTintAlpha('#000000', [['#555555', 4.5]], ['#ffffff'])
    expect(a).toBeLessThan(TINT_ALPHA)
    expect(contrast('#555555', composite('#000000' + Math.round(a * 255).toString(16), '#ffffff'))).toBeGreaterThanOrEqual(4.5)
    expect(selectionTintAlpha('#000000', [['#000000', 21]], ['#000000'])).toBe(TINT_MIN)
  })
})

describe('a chosen page is the accent, solid', () => {
  for (const s of STYLES) {
    it(`${s.id}: the rail's fill is opaque at every accent alpha, and its label reads`, () => {
      const solid = at(s, 1)
      // At 100% it is exactly what the rail has always worn.
      expect(solid['--p-sel-solid']).toBe(solid['--p-sel-bg'])
      expect(solid['--p-on-sel-solid']).toBe(solid['--p-on-accent'])
      for (const a of ALPHAS) {
        const t = at(s, a)
        expect(t['--p-sel-solid'], `${s.id} at ${a}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(t['--p-sel-solid']).toBe(solid['--p-sel-solid'])
        expect(contrast(t['--p-on-sel-solid'], t['--p-sel-solid'])).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
