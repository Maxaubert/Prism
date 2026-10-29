import { app, ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import { resolve } from 'path'
import { listDir } from '../dirList'
import {
  extendDesktopDirectories,
  insideDesktop,
  insideDesktopAll,
  insideDesktopAllAsync,
  insideDesktopAsync,
  releaseDesktop,
  validDesktopRoot
} from '../desktopAccess'
import { browseLocations, browseWatch } from '../browse'
import { driveUsage, withUsedShare } from '../driveUsage'
import { container } from '../archiveBrowse'
import { containerCandidates } from '@shared/archivePlace'
import { weekStart } from '../weekStart'
import { isLocalFixed } from '../driveKinds'
import {
  browseSearch,
  browseSuggest,
  cancelBrowseSearch,
  normalizeSearchWindow,
  suggestSlot
} from '../browseSearch'
import { browseWatcherOf } from '../browseWatch'
import { mainCrumb } from '../diagCrumb'
import type { BrowseSearchResult } from '@shared/browse'
import type { DirListing, OpenPayload } from '@shared/types'
import { E2E, windows } from '../appState'
import type { MainCtx } from './context'

/** The Explorer: listings, the cache, search and suggestions, watches, drives, folder sizes. */
export function registerBrowseIpc(ctx: MainCtx): void {
  const {
    SLOW_SCAN_MS,
    SLOW_SETUP_MS,
    archives,
    explorerListings,
    folderChanged,
    folderSizes,
    listingCache,
    warmIndexer
  } = ctx
  // The renderer owns the tab list; main persists it. The root wall is NOT
  // rebuilt from this snapshot: a report races payloads still in flight, and
  // replacing the set once tore out a root main had just registered for a
  // file the renderer had not seen yet - whose listDir was then refused and
  // cached as unreadable. Additions stay main's (the payload builders);
  // removals arrive explicitly below, and a snapshot cannot remove what it
  // never knew about.
  // Local fixed drives only, like the read-ahead (review, 2026-10-28): on a
  // share each subfolder's guard was an SMB round trip, and the paths are
  // now resolved off main's thread before the guard reads them.
  const warmFolderSizes = (dir: string, paths: string[]): void => {
    if (!isLocalFixed(dir)) return
    void insideDesktopAllAsync(paths)
      .then((allowed) => folderSizes.prefetchIndexed(allowed))
      .catch(() => {})
  }
  // NAMES FIRST (#271): the reply is the folder's names, and the sizes and
  // dates follow as `browse:details`. The indexer warm-up and the folder
  // sizes go AFTER the reply leaves (setImmediate): the size warm-up's
  // realpath checks, two per subfolder, used to run before it.
  // A RE-READ IS NOT AN ARRIVAL (perf review #10, 2026-10-28): the watcher's
  // and the focus's re-reads (`again`) of the folder on screen skip both
  // warm-ups. Its arrival warmed them, and Downloads during a download
  // re-reads about once a second.
  ipcMain.handle(
    CALL.browseDirectory,
    async (e, tabId: string, path: string, options?: { details?: boolean; again?: boolean }) => {
      // The window asking owns the tab (2026-10-29): its details stream there.
      windows.noteTabOwner(tabId, e.sender)
      const directory = await explorerListings.browse(tabId, path, options?.details !== false)
      if (directory && !directory.listing.unreadable && options?.again !== true) {
        const folders = directory.listing.folders.map((folder) => folder.path)
        setImmediate(() => {
          void warmIndexer(directory.path)
          warmFolderSizes(directory.path, folders)
        })
      }
      return directory
    }
  )
  // The page's synchronous look at the cache (#271): a folder it has never
  // seen this session paints from disk in the same frame as the click.
  ipcMain.on(CALL.browseCached, (event, path: unknown) => {
    event.returnValue =
      windows.isPrismPage(event.sender) && typeof path === 'string'
        ? explorerListings.cached(path)
        : null
  })
  ipcMain.handle(CALL.browsePrefetch, (_e, path: unknown, pin?: unknown) => {
    if (typeof path !== 'string') return null
    if (pin === true) listingCache.pin([path])
    return explorerListings.prefetch(path)
  })
  ipcMain.handle(CALL.listingCacheClear, () => listingCache.clear())
  /**
   * The archive check before a search is an awaited stat now (2026-10-12),
   * and two of them can finish out of order: the older search would then
   * start last and cancel the newer one, and a cancel that came during the
   * wait would find nothing to cancel. So the newest per slot is the only
   * one that goes on, a cancel still reaches one that is waiting, and a path
   * with no archive in it (nearly all) is not awaited at all.
   */
  const searchWaiting = new Map<string, string>()
  const searchContainer = async (
    slot: string,
    requestId: string,
    path: string,
    query: string
  ): Promise<string | null | 'gone'> => {
    if (
      typeof path !== 'string' ||
      typeof query !== 'string' ||
      !containerCandidates(path).length
    ) {
      searchWaiting.delete(slot)
      return null
    }
    searchWaiting.set(slot, requestId)
    const found = await container(path)
    if (searchWaiting.get(slot) !== requestId) return 'gone'
    searchWaiting.delete(slot)
    return found
  }
  const searchGone = (path: string): BrowseSearchResult => ({
    path,
    listing: { folders: [], files: [] },
    scanned: 0,
    unreadable: 0,
    skippedLinks: 0,
    truncated: false,
    cancelled: true
  })
  ipcMain.handle(
    CALL.browseSearch,
    async (
      event,
      tabId: string,
      path: string,
      query: string,
      requestId: string,
      window?: unknown
    ) => {
      // Inside an archive (#300): the whole archive below the folder, from
      // memory, one answer.
      const outer = await searchContainer(tabId, requestId, path, query)
      if (outer === 'gone') return searchGone(path)
      if (outer) {
        const inside = await archives.search(path, query)
        if (inside) return inside
      }
      const result = await browseSearch(
        tabId,
        path,
        query,
        requestId,
        (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(PUSH.browseSearchProgress, progress)
        },
        {},
        normalizeSearchWindow(window)
      )
      return result
    }
  )
  ipcMain.on(CALL.browseSearchCancel, (_e, tabId: string, requestId: string) => {
    if (searchWaiting.get(tabId) === requestId) searchWaiting.delete(tabId)
    cancelBrowseSearch(tabId, requestId)
  })
  // The search popup's suggestions (#267): the same search and index as the
  // list's, in a slot of their own, with no progress (one answer each).
  ipcMain.handle(
    CALL.browseSuggest,
    async (_e, tabId: string, path: string, query: string, requestId: string) => {
      const outer = await searchContainer(suggestSlot(tabId), requestId, path, query)
      if (outer === 'gone') return searchGone(path)
      if (outer) {
        const inside = await archives.search(path, query, 200)
        if (inside) return inside
      }
      return browseSuggest(tabId, path, query, requestId)
    }
  )
  ipcMain.on(CALL.browseSuggestCancel, (_e, tabId: string, requestId: string) => {
    if (typeof tabId === 'string' && searchWaiting.get(suggestSlot(tabId)) === requestId)
      searchWaiting.delete(suggestSlot(tabId))
    if (typeof tabId === 'string') cancelBrowseSearch(suggestSlot(tabId), requestId)
  })
  ipcMain.handle(CALL.browseWatch, async (e, tabId: string, path: string | null) => {
    // A tab torn off or snapped back (step 3, 2026-10-29) is shown by two
    // pages for a moment: the one it leaves stops watching as the one it
    // reaches starts, in no promised order. Only the page that has the tab
    // now may stop its watch; another's stop is a page letting go of a view
    // it no longer has.
    if (path === null && typeof tabId === 'string') {
      const owner = windows.ownerOf(tabId)
      if (owner && owner.id !== e.sender.id) return true
    }
    // And a floating window the tab has already left (a snap back, a cancel)
    // starts no watch for it: a late ask would run one for nobody.
    if (path !== null && windows.of(e.sender)?.spare && !windows.isMoving(tabId)) return false
    windows.noteTabOwner(tabId, e.sender)
    // The watcher's set-up is timed (#322): it runs in main's thread, and a
    // network folder can make it slow. One per folder shown, so a quick one
    // is Detailed logging's only. The time includes the ownership guard,
    // which times itself (`guard-slow`); a call that found the watch
    // already on that folder set nothing up and writes nothing.
    const before = typeof tabId === 'string' ? browseWatcherOf(tabId) : undefined
    const t0 = performance.now()
    const ok = await browseWatch(tabId, path, folderChanged)
    const setUp = typeof tabId === 'string' && browseWatcherOf(tabId) !== before
    if (path !== null && (setUp || !ok)) {
      const ms = Math.round(performance.now() - t0)
      mainCrumb('watch', { path, ms, ok }, { often: ms < SLOW_SETUP_MS })
    }
    return ok
  })
  ipcMain.handle(CALL.browseLocations, () => browseLocations((key) => app.getPath(key)))
  ipcMain.handle(CALL.browseDrives, async (_e, paths: unknown) =>
    E2E
      ? withUsedShare(await driveUsage(paths), process.env.PRISM_E2E_DRIVE_USED)
      : driveUsage(paths)
  )
  // Downloads' date groups count weeks from the user's first day (#285).
  ipcMain.handle(CALL.systemWeekStart, () => weekStart())
  ipcMain.handle(CALL.folderSizesCached, async (_event, paths: unknown) => {
    if (!Array.isArray(paths) || paths.length > 10000) return {}
    // One timed guard call per list (#322): this is where suspect 1 runs.
    // Resolved off main's thread first; the second pass finds them resolved.
    const authorized = await insideDesktopAllAsync(paths)
    const cached = await folderSizes.readCached(authorized)
    const still = new Set(insideDesktopAll(Object.keys(cached)))
    return Object.fromEntries(Object.entries(cached).filter(([path]) => still.has(path)))
  })
  ipcMain.handle(CALL.folderSizesRefresh, async (_event, path: unknown) => {
    if (typeof path !== 'string' || !(await insideDesktopAsync(path))) return
    await folderSizes.invalidate([path])
  })
  const folderSizeRequests = new Map<number, Map<string, AbortController>>()
  ipcMain.handle(CALL.folderSize, async (event, path: string, requestId: string) => {
    if (
      typeof path !== 'string' ||
      !(await insideDesktopAsync(path)) ||
      typeof requestId !== 'string' ||
      !requestId ||
      requestId.length > 200 ||
      event.sender.isDestroyed()
    )
      return null
    const senderId = event.sender.id
    let requests = folderSizeRequests.get(senderId)
    if (!requests) {
      requests = new Map()
      folderSizeRequests.set(senderId, requests)
      event.sender.once('destroyed', () => {
        for (const controller of folderSizeRequests.get(senderId)?.values() ?? [])
          controller.abort()
        folderSizeRequests.delete(senderId)
      })
    }
    requests.get(requestId)?.abort()
    if (!requests.has(requestId) && requests.size >= 64) return null
    const controller = new AbortController()
    requests.set(requestId, controller)
    const t0 = performance.now()
    try {
      const result = await folderSizes.get(path, controller.signal, (result) => {
        if (!controller.signal.aborted && !event.sender.isDestroyed() && insideDesktop(path))
          event.sender.send(PUSH.folderSizeProgress, { requestId, result })
      })
      return insideDesktop(path) && !controller.signal.aborted ? result : null
    } finally {
      if (requests.get(requestId) === controller) requests.delete(requestId)
      // A size scan finished (#322). Every visible folder row asks, two at a
      // time, and most answer from the cache at once, so only a real scan
      // (half a second or more) is said at the quiet level.
      const ms = Math.round(performance.now() - t0)
      mainCrumb(
        'folder-size',
        { path, ms, ...(controller.signal.aborted ? { cancelled: true } : {}) },
        { often: ms < SLOW_SCAN_MS }
      )
    }
  })
  ipcMain.on(CALL.folderSizeCancel, (event, requestId: string) => {
    if (typeof requestId === 'string')
      folderSizeRequests.get(event.sender.id)?.get(requestId)?.abort()
  })
  ipcMain.on(CALL.browseRelease, (_e, tabId: string) => releaseTab(tabId))
}

/**
 * Everything main holds for one tab, let go: its searches, its folder grants
 * (which takes its folder watch, and stops its listing's details run), for
 * good. The page's own close of a tab, and (2026-10-29) a window's close for
 * every tab it held, unless that tab is mid-move to another window.
 */
export function releaseTab(tabId: string): void {
  cancelBrowseSearch(tabId)
  if (typeof tabId === 'string') cancelBrowseSearch(suggestSlot(tabId))
  releaseDesktop(tabId)
  // Its owner entry too (review, 2026-10-29): kept, the registry's map grew
  // with every tab ever browsed, and a window's close released them all again.
  windows.forgetTab(tabId)
}

/** Opening a file inside a tab, a folder's listing and the tree search (the phone's, too). */
export function registerTreeIpc(ctx: MainCtx): void {
  const { archives, buildPayload } = ctx
  // The three navigation handlers take the root they act in, because they are
  // per-tab operations and the renderer always knows which tab asked. Both the
  // root and the path have to hold up: naming a root you never opened gets you
  // nothing, and neither does a path from a DIFFERENT open root.
  //
  // A click in the sidebar tree. It leaves the root alone: the tree you
  // clicked from stays the tree you're in.
  ipcMain.handle(
    CALL.openWithin,
    async (_e, root: string, p: string): Promise<OpenPayload | null> => {
      // A MEMBER of an archive (#300): the members beside it are the arrows'
      // list, read from the container's listing. The container must be one
      // this tab may read, as a file there would be.
      const outer = typeof p === 'string' ? await container(p) : null
      if (outer && outer !== resolve(p)) {
        if (!validDesktopRoot(root, outer) && !insideDesktop(outer)) return null
        const near = await archives.siblings(p)
        return near ? { files: near.files, index: near.index, root } : null
      }
      return validDesktopRoot(root, p) ? await buildPayload(p, root) : null
    }
  )
  ipcMain.handle(CALL.dirList, async (_e, root: string, p: string): Promise<DirListing | null> => {
    // The project tree inside an archive (#300): a zip node expands like a
    // folder, and its folders do, from the container's own listing.
    const outer = typeof p === 'string' ? await container(p) : null
    if (outer) {
      if (!validDesktopRoot(root, outer)) return null
      const r = await archives.resolve(p)
      if (!r) return null
      if (!r.ok)
        return {
          folders: [],
          files: [],
          unreadable: true,
          archiveError: {
            reason: r.reason,
            container: r.container,
            message: archives.failText(r.reason)
          }
        }
      if (r.place.entry && !r.place.entry.dir) return null
      return archives.listing(r.place, 'tree')
    }
    if (!validDesktopRoot(root, p)) return null
    const listing = await listDir(p)
    if (!listing.unreadable) extendDesktopDirectories(root, [p])
    return listing
  })
}
