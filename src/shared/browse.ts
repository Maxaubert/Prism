import type { DirListing } from './types'
import type { FolderSizeResult } from './folderSize'

export const SEARCH_WINDOW_MAX = 512

export interface BrowseSearchWindowRequest {
  offset: number
  limit: number
  sort: BrowseSort
}

export interface BrowseSort {
  key: 'name' | 'path' | 'type' | 'size' | 'modified'
  direction: 'asc' | 'desc'
}

export interface BrowseLocation {
  path: string
  selected: string | null
  scrollTop: number
  query: string
  sort: BrowseSort
  /** The user picked this sort HERE, by a column header (#285). Only
   *  Downloads reads it: there, a sort nobody picked is Downloads' own,
   *  newest first. Never carried to the next folder. */
  sortChosen?: true
}

export interface SavedBrowse {
  path: string
  history: BrowseLocation[]
  cursor: number
  surface: 'folder' | 'viewer'
  preview: boolean
}

export interface BrowseDirectory {
  path: string
  listing: DirListing
}

/** Recursive desktop results. Counts expose incomplete coverage rather than
 * presenting a stopped or partly inaccessible walk as an exhaustive answer. */
export interface BrowseSearchResult extends BrowseDirectory {
  window?: {
    offset: number
    total: number
    /** Native result positions. Rejected or stale entries never disclose a path. */
    paths: Array<string | null>
    folderSizes?: Record<string, FolderSizeResult>
  }
  source?: 'everything' | 'filesystem'
  notice?: string
  scanned: number
  unreadable: number
  skippedLinks: number
  truncated: boolean
  cancelled: boolean
}

export interface BrowseSearchProgress extends BrowseSearchResult {
  tabId: string
  requestId: string
}

export interface BrowseShortcut {
  name: string
  path: string
  group: 'quick' | 'drive'
  /** The Windows Known Folder this is, as Electron's `app.getPath` resolves
   *  it (SHGetKnownFolderPath): Downloads is found by this (#285). */
  known?: 'home' | 'desktop' | 'downloads' | 'documents' | 'pictures' | 'music' | 'videos'
}

/** How full a drive is, for the Explorer's This PC rows (#296). Sizes are
 *  absent when the drive did not answer in time (a sleeping network share, a
 *  card just pulled): the row then shows its name alone. */
export interface BrowseDriveUsage {
  /** The drive root as `browseLocations` gives it, `C:\`. */
  path: string
  /** The volume's own label, '' when it has none. */
  label?: string
  /** What Windows calls the drive when it has no label. */
  kind?: 'local' | 'removable' | 'network' | 'optical'
  /** The drive Windows runs from, which wears the Windows badge. */
  system?: boolean
  total?: number
  free?: number
}

export type BrowseState = SavedBrowse

/** A file pinned beside the live viewer, retained across restart. */
export interface SavedPane {
  id: string
  path: string
  dir: 'left' | 'right' | 'top' | 'bottom'
  /** Index in the saved terminal slots, remapped to a fresh shell on restore. */
  termSlot?: number
}
