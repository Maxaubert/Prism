import { createContext, useContext, type DragEvent, type MouseEvent } from 'react'
import type { DirListing } from '@shared/types'
import type { TREE_SIZES } from './treePrefs'

// What a tree row can do, shared through context so the recursive row components
// don't have to thread a dozen callbacks down every level.

export interface TreeApi {
  expanded: Set<string>
  children: Record<string, DirListing>
  currentPath: string | null
  /** Every file holding unsaved text: each says so with a bold name and a *. */
  dirtyPaths: ReadonlySet<string>
  /** The row the arrow keys are on. Usually the open file, but it steps onto
   *  folders too, where there is nothing to open and only a highlight to move. */
  cursor: string | null
  size: (typeof TREE_SIZES)[number]
  /** Path of the file being renamed right now, if any. */
  editing: string | null
  /** The row whose context menu is open: it holds the hover highlight while
   *  the menu is up, so the menu visibly belongs to it. */
  menuPath: string | null
  /** The navigation filter, applied to the rows as well: a file row renders
   *  only when this says so. Folders always render. */
  /** Explorer selection (2026-08-22): every selected row, filled accent. */
  selected: ReadonlySet<string>
  /** Rows marked CUT (2026-09-03): dimmed the way Explorer dims them, until
   *  the paste moves them or another copy takes the clipboard. Lower-cased. */
  cut: ReadonlySet<string>
  /** Whether this selected row touches another selected row above/below in
   *  the visible order: shared edges drop their rounding so a contiguous
   *  selection reads as one block. */
  selJoin: (path: string) => { top: boolean; bottom: boolean }
  /** A click: plain SELECTS AND OPENS (the tree keeps its quick-look
   *  single-click; only archives are double-click); shift ranges and ctrl
   *  toggles select WITHOUT opening. */
  onRowClick: (e: MouseEvent, path: string, isFolder: boolean) => void
  /* Drag and drop (#70). Every row is draggable; FOLDER rows are also drop
     targets, taking files moved from elsewhere in the tree and members
     extracted out of an archive. */
  onRowDragStart: (e: DragEvent, path: string) => void
  /** The folder row a drag is hovering, so it can light up. */
  dropTarget: string | null
  onDropHover: (path: string | null) => void
  /** The drag is over, dropped or not: forget what it carried. */
  onDragDone: () => void
  onDropOn: (e: DragEvent, folderPath: string) => void
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onStartRename: (path: string) => void
  onSubmitRename: (path: string, name: string) => void
  onCancelRename: () => void
  onDelete: (path: string, name: string, isFolder: boolean) => void
  onMenu: (e: MouseEvent, path: string, name: string, isFolder: boolean, size?: number) => void
}

const Ctx = createContext<TreeApi | null>(null)

export const TreeProvider = Ctx.Provider

export function useTree(): TreeApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('Tree rows must be rendered inside a TreeProvider')
  return api
}
