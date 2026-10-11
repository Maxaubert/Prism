/**
 * The order of the terminal theme wall (#157). The owner, 2026-10-10: "ordered
 * from black to white ... dark colours should be before all coloured, maybe
 * actually coloured themes last, first black to white then coloured". So:
 * the neutral themes first, black to white, then the coloured ones, black to
 * white. Computed off each ground, never typed, so a new theme files itself.
 */
import { normalizeColor } from './termAnsi'

/** sRGB channel (0..1) to linear light. */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * OKLab lightness L (0 black .. 1 white, perceptual: "the black or white
 * scale") and chroma C (how coloured) of a colour; Bjorn Ottosson's matrices.
 * Perceptual on purpose: WCAG luminance puts a saturated blue far darker than
 * it looks, which would file it among the blacks.
 */
export function oklch(colour: string): { L: number; C: number } {
  const hex = normalizeColor(colour, '#000000')
  const r = linear(parseInt(hex.slice(1, 3), 16) / 255)
  const g = linear(parseInt(hex.slice(3, 5), 16) / 255)
  const b = linear(parseInt(hex.slice(5, 7), 16) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B) }
}

/**
 * Below this OKLab chroma a ground reads as neutral. MEASURED (2026-10-10, the
 * forty preset grounds sorted by C; High Contrast, one of the greys, left on
 * 2026-10-11): 0 (six pure greys), 0.0027 Mist, 0.0055
 * Volt, 0.0058 Catppuccin Latte, 0.0082 Paper, 0.0085 Prism, 0.0109 Monokai,
 * then 0.0147 Sage, 0.0149 Cinder and Blossom, 0.0157 Horizon and up to 0.1316
 * Retro. 0.0109 to 0.0147 is the widest gap below 0.02, and this sits in it;
 * a unit test keeps every preset at least 0.001 away from it.
 */
export const NEUTRAL_CHROMA = 0.0125

/**
 * Neutral grounds first, then coloured, each group black to white by OKLab L.
 * A copy; ties keep the input order (Array.prototype.sort is stable).
 */
export function orderTermThemes<T extends { bg: string }>(list: readonly T[]): T[] {
  const keyed = list.map((item) => {
    const { L, C } = oklch(item.bg)
    return { item, L, coloured: C >= NEUTRAL_CHROMA ? 1 : 0 }
  })
  keyed.sort((a, b) => a.coloured - b.coloured || a.L - b.L)
  return keyed.map((k) => k.item)
}
