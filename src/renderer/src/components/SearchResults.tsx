import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { SearchHit } from '@shared/types'
import type { TREE_SIZES } from '../lib/treePrefs'
import { iconColour, KindIcon } from './TreeRows'
import { clickSelect, emptySelection, sweepSelect, type Selection } from '../lib/selection'

// What the sidebar shows while its search box holds a query: a flat list of
// every match under the session root, subfolders included - files the tree
// never even loaded. Main does the walking (bounded); this just asks, waits a
// debounce, and draws rows the tree's shape.

export function SearchResults({
  root,
  query,
  refreshKey,
  currentPath,
  size,
  onOpen,
  onMenu,
  onMultiMenu
}: {
  /** The tab's root: what gets walked, and what main checks the search against. */
  root: string
  query: string
  /** Bumped after a rename/delete, so stale hits don't linger. */
  refreshKey: number
  currentPath: string | null
  size: (typeof TREE_SIZES)[number]
  onOpen: (path: string) => void
  /** Right-click on one hit: the ordinary file menu. */
  onMenu: (e: MouseEvent, path: string, name: string) => void
  /** Right-click inside a multi-selection: the menu that acts on all of it. */
  onMultiMenu: (e: MouseEvent, paths: string[]) => void
}): JSX.Element {
  // Keyed by query so a slow walk never draws under the wrong search.
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; truncated: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      void window.prism.searchTree(root, query).then((r) => {
        if (alive) setFound({ q: query, ...r })
      })
    }, 180)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [root, query, refreshKey])

  // Hits select exactly like tree rows (#70): click selects and opens, shift
  // ranges, ctrl toggles, dragging sweeps.
  const [sel, setSel] = useState<Selection>(emptySelection)
  const [selFor, setSelFor] = useState(query)
  if (selFor !== query) {
    setSelFor(query)
    setSel(emptySelection)
  }
  const sweep = useRef<{ from: string | null; live: boolean; consumed: boolean; base: ReadonlySet<string> }>({
    from: null,
    live: false,
    consumed: false,
    base: new Set()
  })
  const selRef = useRef(sel)
  useEffect(() => {
    selRef.current = sel
  }, [sel])
  useEffect(() => {
    const up = (): void => {
      sweep.current.from = null
      sweep.current.live = false
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  const ready = found?.q === query ? found : null
  const order = useMemo(() => (ready?.hits ?? []).map((h) => h.path), [ready])
  const onRowClick = useCallback(
    (e: MouseEvent, path: string): void => {
      if (sweep.current.consumed) {
        sweep.current.consumed = false
        return
      }
      setSel((s) => clickSelect(order, s, path, { shift: e.shiftKey, ctrl: e.ctrlKey }))
      if (!e.shiftKey && !e.ctrlKey) onOpen(path)
    },
    [order, onOpen]
  )
  const onSweepOver = useCallback(
    (path: string): void => {
      const s = sweep.current
      if (!s.from || (!s.live && path === s.from)) return
      s.live = true
      s.consumed = true
      setSel(sweepSelect(order, s.from, path, s.base))
    },
    [order]
  )
  /** Shared edges lose their rounding, so a run of hits reads as one block. */
  const join = (path: string): { top: boolean; bottom: boolean } => {
    if (!sel.items.has(path)) return { top: false, bottom: false }
    const i = order.indexOf(path)
    return {
      top: i > 0 && sel.items.has(order[i - 1]),
      bottom: i >= 0 && i < order.length - 1 && sel.items.has(order[i + 1])
    }
  }

  if (!ready)
    return <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">searching…</div>
  if (!ready.hits.length)
    return <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">nothing matches</div>

  return (
    <ul role="listbox" aria-label="Search results" className="list-none">
      {ready.hits.map((h) => {
        const on = !!currentPath && h.path.toLowerCase() === currentPath.toLowerCase()
        const picked = sel.items.has(h.path) || on
        const j = join(h.path)
        return (
          <li key={h.path} role="none">
            <button
              role="option"
              aria-selected={on}
              data-selected={picked || undefined}
              onClick={(e) => onRowClick(e, h.path)}
              onPointerDown={(e) => {
                if (e.button === 0)
                  sweep.current = { from: h.path, live: false, consumed: false, base: selRef.current.items }
              }}
              onPointerEnter={() => onSweepOver(h.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (sel.items.has(h.path) && sel.items.size > 1) onMultiMenu(e, [...sel.items])
                else {
                  setSel({ anchor: h.path, items: new Set([h.path]) })
                  onMenu(e, h.path, h.name)
                }
              }}
              className={`flex w-full items-center gap-1.5 rounded-md py-[3px] pl-2 pr-2 text-left outline-none focus-visible:outline-none ${
                picked
                  ? 'bg-[var(--p-sel-bg)] font-medium text-[var(--p-on-accent)]'
                  : 'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
              }`}
              style={{
                fontSize: size.font,
                borderTopLeftRadius: j.top ? 0 : undefined,
                borderTopRightRadius: j.top ? 0 : undefined,
                borderBottomLeftRadius: j.bottom ? 0 : undefined,
                borderBottomRightRadius: j.bottom ? 0 : undefined
              }}
            >
              <KindIcon kind={h.kind} color={picked ? 'var(--p-on-accent)' : iconColour(h.kind)} path={h.path} />
              <span className="min-w-0">
                <span className="block truncate">{h.name}</span>
                {h.dir && (
                  <span className={`block truncate text-[10.5px] ${picked ? 'text-[var(--p-on-accent)]/75' : 'text-[var(--p-dim2)]'}`}>
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
