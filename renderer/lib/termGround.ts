import { ensureContrast, normalizeColor } from './termAnsi'
import type { TermTheme } from './termTheme'
import { DEFAULT_GROUND } from '../../shared/ground'

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

/** Text needs 4.5:1, as everywhere else in both apps. */
const TEXT_FLOOR = 4.5
/** The cursor and the sixteen need 3:1, the ANSI floor. */
const MARK_FLOOR = 3

/**
 * THE THEME ON THE GROUND IT IS ACTUALLY PAINTED ON (2026-09-28; owner: "do all
 * those we should do", of the known gap in the Background colour setting). A
 * theme's palette is made legible against ITS OWN background. Where the host
 * lets somebody pick another background (Prism Terminal's Background colour),
 * the panel paints that instead, and a palette measured against the old one
 * can vanish on the new: the theme's light text on a light pick, its blue on a
 * blue one. So the text, the cursor and all sixteen are floored again against
 * the ground in force, each moved only as far as it must be, the rule
 * `legiblePalette` already keeps. Pure. No ground, or the theme's own: the
 * theme, untouched.
 */
export function onGround(theme: TermTheme, ground: string | null | undefined): TermTheme {
  if (!ground) return theme
  const own = normalizeColor(theme.background, DEFAULT_GROUND).slice(0, 7).toLowerCase()
  const bg = normalizeColor(ground, own).slice(0, 7).toLowerCase()
  if (bg === own) return theme
  const ownCursor = normalizeColor(theme.cursor, '#5b5bd6').slice(0, 7)
  const cursor = ensureContrast(ownCursor, bg, MARK_FLOOR)
  // A selection the theme CHOSE keeps its colour and alpha (#112); only the
  // derived one (`<cursor>55`) follows the floored cursor, as it always did.
  const derived = theme.selectionBackground.toLowerCase() === `${ownCursor.toLowerCase()}55`
  const out: TermTheme = {
    ...theme,
    background: bg,
    foreground: ensureContrast(normalizeColor(theme.foreground, '#d7dae1').slice(0, 7), bg, TEXT_FLOOR),
    cursor,
    selectionBackground: derived ? `${cursor}55` : theme.selectionBackground
  }
  for (const k of ANSI_KEYS) {
    const v = theme[k]
    if (typeof v === 'string') out[k] = ensureContrast(normalizeColor(v, '#888888').slice(0, 7), bg, MARK_FLOOR)
  }
  return out
}
