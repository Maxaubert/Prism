import {
  useCallback,
  useState,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction
} from 'react'
import { parentDir, baseName } from '@shared/path'
import { memberOf } from '@shared/archivePlace'
import { setDrag, DRAG_MIME, dragPayload, droppedPaths, type DragPayload } from '../../lib/dragDrop'
import type { TreeState } from '../../lib/tabs'
import type { Selection } from '../../lib/selection'

// THE TREE'S DRAG AND DROP (out of Sidebar.tsx, structure cleanup 2026-10-12,
// unchanged): rows are cargo, folder rows are destinations, and what landed
// becomes the marked rows. App moves or extracts (onDropInto).

export interface TreeDropDeps {
  state: TreeState
  selRef: RefObject<Selection>
  scroller: RefObject<HTMLDivElement | null>
  root: string
  setDroppedOn: Dispatch<SetStateAction<string[] | null>>
  setSel: Dispatch<SetStateAction<Selection>>
  setCursor: Dispatch<SetStateAction<string | null>>
  onDropInto: (destDir: string, payload: DragPayload) => void
}

export interface TreeDrop {
  dropAt: (clientY: number) => { dir: string; row: string | null }
  hoverDrop: (dir: string | null, row?: string | null) => void
  onDropOn: (e: DragEvent, folderPath: string) => void
  dropDirAt: (clientY: number) => string
  onRowDragStart: (e: DragEvent, path: string) => void
  dropTarget: string | null
  dropRow: string | null
}

export function useTreeDrop({
  state,
  selRef,
  scroller,
  root,
  setDroppedOn,
  setSel,
  setCursor,
  onDropInto
}: TreeDropDeps): TreeDrop {
  /* Drag and drop (#70): rows are cargo, folder rows are destinations. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** The row under a drag, for the drop line (#126): a file row, or 'end'
   *  for the space beneath the list, which means the root. */
  const [dropRow, setDropRow] = useState<string | null>(null)
  const hoverDrop = useCallback((dir: string | null, row: string | null = null): void => {
    setDropTarget(dir)
    setDropRow(dir === null ? null : row)
  }, [])
  const treeChildren = state.children
  const onRowDragStart = useCallback(
    (e: DragEvent, path: string): void => {
      // Dragging a row that is part of a multi-selection takes all of it.
      const items = selRef.current.items
      const paths = items.has(path) && items.size > 1 ? [...items] : [path]
      // Rows INSIDE an archive are its members (review of #300): carried as
      // files they reached file:move as paths that are not on disk, and every
      // drop failed. As members, a real folder extracts them and the same zip
      // moves them, the Explorer's own drag.
      const meta = treeChildren[parentDir(path)]?.archive
      const entries = meta
        ? paths.map((p) => memberOf(meta, p)).filter((p): p is string => !!p)
        : []
      if (meta && entries.length) {
        setDrag({ kind: 'members', archive: meta.container, entries })
        e.dataTransfer.setData(DRAG_MIME, 'members')
        e.dataTransfer.effectAllowed = 'copyMove'
        return
      }
      setDrag({ kind: 'files', paths })
      e.dataTransfer.setData(DRAG_MIME, 'files')
      e.dataTransfer.effectAllowed = 'move'
    },
    [treeChildren, selRef]
  )
  /** The landing dir for a point in the panel: the row whose strip spans
   *  that height (rows annotate their own with data-dropdir), else the root. */
  const dropAt = (clientY: number): { dir: string; row: string | null } => {
    const rows = scroller.current?.querySelectorAll<HTMLElement>('[data-dropdir]')
    if (rows)
      for (const el of rows) {
        const r = el.getBoundingClientRect()
        if (clientY >= r.top && clientY < r.bottom)
          return { dir: el.dataset.dropdir ?? root, row: el.dataset.row ?? null }
      }
    // Beneath every row: the root, and the line goes under the last row.
    return { dir: root, row: 'end' }
  }
  const dropDirAt = (clientY: number): string => dropAt(clientY).dir

  const onDropOn = useCallback(
    (e: DragEvent, folderPath: string): void => {
      setDropTarget(null)
      setDropRow(null)
      const payload = dragPayload(e.dataTransfer)
      setDrag(null)
      // The DROPPED FILES become the marked rows (2026-09-03, owner -
      // Explorer's way; it narrows the 2026-08-31 folder-mark rule). What you
      // dragged has left where it was; where it ARRIVED is what you are now
      // looking at. Best effort on the names: a keep-both rename lands under
      // another name and simply goes unmarked.
      const mark = (paths: string[]): void => {
        const to = paths.length ? paths.map((q) => folderPath + '\\' + baseName(q)) : [folderPath]
        setDroppedOn(to)
        setSel({ anchor: to[0], items: new Set(to) })
        setCursor(to[0])
      }
      if (payload) {
        mark(payload.kind === 'files' ? payload.paths : [])
        onDropInto(folderPath, payload)
      } else {
        // Nothing of ours: Explorer, then. Its files are outside the root, so
        // main will refuse them - App says so rather than failing silently.
        const outside = droppedPaths(e.dataTransfer)
        if (outside.length) {
          mark(outside)
          // `external`: dropped on a zip node these are ADDED and left where
          // they are (review of #300); without it the archive drop took them
          // for Prism's own rows and sent the originals to the Recycle Bin.
          onDropInto(folderPath, { kind: 'files', paths: outside, external: true })
        }
      }
    },
    [onDropInto, setCursor, setDroppedOn, setSel]
  )
  return { dropAt, hoverDrop, onDropOn, dropDirAt, onRowDragStart, dropTarget, dropRow }
}
