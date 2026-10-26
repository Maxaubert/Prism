import { dirname, resolve } from 'path'
import { addRoot } from './roots'
import { grantDesktopDirectory } from './desktopAccess'
import { browseDirectory, type BrowseRead } from './browse'
import { restoredFileIndex, tabsWriter, type SavedTabs } from './tabs'
import { userPaths } from './paths'
import type { BrowseDirectory } from '@shared/browse'
import type { OpenPayload } from '@shared/types'

/**
 * THE TAB STRIP ACROSS LAUNCHES (stage 9c of the structure cleanup,
 * 2026-10-12, out of index.ts): last session's tabs restored, Explorer tabs
 * first, and the strip the renderer reports saved on a debounce and flushed
 * when the window closes. What it reads with is index.ts's: the listing
 * cache, the archive read, and the open payload builders.
 */
export interface TabsSessionDeps {
  cachedListing: (path: string) => Promise<BrowseDirectory | null>
  archiveRead: (tabId: string, path: string) => Promise<BrowseRead | null | undefined>
  buildPayload: (p: string, root?: string) => Promise<OpenPayload | null>
  folderPayload: (dir: string) => Promise<OpenPayload | null>
}

export interface TabsSession {
  restoreTabs(send: (payload: OpenPayload) => void, saved: SavedTabs): Promise<boolean>
  saveTabs(state: SavedTabs): void
  flushTabs(): void
}

/** How long the restore waits for the folder an Explorer tab was showing
 *  before it falls back to the root. A names read is 1 to 3 ms warm; a cold
 *  local disk after a reboot is tens of ms. */
const SHOWN_FOLDER_LIMIT_MS = 750
/** How long the other tabs wait for the Explorer tabs before they go too. The
 *  Explorer goes first so it has the disk to itself, but a tab that is slow
 *  (an offline root) must hold only itself. */
const EXPLORER_WAVE_LIMIT_MS = 500

