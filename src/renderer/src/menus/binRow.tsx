import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/icons/FileMenuIcon'

/**
 * THE RECYCLE BIN'S MENUS (Recycle Bin feature, D19; owner, 2026-11-10). One
 * builder file for the bin, as `archiveMenus.ts` is the zip's. This stage holds
 * the sidebar row's; the row and empty-space menus of the bin's own list join
 * it with the actions.
 */

export interface BinPlaceMenuContext {
  /** Opens the bin and marks the row as the picked place. */
  onOpen: () => void
  /** Each optional action leaves its row DISABLED when absent. */
  onOpenNewTab?: () => void
  onEmpty?: () => void
}

/** The sidebar row's menu: Open, Open in new tab, Empty Recycle Bin. The row
 *  is not a pin, so it has no Unpin, Change icon or Properties; the row that
 *  deletes is last. */
export function binPlaceMenu(ctx: BinPlaceMenuContext): MenuItem[] {
  return [
    { label: 'Open', icon: <FileMenuIcon name="open" />, onPick: ctx.onOpen },
    {
      label: 'Open in new tab',
      icon: <FileMenuIcon name="new-tab" />,
      disabled: !ctx.onOpenNewTab,
      onPick: () => ctx.onOpenNewTab?.()
    },
    {
      label: 'Empty Recycle Bin',
      icon: <FileMenuIcon name="delete" />,
      disabled: !ctx.onEmpty,
      onPick: () => ctx.onEmpty?.()
    }
  ]
}
