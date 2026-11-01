import { memo, useEffect, useId, type JSX, type KeyboardEvent, type RefObject } from 'react'
import { BuiltInIcon } from '../icons/FolderGlyph'
import type { FolderIconDef } from '../../lib/folderIconSetLoad'
import { drawnCell, moveIndex } from './gridMath'
import { useVirtualGrid } from './useVirtualGrid'
import './icon-grid.css'

/** A cell's side in px (40 at Medium, the spec's size). */
export const ICON_CELL = 40

/** One cell: a button with one svg. No state of its own, so a scroll that
 *  brings it back costs one element. */
const Cell = memo(function Cell({
  id,
  icon,
  active,
  current,
  onPick
}: {
  id: string
  icon: FolderIconDef
  active: boolean
  current: boolean
  onPick: (name: string) => void
}): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      data-icon-name={icon.name}
      data-current={current ? '' : undefined}
      data-active={active ? '' : undefined}
      title={icon.name}
      className="icon-grid-cell"
      // The listbox keeps the focus; a press must not take it to the cell.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(icon.name)}
    >
      <BuiltInIcon icon={icon} size={20} />
    </button>
  )
})

/**
 * THE FOLDER ICON PICKER'S GRID (2026-10-31): `role="listbox"` with one tab
 * stop and `aria-activedescendant`, windowed by `useVirtualGrid` (fixed cells,
 * rows placed by transform, `contain: strict`), so the DOM holds about ten rows
 * of cells whether there are 14 icons or 2,024.
 */
export function IconGrid({
  icons,
  active,
  current,
  onActive,
  onPick,
  onLeaveTop,
  gridRef,
  label
}: {
  icons: readonly FolderIconDef[]
  /** The active cell's index, -1 for none. */
  active: number
  /** The folder's icon now, marked. */
  current?: string
  onActive: (index: number) => void
  onPick: (name: string) => void
  /** Up from the first row: back to the search field. */
  onLeaveTop?: () => void
  /** The scroller (the picker focuses it from the search field). */
  gridRef: RefObject<HTMLDivElement | null>
  label: string
}): JSX.Element {
  const base = useId()
  const grid = useVirtualGrid(gridRef, icons.length, ICON_CELL)
  const { reveal } = grid
  useEffect(() => {
    if (active >= 0) reveal(active)
  }, [active, reveal])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.key === 'Enter' || e.key === ' ') && active >= 0 && icons[active]) {
      e.preventDefault()
      onPick(icons[active].name)
      return
    }
    if (e.key === 'ArrowUp' && active < grid.columns && onLeaveTop) {
      e.preventDefault()
      onLeaveTop()
      return
    }
    const next = moveIndex(active, e.key, grid.columns, icons.length, grid.pageRows, e.ctrlKey)
    if (next === undefined) return
    e.preventDefault()
    onActive(next)
  }

  const rows: JSX.Element[] = []
  for (let r = grid.first; r < grid.end; r += 1) {
    const cells: JSX.Element[] = []
    for (let c = 0; c < grid.columns; c += 1) {
      const i = r * grid.columns + c
      const icon = icons[i]
      if (!icon) break
      cells.push(
        <Cell
          key={icon.name}
          id={`${base}-${i}`}
          icon={icon}
          active={i === active}
          current={icon.name === current}
          onPick={onPick}
        />
      )
    }
    rows.push(
      <div key={r} className="icon-grid-row" style={{ transform: `translateY(${r * ICON_CELL}px)` }}>
        {cells}
      </div>
    )
  }

  return (
    <div
      ref={gridRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      // Only a drawn cell: a wheel scroll can take the active one out of
      // the DOM, and an id that is not there points a reader at nothing.
      aria-activedescendant={
        drawnCell(active, grid.columns, grid.first, grid.end, icons.length) ? `${base}-${active}` : undefined
      }
      className="icon-grid"
      data-icon-grid
      onKeyDown={onKeyDown}
    >
      <div className="icon-grid-space" style={{ height: grid.rows * ICON_CELL }}>
        {rows}
      </div>
    </div>
  )
}
