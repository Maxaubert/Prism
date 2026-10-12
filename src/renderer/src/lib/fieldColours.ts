import { contrast, luminance, mix } from './colour'

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

export const isNearBlack = (ground: string): boolean => luminance(ground) < NEAR_BLACK

/** The edge's contrast on black, and the hovered edge's: a hint of a line,
 *  and a step stronger under the pointer. */
const EDGE = 1.6
const EDGE_HOVER = 2.2

/** The first step from `ground` towards `text` that reaches `floor`, in 1%
 *  steps: the quietest line that still meets it, never brighter than needed. */
function lineAt(ground: string, text: string, floor: number): string {
  for (let t = 0.01; t < 1; t += 0.01) {
    const c = mix(ground, text, t)
    if (contrast(c, ground) >= floor) return c
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
 *
 * `row` is the ground the field actually SITS on, when that is not the page's
 * (#306: the address row wears the sidebar colour, a step off the page). The
 * style is judged near-black by its page, so a black style whose sidebar is
 * lifted keeps its quiet field; the colours step off the row, or a fill one
 * shade off the page vanished into a sidebar one shade off it the other way
 * (MEASURED: 1.01:1 on Void and Aurora).
 */
export function nearBlackField(ground: string, text: string, row: string = ground): FieldColours | null {
  if (!isNearBlack(ground)) return null
  return {
    fill: mix(row, text, FILL_STEP),
    edge: lineAt(row, text, EDGE),
    edgeHover: lineAt(row, text, EDGE_HOVER)
  }
}

/** The field's fill anywhere else: the control step (3.5% towards the text on
 *  dark, 9% on light), taken from the ground the field sits on. */
export function controlFieldOn(row: string, text: string, light: boolean): string {
  return mix(row, text, light ? 0.09 : 0.035)
}

/** A hint (the search's placeholder) held to 4.5:1 on the field it sits in:
 *  the dim ink is chosen against the page, and on a light style's field fill
 *  it fell to 3.95:1 (MEASURED on Paper). Walks the hint towards the text
 *  only as far as that takes. */
export function hintOn(hint: string, text: string, field: string): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(hint, text, t)
    if (contrast(c, field) >= 4.5) return c
  }
  return text
}
