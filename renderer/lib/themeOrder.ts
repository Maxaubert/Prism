/**
 * The order of the terminal theme wall (#157). The owner, 2026-10-10: "ordered
 * from black to white ... dark colours should be before all coloured, maybe
 * actually coloured themes last, first black to white then coloured". So:
 * the neutral themes first, black to white, then the coloured ones, black to
 * white. Computed off each ground, never typed, so a new theme files itself.
 */
import { normalizeColor } from './termAnsi'
import { toLab } from './oklab'

/**
 * OKLab lightness L (0 black .. 1 white, perceptual: "the black or white
 * scale") and chroma C (how coloured) of a colour, in the one OKLab (oklab.ts).
 * Perceptual on purpose: WCAG luminance puts a saturated blue far darker than
 * it looks, which would file it among the blacks.
 */
export function oklch(colour: string): { L: number; C: number } {
  const [L, A, B] = toLab(normalizeColor(colour, '#000000'))
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
