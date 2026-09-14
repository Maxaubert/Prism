import type { DirListing } from './types'

export interface BrowseSort {
  key: 'name' | 'type' | 'size' | 'modified'
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
