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
    let stopped = false
    let started = false
    let refreshes = 0
    let timer: ReturnType<typeof setTimeout>
    const requestId = crypto.randomUUID()
    const unsubscribe = window.prism.onBrowseSearchProgress((progress) => {
      if (
        !disposed &&
        !stopped &&
        refreshes === 0 &&
        progress.tabId === tabId &&
        progress.requestId === requestId
      )
        setAnswer({ key, result: progress, running: true })
    })
    const run = () => {
      started = true
      if (refreshes === 0) setAnswer({ key, result: emptyResult(path), running: true })
      void window.prism
        .browseSearch(tabId, path, query, requestId)
        .then((result) => {
          if (disposed || stopped) return
          setAnswer((previous) =>
            previous?.key === key &&
            !previous.running &&
            JSON.stringify(previous.result) === JSON.stringify(result)
              ? previous
              : { key, result, running: false }
          )
          // Return immediately, then let Everything consume recent create and
          // rename events. These bounded follow-ups keep the visible results
          // in place and are cancelled with this query, folder or tab.
          if (result.source === 'everything' && !result.cancelled && refreshes < 2) {
            timer = setTimeout(run, ++refreshes === 1 ? 500 : 1500)
          }
        })
        .catch(() => {
          if (!disposed && !stopped && refreshes === 0)
            setAnswer({
              key,
              result: emptyResult(path),
              running: false,
              error: 'Search could not finish. Try again or choose another folder.'
            })
        })
    }
    timer = setTimeout(run, 50)
    cancel.current = () => {
      stopped = true
      clearTimeout(timer)
      if (started) window.prism.browseSearchCancel(tabId, requestId)
      setAnswer((previous) => ({
        key,
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