export function createTabsSession(deps: TabsSessionDeps): TabsSession {
  /**
   * An Explorer tab's payload, from the listing cache when it has the folder
   * and from a names-only read (1 to 3 ms) when it does not (#271). The folder
   * is the one the tab was SHOWING (`browse.path`), not its root: the root's
   * listing was read here before and thrown away, and the page then read the
   * folder it actually shows a second time.
   */
  async function explorerRestoreListing(
    tabId: string,
    t: { root: string; browse?: { path: string } }
  ): Promise<BrowseDirectory | null> {
    const shown = t.browse?.path && t.browse.path !== t.root ? t.browse.path : null
    for (const path of shown ? [shown, t.root] : [t.root]) {
      const cached = await deps.cachedListing(path)
      if (cached) return cached
      // THE SHOWN FOLDER GETS A TIME LIMIT, THE ROOT DOES NOT (review of #271).
      // Reading `browse.path` is new: the old restore read only the root. A
      // share that has gone offline answers a stat only at the SMB timeout,
      // tens of seconds, and the cache never holds a network folder, so that
      // read is live. Past the limit the root stands in, as it did before, and
      // the page reads the shown folder itself. The root keeps its old,
      // unlimited read: a tab whose root cannot be read is not restored.
      // A tab left inside a zip comes back there (#300).
      const reading = deps
        .archiveRead(tabId, path)
        .then((inside) => (inside !== undefined ? inside : browseDirectory(tabId, path, 'names')))
      const read =
        path === shown
          ? await Promise.race([
              reading,
              new Promise<null>((done) => setTimeout(() => done(null), SHOWN_FOLDER_LIMIT_MS))
            ])
          : await reading
      if (read && !read.listing.unreadable) return { path: read.path, listing: read.listing }
    }
    return null
  }

  /**
   * Restore last session's strip: register each surviving root so the wall
   * accepts it, then hand the renderer the payloads to rebuild the tabs from.
   * The strip is the one index.ts already read (2026-10-16): this used to read
   * and parse it a second time, every sync stat of it twice per page load.
   *
   * EXPLORER TABS FIRST, EVERYTHING ELSE AS IT IS READY (#271). The first
   * Explorer rows used to wait on every saved tab in turn: each project's
   * folder read and each Claude transcript lookup. Now the Explorer payloads
   * go first, each carrying its cached or names-only listing, and the project
   * tabs follow in parallel, each sent when it is ready. `restoreOrder` is the
   * saved position, and the page puts each tab there, so the strip comes back
   * in SAVED order however the payloads arrive. Returns whether a pinned
   * Explorer tab was sent.
   */
  async function restoreTabs(
    send: (payload: OpenPayload) => void,
    saved: SavedTabs
  ): Promise<boolean> {
    const ids = saved.tabs.map((t, i) => t.id ?? `restored-${i}-${Date.now()}`)
    for (const [i, t] of saved.tabs.entries()) {
      // The SAVED root, not the file's folder: navigating into a subfolder and
      // reopening there used to leave the tab rooted at the subfolder, because
      // the payload was rebuilt from the file alone and root followed it. The
      // wall has to be registered here, since buildPayload only does that when
      // it is inventing the root itself.
      const restoreTabId = ids[i]
      if (t.role !== 'explorer') addRoot(t.root)
      else grantDesktopDirectory(restoreTabId, t.root)
      for (const pane of t.panes ?? [])
        grantDesktopDirectory(restoreTabId, dirname(pane.path))
      if (t.file) grantDesktopDirectory(restoreTabId, dirname(t.file))
      for (const path of t.open ?? []) grantDesktopDirectory(restoreTabId, path)
      for (const location of t.browse?.history ?? [])
        grantDesktopDirectory(restoreTabId, location.path)
      if (t.browse) grantDesktopDirectory(restoreTabId, t.browse.path)
    }
    const finish = async (
      i: number,
      payload: OpenPayload,
      listing?: BrowseDirectory
    ): Promise<OpenPayload> => {
      const t = saved.tabs[i]
      // SAVED order, exactly: the old active-goes-last splice scrambled the
      // strip. The active one carries a flag instead and the renderer brings
      // it to the front without moving it.
      return {
        ...payload,
        index: restoredFileIndex(t, payload.index),
        restore: true,
        restoreTabId: ids[i],
        restoreOrder: i,
        role: t.role,
        pinned: t.pinned,
        ...(t.browse ? { browse: t.browse } : {}),
        ...(t.panes ? { panes: t.panes } : {}),
        ...(i === saved.active ? { restoreActive: true } : {}),
        ...(t.open?.length ? { open: t.open } : {}),
        ...(listing ? { listing } : {})
      }
    }
    let pinnedSent = false
    // Wave one: the Explorer tabs, from the cache or a names-only read.
    const explorers = saved.tabs.flatMap((t, i) => (t.role === 'explorer' && !t.file ? [i] : []))
    const waveOne = Promise.allSettled(
      explorers.map(async (i) => {
        const t = saved.tabs[i]
        const listing = await explorerRestoreListing(ids[i], t)
        if (!listing) return
        const files =
          listing.path.toLowerCase() === resolve(t.root).toLowerCase() ? listing.listing.files : []
        const payload = await finish(i, { root: t.root, files, index: -1 }, listing)
        if (payload.pinned) pinnedSent = true
        send(payload)
      })
    )
    // Wave two: everything else, each sent when it is ready, once the Explorer
    // tabs have gone or EXPLORER_WAVE_LIMIT_MS has passed, whichever is first.
    let limit: NodeJS.Timeout | undefined
    await Promise.race([
      waveOne,
      new Promise<void>((done) => {
        limit = setTimeout(done, EXPLORER_WAVE_LIMIT_MS)
      })
    ])
    clearTimeout(limit)
    const rest = saved.tabs.flatMap((_t, i) => (explorers.includes(i) ? [] : [i]))
    const waveTwo = Promise.allSettled(
      rest.map(async (i) => {
        const t = saved.tabs[i]
        const payload = t.file
          ? await deps.buildPayload(t.file, t.root)
          : t.role === 'explorer'
            ? null
            : await deps.folderPayload(t.root)
        if (!payload) return
        const done = await finish(i, payload)
        if (done.role === 'explorer' && done.pinned) pinnedSent = true
        send(done)
      })
    )
    await Promise.all([waveOne, waveTwo])
    return pinnedSent
  }

  /** Save on a delay, as the window state does: switching tabs with the arrow
   *  keys fires this continuously and the disk need not hear about each one. */
  let tabsTimer: NodeJS.Timeout | null = null
  let tabsPending: SavedTabs | null = null
  const tabsFile = tabsWriter(userPaths.tabs)
  function saveTabs(state: SavedTabs): void {
    tabsPending = state
    if (tabsTimer) clearTimeout(tabsTimer)
    tabsTimer = setTimeout(() => {
      tabsTimer = null
      if (tabsPending) void tabsFile.write(tabsPending)
    }, 400)
  }

  /** Close flushes the debounce: a report still in its 400ms window must not
   *  die with the app. */
  function flushTabs(): void {
    if (tabsTimer) {
      clearTimeout(tabsTimer)
      tabsTimer = null
    }
    if (tabsPending) tabsFile.flushSync(tabsPending) // sync-ok: window close, which may be the quit; the last strip must be down
  }

  return { restoreTabs, saveTabs, flushTabs }
}
