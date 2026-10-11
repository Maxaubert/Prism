import { ICON_RAINBOW } from './markColours'
import { contrastRatio, luminance, mixHex } from './termAnsi'

/** Under this, the theme's text on a fill is gone and the name flips. */
export const NAME_FLIP = 2

/** Dark or light, MEASURED off the ground (regression rule 15), with the
 *  chrome's own threshold (`chromeTokens`: light above 0.4). */
export const groundIsDark = (ground: string): boolean => luminance(ground) <= 0.4

/**
 * THE NAME ON A FULL TAB (#143; owner, 2026-10-10: "Every tab name in Full
 * uses the theme's own text colour ... A filled tab changes its name to the
 * opposite colour ... only when the theme's text colour would read under 2:1
 * on that state's full fill colour"). Decided once per state colour, from the
 * fill at full strength, so a breathing question's name never changes as its
 * fill fades. The opposite is black on a dark theme and white on a light one,
 * and which theme it is comes from the GROUND, never from the text.
 */
export function nameInk(fill: string, text: string, darkGround: boolean): string {
  if (contrastRatio(text, fill) >= NAME_FLIP) return text
  return darkGround ? '#0b0b0b' : '#ffffff'
}

/** Every colour that can sit under a name on the flowing rainbow: the seven
 *  stops and the blends at 25, 50 and 75% between each and the next. */
const RAINBOW_SAMPLES = ICON_RAINBOW.flatMap((c, i) =>
  [0, 0.25, 0.5, 0.75].map((t) => mixHex(c, ICON_RAINBOW[(i + 1) % ICON_RAINBOW.length], t))
)
const worstOnRainbow = (ink: string): number => Math.min(...RAINBOW_SAMPLES.map((c) => contrastRatio(ink, c)))

/**
 * THE NAME ON THE RAINBOW FILL (2026-10-10 rework). The ribbon flows under the
 * name, so its ink is chosen ONCE, never per frame, from the WORST colour that
 * can be under it: the text is kept if its worst is 2:1 or better, else the
 * opposite if its worst is better. Measured: Volt's text 1.4:1 worst (the
 * yellow) and black 4.6:1, so it flips; Paper's text holds at 3.5:1.
 */
export function rainbowInk(text: string, darkGround: boolean): string {
  const keep = worstOnRainbow(text)
  if (keep >= NAME_FLIP) return text
  const opposite = darkGround ? '#0b0b0b' : '#ffffff'
  return worstOnRainbow(opposite) > keep ? opposite : text
}
