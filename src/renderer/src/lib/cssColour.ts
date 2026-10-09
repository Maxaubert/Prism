import type { Rgba } from '@shared/sweepOverlay'

/**
 * A computed CSS colour as straight-alpha bytes, for the native sweep box
 * (#338): the band's own `background-color` and `border-top-color`, read off
 * the element, so the native box wears exactly the theme's colours. Only the
 * forms Chromium's computed style produces: `rgb()` / `rgba()` (either
 * syntax), `color(srgb r g b / a)` (what a `color-mix` in srgb serialises to)
 * and `transparent`. Anything else is null, and the caller keeps the DOM box.
 */
const NUM = String.raw`(-?[\d.]+(?:e-?\d+)?)`
const ALPHA = String.raw`(-?[\d.]+(?:e-?\d+)?%?)`
const RGB = new RegExp(
  String.raw`^rgba?\(\s*${NUM}\s*(?:,\s*|\s+)${NUM}\s*(?:,\s*|\s+)${NUM}\s*(?:(?:,|\/)\s*${ALPHA}\s*)?\)$`
)
const SRGB = new RegExp(String.raw`^color\(srgb\s+${NUM}\s+${NUM}\s+${NUM}\s*(?:\/\s*${ALPHA}\s*)?\)$`)

const byte = (v: number): number => Math.round(Math.min(255, Math.max(0, v)))
const alpha = (s: string | undefined): number | null => {
  if (s === undefined) return 255
  const v = s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s)
  return Number.isFinite(v) ? byte(v * 255) : null
}

export function cssColour(s: string): Rgba | null {
  const t = s.trim()
  if (t === 'transparent') return [0, 0, 0, 0]
  let m = RGB.exec(t)
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number)
    const a = alpha(m[4])
    if (![r, g, b].every(Number.isFinite) || a === null) return null
    return [byte(r), byte(g), byte(b), a]
  }
  m = SRGB.exec(t)
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number)
    const a = alpha(m[4])
    if (![r, g, b].every(Number.isFinite) || a === null) return null
    return [byte(r * 255), byte(g * 255), byte(b * 255), a]
  }
  return null
}
