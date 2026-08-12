import { useEffect, useState, type JSX } from 'react'
import type { SearchHit } from '@shared/types'
import type { TREE_SIZES } from '../lib/treePrefs'
import { iconColour, KindIcon } from './TreeRows'

// What the sidebar shows while its search box holds a query: a flat list of
// every match under the session root, subfolders included - files the tree
// never even loaded. Main does the walking (bounded); this just asks, waits a
// debounce, and draws rows the tree's shape.

export function SearchResults({
  query,
  refreshKey,
  currentPath,
  size,
  onOpen
}: {
  query: string
  /** Bumped after a rename/delete, so stale hits don't linger. */
  refreshKey: number
  currentPath: string | null
  size: (typeof TREE_SIZES)[number]
  onOpen: (path: string) => void
}): JSX.Element {
  // Keyed by query so a slow walk never draws under the wrong search.
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; truncated: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      void window.prism.searchTree(query).then((r) => {
        if (alive) setFound({ q: query, ...r })
      })
    }, 180)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, refreshKey])

  const ready = found?.q === query ? found : null

  if (!ready)
    return <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">searching…</div>
  if (!ready.hits.length)
    return <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">nothing matches</div>

  return (
    <ul role="listbox" aria-label="Search results" className="list-none">
      {ready.hits.map((h) => {
        const on = !!currentPath && h.path.toLowerCase() === currentPath.toLowerCase()
        return (
          <li key={h.path} role="none">
            <button
              role="option"
              aria-selected={on}
              onClick={() => onOpen(h.path)}
              className={`flex w-full items-center gap-1.5 rounded-md py-[3px] pl-2 pr-2 text-left outline-none transition-colors focus-visible:outline-none ${
                on
                  ? 'bg-[var(--p-sel-bg)] font-medium text-[var(--p-on-accent)]'
                  : 'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
              }`}
              style={{ fontSize: size.font }}
            >
              <KindIcon kind={h.kind} color={on ? 'var(--p-on-accent)' : iconColour(h.kind)} />
              <span className="min-w-0">
                <span className="block truncate">{h.name}</span>
                {h.dir && (
                  <span className={`block truncate text-[10.5px] ${on ? 'text-[var(--p-on-accent)]/75' : 'text-[var(--p-dim2)]'}`}>
                    {h.dir}
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
      {ready.truncated && (
        <li className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">
          more than {ready.hits.length} matches; keep typing
        </li>
      )}
    </ul>
  )
}
