import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The phone is sized from a stylesheet, and a stylesheet names structure that
 * lives in another file (2026-09-08, #107).
 *
 * That is the deal `phone.css` makes: the shared players keep the desktop's
 * sizes and the phone scales them from outside, which is the only arrangement
 * in which a phone-sized transport cannot reach the app window. The price is
 * that a selector can go stale silently - rename a marker in Transport.tsx and
 * the phone quietly goes back to desktop-sized controls, with nothing red
 * anywhere. So the markers are checked the way the installer's extensions are:
 * every name the stylesheet reaches for must be rendered by the component that
 * owns it.
 *
 * The floor is checked too. 44px is what Apple asks for and 48dp what Google
 * does; it is a platform number rather than a taste, so it is asserted rather
 * than left to whoever next edits the file.
 */

const css = readFileSync('src/renderer/src/phone/phone.css', 'utf8')

/** Where each marker the stylesheet uses is rendered. */
const owners: Record<string, string> = {
  'data-phone-stage': 'src/renderer/src/phone/PhoneViewer.tsx',
  'data-transport-row': 'src/renderer/src/components/Transport.tsx',
  'data-time': 'src/renderer/src/components/Transport.tsx',
  'data-scrub': 'src/renderer/src/components/Transport.tsx',
  'data-scrub-track': 'src/renderer/src/components/Transport.tsx',
  'data-scrub-thumb': 'src/renderer/src/components/Transport.tsx',
  'data-vol-readout': 'src/renderer/src/components/VolumeReadout.tsx',
  'data-vol-pct': 'src/renderer/src/components/VolumeReadout.tsx'
}

describe('the phone sizes itself from one stylesheet', () => {
  it('declares the platform floor, and a row taller than it', () => {
    expect(/--phone-touch:\s*44px/.test(css)).toBe(true)
    const row = /--phone-row:\s*(\d+)px/.exec(css)
    expect(row).not.toBeNull()
    expect(Number(row?.[1])).toBeGreaterThan(44)
  })

  it('sizes its own touch targets from the token rather than a copy of 44', () => {
    // A second copy of 44 is the drift the token exists to prevent: it reads
    // as sized and then stops moving when the floor does.
    for (const f of ['src/renderer/src/phone/Browser.tsx', 'src/renderer/src/phone/PhoneViewer.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src).toContain('var(--phone-touch)')
      // The prose may say 44px; a class must not, or it stops moving when
      // the floor does.
      expect(/\[[^\]]*44px/.test(src)).toBe(false)
    }
    expect(readFileSync('src/renderer/src/phone/Browser.tsx', 'utf8')).toContain(
      'min-h-[var(--phone-row)]'
    )
  })

  it('reaches for no marker that has stopped being rendered', () => {
    const used = new Set([...css.matchAll(/\[(data-[a-z-]+)\]/g)].map((m) => m[1]))
    expect(used.size).toBeGreaterThan(0)
    for (const marker of used) {
      const owner = owners[marker]
      expect(owner, `${marker} is used in phone.css and owned by nothing`).toBeDefined()
      expect(readFileSync(owner, 'utf8'), `${marker} is gone from ${owner}`).toContain(marker)
    }
  })
})
