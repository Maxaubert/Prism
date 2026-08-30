import type { JSX } from 'react'
import type { MenuItem } from '../components/ContextMenu'

/**
 * The file verbs every surface shares.
 *
 * Before this, "Show in File Explorer" and "Copy path" existed once, in the
 * sidebar's tree-row menu, and were unreachable from the picture you were
 * actually looking at (2026-08-30). Seven surfaces gained a right-click menu
 * in one pass and none of them should be re-typing these against
 * `window.prism.*` with a slightly different label and a different icon.
 *
 * Kept deliberately small: the rows that mean the same thing wherever a file
 * is on screen. Anything kind-specific (rotate, speed, extract) belongs to
 * the surface that owns it.
 */

/** The menu glyph: 13px, hairline, quiet. Matches the sidebar's own. */
export const MenuIcon = ({ d }: { d: string }): JSX.Element => (
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
    <path d={d} />
  </svg>
)

/** A tick, or the space one would take, so labels line up either way. */
export const tickIf = (on: boolean): JSX.Element =>
  on ? <MenuIcon d="M5 12.5l4.5 4.5L19 7" /> : <span className="w-[13px] shrink-0" aria-hidden />

/** Show in File Explorer, Copy path, Copy file: true wherever a file is. */
export function fileVerbs(path: string): MenuItem[] {
  return [
    {
      label: 'Show in File Explorer',
      icon: <MenuIcon d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />,
      onPick: () => window.prism.showInExplorer(path)
    },
    {
      label: 'Copy path',
      icon: (
        <MenuIcon d="M9 15l6-6M7.5 10.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M16.5 13.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
      ),
      onPick: () => void navigator.clipboard.writeText(path)
    },
    {
      label: 'Copy file',
      icon: <MenuIcon d="M8 8h12v12H8zM16 8V4H4v12h4" />,
      onPick: () => void window.prism.copyFileToClipboard(path)
    }
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
    {
      label: `Next ${what}`,
      hint: '→',
      disabled: !canStep(1),
      icon: <MenuIcon d="M9 6l6 6-6 6" />,
      onPick: () => onStep(1)
    },
    {
      label: `Previous ${what}`,
      hint: '←',
      disabled: !canStep(-1),
      icon: <MenuIcon d="M15 6l-6 6 6 6" />,
      onPick: () => onStep(-1)
    }
  ]
}
