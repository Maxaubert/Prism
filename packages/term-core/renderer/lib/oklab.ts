import { contrastRatio, luminance } from './termAnsi'

/** OKLab, where equal steps in lightness look equal: the sidebar's step and
 *  the accent's lift are measured in it. */
export type Lab = [number, number, number]

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const unlin = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function toLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

/** Back to a 6-digit hex, each channel clipped to the screen's range. */
export function fromLab([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, unlin(Math.max(0, v)))) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** OKLab lightness, 0 black to 1 white. */
export const okLightness = (hex: string): number => toLab(hex)[0]

/** A colour at another lightness, its chroma scaled with the lightness so it
 *  keeps the look of the colour it was: a dark red lifted is a red. */
export function atLightness(hex: string, L: number): string {
  const [l0, a, b] = toLab(hex)
  const k = l0 > 0.001 ? L / l0 : 0
  return fromLab([L, a * k, b * k])
}

/**
 * A colour moved, by lightness alone, until it reads at `floor` on every
 * ground: lighter on a dark ground, darker on a light one. Mixing with white
 * greyed a picked dark red to a pink grey (owner, 2026-10-12: the theme
 * switch's Save "doesnt follow the accent color", with #140707 picked); this
 * keeps the hue and the saturation. Null when no lightness clears the floor.
 */
export function liftToFloor(hex: string, grounds: readonly string[], floor: number): string | null {
  const reads = (c: string): boolean => grounds.every((g) => contrastRatio(c, g) >= floor)
  if (reads(hex)) return hex
  const up = luminance(grounds[0]) < 0.18
  const L0 = okLightness(hex)
  for (let i = 1; i <= 100; i += 1) {
    const L = up ? L0 + (1 - L0) * (i / 100) : L0 * (1 - i / 100)
    const c = atLightness(hex, L)
    if (reads(c)) return c
  }
  return null
}
