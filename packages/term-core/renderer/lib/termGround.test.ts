import { describe, expect, it } from 'vitest'
import { contrastRatio } from './termAnsi'
import { onGround } from './termGround'
import { TERM_PRESETS, resolveTermTheme } from './termTheme'

const KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

describe('onGround', () => {
  it('leaves the theme alone with no ground, or its own', () => {
    const t = resolveTermTheme('nord')
    expect(onGround(t, null)).toBe(t)
    expect(onGround(t, t.background.toUpperCase())).toBe(t)
  })

  // Every preset on a light, a dark and a saturated pick: nothing invisible.
  for (const ground of ['#f4f1e8', '#101010', '#1d3fbf']) {
    it(`every preset reads on a picked ${ground}`, () => {
      for (const p of TERM_PRESETS) {
        const t = onGround(resolveTermTheme(p.id), ground)
        expect(t.background).toBe(ground)
        expect(contrastRatio(t.foreground, ground), `${p.id} text`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(t.cursor, ground), `${p.id} cursor`).toBeGreaterThanOrEqual(3)
        for (const k of KEYS) expect(contrastRatio(t[k] as string, ground), `${p.id} ${k}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('moves only what fails: a colour that already reads keeps its value', () => {
    const t = resolveTermTheme('pitch')
    const out = onGround(t, '#101010')
    for (const k of KEYS)
      if (contrastRatio(t[k] as string, '#101010') >= 3) expect(out[k]).toBe((t[k] as string).slice(0, 7).toLowerCase())
  })
})
