import { useCallback, useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react'
import type { SearchHit } from '@shared/types'
import type { TREE_SIZES } from '../lib/treePrefs'
import { FolderIcon, iconColour, KindIcon } from './TreeRows'
import { clickSelect, emptySelection, type Selection } from '../lib/selection'

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
  onRows,
  cursorPath,
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
  /** A file opens in the viewer; a FOLDER walks the tree there instead. */
  onOpen: (path: string, isFolder?: boolean) => void
  /** Right-click on one hit: the ordinary file menu. */
  onMenu: (e: MouseEvent, path: string, name: string, isFolder?: boolean) => void
  /** Lend the hits upward so the arrows can walk them, the same shape as the
   *  tree lends its own rows. Without this the keys fell through to App and
   *  paged the folder BEHIND the results panel. */
  onRows?: (rows: Array<{ path: string; name: string; isFolder: boolean }>) => void
  /** Which hit the cursor is on, for the roving tab stop. */
  cursorPath?: string | null
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
  // ranges, ctrl toggles.
  const [sel, setSel] = useState<Selection>(emptySelection)
  // A new query, or a folder rewritten under us, starts clean: stale hit
  // paths acted on later would touch files that are not there any more.
  const [selFor, setSelFor] = useState(`${query}\u0000${refreshKey}`)
  if (selFor !== `${query}\u0000${refreshKey}`) {
    setSelFor(`${query}\u0000${refreshKey}`)
    setSel(emptySelection)
  }

  const ready = found?.q === query ? found : null
  // Reported upward whenever the answer changes, so Sidebar's `step` has a
  // list to walk while the search panel is showing.
  useEffect(() => {
    onRows?.((ready?.hits ?? []).map((h) => ({ path: h.path, name: h.name, isFolder: !!h.isFolder })))
  }, [ready, onRows])
  const order = useMemo(() => (ready?.hits ?? []).map((h) => h.path), [ready])
  const onRowClick = useCallback(
    (e: MouseEvent, path: string, isFolder?: boolean): void => {
      setSel((s) => clickSelect(order, s, path, { shift: e.shiftKey, ctrl: e.ctrlKey }))
      if (!e.shiftKey && !e.ctrlKey) onOpen(path, isFolder)
    },
    [order, onOpen]
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
              data-row={h.path}
              tabIndex={cursorPath && h.path.toLowerCase() === cursorPath.toLowerCase() ? 0 : -1}
              aria-selected={on}
              data-selected={picked || undefined}
              onClick={(e) => onRowClick(e, h.path, h.isFolder)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (sel.items.has(h.path) && sel.items.size > 1) onMultiMenu(e, [...sel.items])
                else {
                  setSel({ anchor: h.path, items: new Set([h.path]) })
                  onMenu(e, h.path, h.name, h.isFolder)
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
              {h.isFolder ? (
                <FolderIcon color={picked ? 'var(--p-on-accent)' : iconColour('folder')} />
              ) : (
                <KindIcon kind={h.kind} color={picked ? 'var(--p-on-accent)' : iconColour(h.kind)} />
              )}
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
