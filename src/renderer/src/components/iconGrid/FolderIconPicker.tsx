import { useDeferredValue, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { fuzzyFilter } from '../../lib/fuzzy'
import { loadFolderIconSet, useFolderIconSet } from '../../lib/folderIconSetLoad'
import { IconGrid } from './IconGrid'
import { enterPick } from './gridMath'
import { ICON_GRID_LABEL, ICON_SEARCH_LABEL, iconStatus } from './pickerText'

/**
 * THE FOLDER ICON PICKER'S BODY (folder icons, 2026-10-31): a search field
 * (focused on open), the grid, a status line. Typing goes to the field and
 * the grid follows through `useDeferredValue`, so a key never waits for it;
 * Down moves into the grid, Up from its first row comes back. One click, or
 * Enter on the field or a cell, picks (D8). The folder's icon now is marked
 * and is the active cell on open (the grid scrolls it into view).
 */
export function FolderIconPicker({
  current,
  onPick
}: {
  current?: string
  onPick: (name: string) => void
}): JSX.Element {
  const set = useFolderIconSet()
  useEffect(() => {
    void loadFolderIconSet().catch(() => {})
  }, [])
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const searching = !!deferred.trim()
  const icons = useMemo(
    () => (set ? fuzzyFilter(set.hay, deferred).map((i) => set.icons[i]) : []),
    [set, deferred]
  )
  // The active cell belongs to the list it was chosen in (the search popup's
  // way): a new list starts at its best hit, or, unsearched, at the folder's
  // icon now.
  const [mark, setMark] = useState<{ list: unknown; at: number }>({ list: null, at: -1 })
  const active =
    mark.list === icons
      ? mark.at
      : searching
        ? icons.length
          ? 0
          : -1
        : current
          ? icons.findIndex((i) => i.name === current)
          : -1
  const setActive = (at: number): void => setMark({ list: icons, at })
  const field = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  return (
    <div className="mt-3" data-folder-icon-picker>
      <input
        ref={field}
        className="folder-icon-search"
        type="search"
        aria-label={ICON_SEARCH_LABEL}
        placeholder="Search icons"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && icons.length) {
            e.preventDefault()
            if (active < 0) setActive(0)
            grid.current?.focus()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            // The deferred list may be a key behind; Enter picks the best
            // hit of what the field says now.
            if (!set) return
            const at = enterPick({ query, deferred, active, best: (q) => fuzzyFilter(set.hay, q)[0] })
            const pick = !at ? undefined : 'list' in at ? icons[at.list] : set.icons[at.set]
            if (pick) onPick(pick.name)
          }
        }}
      />
      <div className="mt-2">
        <IconGrid
          gridRef={grid}
          label={ICON_GRID_LABEL}
          icons={icons}
          active={active}
          current={current}
          onActive={setActive}
          onPick={onPick}
          onLeaveTop={() => field.current?.focus()}
        />
      </div>
      <p className="folder-icon-status" role="status" data-icon-status>
        {set ? iconStatus(set.icons.length, icons.length, searching) : 'Loading icons…'}
      </p>
    </div>
  )
}
