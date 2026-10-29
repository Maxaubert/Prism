/**
 * Prism's colour maths on hex, in one place (structure cleanup, 2026-10-12:
 * theme.ts, fieldColours.ts, the visualizer and nine tests each had a copy).
 * `cssColour.ts` (computed CSS colours) and `accentAlpha.ts` (the stored
 * accent alpha) sit beside it.
 */

/** `[r, g, b]` of `#rgb`, `#rrggbb` or `#rrggbbaa`. The first SIX digits only:
 *  a colour may carry an alpha (#249 rework), and parsing all eight shifted G,
 *  B and A into R, G and B. */
export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `#rrggbb` of channels in 0-255, rounded. */
export const rgbToHex = (c: readonly number[]): string =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/**
 * The mix (`a` moved `t` of the way to `b`), WCAG luminance (0 black to 1
 * white) and contrast (1 to 21, either order) are the core's (2026-10-28):
 * this file had its own copy from when the core lived in another repo. Same
 * maths; the core's mix also clamps each channel to 0-255.
 */
export {
  mixHex as mix,
  luminance,
  contrastRatio as contrast
} from 'prism-term-core/renderer/lib/colourMath'
