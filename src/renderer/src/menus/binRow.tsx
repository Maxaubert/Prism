import type { ViewerFile } from '@shared/types'
import type { BrowseEntry } from '../components/browse/types'
import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/icons/FileMenuIcon'

/**
 * THE RECYCLE BIN'S MENUS (Recycle Bin feature, D19; owner, 2026-11-10). One
 * builder file for the bin, as `archiveMenus.ts` is the zip's. This stage holds
 * the sidebar row's; the row and empty-space menus of the bin's own list join
 * it with the actions.
 */

export interface BinRowMenuContext {
  /** The row the press was on. */
  entry: BrowseEntry
  /** Several marked rows, when the press was on one of them (#257). */
  paths?: string[]
  openFile: (file: ViewerFile) => void
  showInPreview: (file: ViewerFile) => void
  /** The ORIGINAL full paths of these bin entries, as text (D16). */
  copyOriginalPaths: (paths: string[]) => void
}

/**
 * A ROW OF THE BIN'S LIST (D12, D16). Read-only: a binned item can be looked
 * at and its original path copied, and the actions (Restore, Delete
 * permanently) join in the next stage. A folder is never opened (D10). With
 * several rows marked only what acts on all of them is offered. None of the
 * ordinary row's verbs (Cut, Paste, Rename, pins, Show in File Explorer,
 * Properties) is here: the bin is not a place you write to.
 */
export function binRowMenu(ctx: BinRowMenuContext): MenuItem[] {
  const { entry } = ctx
  if (ctx.paths && ctx.paths.length > 1) {
    const paths = ctx.paths
    return [
      { label: 'Copy original paths', icon: <FileMenuIcon name="path" />, onPick: () => ctx.copyOriginalPaths(paths) }
    ]
  }
  const file = entry.file
  return [
    ...(file && !entry.isFolder
      ? [
          {
            label: 'Open',
            icon: <FileMenuIcon name="open" />,
            hint: 'Enter',
            onPick: () => ctx.openFile(file)
          },
          {
            label: 'Show in preview',
            icon: <FileMenuIcon name="split" />,
            onPick: () => ctx.showInPreview(file)
          }
        ]
      : []),
    { label: 'Copy original path', icon: <FileMenuIcon name="path" />, onPick: () => ctx.copyOriginalPaths([entry.path]) }
  ]
}

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
