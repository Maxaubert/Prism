import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { useMediaLook, type MediaLook } from '../lib/viz/mediaLook'
import { prismMediaLook } from '../lib/viz/prismMediaLook'
import { vizState, WIDTHS } from '../lib/viz/vizStore'
import { resolveVizTheme } from '../lib/theme'

/**
 * The players take their look from the host (#29, 2026-11-01).
 *
 * AudioView and VideoView are bound for the shared `prism-core` that Filesmith
 * will bundle too. Reaching into Prism's viz store and app theme directly would
 * drag Prism's whole Settings, preset and theme system along with them, so the
 * views read a narrow context (lib/viz/mediaLook) and Prism installs its stores
 * behind it (PrismMediaLook). Nothing a viewer sees changes: the same settings,
 * the same defaults, the same persistence.
 */

const here = resolve(__dirname)
const source = (name: string): string => readFileSync(resolve(here, name), 'utf8')

describe('the players never reach into Prism settings stores (#29)', () => {
  for (const file of ['AudioView.tsx', 'VideoView.tsx']) {
    it(`${file} imports neither the viz store nor the app theme`, () => {
      const text = source(file)
      expect(text).not.toMatch(/from '\.\.\/lib\/viz\/vizStore'/)
      expect(text).not.toMatch(/from '\.\.\/lib\/theme'/)
      expect(text).toMatch(/useMediaLook\(\)/)
    })
  }
})

describe("Prism's provider hands the views exactly what the stores hold", () => {
  const capture = (): MediaLook => prismMediaLook(vizState())

  it('the viz settings are the store settings', () => {
    const look = capture()
    const s = vizState()
    for (const k of Object.keys(look.viz) as Array<keyof MediaLook['viz']>) {
      expect(look.viz[k]).toBe(s[k])
    }
  })

  it('themes resolve through the app theme, accent included', () => {
    const look = capture()
    expect(look.resolveTheme).toBe(resolveVizTheme)
  })

  it('a width names the same class, an unknown one falls back to full', () => {
    const look = capture()
    for (const w of Object.keys(WIDTHS)) expect(look.widthClass(w)).toBe(WIDTHS[w])
    expect(look.widthClass('nonsense')).toBe(WIDTHS.full)
  })

  it('a view with no host says so instead of guessing a look', () => {
    const Probe = (): null => {
      useMediaLook()
      return null
    }
    expect(() => renderToString(createElement(Probe))).toThrow(/MediaLook/)
  })
})
