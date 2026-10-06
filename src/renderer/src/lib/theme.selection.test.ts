import { describe, expect, it } from 'vitest'
import { alphaOf, composite } from 'prism-term-core/renderer/lib/colour'
import { derive, sideGround, TINT_ALPHA, TINT_MIN, selectionTintAlpha, type Style } from './theme'
import { DERIVED_STYLES } from './themes/testStyles'

// TWO HIGHLIGHTS FROM ONE ACCENT (owner, 2026-10-03: "i cant seem to make it
// look good both in the settings highlighting for the selected tab which i want
// more saturated and the explorer which i want to be more transparent like
// selecting files in file explorer"). A marked FILE is a tint the row's own
// text still reads on. The chosen settings PAGE was the accent solid until the
// grouped cards redesign (#292; owner, 2026-10-05: no accent on the chosen
// rail item), which made it a grey fill, so `--p-sel-solid` went with it.

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
    expect(DERIVED_STYLES.some((s) => s.mode === 'light')).toBe(true)
    expect(DERIVED_STYLES.some((s) => s.mode === 'dark')).toBe(true)
  })

  for (const s of DERIVED_STYLES) {
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
    const full = DERIVED_STYLES.filter((s) => alphaOf(at(s, 1)['--p-sel-tint']) >= TINT_ALPHA - 0.005)
    expect(full.length / DERIVED_STYLES.length).toBeGreaterThan(0.6)
  })

  it('the knockout tokens are the tint as seen, opaque', () => {
    for (const s of DERIVED_STYLES) {
      const t = at(s, 0.5)
      expect(t['--p-sel-tint-seen']).toBe(composite(t['--p-sel-tint'], t['--p-bg']))
      expect(t['--p-sel-tint-side']).toBe(composite(t['--p-sel-tint'], sideGround(s)))
      expect(alphaOf(t['--p-sel-tint-seen'])).toBe(1)
    }
  })
})

// THE INACTIVE MARK (#296; owner, 2026-10-06: "still highlighted but dimmed").
describe('the dimmed mark is quieter than the tint and still a mark', () => {
  for (const s of DERIVED_STYLES) {
    it(`${s.id}: inks read on it, a step off the panel, a step under the tint`, () => {
      const t = at(s, 1)
      expect(t['--p-sel-tint-dim']).toMatch(/^#[0-9a-f]{8}$/)
      expect(t['--p-sel-line-dim']).toMatch(/^#[0-9a-f]{8}$/)
      for (const ground of [t['--p-bg'], sideGround(s)]) {
        const full = composite(t['--p-sel-tint'], ground)
        const dim = composite(t['--p-sel-tint-dim'], ground)
        expect(contrast(t['--p-text'], dim), `${s.id} text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['--p-dim'], dim), `${s.id} dim ink`).toBeGreaterThanOrEqual(3.2)
        // MEASURED over every style: 1.12 to 1.30 off the panel, where the
        // tint is 1.19 to 1.46, so it is seen, and always weaker than the tint.
        expect(contrast(dim, ground), `${s.id} off the ground`).toBeGreaterThanOrEqual(1.1)
        expect(contrast(full, ground) - contrast(dim, ground), `${s.id} under the tint`).toBeGreaterThanOrEqual(0.05)
      }
    })
  }
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

