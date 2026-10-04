import type { BrowseDirectory } from '@shared/browse'
import type { BrowseDetails } from '@shared/types'
import { applyDetails, carryDetails } from './listingMerge'

export const directoryKey = (path: string): string =>
  path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/**
 * Display-only snapshots. Every revisit still revalidates through main.
 *
 * APP-WIDE, NOT ONE TAB'S (#271). It used to belong to the tab in front and
 * was cleared at every tab switch, so the tab you switched to had nothing to
 * draw until main answered. Keyed by the folder alone now, so a switch is a
 * hit. Bounded twice (64 folders, 100,000 rows: about 20 MB of rows at the
 * most, MEASURED at roughly 200 bytes a row as JavaScript objects).
 *
 * Details patches for a folder that is not held yet (they can overtake a read
 * whose answer nobody kept) wait in a small stash and are laid over the
 * listing when it arrives.
 */
export function createVisitedDirectories(maxFolders = 64, maxRows = 100_000) {
  let rows = 0
  const entries = new Map<string, BrowseDirectory>()
  const stash = new Map<string, BrowseDetails[]>()
  const size = (entry: BrowseDirectory): number =>
    entry.listing.files.length + entry.listing.folders.length
  const forget = (path: string): void => {
    const key = directoryKey(path)
    const old = entries.get(key)
    if (old) rows -= size(old)
    entries.delete(key)
  }
  return {
    get(path: string | undefined): BrowseDirectory | null {
      if (!path) return null
      const key = directoryKey(path)
      const hit = entries.get(key)
      if (!hit) return null
      // Most recently used last, so the oldest goes first.
      entries.delete(key)
      entries.set(key, hit)
      return hit
    },
    forget,
    /** Keep a fresh answer. A names-only one keeps the sizes the old copy had
     *  for files still there, and any stashed patches are laid over it. The
     *  merged entry is returned: it is what the list should draw. */
    remember(entry: BrowseDirectory): BrowseDirectory {
      const key = directoryKey(entry.path)
      const old = entries.get(key)
      let listing = carryDetails(old?.listing, entry.listing)
      for (const patch of stash.get(key) ?? []) listing = applyDetails(listing, patch)
      stash.delete(key)
      const merged = listing === entry.listing ? entry : { ...entry, listing }
      forget(entry.path)
      if (entry.listing.unreadable || size(merged) > maxRows) return merged
      entries.set(key, merged)
      rows += size(merged)
      while (entries.size > maxFolders || rows > maxRows) forget(entries.keys().next().value!)
      return merged
    },
    /** A details patch from main: applied where the folder is held, else kept
     *  a moment for the answer it belongs to. Returns the updated entry. */
    patch(details: BrowseDetails): BrowseDirectory | null {
      const key = directoryKey(details.path)
      const held = entries.get(key)
      if (!held) {
        const list = stash.get(key) ?? []
        list.push(details)
        stash.set(key, list)
        while (stash.size > 16) stash.delete(stash.keys().next().value!)
        return null
      }
      const listing = applyDetails(held.listing, details)
      if (listing === held.listing) return held
      const next = { ...held, listing }
      entries.set(key, next)
      return next
    },
    clear(): void {
      entries.clear()
      stash.clear()
      rows = 0
    }
  }
}

export type VisitedDirectories = ReturnType<typeof createVisitedDirectories>

/** The one the app uses: every tab and every Explorer surface share it. */
export const visitedDirectories = createVisitedDirectories()

/** Navigation and the resulting location effect can await the same directory read. */
export function createDirectoryRequests(
  read: (tabId: string, path: string) => Promise<BrowseDirectory | null>
) {
  const pending = new Map<string, Promise<BrowseDirectory | null>>()
  return (tabId: string, path: string, generation: string): Promise<BrowseDirectory | null> => {
    const key = `${tabId}\0${directoryKey(path)}\0${generation}`
    const existing = pending.get(key)
    if (existing) return existing
    const request = read(tabId, path)
    pending.set(key, request)
    const clear = (): void => {
      if (pending.get(key) === request) pending.delete(key)
    }
    void request.then(clear, clear)
    return request
  }
}
