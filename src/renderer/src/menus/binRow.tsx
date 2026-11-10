import type { ViewerFile } from '@shared/types'
import type { BrowseEntry } from '../components/browse/types'
import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/icons/FileMenuIcon'

/**
 * THE RECYCLE BIN'S MENUS (Recycle Bin feature, D19; owner, 2026-11-10). One
 * builder file for the bin, as `archiveMenus.ts` is the zip's: the rows of its
 * list, the list's empty space and the sidebar row.
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
  /** Put these bin entries back where they came from (D13). */
  restore: (paths: string[]) => void
  /** Ask, then delete these for good (D14). */
  askDelete: (paths: string[]) => void
}

/**
 * A ROW OF THE BIN'S LIST (D12, D13, D14, D16). A binned item can be looked
 * at, put back, have its original path copied or be deleted for good; the row
 * that destroys is last and red. A folder is never opened (D10). With several
 * rows marked only what acts on all of them is offered, with the count. None
 * of the ordinary row's verbs (Cut, Paste, Rename, pins, Show in File
 * Explorer, Properties) is here: the bin is not a place you write to.
 */
export function binRowMenu(ctx: BinRowMenuContext): MenuItem[] {
  const { entry } = ctx
  if (ctx.paths && ctx.paths.length > 1) {
    const paths = ctx.paths
    return [
      {
        label: `Restore ${paths.length} items`,
        icon: <FileMenuIcon name="restore" />,
        onPick: () => ctx.restore(paths)
      },
      { label: 'Copy original paths', icon: <FileMenuIcon name="path" />, onPick: () => ctx.copyOriginalPaths(paths) },
      {
        label: `Delete ${paths.length} items permanently`,
        icon: <FileMenuIcon name="delete" />,
        danger: true,
        onPick: () => ctx.askDelete(paths)
      }
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
    { label: 'Restore', icon: <FileMenuIcon name="restore" />, onPick: () => ctx.restore([entry.path]) },
    { label: 'Copy original path', icon: <FileMenuIcon name="path" />, onPick: () => ctx.copyOriginalPaths([entry.path]) },
    {
      label: 'Delete permanently',
      icon: <FileMenuIcon name="delete" />,
      danger: true,
      onPick: () => ctx.askDelete([entry.path])
    }
  ]
}

export interface BinEmptySpaceMenuContext {
  /** How many items the bin holds (the list's count). */
  count: number
  onEmpty: () => void
}

/** A right press on the bin list's empty space: the one thing that is about
 *  the bin as a whole. Disabled, not hidden, when there is nothing to empty. */
export function binEmptySpaceMenu(ctx: BinEmptySpaceMenuContext): MenuItem[] {
  return [
    {
      label: 'Empty Recycle Bin',
      icon: <FileMenuIcon name="delete" />,
      danger: true,
      disabled: ctx.count === 0,
      onPick: ctx.onEmpty
    }
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
      danger: true,
      disabled: !ctx.onEmpty,
      onPick: () => ctx.onEmpty?.()
    }
  ]
}
