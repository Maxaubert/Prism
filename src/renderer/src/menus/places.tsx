import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/icons/FileMenuIcon'
import type { QuickAccessPin } from '../lib/quickAccess'
import { fileVerbs } from './fileVerbs'

/**
 * THE PLACES PANEL'S MENU (#296): what the user right-clicks in the Explorer's
 * places column, a Quick access or Pinned pin, a This PC
 * drive (`components/browse/BrowsePlaces.tsx`, opened by a right click, the
 * menu key or Shift+F10). One menu for all of them; a pin, or a place that is
 * also pinned, gets the pin rows, anything else gets "Pin to Quick access".
 */

export interface PlacesMenuContext {
  /** The place right-clicked, as a pin (a drive is a folder). */
  pin: QuickAccessPin
  /** Whether that path is in the pin list, whichever row opened the menu. */
  pinned: boolean
  /** The pins of the section the path belongs to, in order, and its index
   *  there (-1 when it is not in it), for Move up and Move down. */
  siblings: QuickAccessPin[]
  index: number
  /** Marks the row the menu came from as the picked place. */
  onChoose: () => void
  onNavigate: (path: string) => void
  /** Each optional action leaves its row DISABLED when absent. */
  onQuickAccessFile?: (path: string, full?: boolean) => void
  onOpenNewTab?: (path: string, isFolder?: boolean) => void
  onUnpinQuickAccess?: (path: string) => void
  onMoveQuickAccess?: (path: string, beforePath?: string) => void
  onPinQuickAccessPaths?: (paths: string[], beforePath?: string) => void
  /** Opens the place's Properties (the panel knows whether it is a drive). */
  onProperties?: () => void
}

export function placesMenu(ctx: PlacesMenuContext): MenuItem[] {
  const { pin, siblings, index } = ctx
  return [
    {
      label: 'Open',
      icon: <FileMenuIcon name="open" />,
      onPick: () => {
        if (!pin.isFolder) {
          ctx.onQuickAccessFile?.(pin.path, true)
          return
        }
        // Open from a place's menu is a pick of that place.
        ctx.onChoose()
        ctx.onNavigate(pin.path)
      }
    },
    {
      label: 'Open in new tab',
      icon: <FileMenuIcon name="new-tab" />,
      disabled: !ctx.onOpenNewTab,
      onPick: () => ctx.onOpenNewTab?.(pin.path, pin.isFolder)
    },
    // The clipboard row, then the pin rows, then where it is and its facts
    // (owner, 2026-10-12: the same order as a file or folder row).
    ...fileVerbs(pin.path)
      .filter((item) => item.label === 'Copy path')
      .map((item) => ({ ...item, icon: <FileMenuIcon name="path" /> })),
    ...(ctx.pinned
      ? [
          {
            label: 'Unpin from Quick access',
            icon: <FileMenuIcon name="unpin" />,
            disabled: !ctx.onUnpinQuickAccess,
            onPick: () => ctx.onUnpinQuickAccess?.(pin.path)
          },
          {
            label: 'Move up',
            icon: <FileMenuIcon name="up" />,
            disabled: !ctx.onMoveQuickAccess || index <= 0,
            onPick: () => ctx.onMoveQuickAccess?.(pin.path, siblings[index - 1]?.path)
          },
          {
            label: 'Move down',
            icon: <FileMenuIcon name="down" />,
            disabled: !ctx.onMoveQuickAccess || index < 0 || index >= siblings.length - 1,
            // Before the row after next; the last row moves to the
            // end, which is the end of its section too.
            onPick: () => ctx.onMoveQuickAccess?.(pin.path, siblings[index + 2]?.path)
          }
        ]
      : [
          {
            label: 'Pin to Quick access',
            icon: <FileMenuIcon name="pin" />,
            disabled: !ctx.onPinQuickAccessPaths,
            onPick: () => ctx.onPinQuickAccessPaths?.([pin.path])
          }
        ]),
    ...fileVerbs(pin.path)
      .filter((item) => item.label !== 'Copy path')
      .map((item) => ({ ...item, icon: <FileMenuIcon name="folder" /> })),
    // Files, folders AND drives have Properties (owner, 2026-10-12); a drive
    // shows its own facts (sizes, kind), not a walk of the whole disk.
    {
      label: 'Properties',
      icon: <FileMenuIcon name="properties" />,
      disabled: !ctx.onProperties,
      onPick: () => ctx.onProperties?.()
    }
  ]
}
