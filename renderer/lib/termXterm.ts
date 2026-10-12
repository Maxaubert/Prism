import { parseColour, toStored } from './colour'
import { normalizeColor } from './termAnsi'
import type { TermTheme } from './termTheme'
import { DEFAULT_GROUND } from '../../shared/ground'

export type XtermTheme = TermTheme & {
  cursorAccent?: string
  scrollbarSliderBackground?: string
  scrollbarSliderHoverBackground?: string
  scrollbarSliderActiveBackground?: string
}

/**
 * The theme as handed to xterm. Pure, so what xterm gets is tested.
 *
 * EVERY VALUE IS `#rrggbb` OR `#rrggbbaa` (#112). xterm 6 parses those and
 * comma `rgba()` only; space syntax and `hsla()` go to a canvas path that
 * throws on anything not opaque. A colour with an alpha now reaches here (a
 * Custom selection, a host style's `rgba()` ground), so each is put in the
 * one stored form on the way out.
 *
 * THE PANEL PAINTS THE GROUND, NOT XTERM (2026-09-19, owner screenshot: a grey
 * bar along the bottom of a black terminal). xterm sizes itself in whole rows,
 * MEASURED at 604px in a 611px box, so a few pixels under the last row are
 * never xterm's to paint. While the canvas carried the ground and the box
 * around it was transparent, that strip showed the native window background
 * instead of the theme. So where the panel paints the ground (`paintsGround`)
 * the canvas is clear: every pixel of the panel gets exactly ONE coat, and two
 * translucent coats would be a visibly darker panel on an acrylic window.
 * Where the host paints behind the panel (Prism's dock) the canvas carries
 * the ground, clear only when asked (`clearGround`: following an acrylic
 * style, so the window's material shows through).
 *
 * The block cursor draws the character under it in `cursorAccent`, which
 * defaults to the background; on a clear background that would be a hole, so
 * it is named.
 */
export function xtermTheme(base: TermTheme, how: { paintsGround: boolean; clearGround: boolean }): XtermTheme {
  // THE SCROLLBAR WEARS THE THEME (owner, 2026-09-23: "make the scrollbar more
  // minimalistic and make sure it follows the theme"). xterm 6 draws its own
  // slider, coloured from these three; left unset they are a fixed grey on
  // every theme. The text ink at 40%, 65% under the pointer or a drag, which
  // is Prism's scrollbar rule; its size and shape are in the hosts' CSS.
  const ink = normalizeColor(base.foreground, '#cccccc').slice(0, 7)
  let theme: XtermTheme = {
    ...base,
    scrollbarSliderBackground: `${ink}66`,
    scrollbarSliderHoverBackground: `${ink}a6`,
    scrollbarSliderActiveBackground: `${ink}a6`
  }
  if (how.paintsGround) {
    // Flattened first: a custom theme may hold #rgb, #rrggbbaa or an rgba().
    theme = { ...theme, background: '#00000000', cursorAccent: normalizeColor(base.background, DEFAULT_GROUND) }
  } else if (how.clearGround) theme = { ...theme, background: '#00000000' }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(theme)) {
    const c = typeof v === 'string' ? parseColour(v) : null
    out[k] = c ? toStored(c) : v
  }
  return out as unknown as XtermTheme
}
