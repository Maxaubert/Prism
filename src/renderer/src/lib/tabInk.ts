import { contrastRatio } from 'prism-term-core/renderer/lib/termAnsi'
import { mix } from './theme'

/**
 * The ink on a FULL agent tab, chosen on what the eye sees (#253).
 *
 * The working colour can carry an alpha once the core's colour picker lands
 * (owner, 2026-10-03: "an alpha per colour on every colour setting"). Chosen on
 * the raw tint, `contrastRatio` reads only its first six digits and judges the
 * colour as if it were solid, so a light tint at a quarter over a dark strip
 * took black text on what is in fact a dark fill. So the tint is laid on the
 * strip's own opaque ground first. An opaque tint is unchanged, byte for byte.
 * Prism Terminal's core gets its own `inkOn` for this; the swap to it is the
 * #251 rework's.
 */

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as six hex digits and an alpha,
 *  or null for anything else. */
function split(c: string): { hex: string; a: number } | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim())
  if (!m) return null
  const s = m[1].length <= 4 ? [...m[1]].map((d) => d + d).join('') : m[1]
  const hex = '#' + s.slice(0, 6).toLowerCase()
  const a = s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1
  return { hex, a }
}

/** The opaque colour a tint shows over `ground`. A ground that is not a plain
 *  hex colour (unset, or an rgba) is no ground: the tint is taken as solid,
 *  which is what the strip did before. */
export function tintOver(tint: string, ground: string): string {
  const t = split(tint)
  if (!t) return tint
  const g = split(ground)
  if (t.a >= 1 || !g) return t.hex
  return mix(g.hex, t.hex, t.a)
}

/**
 * Text biases WHITE: strict contrast maths picks black on the default orange,
 * but white-on-orange is the look; black only wins on genuinely light fills
 * (contrast against black of 12 is a ~0.55 luminance threshold). The rule is
 * the strip's own, unchanged; only what it is measured on moved.
 */
export function tabInk(tint: string, ground: string): string {
  return contrastRatio('#000000', tintOver(tint, ground)) < 12 ? '#ffffff' : '#000000'
}
