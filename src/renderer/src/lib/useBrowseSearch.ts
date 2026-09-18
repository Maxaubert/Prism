import { useEffect, useRef, useState } from 'react'
import type { BrowseSearchResult } from '@shared/browse'

const emptyResult = (path: string): BrowseSearchResult => ({
  path,
  listing: { folders: [], files: [] },
  scanned: 0,
  unreadable: 0,
  skippedLinks: 0,
  truncated: false,
  cancelled: false
})

/** Each query belongs to one tab and location. Late results never cross that boundary. */
export function useBrowseSearch(
  tabId: string | undefined,
  path: string | undefined,
  query: string,
  visible: boolean,
  revision: number
) {
  const key = JSON.stringify([tabId, path, query, revision])
  const [answer, setAnswer] = useState<{
    key: string
    result: BrowseSearchResult
    running: boolean
    error?: string
  }>()
  const cancel = useRef<() => void>(() => {})
  const searching = visible && !!tabId && !!path && !!query.trim()
  useEffect(() => {
    if (!searching || !tabId || !path) return
    let disposed = false
    let started = false
    const requestId = crypto.randomUUID()
    const unsubscribe = window.prism.onBrowseSearchProgress((progress) => {
      if (!disposed && progress.tabId === tabId && progress.requestId === requestId)
        setAnswer({ key, result: progress, running: true })
    })
    const timer = setTimeout(() => {
      started = true
      setAnswer({ key, result: emptyResult(path), running: true })
      void window.prism
        .browseSearch(tabId, path, query, requestId)
        .then((result) => {
          if (!disposed) setAnswer({ key, result, running: false })
        })
        .catch(() => {
          if (!disposed)
            setAnswer({
              key,
              result: emptyResult(path),
              running: false,
              error: 'Search could not finish. Try again or choose another folder.'
            })
        })
    }, 50)
    cancel.current = () => {
      clearTimeout(timer)
      if (started) window.prism.browseSearchCancel(tabId, requestId)
      else setAnswer({ key, result: { ...emptyResult(path), cancelled: true }, running: false })
    }
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
      if (started) window.prism.browseSearchCancel(tabId, requestId)
      cancel.current = () => {}
    }
  }, [key, path, query, searching, tabId])
  const current = answer?.key === key ? answer : undefined
  return {
    result: searching ? (current?.result ?? emptyResult(path!)) : undefined,
    state: searching
      ? {
          ...(current?.result ?? emptyResult(path!)),
          running: current?.running ?? true
        }
      : undefined,
    error: searching ? current?.error : undefined,
    cancel: () => cancel.current()
  }
}
