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
  travelBrowse,
  setBrowseLocation,
  setBrowseSurface,
  setBrowsePreview,
  isExplorerTab,
  underRoot,
  type Tab,
  type TabState
} from './tabs'
import { fileKind } from '@shared/fileKind'
import { applyDetails } from './listingMerge'
import { browseLocation, browseParent } from './browse'
import { intendToPlay } from './playState'
import { useBrowseSearch } from './useBrowseSearch'
import { createDirectoryRequests, directoryKey, visitedDirectories } from './visitedDirectories'
import { usePendingHint, type ListPending } from './usePendingHint'

const extOf = (name: string): string => /\.[^.]*$/.exec(name.toLowerCase())?.[0] ?? ''

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

/** The listing cache on disk, kept in the shared snapshots when it has the
 *  folder (#271). Synchronous: it paints in the same frame. */
function rememberCached(path: string): BrowseDirectory | null {
  // No bridge (a test rendering the hook on its own): nothing on disk to ask.
  if (typeof window === 'undefined' || !window.prism?.browseCached) return null
  const hit = window.prism.browseCached(path)
  return hit && !hit.listing.unreadable ? visitedDirectories.remember(hit) : null
}

/** Folder navigation owns only the browse cursor. It never reroots a session or writes to a shell. */
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
  const [locations, setLocations] = useState<BrowseShortcut[]>([])
  const [revision, setRevision] = useState(0)
  const serial = useRef(new Map<string, number>())
  // Quiet selects per tab (#263): an open that lands after one must not take
  // the selected path back, or the marks just made read as stale and go.
  const marked = useRef(new Map<string, number>())
  const readDirectory = useRef(
    createDirectoryRequests((tabId, target) => window.prism.browseDirectory(tabId, target))
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
    active.browse.surface === 'folder' &&
    (!active.term || active.term.view === 'hidden')
  const search = useBrowseSearch(
    id,
    path,
    location?.query ?? '',
    folder,
    refreshKey + revision,
    location?.sort ?? { key: 'name', direction: 'asc' },
    location?.selected ?? null
  )

  useEffect(() => {
    void window.prism.browseLocations().then(setLocations)
  }, [])
  // Sizes and dates of a names-first answer (#271), laid over the rows in
  // place: the shared snapshot and the list on screen alike.
  useEffect(
    () =>
      window.prism.onBrowseDetails((details) => {
        visitedDirectories.patch(details)
        setResult((r) =>
          r && directoryKey(r.path) === directoryKey(details.path)
            ? (() => {
                const listing = applyDetails(r.listing, details)
                return listing === r.listing ? r : { ...r, listing }
              })()
            : r
        )
      }),
    []
  )
  useEffect(() => {
    if (!folder || !id || !path) return
    const refresh = (): void => setRevision((value) => value + 1)
    const changed = window.prism.onDirChanged(({ dirs }) => {
      if (dirs.some((dir) => dir.toLowerCase() === path.toLowerCase())) refresh()
    })
    window.addEventListener('focus', refresh)
    return () => {
      changed()
      window.removeEventListener('focus', refresh)
      void window.prism.browseWatch(id, null)
    }
  }, [folder, id, path])
  useEffect(() => {
    const fresh = delivered.current
    delivered.current = null
    if (!folder || !id || !path) return
    if (
      fresh?.tabId === id &&
      directoryKey(fresh.path) === directoryKey(path) &&
      fresh.refreshKey === refreshKey &&
      fresh.revision === revision &&
      fresh.request === serial.current.get(id)
    ) {
      void window.prism.browseWatch(id, path)
      return
    }
    let cancelled = false
    const request = serial.current.get(id)
    void readDirectory
      .current(id, path, `${refreshKey}:${revision}`)
      .then((next) => {
        if (cancelled) return
        if (serial.current.get(id) === request) setWaitingFor(null)
        if (next && !next.listing.unreadable) {
          setResult({ ...visitedDirectories.remember(next), tabId: id })
          setError(undefined)
          void window.prism.browseWatch(id, path)
        } else {
          visitedDirectories.forget(path)
          setResult(null)
          setError({
            tabId: id,
            message: 'This folder cannot be opened. Check the path or choose another location.'
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
  }, [folder, id, path, refreshKey, revision])

  const navigate = useCallback(
    async (target: string, tabId = id) => {
      if (!tabId) return
      pauseTab(tabId)
      const request = (serial.current.get(tabId) ?? 0) + 1
      serial.current.set(tabId, request)
      // A HIT PAINTS NOW, BEFORE THE READ (#271): this session's snapshot,
      // else the listing cache on disk (a synchronous look, tens of KB).
      const cached = visitedDirectories.get(target) ?? rememberCached(target)
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
        if (visibleId.current === tabId) {
          if (cached) setResult(null)
          setError({
            tabId,
            message: 'This folder cannot be opened. Check the path or choose another location.'
          })
        }
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
    [id, path, folder, refreshKey, revision, setState]
  )
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
          const cached = visitedDirectories.get(target) ?? (target ? rememberCached(target) : null)
          if (cached) setResult({ ...cached, tabId: id })
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
  const openFile = useCallback(
    async (file: ViewerFile | string, full = true, play = true) => {
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
          marksAtAsk !== (marked.current.get(id) ?? 0)
        ).map((t) =>
          t.id === id
            ? {
                ...t,
                files: payload.files,
                index: payload.index,
                browse: {
                  ...t.browse,
                  surface: full ? 'viewer' : 'folder'
                },
                term: t.term ? { ...t.term, view: 'hidden' } : null
              }
            : t
        )
      }))
      return true
    },
    [active, id, path, setState]
  )
  // The tab's own answer, else the shared snapshot of the same folder: a tab
  // switch, or a restored tab's first frame, draws rows before any read.
  // Nothing in memory for the folder on screen: the cache on disk, looked at
  // while rendering (a synchronous read of one small file, once per folder),
  // so the first frame has rows. What it finds goes into the snapshots.
  const ownAnswer = !!result && result.tabId === id && result.path === path
  const diskListing = useMemo(
    () =>
      folder && path && !ownAnswer && !visitedDirectories.get(path)
        ? (rememberCached(path)?.listing ?? null)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per folder, not per answer
    [folder, path]
  )
  const directoryListing = ownAnswer
    ? result!.listing
    : (visitedDirectories.get(path)?.listing ?? diskListing)
  const waitingPath = waitingFor && waitingFor.tabId === id ? waitingFor.path : null
  const waiting = !!waitingPath || (folder && !directoryListing && !error)
  const pending: ListPending = usePendingHint(waiting ? `${id}\0${waitingPath ?? path}` : null)
  const listing = search.result?.listing ?? directoryListing
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
    const file = listing?.files.find((f) => f.path === location?.selected)
    if (preview && file) void openFile(file, false, false)
  }, [active, id, setState, listing, location?.selected, openFile])
  const openSplit = useCallback(
    (file: ViewerFile | string) => {
      if (!active || !id || !isExplorerTab(active)) return
      setState((s) => ({
        ...s,
        tabs: setBrowsePreview(setBrowseSurface(s.tabs, id, 'folder'), id, true)
      }))
      void openFile(file, false)
    },
    [active, id, setState, openFile]
  )
  const previewFile = useMemo(() => active?.files[active.index], [active?.files, active?.index])
  return {
    folder,
    location,
    listing,
    locations,
    pending,
    /** Where a navigation is going while its folder has not answered: the
     *  address bar says so at once. */
    pendingPath: waitingPath,
    error: error ?? search.error,
    searchState: search.state,
    cancelSearch: search.cancel,
    searchRange: search.requestRange,
    navigate,
    travel,
    patch,
    showFolder,
    openFile,
    openSplit,
    select,
    togglePreview,
    previewFile
  }
}
