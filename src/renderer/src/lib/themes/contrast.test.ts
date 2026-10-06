import { describe, expect, it } from 'vitest'
import { composite, opaque, parseColour } from 'prism-term-core/renderer/lib/colour'
import { buildTermTheme } from 'prism-term-core/renderer/lib/termTheme'
import { paintedAlpha, STYLES, variablesFor } from '../theme'

// EVERY FLOOR, ON WHAT PRISM PAINTS (#298, spec 8). The 18 themes were designed
// and checked in the mockup (`check-themes.mjs`); this holds the app to the
// same floors on the tokens `variablesFor` publishes, so a derivation that
// drifts from the design shows here, not on somebody's screen.

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

/** A colour as the eye gets it on a ground (eight digits composited). */
const seen = (c: string, ground: string): string => composite(c, ground)

/** Grey: every channel within `tol` of the others. */
const grey = (c: string, tol: number): boolean => {
  const p = parseColour(c)!
  return Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) <= tol
}

const CODE_TEXT = ['keyword', 'string', 'number', 'fn', 'type', 'const', 'op', 'meta', 'tag', 'attr', 'comment']

for (const s of STYLES) {
  describe(`${s.name}`, () => {
    const v = variablesFor(s)
    const ground = opaque(s.bg)
    const panel = v['--p-side-flat']
    const raised = v['--p-raised']

    it('text reads 4.5:1 on the ground, the panel and the menus', () => {
      for (const g of [ground, panel, raised]) expect(contrast(v['--p-text'], g), g).toBeGreaterThanOrEqual(4.5)
    })

    it('the dim inks hold 4.5:1 and 3.2:1 on the panel', () => {
      expect(contrast(v['--p-dim'], panel)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(v['--p-dim2'], panel)).toBeGreaterThanOrEqual(3.2)
    })

    it('the accent: its ink 4.5:1 on its fill, its line 3:1 on the ground and panel', () => {
      expect(contrast(v['--p-on-accent'], v['--p-accent'])).toBeGreaterThanOrEqual(4.5)
      for (const g of [ground, panel]) expect(contrast(v['--p-accent-solid'], g)).toBeGreaterThanOrEqual(3)
    })

    it('a marked row reads on the selection as seen, and the selection is seen', () => {
      const tint = v['--p-sel-tint-seen']
      expect(contrast(v['--p-text'], tint)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(v['--p-dim'], tint)).toBeGreaterThanOrEqual(3.2)
      expect(contrast(tint, ground)).toBeGreaterThanOrEqual(1.12)
    })

    it('folders read 3:1 on the panel', () => {
      expect(contrast(v['--p-tree-folder'], panel)).toBeGreaterThanOrEqual(3)
    })

    it('code reads 4.5:1 on the ground and the panel, and on the active line', () => {
      for (const t of CODE_TEXT)
        for (const g of [ground, panel]) expect(contrast(v[`--p-code-${t}`], g), `${t} on ${g}`).toBeGreaterThanOrEqual(4.5)
      const line = seen(v['--p-code-active-line'], ground)
      // The eight that carry meaning; the punctuation and the comment are the
      // quiet two by design and hold 4.5:1 on the plain ground above.
      for (const t of ['keyword', 'string', 'number', 'fn', 'type', 'const', 'tag', 'attr'])
        expect(contrast(v[`--p-code-${t}`], line), `${t} on the active line`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(v['--p-code-invalid'], ground)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(v['--p-code-invalid'], panel)).toBeGreaterThanOrEqual(4.5)
    })

    it("the terminal's derived sixteen hold 3:1 on the ground when it follows the theme", () => {
      // The core derives them against --p-side-flat, which is the PANEL on a
      // shipped theme; the panel sits between the ground and the text on all
      // 18, so they clear the ground too (spec 6).
      const term = buildTermTheme(v['--p-bg'], v['--p-text'], v['--p-accent-hi'], v['--p-side-flat'])
      const ansi = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan'] as const
      for (const k of ansi) {
        const c = (term as unknown as Record<string, string>)[k]
        expect(contrast(c, ground), `${k} ${c}`).toBeGreaterThanOrEqual(3)
      }
    })

    if (paintedAlpha(s) < 1) {
      it('see-through: text reads 4.5:1 over its glass on white and on black', () => {
        const a = Math.round(paintedAlpha(s) * 255)
        const glass = ground + a.toString(16).padStart(2, '0')
        for (const desk of ['#ffffff', '#000000'])
          expect(contrast(v['--p-text'], composite(glass, desk)), desk).toBeGreaterThanOrEqual(4.5)
        expect(a).toBe(s.mode === 'dark' ? 184 : 209)
      })
    }

    if (s.hc) {
      it('high contrast is monochrome: accent, selection and folder pure grey', () => {
        for (const k of ['--p-accent', '--p-accent-solid', '--p-sel-tint', '--p-tree-folder'])
          expect(grey(v[k], 0), `${k} ${v[k]}`).toBe(true)
        // The ink on the accent is the design's near-black, a hair off grey.
        expect(grey(v['--p-on-accent'], 4)).toBe(true)
        // Kinds and code keep a whisper of hue so they can still be told
        // apart: near grey, every channel within about 11% of the others.
        for (const k of ['image', 'video', 'audio', 'pdf', 'text']) expect(grey(v[`--p-kind-${k}`], 28), k).toBe(true)
        for (const t of ['keyword', 'string', 'number', 'fn', 'type', 'const', 'op', 'meta', 'tag', 'attr', 'comment'])
          expect(grey(v[`--p-code-${t}`], 28), t).toBe(true)
      })
    }
  })
}
