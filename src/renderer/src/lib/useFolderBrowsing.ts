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
import { browseLocation, browseParent } from './browse'
import { intendToPlay } from './playState'
import { useBrowseSearch } from './useBrowseSearch'
import {
  createDirectoryRequests,
  createVisitedDirectories,
  directoryKey
} from './visitedDirectories'

const extOf = (name: string): string => /\.[^.]*$/.exec(name.toLowerCase())?.[0] ?? ''

function pauseTab(tabId: string): void {
  for (const region of document.querySelectorAll<HTMLElement>('[data-player-tab]')) {
    if (region.dataset.playerTab !== tabId) continue
    for (const media of region.querySelectorAll<HTMLMediaElement>('video,audio')) media.pause()
  }
}

/** Folder navigation owns only the browse cursor. It never reroots a session or writes to a shell. */
export function useFolderBrowsing(
  active: Tab | null,
  setState: Dispatch<SetStateAction<TabState>>,
  refreshKey: number
) {
  const [result, setResult] = useState<(BrowseDirectory & { tabId: string }) | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorState, setError] = useState<{ tabId: string; message: string }>()
  const [locations, setLocations] = useState<BrowseShortcut[]>([])
  const [revision, setRevision] = useState(0)
  const serial = useRef(new Map<string, number>())
  const visited = useRef(createVisitedDirectories())
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
    visited.current.use(id)
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
        if (serial.current.get(id) === request) setLoading(false)
        if (next && !next.listing.unreadable) {
          visited.current.remember(id, next)
          setResult({ ...next, tabId: id })
          setError(undefined)
          void window.prism.browseWatch(id, path)
        } else {
          visited.current.forget(id, path)
          setResult(null)
          setError({
            tabId: id,
            message: 'This folder cannot be opened. Check the path or choose another location.'
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          visited.current.forget(id, path)
          setResult(null)
          if (serial.current.get(id) === request) setLoading(false)
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
      const cached = visited.current.get(tabId, target)
      // Start the real read before committing a cached cursor. Its location
      // effect joins this same promise instead of scanning the folder twice.
      const reading = readDirectory
        .current(tabId, target, `${refreshKey}:${revision}`)
        .catch(() => null)
      if (visibleId.current === tabId) {
        setLoading(!cached)
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
      if (visibleId.current === tabId) setLoading(false)
      if (!next || next.listing.unreadable) {
        visited.current.forget(tabId, target)
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
        visited.current.remember(tabId, next)
        setResult({ ...next, tabId })
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
      setLoading(false)
      setError(undefined)
      if (id) {
        serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
        pauseTab(id)
        if (active) {
          const { history, cursor } = active.browse
          const next = Math.max(0, Math.min(history.length - 1, cursor + Math.trunc(delta)))
          const cached = visited.current.get(id, history[next]?.path)
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
    setLoading(false)
    setError(undefined)
    if (id) {
      serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
      pauseTab(id)
      const cached = visited.current.get(id, path)
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
      const granted = parent
        ? await window.prism.browseDirectory(id, parent).catch(() => null)
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
        tabs: setBrowseLocation(parent ? navigateBrowse(s.tabs, id, parent) : s.tabs, id, {
          selected: filePath
        }).map((t) =>
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
  const directoryListing =
    result && result.tabId === id && result.path === path ? result.listing : null
  const listing = search.result?.listing ?? directoryListing
  const select = useCallback(
    (selected: string | null) => {
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
    loading: loading || (folder && !directoryListing && !error),
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
