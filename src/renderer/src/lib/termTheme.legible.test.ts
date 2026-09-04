import { describe, expect, it } from 'vitest'
import { TERM_PRESETS, resolveTermTheme } from './termTheme'
import { ANSI_CONTRAST_FLOOR, contrastRatio, legiblePalette, type Ansi16 } from './termAnsi'

const KEYS: Array<keyof Ansi16> = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
]

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

  it('legiblePalette leaves a colour that already reads exactly as it was', () => {
    const p = TERM_PRESETS.find((x) => x.id === 'dracula')!
    const out = legiblePalette(p.ansi!, p.bg)
    expect(out.brightBlue).toBe(p.ansi!.brightBlue) // 6.8:1, untouched
    expect(out.brightBlack).not.toBe(p.ansi!.brightBlack) // 2.2:1, nudged
    expect(contrastRatio(out.brightBlack, p.bg)).toBeGreaterThanOrEqual(ANSI_CONTRAST_FLOOR - 0.01)
  })
})
