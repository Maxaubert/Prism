import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowseSearchResult, BrowseSort } from '@shared/browse'
import { mergeSearchWindows, searchWindowOffset } from './searchWindows'

const emptyResult = (path: string): BrowseSearchResult => ({
  path,
  listing: { folders: [], files: [] },
  scanned: 0,
  unreadable: 0,
  skippedLinks: 0,
  truncated: false,
  cancelled: false
})

/** The index owns the full result set. Only a bounded cache of nearby rows crosses IPC. */
export function useBrowseSearch(
  tabId: string | undefined,
  path: string | undefined,
  query: string,
  visible: boolean,
  revision: number,
  sort: BrowseSort,
  selectedPath: string | null
) {
  const key = JSON.stringify([tabId, path, query, revision, sort.key, sort.direction])
  const [range, setRange] = useState({ key: '', start: 0 })
  const offset = range.key === key ? searchWindowOffset(range.start) : 0
  const cache = useRef({ key: '', pages: new Map<number, BrowseSearchResult>() })
  const retainedSelection = useRef<{ key: string; page: BrowseSearchResult } | undefined>(undefined)
  const selection = useRef(selectedPath)
  useEffect(() => {
    selection.current = selectedPath
  }, [selectedPath])
  const [answer, setAnswer] = useState<{
    key: string
    result: BrowseSearchResult
    windows: NonNullable<BrowseSearchResult['window']>[]
    running: boolean
    error?: string
  }>()
  const cancel = useRef<() => void>(() => {})
  useEffect(() => {
    if (answer?.key !== key) return
    const folders = answer.result.listing.folders.filter((entry) => entry.path === selectedPath)
    const files = answer.result.listing.files.filter((entry) => entry.path === selectedPath)
    retainedSelection.current =
      folders.length || files.length
        ? {
            key,
            page: { ...answer.result, listing: { folders, files } }
          }
        : undefined
  }, [answer, key, selectedPath])
  const searching = visible && !!tabId && !!path && !!query.trim()
  useEffect(() => {
    if (!searching || !tabId || !path) return
    if (cache.current.key !== key) cache.current = { key, pages: new Map() }
    const pages = cache.current.pages
    let disposed = false
    let stopped = false
    let started = false
    let refreshes = 0
    let timer: ReturnType<typeof setTimeout>
    const requestId = crypto.randomUUID()
    const deliver = (result: BrowseSearchResult, running: boolean): void => {
      if (result.window) {
        if ([...pages.values()].some((page) => page.window?.total !== result.window?.total))
          pages.clear()
        pages.delete(result.window.offset)
        pages.set(result.window.offset, result)
        // Keep selection actionable when the user scrolls far away from its row.
        const selectedPage =
          retainedSelection.current?.key === key &&
          (retainedSelection.current.page.listing.files.some(
            (file) => file.path === selection.current
          ) ||
            retainedSelection.current.page.listing.folders.some(
              (folder) => folder.path === selection.current
            ))
            ? retainedSelection.current.page
            : undefined
        while (pages.size > 8) {
          const oldest = pages.keys().next().value!
          pages.delete(oldest)
        }
        const merged = mergeSearchWindows([...pages.values()], result, selectedPage)
        setAnswer({ key, ...merged, running })
      } else setAnswer({ key, result, windows: [], running })
    }
    const unsubscribe = window.prism.onBrowseSearchProgress((progress) => {
      if (
        !disposed &&
        !stopped &&
        refreshes === 0 &&
        progress.tabId === tabId &&
        progress.requestId === requestId
      )
        deliver(progress, true)
    })
    const run = () => {
      started = true
      setAnswer((previous) =>
        previous?.key === key
          ? { ...previous, running: true, error: undefined }
          : { key, result: emptyResult(path), windows: [], running: true }
      )
      void window.prism
        .browseSearch(tabId, path, query, requestId, {
          offset,
          limit: 512,
          sort: { key: sort.key, direction: sort.direction }
        })
        .then((result) => {
          if (disposed || stopped) return
          if (offset > 0 && !result.window && pages.size) {
            setAnswer((previous) =>
              previous?.key === key
                ? {
                    ...previous,
                    running: false,
                    result: {
                      ...previous.result,
                      notice: result.notice ?? 'Index unavailable. Refresh to retry.'
                    }
                  }
                : previous
            )
            return
          }
          deliver(result, false)
          // Small, newly indexed folders settle quickly. Broad searches should not
          // revalidate the same rows repeatedly while the user is scrolling.
          if (
            result.source === 'everything' &&
            !result.cancelled &&
            (result.window?.total ?? Infinity) <= 512 &&
            offset === 0 &&
            refreshes < 2
          )
            timer = setTimeout(run, ++refreshes === 1 ? 500 : 1500)
        })
        .catch(() => {
          if (!disposed && !stopped)
            setAnswer((previous) => ({
              ...(previous?.key === key
                ? previous
                : { key, result: emptyResult(path), windows: [] }),
              running: false,
              error: 'Search could not finish. Try again or choose another folder.'
            }))
        })
    }
    const cached = pages.get(offset)
    if (cached) deliver(cached, false)
    else timer = setTimeout(run, pages.size ? 16 : 50)
    cancel.current = () => {
      stopped = true
      clearTimeout(timer)
      if (started) window.prism.browseSearchCancel(tabId, requestId)
      setAnswer((previous) => ({
        key,
        windows: previous?.key === key ? previous.windows : [],
        result: {
          ...(previous?.key === key ? previous.result : emptyResult(path)),
          cancelled: true
        },
        running: false
      }))
    }
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
      if (started) window.prism.browseSearchCancel(tabId, requestId)
      cancel.current = () => {}
    }
  }, [key, offset, path, query, searching, tabId, sort.key, sort.direction])
  const current = answer?.key === key ? answer : undefined
  const requestRange = useCallback(
    (start: number) => {
      setRange((previous) =>
        previous.key === key && searchWindowOffset(previous.start) === searchWindowOffset(start)
          ? previous
          : { key, start }
      )
    },
    [key]
  )
  return {
    result: searching ? (current?.result ?? emptyResult(path!)) : undefined,
    state: searching
      ? {
          ...(current?.result ?? emptyResult(path!)),
          windows: current?.windows,
          running: current?.running ?? true
        }
      : undefined,
    error: searching ? current?.error : undefined,
    cancel: () => cancel.current(),
    requestRange
  }
}
