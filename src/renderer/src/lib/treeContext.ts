import { createContext, useContext, type MouseEvent } from 'react'
import type { DirListing, ViewerFile } from '@shared/types'
import type { TREE_SIZES } from './treePrefs'

// What a tree row can do, shared through context so the recursive row components
// don't have to thread a dozen callbacks down every level.

export interface TreeApi {
  expanded: Set<string>
  children: Record<string, DirListing>
  currentPath: string | null
  /** The open file has unsaved text: its row says so with a bold name and a *. */
  dirty: boolean
  size: (typeof TREE_SIZES)[number]
  /** Path of the file being renamed right now, if any. */
  editing: string | null
  /** The navigation filter, applied to the rows as well: a file row renders
   *  only when this says so. Folders always render. */
  fileVisible: (f: ViewerFile) => boolean
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
