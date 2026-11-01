import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { BrowseDirectory, BrowseLocation, BrowseShortcut } from '@shared/browse'
import type { ViewerFile } from '@shared/types'
import {
  navigateBrowse,
  replaceBrowsePath,
  searchBrowse,
  travelBrowse,
  setBrowseLocation,
  setBrowseScroll,
  setBrowseSurface,
  setBrowsePreview,
  isExplorerTab,
  underRoot,
  type Tab,
  type TabState
} from '../lib/tabs/tabs'
import { fileKind } from '@shared/fileKind'
import { baseName, extOf, pathKey } from '@shared/path'
import { applyDetails, sameRows } from '../lib/listingMerge'
import { downloadsPath, isDownloads, viewSort } from '../lib/downloadsView'
import { browseLocation, browseParent } from '../lib/browse'
import { intendToPlay } from '../lib/playState'
import { wayOutPreview } from '../lib/wayOutPreview'
import { useBrowseSearch } from './useBrowseSearch'
import { createDirectoryRequests, directoryKey, visitedDirectories } from '../lib/visitedDirectories'
import { usePendingHint, type ListPending } from './usePendingHint'
import { crumb } from 'prism-term-core/renderer/lib/diag'
import type { DirListing } from '@shared/types'

function pauseTab(tabId: string): void {
  for (const region of document.querySelectorAll<HTMLElement>('[data-player-tab]')) {
    if (region.dataset.playerTab !== tabId) continue
    for (const media of region.querySelectorAll<HTMLMediaElement>('video,audio')) media.pause()
  }
}

/**
 * Where an open that has landed leaves the selected path. It takes the file it
 * opened, unless rows were marked while it loaded (#263): the late open still
 * shows its file, but taking the selection back would make the marks read as
 * stale and wipe them.
 */
export function arrivalSelection(
  tabs: readonly Tab[],
  tabId: string,
  filePath: string,
  markedSince: boolean
): Tab[] {
  return markedSince ? [...tabs] : setBrowseLocation(tabs, tabId, { selected: filePath })
}

/**
 * Whether the tab marks something else than `judged`, the row an open was
 * decided on (#70, #101, #334). The way out of a zip opens the zip BECAUSE it
 * is marked; a landing mark judged in the same commit runs first (the list's
 * effect, a child's) and its quiet select counts before the open is asked, so
 * the count of marks misses it. The tab's own selected path does not.
 */
export function selectionMoved(tabs: readonly Tab[], tabId: string, judged: string): boolean {
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return false
  const now = browseLocation(tab.browse).selected
  return !!now && pathKey(now) !== pathKey(judged)
}

/**
 * WHY A FOLDER WAS READ, for the diagnostics log's `open-folder` crumb (#322).
 * `navigate` is a folder asked for by name or click; the others come through
 * the location effect: `back` / `forward` (history), `refresh` (the refresh
 * key), `focus` (the window came back), `dir-changed` (the watcher), `retry`
 * (a zip's password answered) and `arrival` (a tab switched to, or restored).
 */
export type OpenReason = 'navigate' | 'back' | 'forward' | 'refresh' | 'focus' | 'dir-changed' | 'retry' | 'arrival'

/** A background re-read (the watcher, the window's focus) this slow or slower
 *  reaches the quiet log; a quicker one is Detailed logging's (review of
 *  #322): a folder written to without a break (Downloads during a download)
 *  re-reads about once a second for as long as it lasts. */
export const BACKGROUND_READ_SLOW_MS = 200

/** THE FOCUS TRUSTS A LIVE WATCH (perf review #10, 2026-10-28): coming back
 *  to the window re-read the folder on screen every time, though its watcher
 *  already re-reads it on every change. With the watch set up and a read this
 *  recent, the focus reads nothing; past it (a watch that went quiet, a share
 *  whose notifications never come) it still re-reads, at most this often. */
export const FOCUS_TRUST_MS = 60_000

