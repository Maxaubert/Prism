import type { MouseEvent, ReactNode } from 'react'
import type { DirListing, ViewerFile } from '@shared/types'
import type { QuickAccessPin } from '../../lib/quickAccess'
import type { DragPayload } from '../../lib/dragDrop'
import type { FolderSizeResult } from '@shared/folderSize'

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
}

export interface BrowseSort {
  key: 'name' | 'type' | 'size' | 'modified'
  direction: 'asc' | 'desc'
}

export interface BrowseSearchState {
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
  loading: boolean
  error?: string
  places: BrowsePlace[]
  placesVisible?: boolean
  quickAccess?: QuickAccessPin[]
  onQuickAccessFile?: (path: string, full?: boolean) => void
  onUnpinQuickAccess?: (path: string) => void
  onMoveQuickAccess?: (path: string, beforePath?: string) => void
  onPinQuickAccessPaths?: (paths: string[], beforePath?: string) => void
  selectedPath: string | null
  menuPath?: string
  scrollTop: number
  query: string
  searchState?: BrowseSearchState
  sort: BrowseSort
  canBack: boolean
  canForward: boolean
  previewVisible: boolean
  preview?: ReactNode
  terminalControls?: ReactNode
  onNavigate: (path: string) => void
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onSelect: (path: string | null) => void
  onOpen: (file: ViewerFile) => void
  onScroll: (top: number) => void
  onQueryChange: (query: string) => void
  onSortChange: (sort: BrowseSort) => void
  onNewTerminal: (directory: string) => void
  onOpenProject?: (entry: BrowseEntry) => void
  onOpenNewTab?: (path: string, isFolder?: boolean) => void
  onCancelSearch?: () => void
  onPreviewToggle: () => void
  onContextMenu?: (event: MouseEvent<HTMLElement>, entry: BrowseEntry, source?: 'more') => void
  onRename?: (entry: BrowseEntry) => void
  onCopy?: (entry: BrowseEntry) => void
  onCut?: (entry: BrowseEntry) => void
  onPaste?: (directory: string) => void
  onDelete?: (entry: BrowseEntry) => void
  onRefresh?: () => void
  onDropInto?: (directory: string, payload: DragPayload) => void
}
