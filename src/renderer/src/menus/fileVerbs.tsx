import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/icons/FileMenuIcon'
import { canCopyText, clipboardText } from '../lib/clipboardText'

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
 * Viewer menus retain their compact text presentation by default. Surfaces
 * that use the shared file-menu icons can opt in without changing actions.
 */

/**
 * Where the file is: the two rows that mean the same thing wherever it is.
 *
 * NOT "Copy file" (2026-08-31). Over the picture it sat next to "Copy image"
 * and the pair read as the same verb twice - and they are not the same at
 * all: one puts a FILE on the clipboard for Explorer, the other puts PIXELS
 * on it for whatever you are pasting into. Copying a file as a file is what
 * the sidebar is for, where it stands among the other file operations and
 * nothing is competing with it.
 *
 * On a host with no Explorer (the phone page, #106) only Copy path is
 * offered: the path is the browser's own clipboard, which every host has,
 * and a row that does nothing when tapped is worse than no row.
 */
export function fileVerbs(path: string, { icons = false }: { icons?: boolean } = {}): MenuItem[] {
  // `navigator.clipboard` is a SECURE-CONTEXT api and the phone page is
  // plain http by design, so on a phone it is simply not there: the row
  // threw rather than copying. The old execCommand path still works in that
  // context, and a host with neither does not offer the row at all.
  const copyPath: MenuItem | null = canCopyText()
    ? {
        label: 'Copy path',
        icon: icons ? <FileMenuIcon name="path" /> : undefined,
        onPick: () => void clipboardText(path)
      }
    : null
  if (!window.prism.capabilities.explorer) return copyPath ? [copyPath] : []
  // Copy path first, beside whatever else the menu copies, and Show in File
  // Explorer last (owner, 2026-10-12: the clipboard rows in one place).
  return [
    ...(copyPath ? [copyPath] : []),
    {
      label: 'Show in File Explorer',
      icon: icons ? <FileMenuIcon name="folder" /> : undefined,
      onPick: () => window.prism.showInExplorer(path)
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
    { label: `Next ${what}`, disabled: !canStep(1), onPick: () => onStep(1) },
    { label: `Previous ${what}`, disabled: !canStep(-1), onPick: () => onStep(-1) }
  ]
}