/** Whether the window's focus should re-read the folder on screen. */
export function focusNeedsRead(
  watched: { tabId: string; key: string } | null,
  lastRead: { tabId: string; key: string; at: number } | null,
  tabId: string,
  key: string,
  now: number
): boolean {
  const live = !!watched && watched.tabId === tabId && watched.key === key
  const fresh = !!lastRead && lastRead.tabId === tabId && lastRead.key === key && now - lastRead.at < FOCUS_TRUST_MS
  return !(live && fresh)
}

/** One folder read, on the timeline: where, why, how long, how many rows,
 *  and whether rows were already on screen from a cache while it read. */
export function openFolderCrumb(
  path: string,
  reason: OpenReason,
  t0: number,
  listing: DirListing | null | undefined,
  cached: boolean,
  extra: Record<string, unknown> = {}
): void {
  const ms = Math.round(performance.now() - t0)
  const background = reason === 'dir-changed' || reason === 'focus'
  crumb(
    'open-folder',
    {
      path,
      reason,
      ms,
      entries: listing && !listing.unreadable ? listing.folders.length + listing.files.length : null,
      cached,
      ...(listing?.unreadable || !listing ? { unreadable: true } : {}),
      ...extra
    },
    { often: background && ms < BACKGROUND_READ_SLOW_MS }
  )
}

/** The listing cache on disk, kept in the shared snapshots when it has the
 *  folder (#271). Synchronous: it paints in the same frame. */
function rememberCached(path: string): BrowseDirectory | null {
  // No bridge (a test rendering the hook on its own): nothing on disk to ask.
  if (typeof window === 'undefined' || !window.prism?.browseCached) return null
  const hit = window.prism.browseCached(path)
  return hit && !hit.listing.unreadable ? visitedDirectories.remember(hit) : null
}

