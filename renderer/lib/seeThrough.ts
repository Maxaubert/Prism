import { opaque } from './colour'
import { luminance } from './termAnsi'

/**
 * THE SEE-THROUGH WINDOW'S DEFAULT (#156; owner, 2026-10-10: "add support for
 * the see through window setting ... its in prism in style settings i want it
 * here too"). Where the terminal owns the window acrylic (Prism Terminal), the
 * switch alone makes the window see-through, as Prism's does: an OPAQUE ground
 * under it paints at Prism's own levels, as they paint.
 *
 * Prism's `SEE_THROUGH_LEVEL` is 70 on a dark style and 49 on a light one
 * (the levels Glacier and Orchid paint). A level paints
 * `glass = 0.85 - level / 100 * 0.55`, alpha `1 - (1 - glass * 0.75) ^ 3`:
 * level 70 is 0.724, the byte 0xb9; level 49 is 0.820, the byte 0xd1. Stored
 * as those bytes so the window and the Alpha field name the same value.
 */
export const SEE_THROUGH_ALPHA = { dark: 0xb9 / 255, light: 0xd1 / 255 } as const

/**
 * The highest Alpha a ground may carry while the switch is on: 95%, the byte
 * 0xf2. Opaque is the switch's OFF (Prism's rule: the switch and the alpha
 * always agree), and an Alpha of 100 under the switch would read back as the
 * default and make the slider jump.
 */
export const SEE_THROUGH_MAX = 0xf2 / 255

/**
 * The default see-through for a ground: light or dark MEASURED from its own
 * opaque colour (relative luminance above 0.4, the test chromeTheme uses for
 * `data-mode`), never read off a theme's name. Unparseable reads as dark.
 */
export function seeThroughAlpha(ground: string): number {
  return luminance(opaque(ground)) > 0.4 ? SEE_THROUGH_ALPHA.light : SEE_THROUGH_ALPHA.dark
}
