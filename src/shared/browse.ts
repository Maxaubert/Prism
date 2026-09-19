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