/** Folder navigation owns only the browse cursor. It never reroots a session. */
export function useFolderBrowsing(
  active: Tab | null,
  setState: Dispatch<SetStateAction<TabState>>,
  refreshKey: number
) {
  const [result, setResult] = useState<(BrowseDirectory & { tabId: string }) | null>(null)
  /** A navigation whose folder has not answered yet (#271). The list keeps
   *  the folder it shows meanwhile: it never blanks for a read. */
  const [waitingFor, setWaitingFor] = useState<{ tabId: string; path: string } | null>(null)
  const [errorState, setError] = useState<{ tabId: string; message: string }>()
  /** A place inside an archive that wants its password (#300): the question,
   *  and what to do once it is answered. */
  const [archiveAsk, setArchiveAsk] = useState<{
    tabId: string
    container: string
    name: string
    wrong: boolean
    retry: () => void
  } | null>(null)
  const tried = useRef(new Set<string>())
  /** The latest `navigate`, for a password's retry. */
  const navigateRef = useRef<(target: string, tabId?: string) => Promise<void>>(async () => {})
  const askArchive = useCallback((tabId: string, container: string, retry: () => void) => {
    const key = container.toLowerCase()
    const wrong = tried.current.has(key)
    tried.current.add(key)
    setArchiveAsk({ tabId, container, name: baseName(container), wrong, retry })
  }, [])
  const [locations, setLocations] = useState<BrowseShortcut[]>([])
  const [revision, setRevision] = useState(0)
  /** Why the location effect's next read happens (#322); taken by that read. */
  const readReason = useRef<OpenReason | null>(null)
  /** The refresh key the last effect read saw, so a new one says `refresh`. */
  const readRefreshKey = useRef(refreshKey)
  /** The folder `navigate` is reading, and for which tab: the location effect
   *  joins that same read, and `navigate` says its crumb, so the effect does
   *  not say it twice. `navigate` takes its own marker back once its read has
   *  answered: a navigation to the folder already shown moves no location, so
   *  no effect would, and the next real read of it went unsaid. */
  const navigated = useRef<{ tabId: string; key: string } | null>(null)
  const serial = useRef(new Map<string, number>())
  // Quiet selects per tab (#263): an open that lands after one must not take
  // the selected path back, or the marks just made read as stale and go.
  const marked = useRef(new Map<string, number>())
  /** The folder this tab's watch was set up on (perf review #10), and when
   *  its rows were last read: what the window's focus trusts. */
  const watched = useRef<{ tabId: string; key: string } | null>(null)
  const lastRead = useRef<{ tabId: string; key: string; at: number } | null>(null)
  const watchFolder = useCallback((tabId: string, folderPath: string) => {
    const key = directoryKey(folderPath)
    lastRead.current = { tabId, key, at: performance.now() }
    void window.prism.browseWatch(tabId, folderPath).then(
      (ok) => {
        watched.current = ok ? { tabId, key } : null
      },
      () => {
        watched.current = null
      }
    )
  }, [])
  const readDirectory = useRef(
    createDirectoryRequests((tabId, target, again) =>
      window.prism.browseDirectory(tabId, target, again ? { again } : undefined)
    )
  )
  const delivered = useRef<{
    tabId: string
    path: string
    refreshKey: number
    revision: number
    request: number
  } | null>(null)
  const location = active ? browseLocation(active.browse) : null
  const path = location?.path
  const id = active?.id
  const visibleId = useRef(id)
  const latestRefresh = useRef({ refreshKey, revision })
  useLayoutEffect(() => {
    visibleId.current = id
    latestRefresh.current = { refreshKey, revision }
  }, [id, refreshKey, revision])
  const error = errorState && errorState.tabId === id ? errorState.message : undefined
  const folder =
    !!active &&
    isExplorerTab(active) &&
    active.browse.surface === 'folder'
  // DOWNLOADS (#285): the Known Folder shows its own sort, newest first,
  // until one is picked there (lib/downloadsView.ts).
  const downloads = isDownloads(path, downloadsPath(locations))
  const sort = useMemo(
    () => (location ? viewSort(location, downloads) : { key: 'name' as const, direction: 'asc' as const }),
    [location, downloads]
  )
  const [weekStart, setWeekStart] = useState<number | undefined>(undefined)
  const search = useBrowseSearch(
    id,
    path,
    location?.query ?? '',
    folder,
    // Only an explicit refresh (F5, a file operation) re-runs a search, never
    // `revision` (review, 2026-10-16): the window's focus and the folder's
    // watcher bump that, and a new key blanked the results, reset the window
    // to the top and restarted the walk, every time the user came back to
    // Prism, and over and over in a folder that kept changing.
    refreshKey,
    sort,
    location?.selected ?? null
  )

  // THE FULL VIEWER HEARS THE DISK TOO (2026-10-26). A file open in the viewer
  // (a log CodeView follows, a markdown page that refreshes) used to hear its
  // folder through the project's root watcher; with projects gone the only
  // watch is the folder list's, which is shut while the viewer is in front.
  // So the viewer surface watches the folder of the file it shows, through
  // the same per-tab watch (the tab was granted that folder when the file was
  // opened or restored). The two never overlap: one surface is in front.
  const shownPath =
    active && active.kind !== 'settings' && active.browse.surface === 'viewer' && active.index >= 0
      ? (active.files[active.index]?.path ?? null)
      : null
  const viewerFolder = shownPath ? browseParent(shownPath) : null
  useEffect(() => {
    if (!id || !viewerFolder || folder) return
    void window.prism.browseWatch(id, viewerFolder)
    return () => {
      void window.prism.browseWatch(id, null)
    }
  }, [id, viewerFolder, folder])
  useEffect(() => {
    void window.prism.browseLocations().then(setLocations)
    void window.prism.weekStart().then(setWeekStart).catch(() => {})
  }, [])
  // Sizes and dates of a names-first answer (#271), laid over the rows in
  // place: the shared snapshot and the list on screen alike. ONE MERGE, NOT
  // TWO (perf review #11, 2026-10-28): when the list on screen is the
  // snapshot's listing, the snapshot's patched one is taken as is; only a
  // list that differs (a re-read that kept the rows on screen) is merged again.
  useEffect(
    () =>
      window.prism.onBrowseDetails((details) => {
        const before = visitedDirectories.peek(details.path)?.listing
        const held = visitedDirectories.patch(details)?.listing
        setResult((r) => {
          if (!r || directoryKey(r.path) !== directoryKey(details.path)) return r
          const listing = held && before && r.listing === before ? held : applyDetails(r.listing, details)
          return listing === r.listing ? r : { ...r, listing }
        })
      }),
    []
  )
  useEffect(() => {
    if (!folder || !id || !path) return
    const refresh = (why: OpenReason): void => {
      readReason.current = why
      setRevision((value) => value + 1)
    }
    const changed = window.prism.onDirChanged(({ dirs }) => {
      if (dirs.some((dir) => dir.toLowerCase() === path.toLowerCase())) refresh('dir-changed')
    })
    const onFocus = (): void => {
      if (focusNeedsRead(watched.current, lastRead.current, id, directoryKey(path), performance.now()))
        refresh('focus')
    }
    window.addEventListener('focus', onFocus)
    return () => {
      changed()
      window.removeEventListener('focus', onFocus)
      watched.current = null
      void window.prism.browseWatch(id, null)
    }
  }, [folder, id, path])
  useEffect(() => {
    const fresh = delivered.current
    delivered.current = null
    // Taken before any early return (review of #322): App bumps the refresh
    // key after every file operation, from a viewer or project tab too, where
    // this effect reads nothing, and the next Explorer read then said
    // `refresh` for an arrival or a navigation's follow-up.
    const refreshed = readRefreshKey.current !== refreshKey
    readRefreshKey.current = refreshKey
    if (!folder || !id || !path) return
    if (
      fresh?.tabId === id &&
      directoryKey(fresh.path) === directoryKey(path) &&
      fresh.refreshKey === refreshKey &&
      fresh.revision === revision &&
      fresh.request === serial.current.get(id)
    ) {
      navigated.current = null
      readReason.current = null
      watchFolder(id, path)
      return
    }
    let cancelled = false
    const request = serial.current.get(id)
    const reason: OpenReason = refreshed ? 'refresh' : (readReason.current ?? 'arrival')
    readReason.current = null
    const joined = navigated.current?.tabId === id && navigated.current.key === directoryKey(path)
    navigated.current = null
    const t0 = performance.now()
    const shown = !!visitedDirectories.get(path)
    const again = reason === 'dir-changed' || reason === 'focus'
    void readDirectory
      .current(id, path, `${refreshKey}:${revision}`, again)
      .then((next) => {
        // Said even when the effect has moved on (review of #322): a slow
        // read the user gave up on (a hung network folder) is exactly what
        // the log is for, as `navigate` says its own overtaken reads.
        if (!joined)
          openFolderCrumb(next?.path ?? path, reason, t0, next?.listing, shown, cancelled ? { abandoned: true } : {})
        if (cancelled) return
        if (serial.current.get(id) === request) setWaitingFor(null)
        if (next && !next.listing.unreadable) {
          const merged = visitedDirectories.remember(next)
          // THE SAME ROWS DRAW NOTHING (perf review #18, 2026-10-28): a
          // re-read whose rows match the ones on screen (the focus's, or the
          // watcher's for a change that left this folder's rows as they were)
          // keeps the answer on screen, so nothing re-sorts or re-renders.
          // Its details patch still lands on that answer if a size moved.
          setResult((r) =>
            r &&
            r.tabId === id &&
            directoryKey(r.path) === directoryKey(merged.path) &&
            sameRows(r.listing, merged.listing)
              ? r
              : { ...merged, tabId: id }
          )
          setError(undefined)
          // A folder gone from inside a zip answered the nearest one still
          // there (#300): the tab's CURRENT entry becomes that place (a push
          // made Back bounce off the gone folder forever).
          if (
            next.listing.archiveError?.reason === 'missing' &&
            directoryKey(next.path) !== directoryKey(path)
          )
            setState((s) => ({ ...s, tabs: replaceBrowsePath(s.tabs, id, next.path) }))
          watchFolder(id, next.path)
        } else {
          visitedDirectories.forget(path)
          setResult(null)
          const refused = next?.listing.archiveError
          if (refused && (refused.reason === 'password' || refused.reason === 'aes'))
            askArchive(id, refused.container, () => {
              readReason.current = 'retry'
              setRevision((v) => v + 1)
            })
          setError({
            tabId: id,
            message:
              refused?.message ??
              'This folder cannot be opened. Check the path or choose another location.'
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          visitedDirectories.forget(path)
          setResult(null)
          if (serial.current.get(id) === request) setWaitingFor(null)
          setError({ tabId: id, message: 'This folder cannot be read. Try another location.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [folder, id, path, refreshKey, revision, askArchive, setState, watchFolder])

  const navigate = useCallback(
    async (target: string, tabId = id) => {
      if (!tabId) return
      pauseTab(tabId)
      const request = (serial.current.get(tabId) ?? 0) + 1
      serial.current.set(tabId, request)
      // A HIT PAINTS NOW, BEFORE THE READ (#271): this session's snapshot,
      // else the listing cache on disk (a synchronous look, tens of KB).
      const cached = visitedDirectories.get(target) ?? rememberCached(target)
      const t0 = performance.now()
      const marker = { tabId, key: directoryKey(target) }
      navigated.current = marker
      // Start the real read before committing a cached cursor. Its location
      // effect joins this same promise instead of scanning the folder twice.
      const reading = readDirectory
        .current(tabId, target, `${refreshKey}:${revision}`)
        .catch(() => null)
      if (visibleId.current === tabId) {
        // A miss keeps the folder on screen (dimmed after a moment, a hint
        // after 300 ms); it never empties the list for the read.
        setWaitingFor(cached ? null : { tabId, path: target })
        setError(undefined)
        if (cached) setResult({ ...cached, tabId })
      }
      if (cached) setState((s) => ({ ...s, tabs: navigateBrowse(s.tabs, tabId, cached.path) }))
      const next = await reading
      // Its read has answered: a location effect that joins it has run by
      // now, and one that never will (the folder already shown) must not
      // leave the marker to swallow the next read's crumb.
      if (navigated.current === marker) navigated.current = null
      // Said even when a later navigation overtook it: the read still ran,
      // and a slow one is what the log is for.
      openFolderCrumb(next?.path ?? target, 'navigate', t0, next?.listing, !!cached)
      if (serial.current.get(tabId) !== request) return
      // The cached cursor is already committed. A later watch/explicit refresh
      // owns its new contents; this earlier scan must not overwrite that result.
      if (
        cached &&
        (latestRefresh.current.refreshKey !== refreshKey ||
          latestRefresh.current.revision !== revision)
      )
        return
      if (visibleId.current === tabId) setWaitingFor(null)
      if (!next || next.listing.unreadable) {
        visitedDirectories.forget(target)
        const refused = next?.listing.archiveError
        if (visibleId.current === tabId) {
          if (cached) setResult(null)
          setError({
            tabId,
            message:
              refused?.message ??
              'This folder cannot be opened. Check the path or choose another location.'
          })
        }
        // A zip whose NAMES are locked asks before it can be entered (#300);
        // Cancel stays where you were.
        if (refused && (refused.reason === 'password' || refused.reason === 'aes'))
          askArchive(tabId, refused.container, () => void navigateRef.current(target, tabId))
        return
      }
      if (visibleId.current === tabId) {
        setResult({ ...visitedDirectories.remember(next), tabId })
        setError(undefined)
        if (!folder || !path || directoryKey(path) !== directoryKey(next.path))
          delivered.current = { tabId, path: next.path, refreshKey, revision, request }
      }
      if (!cached) setState((s) => ({ ...s, tabs: navigateBrowse(s.tabs, tabId, next.path) }))
    },
    [id, path, folder, refreshKey, revision, setState, askArchive]
  )
  useLayoutEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const travel = useCallback(
    (delta: number) => {
      setWaitingFor(null)
      setError(undefined)
      if (id) {
        serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
        pauseTab(id)
        if (active) {
          const { history, cursor } = active.browse
          const next = Math.max(0, Math.min(history.length - 1, cursor + Math.trunc(delta)))
          const target = history[next]?.path
          if (next !== cursor) readReason.current = next < cursor ? 'back' : 'forward'
          const cached = visitedDirectories.get(target) ?? (target ? rememberCached(target) : null)
          if (cached) setResult({ ...cached, tabId: id })
          // Not held anywhere: the folder on screen stays, as a navigation's
          // does (review of #271), until the read answers or 300 ms pass.
          else if (target && next !== cursor) setWaitingFor({ tabId: id, path: target })
        }
        setState((s) => ({ ...s, tabs: travelBrowse(s.tabs, id, delta) }))
      }
    },
    [active, id, setState]
  )
  const patch = useCallback(
    (patch: Partial<Omit<BrowseLocation, 'path'>>) => {
      if (id) setState((s) => ({ ...s, tabs: setBrowseLocation(s.tabs, id, patch) }))
    },
    [id, setState]
  )
  /** A settled scroll, for the history entry on screen NOW (review,
   *  2026-10-16): the list calls the one it was given when it scrolled, so a
   *  position that settles after a navigation still lands where it was made
   *  (`setBrowseScroll`). Never per scroll event: the list keeps its own. */
  const at = active?.browse.cursor
  const atQuery = location?.query
  const atSort = location?.sort
  const keepScroll = useCallback(
    (scrollTop: number) => {
      if (!id || at === undefined || path === undefined || atQuery === undefined || !atSort) return
      const place = { cursor: at, path, query: atQuery, sort: atSort }
      setState((s) => {
        const tabs = setBrowseScroll(s.tabs, id, place, scrollTop)
        return tabs === s.tabs ? s : { ...s, tabs }
      })
    },
    [id, at, path, atQuery, atSort, setState]
  )
  /** Start, refine or clear the search: a place in the history (#281). */
  const searchFor = useCallback(
    (query: string) => {
      // The filter on the timeline (#322): once per keystroke, so Detailed
      // logging's only, as is the `search-start` of the search it starts; a
      // slow search's `search-end` (with the query) is the quiet line.
      crumb('filter', { query }, { often: true })
      if (id) setState((s) => ({ ...s, tabs: searchBrowse(s.tabs, id, query) }))
    },
    [id, setState]
  )
  const showFolder = useCallback(() => {
    setWaitingFor(null)
    setError(undefined)
    if (id) {
      serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
      pauseTab(id)
      const cached = visitedDirectories.get(path)
      if (cached) setResult({ ...cached, tabId: id })
      setState((s) => ({ ...s, tabs: setBrowseSurface(s.tabs, id, 'folder') }))
    }
  }, [id, path, setState])
  // Tree paths share the same last-action-wins sequence as folder and preview opens.
  // `judged`: the marked row this open was decided on (the way out of a zip);
  // a tab that marks another by the time it lands keeps that one.
  const openFile = useCallback(
    async (file: ViewerFile | string, full = true, play = true, judged: string | null = null) => {
      if (!id || !path) return
      const request = (serial.current.get(id) ?? 0) + 1
      serial.current.set(id, request)
      const marksAtAsk = marked.current.get(id) ?? 0
      if (visibleId.current === id) setError(undefined)
      const fromTree = typeof file === 'string'
      const filePath = fromTree ? file : file.path
      // A PICK PLAYS (#139, and #207 for the Explorer; owner, 2026-09-23: "when
      // you click a audio or video file it autoplays, the only times videos and
      // audio shouldnt autoplay is when you open prism and a video is already in
      // one of the tabs"). The project tree has recorded this intent since
      // 2026-09-03; the Explorer's row click, double-click, pins and menu never
      // did, so a film picked there sat at 0:00. Keyed by the media URL, which is
      // what the players ask `wasPlaying`. A restore never comes through here, and
      // callers that only SHOW a file (the preview toggle, Open full view, an
      // arrival App has already judged) pass `play = false`.
      const kind = fromTree ? fileKind(extOf(filePath)) : file.kind
      if (play && (kind === 'video' || kind === 'audio')) intendToPlay(window.prism.mediaUrl(filePath))
      const root =
        fromTree && active && underRoot(active.root, filePath)
          ? active.root
          : (browseParent(filePath) ?? path)
      // A saved file pin may be outside every visited folder after restart.
      // Grant its parent only on activation, inside the same navigation sequence.
      const parent = fromTree ? (browseParent(filePath) ?? root) : null
      // For its grant only: no details run to take the disk from the list.
      const granted = parent
        ? await window.prism.browseDirectory(id, parent, { details: false }).catch(() => null)
        : true
      if (serial.current.get(id) !== request) return
      const payload = granted
        ? await window.prism.openWithin(root, filePath).catch(() => null)
        : null
      if (serial.current.get(id) !== request) return
      if (!payload) {
        if (visibleId.current === id)
          setError({
            tabId: id,
            message: 'This file cannot be opened. It may have moved or been deleted.'
          })
        return false
      }
      setState((s) => ({
        ...s,
        tabs: arrivalSelection(
          parent ? navigateBrowse(s.tabs, id, parent) : s.tabs,
          id,
          filePath,
          marksAtAsk !== (marked.current.get(id) ?? 0) || (judged !== null && selectionMoved(s.tabs, id, judged))
        ).map((t) =>
          t.id === id
            ? {
                ...t,
                files: payload.files,
                index: payload.index,
                browse: {
                  ...t.browse,
                  surface: full ? 'viewer' : 'folder'
                }
              }
            : t
        )
      }))
      return true
    },
    [active, id, path, setState]
  )
  // The tab's own answer, else the shared snapshot of the same folder (#271):
  // a tab switch, or a restored tab's first frame, draws rows before any
  // read. With nothing in memory either, the cache on disk, looked at while
  // rendering (a synchronous read of one small file, once per folder; under
  // 1 ms MEASURED for a miss), and what it finds goes into the snapshots.
  const ownAnswer = !!result && result.tabId === id && result.path === path
  const diskListing = useMemo(
    () =>
      folder && path && !ownAnswer && !visitedDirectories.get(path)
        ? (rememberCached(path)?.listing ?? null)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per folder, not per answer
    [folder, path]
  )
  const waitingPath = waitingFor && waitingFor.tabId === id ? waitingFor.path : null
  // A failed read drops what the disk had for the folder (review of #271): the
  // memo would otherwise keep its rows, and the status bar its count, under
  // the error. Back or Forward to a folder not held anywhere keeps the rows
  // of the folder it left while its read is out (`held`), as a navigation does.
  const held =
    result && waitingPath && result.tabId === id && directoryKey(waitingPath) === directoryKey(path ?? '')
      ? result.listing
      : null
  const directoryListing = ownAnswer
    ? result!.listing
    : (visitedDirectories.get(path)?.listing ?? (error ? null : diskListing) ?? held)
  const waiting = !!waitingPath || (folder && !directoryListing && !error)
  const pending: ListPending = usePendingHint(waiting ? `${id}\0${waitingPath ?? path}` : null)
  const listing = search.result?.listing ?? directoryListing
  // OUT OF A ZIP, ITS PREVIEW COMES BACK (#334, `wayOutPreview`). Each move of
  // this tab from one place to another is an arrival, said once; a tab switch
  // is not one. It is judged when the folder arrived at has its rows.
  const lastPlace = useRef<{ tabId: string; path: string } | null>(null)
  const arrival = useRef<{ tabId: string; from: string; to: string } | null>(null)
  useEffect(() => {
    const was = lastPlace.current
    lastPlace.current = id && path ? { tabId: id, path } : null
    arrival.current =
      was && id && path && was.tabId === id && directoryKey(was.path) !== directoryKey(path)
        ? { tabId: id, from: was.path, to: path }
        : null
  }, [id, path])
  const selectedHere = location?.selected ?? null
  const previewOn = !!active?.browse.preview
  useEffect(() => {
    const came = arrival.current
    if (!came || came.tabId !== id || !path || directoryKey(came.to) !== directoryKey(path)) return
    // Rows still those of the folder left (a Back whose read is out) are not
    // this folder's: wait for its own.
    if (!folder || !directoryListing || waitingPath) return
    arrival.current = null
    const file = wayOutPreview({
      from: came.from,
      to: path,
      selected: selectedHere,
      preview: previewOn,
      files: directoryListing.files
    })
    // Judged on the zip being marked: a landing mark made in this same commit
    // (an extraction's, #70) is not taken back (`selectionMoved`).
    if (file) void openFile(file, false, false, selectedHere)
  }, [id, path, folder, directoryListing, waitingPath, selectedHere, previewOn, openFile])
  const select = useCallback(
    (selected: string | null, quiet = false) => {
      // MARKING IS NOT PICKING (#263; owner, 2026-10-03: "when you multiselect
      // like this it picks a file so here this drag starts one of the videos,
      // and if the preview is not open it will open. it shouldnt, im just
      // selecting, same is the case if i ctrl select it shouldnt start or
      // preview anything"). A sweep or a Ctrl or Shift click only moves the
      // keyboard's place: the preview keeps what it shows, nothing starts or
      // pauses, and a pane that is shut stays shut. Nor is the serial moved, so
      // an open a plain click already asked for still lands.
      if (quiet) {
        if (id) marked.current.set(id, (marked.current.get(id) ?? 0) + 1)
        return patch({ selected })
      }
      if (id) serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
      patch({ selected })
      const file = listing?.files.find((f) => f.path === selected)
      if (file && active?.browse.preview) void openFile(file, false)
      else if (id) pauseTab(id)
    },
    [id, patch, listing, active?.browse.preview, openFile]
  )
  const togglePreview = useCallback(() => {
    if (!active || !id) return
    const preview = !active.browse.preview
    if (!preview) {
      serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
      pauseTab(id)
    }
    setState((s) => ({ ...s, tabs: setBrowsePreview(s.tabs, id, preview) }))
    crumb('preview', { on: preview })
    const file = listing?.files.find((f) => f.path === location?.selected)
    if (preview && file) void openFile(file, false, false)
  }, [active, id, setState, listing, location?.selected, openFile])
  const openSplit = useCallback(
    (file: ViewerFile | string) => {
      if (!active || !id || !isExplorerTab(active)) return
      crumb('preview', { on: true, path: typeof file === 'string' ? file : file.path })
      setState((s) => ({
        ...s,
        tabs: setBrowsePreview(setBrowseSurface(s.tabs, id, 'folder'), id, true)
      }))
      void openFile(file, false)
    },
    [active, id, setState, openFile]
  )
  const previewFile = useMemo(() => active?.files[active.index], [active?.files, active?.index])
  /** The password question's answer (#300): main remembers it for the
   *  session and the place is asked for again; a wrong one asks again. */
  const answerArchive = useCallback(
    (password: string | null) => {
      const ask = archiveAsk
      setArchiveAsk(null)
      if (!ask || password === null) return
      void window.prism.archiveRememberPassword(ask.container, password).then(() => ask.retry())
    },
    [archiveAsk]
  )
  const askHere = archiveAsk && archiveAsk.tabId === id ? archiveAsk : null
  const shownError = error ?? search.error
  const searchState = search.state
  const cancelSearch = search.cancel
  const searchRange = search.requestRange
  // ONE OBJECT WHILE NOTHING IN IT CHANGED (perf review, 2026-10-28). A new
  // literal every render made the App's drag-and-drop listeners and its
  // capturing keydown re-subscribe on every render (both list `browsing` in
  // their deps), and left nothing derived from it stable enough to memo.
  return useMemo(
    () => ({
      folder,
      location,
      /** A place inside an archive asks for its password (#300). */
      archiveAsk: askHere,
      answerArchive,
      /** The sort the folder is shown in (Downloads' own until picked, #285). */
      sort,
      downloads,
      weekStart,
      listing,
      locations,
      pending,
      /** Where a navigation is going while its folder has not answered: the
       *  address bar says so at once. */
      pendingPath: waitingPath,
      error: shownError,
      searchState,
      cancelSearch,
      searchRange,
      navigate,
      travel,
      patch,
      keepScroll,
      searchFor,
      showFolder,
      openFile,
      openSplit,
      select,
      togglePreview,
      previewFile
    }),
    [
      folder,
      location,
      askHere,
      answerArchive,
      sort,
      downloads,
      weekStart,
      listing,
      locations,
      pending,
      waitingPath,
      shownError,
      searchState,
      cancelSearch,
      searchRange,
      navigate,
      travel,
      patch,
      keepScroll,
      searchFor,
      showFolder,
      openFile,
      openSplit,
      select,
      togglePreview,
      previewFile
    ]
  )
}
