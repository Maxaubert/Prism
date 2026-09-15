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
  underRoot,
  type Tab,
  type TabState
} from './tabs'
import { browseLocation, browseParent } from './browse'
import { useBrowseSearch } from './useBrowseSearch'

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
  const location = active ? browseLocation(active.browse) : null
  const path = location?.path
  const id = active?.id
  const visibleId = useRef(id)
  useLayoutEffect(() => {
    visibleId.current = id
  }, [id])
  const error = errorState && errorState.tabId === id ? errorState.message : undefined
  const folder =
    !!active &&
    active.kind !== 'settings' &&
    active.browse.surface === 'folder' &&
    (!active.term || active.term.view === 'hidden')
  const search = useBrowseSearch(id, path, location?.query ?? '', folder, refreshKey + revision)

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
    if (!folder || !id || !path) return
    let cancelled = false
    void window.prism
      .browseDirectory(id, path)
      .then((next) => {
        if (cancelled) return
        setLoading(false)
        if (next) {
          setResult({ ...next, tabId: id })
          setError(undefined)
          void window.prism.browseWatch(id, path)
        } else
          setError({
            tabId: id,
            message: 'This folder cannot be opened. Check the path or choose another location.'
          })
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
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
      if (visibleId.current === tabId) {
        setLoading(true)
        setError(undefined)
      }
      const next = await window.prism.browseDirectory(tabId, target).catch(() => null)
      if (serial.current.get(tabId) !== request) return
      if (visibleId.current === tabId) setLoading(false)
      if (!next || next.listing.unreadable) {
        if (visibleId.current === tabId)
          setError({
            tabId,
            message: 'This folder cannot be opened. Check the path or choose another location.'
          })
        return
      }
      if (visibleId.current === tabId) setResult({ ...next, tabId })
      setState((s) => ({ ...s, tabs: navigateBrowse(s.tabs, tabId, next.path) }))
    },
    [id, setState]
  )
  const travel = useCallback(
    (delta: number) => {
      setLoading(false)
      setError(undefined)
      if (id) {
        serial.current.set(id, (serial.current.get(id) ?? 0) + 1)
        pauseTab(id)
        setState((s) => ({ ...s, tabs: travelBrowse(s.tabs, id, delta) }))
      }
    },
    [id, setState]
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
      setState((s) => ({ ...s, tabs: setBrowseSurface(s.tabs, id, 'folder') }))
    }
  }, [id, setState])
  // Tree paths share the same last-action-wins sequence as folder and preview opens.
  const openFile = useCallback(
    async (file: ViewerFile | string, full = true) => {
      if (!id || !path) return
      const request = (serial.current.get(id) ?? 0) + 1
      serial.current.set(id, request)
      if (visibleId.current === id) setError(undefined)
      const fromTree = typeof file === 'string'
      const filePath = fromTree ? file : file.path
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
                browse: { ...t.browse, surface: full ? 'viewer' : 'folder' },
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
    if (preview && file) void openFile(file, false)
  }, [active, id, setState, listing, location?.selected, openFile])
  const previewFile = useMemo(
    () => listing?.files.find((f) => f.path === location?.selected),
    [listing, location?.selected]
  )
  return {
    folder,
    location,
    listing,
    locations,
    loading: loading || (folder && !directoryListing && !error),
    error: error ?? search.error,
    searchState: search.state,
    cancelSearch: search.cancel,
    navigate,
    travel,
    patch,
    showFolder,
    openFile,
    select,
    togglePreview,
    previewFile
  }
}
