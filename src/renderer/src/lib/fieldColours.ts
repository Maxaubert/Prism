/**
 * The Explorer toolbar's two fields, the address and the search (#267; owner,
 * 2026-10-04, of the toolbar on Void: "make the url box more visible and for
 * the black theme make the grey colours used in search and in the url bar
 * darker grey").
 *
 * On a near-black ground a field is told apart by its EDGE, not by a lighter
 * slab: the fill steps only a shade off the ground, and a QUIET edge carries
 * the shape. It was drawn at the 3:1 a control's boundary is held to, and on
 * true black that read as a white frame (owner, 2026-10-04: "the white border
 * stands out too much on the black theme"), so it is a dim grey, Dolphin's
 * kind of line, and the owner's word is the measure here. Anywhere else the
 * fields keep the fill and edge the search always had.
 *
 * Near-black is MEASURED from the ground's luminance, never read off a style's
 * name: a custom black style gets it too, and Void with a tinted material
 * that lifts the ground does not.
 */

/** Darker than #121212 (luminance 0.006): Void, Default, Terminal and the
 *  acrylic black are under it; Driftwood's brown (0.008) is not. */
export const NEAR_BLACK = 0.006

/** How far the fill steps from the ground towards the text. Today's control
 *  is 3.5%, which read as a grey slab on true black; 2.5% sits into the page. */
const FILL_STEP = 0.025

const rgbOf = (hex: string): number[] => {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hexOf = (c: number[]): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const mixHex = (a: string, b: string, t: number): string => {
  const A = rgbOf(a)
  const B = rgbOf(b)
  return hexOf(A.map((v, i) => v + (B[i] - v) * t))
}

export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastOf(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

export const isNearBlack = (ground: string): boolean => luminance(ground) < NEAR_BLACK

/** The edge's contrast on black, and the hovered edge's: a hint of a line,
 *  and a step stronger under the pointer. */
const EDGE = 1.6
const EDGE_HOVER = 2.2

/** The first step from `ground` towards `text` that reaches `floor`, in 1%
 *  steps: the quietest line that still meets it, never brighter than needed. */
function lineAt(ground: string, text: string, floor: number): string {
  for (let t = 0.01; t < 1; t += 0.01) {
    const c = mixHex(ground, text, t)
    if (contrastOf(c, ground) >= floor) return c
  }
  return text
}

export interface FieldColours {
  fill: string
  edge: string
  /** The edge under the pointer: a step stronger, so a field still answers
   *  a hover now that its fill no longer changes. */
  edgeHover: string
}

/**
 * The field's colours on a near-black `ground` (both flat hex), or null where
 * the style's own control fill and edge stay in force.
 */
export function nearBlackField(ground: string, text: string): FieldColours | null {
  if (!isNearBlack(ground)) return null
  return {
    fill: mixHex(ground, text, FILL_STEP),
    edge: lineAt(ground, text, EDGE),
    edgeHover: lineAt(ground, text, EDGE_HOVER)
  }
}

/** A hint (the search's placeholder) held to 4.5:1 on the field it sits in:
 *  the dim ink is chosen against the page, and on a light style's field fill
 *  it fell to 3.95:1 (MEASURED on Paper). Walks the hint towards the text
 *  only as far as that takes. */
export function hintOn(hint: string, text: string, field: string): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mixHex(hint, text, t)
    if (contrastOf(c, field) >= 4.5) return c
  }
  return text
}
