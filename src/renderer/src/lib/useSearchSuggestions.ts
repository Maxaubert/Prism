import { useEffect, useState } from 'react'
import type { ViewerFile } from '@shared/types'
import { rankSuggestions } from './searchSuggest'

export interface Suggestion {
  path: string
  name: string
  isFolder: boolean
  file?: ViewerFile
}

export interface Suggestions {
  hits: Suggestion[]
  /** An answer for the query as typed now is still on its way. The last
   *  answer stays on screen meanwhile, so a word typed does not flash empty. */
  running: boolean
  /** Found more than were shown (the list's search will have them). */
  more: boolean
}

/** One empty list for every "nothing", so a row marked in it stays marked. */
const NONE: Suggestion[] = []

/**
 * The search popup's few likely matches (#267), through main's own search
 * (the Everything index when it runs, the bounded walk when it does not), in
 * a slot beside the list's search so neither stops the other. A short pause
 * after each key, so a word typed fast is one search rather than five.
 */
export function useSearchSuggestions(
  tabId: string | undefined,
  path: string,
  query: string
): Suggestions {
  const key = JSON.stringify([tabId, path, query])
  const asked = !!tabId && !!query.trim()
  const [answer, setAnswer] = useState<{ key: string; hits: Suggestion[]; more: boolean } | null>(null)
  useEffect(() => {
    if (!tabId || !query.trim()) return
    let live = true
    let requestId = crypto.randomUUID()
    let refreshes = 0
    let timer: ReturnType<typeof setTimeout>
    const ask = (): void => {
      void window.prism
        .browseSuggest(tabId, path, query, requestId)
        .then((result) => {
          if (!live) return
          // The list's own rule (useBrowseSearch): a folder the index has only
          // just been given settles within a second or two, so an indexed
          // answer is asked again twice, then left alone.
          if (result.source === 'everything' && !result.cancelled && refreshes < 2) {
            const wait = ++refreshes === 1 ? 500 : 1500
            timer = setTimeout(() => {
              requestId = crypto.randomUUID()
              ask()
            }, wait)
          }
          const all: Suggestion[] = [
            ...result.listing.folders.map((folder) => ({ path: folder.path, name: folder.name, isFolder: true })),
            ...result.listing.files.map((file) => ({ path: file.path, name: file.name, isFolder: false, file }))
          ]
          const ranked = rankSuggestions(all, query, path)
          const more = all.length > ranked.length || !!result.truncated || (result.window?.total ?? 0) > ranked.length
          // A second look that found the same rows keeps the same list, so a
          // row somebody has already walked to stays marked.
          setAnswer((previous) => {
            const same =
              previous?.key === key &&
              previous.hits.length === ranked.length &&
              previous.hits.every((hit, index) => hit.path === ranked[index].path)
            return { key, hits: same ? previous.hits : ranked.length ? ranked : NONE, more }
          })
        })
        .catch(() => {
          if (live) setAnswer({ key, hits: NONE, more: false })
        })
    }
    timer = setTimeout(ask, 120)
    return () => {
      live = false
      clearTimeout(timer)
      window.prism.browseSuggestCancel(tabId, requestId)
    }
  }, [key, tabId, path, query])
  const fresh = answer?.key === key
  return {
    hits: asked ? (answer?.hits ?? NONE) : NONE,
    running: asked && !fresh,
    more: asked && fresh && !!answer?.more
  }
}
