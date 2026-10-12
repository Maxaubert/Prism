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

/** `a` moved `t` of the way to `b`, channel by channel. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t))
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two colours, 1 to 21, in either order. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
