import { dirname, resolve } from 'path'
import { grantDesktopDirectory } from './desktopAccess'
import { browseDirectory, type BrowseRead } from './browse'
import { type SavedTabs } from './tabs'
import { latestWriter } from './latestWrite'
import { createSessionModel, type SavedBounds, type SessionEntry } from './session'
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
}

export interface TabsSession {
  restoreTabs(
    send: (payload: OpenPayload) => void,
    saved: SavedTabs,
    mintId: (i: number) => string
  ): Promise<boolean>
  session: SessionStore
}

/** The session file's writer, one entry per window (session.ts), keyed by
 *  each window page's webContents id. */
export interface SessionStore {
  seed(key: number, saved: SessionEntry | null): void
  report(key: number, state: SavedTabs): void
  bounds(key: number, bounds: SavedBounds): void
  focus(key: number): void
  /** A Win+E window ranks below an ordinary one (session.ts). */
  minor(key: number): void
  rekey(from: number, to: number): void
  /** A window closed: `others` are still open, or the app is `quitting`.
   *  Written at once: on main's thread only when it is the last window or
   *  the quit, off it while other windows stay open. */
  closed(key: number, how: { others: boolean; quitting: boolean }): void
  /** The debounce, written now: synchronously when `last` (the last window,
   *  or the quit), off main otherwise. */
  flush(last: boolean): void
  primary(): SessionEntry | null
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
   * Restore last session's strip: grant each surviving folder to its tab, then
   * hand the renderer the payloads to rebuild the tabs from.
   * The strip is the one index.ts already read (2026-10-16): this used to read
   * and parse it a second time, every sync stat of it twice per page load.
   *
   * TABS SHOWING A FOLDER FIRST, THE ONES WITH A FILE OPEN AS THEY ARE READY
   * (#271). The first rows used to wait on every saved tab in turn. Now the
   * folder tabs go first, each carrying its cached or names-only listing, and
   * the tabs with a file open follow in parallel, each sent when it is ready.
   * `restoreOrder` is the
   * saved position, and the page puts each tab there, so the strip comes back
   * in SAVED order however the payloads arrive. Returns whether a pinned
   * Explorer tab was sent.
   */
  async function restoreTabs(
    send: (payload: OpenPayload) => void,
    saved: SavedTabs,
    mintId: (i: number) => string
  ): Promise<boolean> {
    // An id minted here is unique in the process (2026-10-29): two windows
    // restoring in the same millisecond must never share one.
    const ids = saved.tabs.map((t, i) => t.id ?? mintId(i))
    for (const [i, t] of saved.tabs.entries()) {
      // The SAVED root, not the file's folder: navigating into a subfolder and
      // reopening there used to leave the tab rooted at the subfolder, because
      // the payload was rebuilt from the file alone and root followed it. Every
      // tab is granted its own folders here, as an Explorer tab walks to them.
      const restoreTabId = ids[i]
      grantDesktopDirectory(restoreTabId, t.root)
      if (t.file) grantDesktopDirectory(restoreTabId, dirname(t.file))
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
        restore: true,
        restoreTabId: ids[i],
        restoreOrder: i,
        role: 'explorer' as const,
        pinned: t.pinned,
        ...(t.browse ? { browse: t.browse } : {}),
        ...(i === saved.active ? { restoreActive: true } : {}),
        ...(listing ? { listing } : {})
      }
    }
    let pinnedSent = false
    // Wave one: the Explorer tabs, from the cache or a names-only read.
    const explorers = saved.tabs.flatMap((t, i) => (!t.file ? [i] : []))
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
        // Wave one took every tab without a file; what is left has one open.
        const payload = t.file ? await deps.buildPayload(t.file, t.root) : null
        if (!payload) return
        const done = await finish(i, payload)
        if (done.pinned) pinnedSent = true
        send(done)
      })
    )
    await Promise.all([waveOne, waveTwo])
    return pinnedSent
  }

  /**
   * THE SESSION, PER WINDOW (2026-10-29, session.ts): each window's strip and
   * bounds, keyed by its page's webContents id. Saved on a delay, as before:
   * switching tabs with the arrow keys fires this continuously and the disk
   * need not hear about each one.
   */
  const model = createSessionModel()
  let timer: NodeJS.Timeout | null = null
  let dirty = false
  const file = latestWriter(userPaths.tabs)
  const later = (): void => {
    dirty = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!dirty) return
      dirty = false
      const doc = model.doc()
      if (doc) void file.write(JSON.stringify(doc))
    }, 400)
  }
  /** A close flushes the debounce: a report still in its 400ms window must
   *  not die with the app. Only the LAST window's close (or the quit) writes
   *  on main's thread (review, 2026-10-29): closing one of several windows on
   *  a busy disk would be the 3.9 s tabs.json freeze of 2026-10-12 again. */
  function flush(last: boolean): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!dirty) return
    dirty = false
    const doc = model.doc()
    if (!doc) return
    const text = JSON.stringify(doc)
    // sync-ok: the last window's close or the quit; the last strip must be down
    if (last) file.flushSync(text)
    else void file.write(text)
  }
  const session: SessionStore = {
    seed: (key, saved) => model.seed(key, saved),
    report(key, state) {
      model.report(key, state)
      later()
    },
    bounds(key, b) {
      model.bounds(key, b)
      later()
    },
    // Not written on its own: which window leads matters at the next write
    // and at every close, and a focus is no reason to touch the disk.
    focus: (key) => model.focus(key),
    minor: (key) => model.minor(key),
    rekey: (from, to) => model.rekey(from, to),
    closed(key, how) {
      model.closed(key, how)
      dirty = true
      flush(!how.others || how.quitting)
    },
    flush,
    primary: () => model.primary()
  }

  return { restoreTabs, session }
}
