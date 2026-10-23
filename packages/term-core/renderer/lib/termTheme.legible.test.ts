import { describe, expect, it } from 'vitest'
import { TERM_PRESETS, resolveTermTheme } from './termTheme'
import { ANSI_CONTRAST_FLOOR, contrastRatio, legiblePalette, type Ansi16 } from './termAnsi'
import { saveCustomTermTheme } from './termLook'
import { withAlpha } from './colour'

const KEYS: Array<keyof Ansi16> = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
]

// ALPHA NEVER MAKES A THEME LESS LEGIBLE (#112). Every preset, saved as a
// Custom with its text, cursor and sixteen at alpha 0.1 to 0.9: the text and
// cursor read at least as well as their opaque pick, up to the floor; the
// sixteen clear 3:1 on the composite, as `legiblePalette` floors them opaque.
describe('a Custom at every alpha reads', () => {
  it('text 4.5:1 and cursor 3:1 (or the opaque pick), the sixteen 3:1', () => {
    for (const p of TERM_PRESETS) {
      const base = resolveTermTheme(p.id)
      const ansi = Object.fromEntries(KEYS.map((k) => [k, base[k] as string]))
      for (let i = 1; i <= 9; i += 1) {
        const a = i / 10
        localStorage.clear()
        saveCustomTermTheme({
          bg: p.bg,
          fg: withAlpha(p.fg, a),
          cursor: withAlpha(p.cursor, a),
          ansi: Object.fromEntries(Object.entries(ansi).map(([k, v]) => [k, withAlpha(v, a)]))
        })
        const t = resolveTermTheme('custom')
        const at = `${p.id} at ${a}`
        // Measured on what is drawn: the composite, opaque. A hex8 measured
        // as it stands is judged on its first six digits, as if solid.
        for (const v of [t.foreground, t.cursor, ...KEYS.map((k) => t[k] as string)]) expect(v, at).toMatch(/^#[0-9a-f]{6}$/)
        expect(contrastRatio(t.foreground, p.bg), `${at} text`).toBeGreaterThanOrEqual(Math.min(4.5, contrastRatio(p.fg, p.bg)) - 0.02)
        expect(contrastRatio(t.cursor, p.bg), `${at} cursor`).toBeGreaterThanOrEqual(Math.min(3, contrastRatio(p.cursor, p.bg)) - 0.02)
        for (const k of KEYS) expect(contrastRatio(t[k] as string, p.bg), `${at} ${k}`).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR - 0.01)
      }
    }
    localStorage.clear()
  })
})

describe('every terminal theme reads (#99 follow-up, 2026-09-04)', () => {
  it('all sixteen colours of every preset clear the floor against its background', () => {
    for (const p of TERM_PRESETS) {
      const t = resolveTermTheme(p.id)
      for (const k of KEYS) {
        const r = contrastRatio(t[k] as string, p.bg)
        expect(r, `${p.id}.${k} ${t[k]} on ${p.bg}`).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR - 0.01)
      }
    }
  })

  // NO INVISIBLE TEXT, ANYWHERE (owner, 2026-09-24: "verify all themes look
  // good, no invisible text"). The sixteen are held above; these are the rest
  // of what a theme draws: its text (4.5:1, reading text), its cursor and the
  // chrome accent it asks for (3:1, the floor for a mark that is not text).
  it("every preset's text reads on its ground", () => {
    for (const p of TERM_PRESETS) {
      const r = contrastRatio(p.fg, p.bg)
      expect(r, `${p.id} text ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("every preset's cursor and accent can be seen on its ground", () => {
    for (const p of TERM_PRESETS) {
      expect(contrastRatio(p.cursor, p.bg), `${p.id} cursor ${p.cursor}`).toBeGreaterThanOrEqual(3)
      if (p.accent) expect(contrastRatio(p.accent, p.bg), `${p.id} accent ${p.accent}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('legiblePalette leaves a colour that already reads exactly as it was', () => {
    const p = TERM_PRESETS.find((x) => x.id === 'dracula')!
    const out = legiblePalette(p.ansi!, p.bg)
    expect(out.brightBlue).toBe(p.ansi!.brightBlue) // 6.8:1, untouched
    expect(out.brightBlack).not.toBe(p.ansi!.brightBlack) // 2.2:1, nudged
    expect(contrastRatio(out.brightBlack, p.bg)).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR - 0.01)
  })
})

describe("the app icon's two themes (owner, 2026-09-21)", () => {
  // "two themes that match the app icon colour scheme, one with orange and
  // black, and one with orange and dark grey". The icon is orange #ec9448 over
  // a charcoal and dark-grey swirl; these pin the two presets that carry it.
  const ICON_ORANGE = '#ec9448'
  const find = (id: string) => {
    const p = TERM_PRESETS.find((t) => t.id === id)
    if (!p) throw new Error(`no preset ${id}`)
    return p
  }

  it('Pitch is orange on black, cursor and chrome alike', () => {
    const p = find('pitch')
    expect(p.bg).toBe('#000000')
    expect(p.cursor).toBe(ICON_ORANGE)
    expect(p.accent).toBe(ICON_ORANGE)
  })

  it("Cinder is orange on the icon's own dark grey", () => {
    const p = find('cinder')
    expect(p.bg).toBe('#383c44')
    expect(p.cursor).toBe(ICON_ORANGE)
    expect(p.accent).toBe(ICON_ORANGE)
  })
})
