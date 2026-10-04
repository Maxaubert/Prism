import { useCallback, useEffect, useRef } from 'react'
import type { DirListing } from '@shared/types'
import type { QuickAccessPin } from './quickAccess'
import { browseParent } from './browse'
import { directoryKey, visitedDirectories } from './visitedDirectories'

/**
 * READ AHEAD (#271; owner-approved recommendation 5, 2026-10-04: "read ahead
 * on hover, local fixed drives only, at most 2 at a time"). The page says
 * which folders are likely next; main decides whether they may be read (local
 * fixed drives, 5000 entries at most) and reads at most two at a time. What
 * comes back sits in the shared snapshots, so the click paints from memory.
 * It is never written to the cache on disk (review of #271): that keeps only
 * the folders the user opened.
 *
 * What is likely next, and when:
 *   - a folder row the pointer rests on for 150 ms, or a folder selected with
 *     the keyboard;
 *   - the parent of the folder on screen, so Up is instant;
 *   - the first 12 subfolders of a folder of 30 entries or fewer, at idle;
 *   - the first 8 Quick access places, once, at idle after launch (marked
 *     pinned, so once opened they are the last to be evicted).
 */

export const HOVER_MS = 150
const asked = new Map<string, number>()
/** A folder read ahead is good for a while; after that a hover asks again. */
const FRESH_MS = 30_000

/** Ask main to read one folder ahead. Quiet: a refusal or a failure is nothing. */
export function prefetchFolder(path: string, pin = false, now = Date.now()): boolean {
  const key = directoryKey(path)
  const last = asked.get(key)
  if (last !== undefined && now - last < FRESH_MS) return false
  if (visitedDirectories.get(path)) return false
  asked.set(key, now)
  if (asked.size > 256) asked.delete(asked.keys().next().value!)
  void window.prism
    .browsePrefetch(path, pin)
    .then((hit) => {
      if (hit && !hit.listing.unreadable && !visitedDirectories.get(hit.path))
        visitedDirectories.remember(hit)
    })
    .catch(() => {})
  return true
}

/** Pure: the subfolders worth reading ahead of a folder, if it is small. */
export function smallFolderChildren(listing: DirListing | null, maxEntries = 30, take = 12): string[] {
  if (!listing || listing.unreadable) return []
  if (listing.folders.length + listing.files.length > maxEntries) return []
  return listing.folders.slice(0, take).map((f) => f.path)
}

let quickAccessDone = false

const idle = (fn: () => void): (() => void) => {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 2000 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, 400)
  return () => window.clearTimeout(id)
}

export function useListingPrefetch({
  directory,
  listing,
  selectedFolder,
  quickAccess,
  ready
}: {
  directory: string
  listing: DirListing | null
  selectedFolder: string | null
  quickAccess?: QuickAccessPin[]
  ready: boolean
}): (path: string | null) => void {
  // The parent and a small folder's children, once the folder is on screen.
  useEffect(() => {
    if (!ready) return
    return idle(() => {
      const parent = browseParent(directory)
      if (parent) prefetchFolder(parent)
      for (const child of smallFolderChildren(listing)) prefetchFolder(child)
    })
  }, [ready, directory, listing])
  // Quick access, once a session.
  useEffect(() => {
    if (!ready || quickAccessDone || !quickAccess) return
    quickAccessDone = true
    return idle(() => {
      for (const pin of quickAccess.filter((p) => p.isFolder).slice(0, 8)) prefetchFolder(pin.path, true)
    })
  }, [ready, quickAccess])
  // A folder picked with the keyboard (or a click): likely opened next.
  useEffect(() => {
    if (!ready || !selectedFolder) return
    const timer = window.setTimeout(() => prefetchFolder(selectedFolder), HOVER_MS)
    return () => window.clearTimeout(timer)
  }, [ready, selectedFolder])
  // The pointer resting on a folder row.
  const hover = useRef<number | null>(null)
  useEffect(() => () => void (hover.current !== null && window.clearTimeout(hover.current)), [])
  return useCallback((path: string | null) => {
    if (hover.current !== null) window.clearTimeout(hover.current)
    hover.current = path === null ? null : window.setTimeout(() => prefetchFolder(path), HOVER_MS)
  }, [])
}
