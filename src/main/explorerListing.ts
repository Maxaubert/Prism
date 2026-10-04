import { stat } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import type { BrowseDirectory } from '@shared/browse'
import type { BrowseDetails, DirListing, ViewerFile } from '@shared/types'
import { browseDirectory, type BrowseRead } from './browse'
import { desktopClosed } from './desktopAccess'
import { listNames, statDetails, type FileDetail } from './dirList'
import type { ListingCache } from './listingCache'
import { createPrefetchQueue } from './listingPrefetch'

/**
 * THE EXPLORER'S LISTINGS, NEVER A LOADING SCREEN (#271; owner, 2026-10-04:
 * "whenever the app loads, it has to load the files in the file explorer.
 * Like there's a loading screen ... I don't ever want to see that ... not even
 * if you launch it from a restart of the PC, or it's your first time after
 * installing the program"). Design and the owner's six decisions:
 * docs/superpowers/specs/2026-10-04-explorer-never-loading-design.md.
 *
 * Main's half: a folder is answered with its NAMES (milliseconds), the sizes
 * and dates follow as `browse:details` patches, a finished listing is written
 * to the on-disk cache, the cache answers the start-up restore and the page's
 * synchronous `browse:cached`, and folders the user is about to open are read
 * ahead. Everything that competes for the disk at launch (the search index,
 * folder sizes, the drive-kind probe) waits for the first answer (`settled`).
 */

/** Merge details into a names-first listing. Pure; the renderer has its own. */
export function withDetails(listing: DirListing, details: ReadonlyMap<string, FileDetail>): DirListing {
  const files: ViewerFile[] = listing.files.map((f) => {
    const d = details.get(f.path)
    return d ? { ...f, size: d.size, mtimeMs: d.mtimeMs } : f
  })
  const { complete: _complete, ...rest } = listing
  void _complete
  return { ...rest, files }
}

export interface ExplorerListingDeps {
  cache: ListingCache
  /** To the main window's page. */
  send: (channel: 'browse:details', payload: BrowseDetails) => void
  /** Local fixed drive: what the read ahead may touch. */
  localFixed: (path: string) => boolean
  /** E2E only: hold every names read this long (`PRISM_E2E_LIST_DELAY`). */
  delayMs?: number
  /** E2E only: hold every details run this long (`PRISM_E2E_DETAILS_DELAY`). */
  detailsDelayMs?: number
  /** How long launch extras wait for the first answer at most. */
  settleMs?: number
  /** Folders over this many entries are not read ahead. */
  prefetchMaxEntries?: number
}

export function createExplorerListings(deps: ExplorerListingDeps) {
  const {
    cache,
    send,
    localFixed,
    delayMs = 0,
    detailsDelayMs = 0,
    settleMs = 1500,
    prefetchMaxEntries = 5000
  } = deps
  /** One details run per tab: a newer read of that tab yields the disk to it. */
  const runs = new Map<string, number>()
  let runSerial = 0

  let settle!: () => void
  const settled = new Promise<void>((done) => {
    settle = done
  })
  const timer = setTimeout(() => settle(), settleMs)
  timer.unref?.()

  const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

  /** Stat the files of a names-first answer in the background and stream the
   *  answers to the page; the finished listing goes to the cache. */
  const details = (tabId: string, read: BrowseRead): void => {
    const run = ++runSerial
    runs.set(tabId, run)
    const live = (): boolean => runs.get(tabId) === run && !desktopClosed(tabId)
    const known = new Map<string, FileDetail>()
    const start = (fn: () => void): void => {
      if (detailsDelayMs > 0) setTimeout(fn, detailsDelayMs)
      else setImmediate(fn)
    }
    start(() => {
      void statDetails(
        read.listing.files.map((f) => f.path),
        (files, done) => {
          for (const f of files) known.set(f.path, f)
          send('browse:details', { path: read.path, files, done })
        },
        { live }
      ).then((finished) => {
        if (runs.get(tabId) === run) runs.delete(tabId)
        if (finished) cache.put(read.path, withDetails(read.listing, known), read.folderMtimeMs)
      })
    })
  }

  const prefetchQueue = createPrefetchQueue<BrowseDirectory | null>({
    limit: 2,
    run: async (path) => {
      if (!isAbsolute(path) || !localFixed(path)) return null
      const dir = resolve(path)
      const info = await stat(dir)
      if (!info.isDirectory()) return null
      const listing = await listNames(dir)
      if (listing.unreadable) return null
      if (listing.folders.length + listing.files.length > prefetchMaxEntries) return null
      const known = new Map<string, FileDetail>()
      await statDetails(
        listing.files.map((f) => f.path),
        (files) => {
          for (const f of files) known.set(f.path, f)
        },
        { limit: 4 }
      )
      const full = withDetails(listing, known)
      cache.put(dir, full, info.mtimeMs)
      return { path: dir, listing: full }
    }
  })

  return {
    /** Resolves at the first Explorer answer, or after `settleMs`. */
    settled,
    /**
     * The Explorer's own read: names now, details streamed after. `details:
     * false` is a read for its GRANT only (opening a file from the tree grants
     * its folder), which must not take the disk from the folder on screen.
     */
    async browse(tabId: string, path: string, withStream = true): Promise<BrowseDirectory | null> {
      prefetchQueue.cancel()
      if (delayMs > 0) await sleep(delayMs)
      const read = await browseDirectory(tabId, path, 'names')
      settle()
      if (!read || read.listing.unreadable) return read && { path: read.path, listing: read.listing }
      if (read.listing.complete === false) {
        if (withStream) details(tabId, read)
      } else cache.put(read.path, read.listing, read.folderMtimeMs)
      return { path: read.path, listing: read.listing }
    },
    /** The stored listing of one folder, synchronously, or null. */
    cached(path: string): BrowseDirectory | null {
      if (typeof path !== 'string' || !isAbsolute(path)) return null
      const hit = cache.read(resolve(path))
      return hit ? { path: hit.path, listing: hit.listing } : null
    },
    /** Read one folder ahead of the click. */
    prefetch(path: string): Promise<BrowseDirectory | null> {
      if (typeof path !== 'string' || !isAbsolute(path) || path.length > 1024)
        return Promise.resolve(null)
      return prefetchQueue.add(path)
    }
  }
}
