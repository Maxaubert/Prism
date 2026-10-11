import { composite } from './colour'
import { contrastRatio, mixHex } from './termAnsi'

/**
 * THE RAINBOW FINISH (#143; owner, 2026-10-10: "keep the like that border that
 * moves slowly"). A finished tab wears the app icon's own ribbon, flowing. The
 * seven colours are `build/icon-source.png`'s, as the approved mockups sampled
 * them, in the order the ribbon runs.
 */
export const ICON_RAINBOW = ['#12cee5', '#2179fa', '#945af5', '#e84fd2', '#fb7f6c', '#f0a934', '#e8d021'] as const

/** The lowest contrast of `c` over every ground it can sit on. */
const worstOn = (c: string, grounds: readonly string[]): number =>
  Math.min(...grounds.map((g) => contrastRatio(c, g)))

/**
 * A mark's colour moved to a contrast floor against EVERY ground it can sit on
 * (the bare strip and, under Prompt, both segment shades). Mixed towards black
 * on a light ground and towards white on a dark one, so it keeps its hue: a
 * linear mix with black or white only scales the distance from it. The least
 * step that clears the floor, in 2% steps as the mockups measured (on Paper
 * the lowest landed at 3.01:1). A floor no step reaches gets the step that came
 * nearest, never an error.
 */
export function floorMark(c: string, grounds: readonly string[], floor = 3): string {
  if (!grounds.length || worstOn(c, grounds) >= floor) return c
  // Judged on the darkest ground for a light-or-dark answer that holds for all.
  const dark = grounds.reduce((a, g) => (contrastRatio('#ffffff', g) < contrastRatio('#ffffff', a) ? a : g), grounds[0])
  const to = contrastRatio('#ffffff', dark) >= contrastRatio('#000000', dark) ? '#ffffff' : '#000000'
  let best = c
  let bestScore = worstOn(c, grounds)
  for (let i = 1; i <= 50; i += 1) {
    const m = mixHex(c, to, i * 0.02)
    const score = worstOn(m, grounds)
    if (score >= floor) return m
    if (score > bestScore) {
      best = m
      bestScore = score
    }
  }
  return best
}

/** The seven, each floored on these grounds. */
export function rainbowOn(grounds: readonly string[], floor = 3): string[] {
  return ICON_RAINBOW.map((c) => floorMark(c, grounds, floor))
}

/** The ribbon as a gradient that LOOPS (its first colour again at the end), so
 *  a tile slid by its own length is seamless: along a line (`x`) or down an
 *  edge (`y`). */
export function rainbowGradient(cols: readonly string[], axis: 'x' | 'y'): string {
  return `linear-gradient(${axis === 'x' ? '90deg' : '180deg'}, ${[...cols, cols[0]].join(', ')})`
}

/** The icon's seven, RAW, across a whole Full fill as a looping gradient
 *  (2026-10-10 rework, choice 1A: "the solid flowing rainbow across the whole
 *  finished tab"). Not floored: a fill is the colour itself, and the name's ink
 *  is what is held to the rule (`rainbowInk`). */
export function rainbowFillX(): string {
  return rainbowGradient(ICON_RAINBOW, 'x')
}

/** A see-through colour as the opaque one it shows over the solid ground: Full
 *  fills a tab SOLID (owner, 2026-10-10), so a half-alpha working colour (#112)
 *  is laid on the window's own ground first. */
export function opaqueOver(c: string, ground: string): string {
  return composite(c, ground)
}
