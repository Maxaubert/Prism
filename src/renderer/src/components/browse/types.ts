import type { MouseEvent, ReactNode } from 'react'
import type { DirListing, ViewerFile } from '@shared/types'
import type { QuickAccessPin } from '../../lib/quickAccess'
import type { DragPayload } from '../../lib/dragDrop'
import type { FolderSizeResult } from '@shared/folderSize'
import type { BrowseSearchResult } from '@shared/browse'
import type { ListPending } from '../../lib/usePendingHint'

export interface BrowsePlace {
  path: string
  label: string
  group: 'Quick access' | 'Projects' | 'This PC'
}

export interface BrowseEntry {
  path: string
  name: string
  isFolder: boolean
  file?: ViewerFile
  folderSize?: FolderSizeResult | null
  /** Modified time: a folder's own (#285), or the file's. */
  mtimeMs?: number
}

export interface BrowseSort {
  key: 'name' | 'path' | 'type' | 'size' | 'modified'
  direction: 'asc' | 'desc'
}

export interface BrowseSearchState {
  window?: BrowseSearchResult['window']
  windows?: NonNullable<BrowseSearchResult['window']>[]
  source?: 'everything' | 'filesystem'
  notice?: string
  running: boolean
  scanned: number
  unreadable: number
  skippedLinks: number
  truncated: boolean
  cancelled: boolean
}

export interface FolderBrowserProps {
  directory: string
  listing: DirListing | null
  /** A folder that has not answered yet (#271). There is no loading state
   *  that hides the list: 'quiet' keeps the rows, 'slow' (past 300 ms) shows
   *  the header with a thin bar. */
  pending: ListPending
  /** Where a pending navigation is going, for the address bar. */
  pendingPath?: string | null
  error?: string
  places: BrowsePlace[]
  placesVisible?: boolean
  /** The places panel is mid-slide after a toggle: keep it mounted and animate. */
  placesSliding?: boolean
  /** THE COLLAPSED PANEL PEEKS (#250): 'in' while the hidden places panel is
   *  out OVER the list, 'out' for its slide away. */
  placesPeek?: 'in' | 'out' | null
  /** The peeking panel's own toggle: keep it open. */
  onPinPlaces?: () => void
  /** A place or a pin was picked from the peeking panel: the peek is over. */
  onPlacePicked?: () => void
  quickAccess?: QuickAccessPin[]
  onQuickAccessFile?: (path: string, full?: boolean) => void
  onUnpinQuickAccess?: (path: string) => void
  onMoveQuickAccess?: (path: string, beforePath?: string) => void
  onPinQuickAccessPaths?: (paths: string[], beforePath?: string) => void
  /** Whose list this is (the tab's id). The marks of several rows are this
   *  list's own, and one component serves every Explorer tab. */
  owner?: string
  selectedPath: string | null
  menuPath?: string
  scrollTop: number
  query: string
  searchState?: BrowseSearchState
  sort: BrowseSort
  /** The folder on screen is the user's Downloads (#285): by Date modified it
   *  mixes files and folders and shows File Explorer's date groups. */
  downloads?: boolean
  /** The user's first day of the week for those groups, 0 Sunday. */
  weekStart?: number
  canBack: boolean
  canForward: boolean
  previewEnabled: boolean
  previewVisible: boolean
  preview?: ReactNode
  terminalControls?: ReactNode
  /** Something else is in front (a question, the update window, Settings):
   *  the search popup does not open, and leaves if it was up (#267). */
  covered?: boolean
  onNavigate: (path: string) => void
  onBack: () => void
  onForward: () => void
  onUp: () => void
  /** `quiet`: a sweep or a Ctrl or Shift click marking rows (#263). It moves
   *  the selected path only; the preview and playback are left alone. */
  onSelect: (path: string | null, quiet?: boolean) => void
  onOpen: (file: ViewerFile) => void
  onScroll: (top: number) => void
  onQueryChange: (query: string) => void
  onSortChange: (sort: BrowseSort) => void
  onNewTerminal: (directory: string) => void
  onOpenProject?: (entry: BrowseEntry) => void
  onOpenNewTab?: (path: string, isFolder?: boolean) => void
  onCancelSearch?: () => void
  onSearchRange?: (first: number) => void
  onPreviewToggle: () => void
  /** `paths` is every marked row when the row pressed is one of several
   *  marked (#257): the menu then acts on all of them, as the marks say. */
  onContextMenu?: (
    event: MouseEvent<HTMLElement>,
    entry: BrowseEntry,
    source?: 'more',
    paths?: string[]
  ) => void
  onRename?: (entry: BrowseEntry) => void
  onCopy?: (entry: BrowseEntry) => void
  onCut?: (entry: BrowseEntry) => void
  onPaste?: (directory: string) => void
  onDelete?: (entry: BrowseEntry) => void
  /** Several rows marked (a sweep or a Ctrl click, #257): copy or cut them all. */
  onCopyPaths?: (paths: string[], cut: boolean) => void
  /** Several rows marked: one question for all of them, the tree's. */
  onDeleteMany?: (paths: string[]) => void
  onRefresh?: () => void
  onDropInto?: (directory: string, payload: DragPayload) => void
}
