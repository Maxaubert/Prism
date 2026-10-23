import { describe, expect, it } from 'vitest'
import { DEFAULT_TERM_THEME, TERM_PRESETS, resolveCustomTheme, resolveTermTheme } from './termTheme'
import { saveCustomTermTheme } from './termLook'
import { onGround } from './termGround'
import { contrastRatio } from './termAnsi'
import { xtermTheme } from './termXterm'

describe('resolveTermTheme', () => {
  it("keeps the core's own default, prism, in the list (PT Default now leads it)", () => {
    // The wall's first card is the HOST's default (Prism Terminal's is PT
    // Default); the core's neutral fallback is still 'prism', found by id.
    expect(TERM_PRESETS[0]?.id).toBe('pt-default')
    expect(DEFAULT_TERM_THEME).toBe('prism')
    expect(TERM_PRESETS.some((p) => p.id === DEFAULT_TERM_THEME)).toBe(true)
  })

  it('resolves a preset by id, with a full sixteen', () => {
    const t = resolveTermTheme('dracula')
    expect(t.background).toBe('#1e1f29')
    expect(t.selectionBackground).toBe('#bbbbbb55') // the cursor, translucent
    expect(t.red).toBeDefined()
    expect(t.brightWhite).toBeDefined()
  })

  it("an unknown id, and Prism's legacy 'style', resolve to the prism preset", () => {
    const prism = resolveTermTheme('prism')
    expect(prism.background).toBe('#0b0b0f')
    expect(prism.foreground).toBe('#e7e7ee')
    expect(prism.cursor).toBe('#7c7cf0')
    expect(resolveTermTheme('style')).toEqual(prism)
    expect(resolveTermTheme('no-such-theme')).toEqual(prism)
  })

  it("'custom' with nothing saved falls back the same way", () => {
    localStorage.clear()
    expect(resolveTermTheme('custom')).toEqual(resolveTermTheme('prism'))
  })
})

describe('a Custom with alpha (#112)', () => {
  it('a hex8 cursor derives a 9-character selection from the opaque cursor', () => {
    localStorage.clear()
    saveCustomTermTheme({ bg: '#101010', fg: '#eeeeee', cursor: '#ff800080', ansi: {} })
    const t = resolveTermTheme('custom')
    expect(t.selectionBackground).toHaveLength(9)
    expect(t.cursor).toMatch(/^#[0-9a-f]{6}$/)
    expect(t.selectionBackground).toBe(`${t.cursor}55`)
  })
  it('a chosen selection is honoured, and survives a picked ground', () => {
    localStorage.clear()
    saveCustomTermTheme({ bg: '#101010', fg: '#eeeeee', cursor: '#ff8000', selection: '#3355ff80', ansi: {} })
    expect(resolveTermTheme('custom').selectionBackground).toBe('#3355ff80')
    expect(onGround(resolveTermTheme('custom'), '#f4f1e8').selectionBackground).toBe('#3355ff80')
  })
  it('a derived selection follows the floored cursor on a picked ground, as before', () => {
    const t = onGround(resolveTermTheme('dracula'), '#f4f1e8')
    expect(t.selectionBackground).toBe(`${t.cursor}55`)
  })
  it('foreground, cursor and the sixteen are composited against the ground in force', () => {
    localStorage.clear()
    saveCustomTermTheme({ bg: '#000000', fg: '#ffffff80', cursor: '#ffffff', ansi: { red: '#ff000080' } })
    const own = resolveTermTheme('custom')
    expect(own.foreground).toBe('#808080')
    expect(own.red).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrastRatio(own.red as string, '#000000')).toBeGreaterThanOrEqual(3)
    // On a picked white ground, half-white text is laid on WHITE first.
    expect(resolveTermTheme('custom', '#ffffff').foreground).not.toBe(own.foreground)
  })
})

describe('resolveCustomTheme: the editor and the wall draw what the terminal draws (#113 review)', () => {
  const c = {
    bg: '#000000',
    fg: '#ffffff4d',
    cursor: '#ff800080',
    ansi: { red: '#ff000066', green: '#00ff00', blue: '#3355ff80' }
  }
  it('is exactly what the terminal resolves for the same saved Custom', () => {
    localStorage.clear()
    saveCustomTermTheme(c)
    expect(resolveCustomTheme(c)).toEqual(resolveTermTheme('custom'))
    expect(resolveCustomTheme(c, '#f4f1e8')).toEqual(resolveTermTheme('custom', '#f4f1e8'))
  })
  it('a 30% foreground is drawn floored, never at its raw alpha', () => {
    const t = resolveCustomTheme(c)
    expect(t.foreground).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrastRatio(t.foreground, '#000000')).toBeGreaterThanOrEqual(4.5)
  })
  it('the derived selection is the drawn cursor at 55, not the raw opaque cursor', () => {
    const t = resolveCustomTheme(c)
    expect(t.selectionBackground).toBe(`${t.cursor}55`)
    expect(t.selectionBackground).not.toBe('#ff800055')
  })
})

describe('what xterm is handed (#112)', () => {
  // xterm 6 parses #rrggbb[aa] and comma rgba() only; anything else goes to a
  // canvas path that throws on a colour that is not opaque.
  const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/
  it('every value, over every preset and an alpha Custom, painted or not, on any ground', () => {
    localStorage.clear()
    saveCustomTermTheme({
      bg: '#10101080',
      fg: '#EEEEEE99',
      cursor: '#ff800040',
      selection: '#3355ff80',
      ansi: { red: '#ff000080', green: '#00ff00', blue: 'rgba(0, 0, 255, 0.5)' }
    })
    for (const id of [...TERM_PRESETS.map((p) => p.id), 'custom'])
      for (const ground of [null, '#f4f1e8', '#20304080'])
        for (const paints of [true, false]) {
          const t = xtermTheme(onGround(resolveTermTheme(id, ground), ground), { paintsGround: paints, clearGround: !paints })
          for (const [k, v] of Object.entries(t)) if (typeof v === 'string') expect(v, `${id} ${k}`).toMatch(HEX)
        }
  })
})
