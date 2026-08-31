import type { JSX } from 'react'
import type { MenuItem } from '../components/ContextMenu'

/**
 * The file verbs every surface shares.
 *
 * Before this, "Show in File Explorer" and "Copy path" existed once, in the
 * sidebar's tree-row menu, and were unreachable from the picture you were
 * actually looking at (2026-08-30). Seven surfaces gained a right-click menu
 * in one pass and none of them should be re-typing these against
 * `window.prism.*` with a slightly different label.
 *
 * Kept deliberately small: the rows that mean the same thing wherever a file
 * is on screen. Anything kind-specific (rotate, speed, extract) belongs to
 * the surface that owns it.
 *
 * NO ICONS, and few shortcuts (owner decision, 2026-08-31). A menu over the
 * thing you are looking at is a short list of verbs, not a toolbar: the
 * glyphs added width and a column of colour to a panel whose whole job is to
 * be read in one glance, and a shortcut hint against a row everybody already
 * knows how to reach teaches nothing. The SIDEBAR's menu keeps its icons -
 * it sits among file rows that are themselves icon-led, and it is the one
 * menu with enough verbs to need scanning.
 */

/** A tick, or the space one would take, so labels line up either way. Ticks
 *  are not icons: they say what is currently ON, which is state the row
 *  cannot express any other way. */
export const tickIf = (on: boolean): JSX.Element =>
  on ? (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-80"
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  ) : (
    <span className="w-[13px] shrink-0" aria-hidden />
  )

/** Show in File Explorer, Copy path, Copy file: true wherever a file is. */
export function fileVerbs(path: string): MenuItem[] {
  return [
    { label: 'Show in File Explorer', onPick: () => window.prism.showInExplorer(path) },
    { label: 'Copy path', onPick: () => void navigator.clipboard.writeText(path) },
    { label: 'Copy file', onPick: () => void window.prism.copyFileToClipboard(path) }
  ]
}

/**
 * Next / Previous, of the same KIND, which is autoplay's rule.
 *
 * `canStep` answers whether there is one that way, so the row greys out at
 * the ends rather than doing nothing.
 */
export function stepVerbs(
  what: string,
  onStep: (dir: 1 | -1) => void,
  canStep: (dir: 1 | -1) => boolean
): MenuItem[] {
  return [
    { label: `Next ${what}`, disabled: !canStep(1), onPick: () => onStep(1) },
    { label: `Previous ${what}`, disabled: !canStep(-1), onPick: () => onStep(-1) }
  ]
}
