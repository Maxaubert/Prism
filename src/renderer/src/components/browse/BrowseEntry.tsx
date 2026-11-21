import type {
  DragEvent as ReactDragEvent,
  JSX,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  RefObject
} from 'react'
import { browsableArchive, memberOf } from '@shared/archivePlace'
import { goesToWindows } from '../../lib/unsupported'
import { browseParent } from '../../lib/browse'
import { DRAG_MIME, setDrag } from '../../lib/drag/dragDrop'
import { noteReady } from '../../lib/drag/dragOut'
import type { atStep } from '../../lib/explorerZoom'
import type { divideRows } from '../../lib/dateGroups'
import type { Rect } from '../../lib/gridLayout'
import { BrowseRow, DividerRow, PendingRow } from './BrowseRow'
import { rowPicture, tilePicture, type EntryPictures } from './EntryMedia'
import { GridTile } from './GridTile'
import { RenameField } from '../RenameField'
import type { BrowseEntry } from './types'
import type { BrowseListProps } from './listProps'
import type { useFolderDrop } from './useFolderDrop'

/** Everything a row or a tile is built from: BrowseList's state, handed in. */
export type EntryView = {
  props: BrowseListProps
  folderDrop: ReturnType<typeof useFolderDrop>
  firstPress: MutableRefObject<string | null>
  setCursor: (path: string | null) => void
  scroller: RefObject<HTMLDivElement | null>
  cursor: string | null
  cut: ReadonlySet<string>
  isMarked: (path: string) => boolean
  look: ReturnType<typeof atStep>
  pictures: EntryPictures
  count: number
  searching: boolean
  divided: ReturnType<typeof divideRows> | null
  groupOf: string[] | null
}

/** What a press or drag on this row carries inside an archive: the row, or
 *  the whole selection when the row is in it, as members with their places. */
function memberCargo(
  props: BrowseListProps,
  path: string
): { archive: string; entries: string[]; places: string[] } | null {
  const archive = props.archive
  if (!archive) return null
  const all = props.marked
  const paths = all && all.size > 1 && all.has(path) ? [...all] : [path]
  const entries: string[] = []
  const places: string[] = []
  for (const p of paths) {
    const inner = memberOf(archive, p)
    if (!inner) continue
    entries.push(inner)
    places.push(p)
  }
  return entries.length ? { archive: archive.container, entries, places } : null
}
/** The inline rename field (#523) for the entry being renamed. */
export function renameField(v: EntryView, entry: BrowseEntry, where: 'row' | 'tile'): JSX.Element {
  const { props, scroller } = v
  // The keyboard goes back to the list, unless the field closed because the
  // hand went somewhere else (a click on a button, the address field).
  const back = (): void => {
    requestAnimationFrame(() => {
      const list = scroller.current
      const at = document.activeElement
      if (!list || (at && at !== document.body && !list.contains(at))) return
      const row = list.querySelector<HTMLElement>('[data-browse-path][tabindex="0"]')
      ;(row ?? list).focus({ preventScroll: true })
    })
  }
  return (
    <RenameField
      name={entry.name}
      className={`browse-rename-field ${where === 'tile' ? 'browse-rename-tile' : ''}`}
      onSubmit={(name) => {
        props.onRenameSubmit?.(name)
        back()
      }}
      onCancel={() => {
        props.onRenameCancel?.()
        back()
      }}
    />
  )
}

/**
 * WHAT A PRESS, A DRAG, A DROP, A DOUBLE CLICK AND A RIGHT-CLICK ON AN ENTRY
 * DO: one set for a row and a tile alike (Stage 4 pulled it out of the row,
 * unchanged), so the two can never disagree.
 */
export function entryHandlers(v: EntryView, entry: BrowseEntry, selected: boolean) {
  const { props, folderDrop, firstPress, setCursor } = v
  return {
    // Nothing is dragged out of the bin (D16): a bin path is not a place to
    // copy from, and a drop elsewhere would move `$R` and leave `$I`.
    draggable: !props.bin,
    // A FOLDER takes a drop into itself; an ARCHIVE row too
    // (#70 D6): a .zip adds what is dropped on it, a 7z or a
    // rar shows no-drop (Prism cannot write them). Any other
    // file row means the folder it is in.
    ...folderDrop(
      entry.isFolder || browsableArchive(entry.name)
        ? entry.path
        : (browseParent(entry.path) ?? props.directory),
      entry.path
    ),
    onMouseDown: (event: ReactMouseEvent) => {
      // THE PRESS ON A MEMBER EXTRACTS IT (#103, D5): a drag
      // out of the window needs real files before it starts,
      // so main unpacks the cargo now (64 MB and 64 members at
      // most), while the pointer travels to the edge.
      if (event.button !== 0 || !props.archive) return
      const cargo = memberCargo(props, entry.path)
      if (!cargo) return
      // Its answer is what lets the edge hand off (`isReady`).
      const req = { kind: 'members' as const, ...cargo }
      void window.prism
        .dragPrepare(req)
        .then((r) => noteReady(req, r.ok))
        .catch(() => noteReady(req, false))
    },
    onDragStart: (event: ReactDragEvent) => {
      // A row inside a multi-selection carries all of it,
      // the tree's rule.
      const all = props.marked
      const paths = all && all.size > 1 && all.has(entry.path) ? [...all] : [entry.path]
      // Rows inside an archive are its MEMBERS (#300): dropped on
      // a real folder they extract there, the archive view's own
      // drag; dropped inside the same zip they move.
      const cargo = memberCargo(props, entry.path)
      if (cargo) {
        setDrag({ kind: 'members', ...cargo })
        event.dataTransfer.effectAllowed = 'copyMove'
        event.dataTransfer.setData(DRAG_MIME, 'members')
        return
      }
      setDrag({ kind: 'files', paths })
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData(DRAG_MIME, 'files')
    },
    onDragEnd: () => setDrag(null),
    onClick: (e: ReactMouseEvent) => {
      if (e.detail === 1) firstPress.current = entry.path
      setCursor(null)
      if ((e.ctrlKey || e.shiftKey) && props.onPick)
        props.onPick(entry, { ctrl: e.ctrlKey, shift: e.shiftKey })
      else props.onSelect(entry.path)
    },
    // WHAT WAS PRESSED IS WHAT OPENS (#494; review, 2026-11-09). A new
    // file slides the rows between the two presses, and Chromium
    // counts a double-click by place and time, so the second one
    // lands on whatever is there now. A row that leaves for Windows
    // can start a program: only the row first pressed. `openGuards` e2e.
    onDoubleClick: () => {
      if (entry.file && goesToWindows(entry.file) && firstPress.current !== entry.path) return
      props.onActivate(entry)
    },
    onPointerEnter:
      entry.isFolder && props.onFolderHover ? () => props.onFolderHover?.(entry.path) : undefined,
    onPointerLeave:
      entry.isFolder && props.onFolderHover ? () => props.onFolderHover?.(null) : undefined,
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (props.onContextMenu) {
        e.preventDefault()
        // A RIGHT-CLICK SELECTS, as File Explorer's does
        // (#296; owner, 2026-10-06: "i see file explorer
        // uses the same highlight if you select a file with
        // left or rightclick. we should probably do the
        // same"). An unmarked row becomes THE selection, in
        // the one look a selection has; inside several marked
        // rows the marks stay and the menu acts on them all.
        // Quiet, as a Ctrl click is (#263): it marks, it does
        // not preview, play or open anything.
        if (!selected) props.onSelect(entry.path, true)
        props.onContextMenu(e, entry)
      }
    }
  }
}

/** One tile of the grid. */
export function entryTile(
  v: EntryView,
  entry: BrowseEntry,
  index: number,
  rect: Rect
): JSX.Element {
  const { props, cut, cursor, look, pictures, count } = v
  const key = entry.path.toLowerCase()
  const selected = v.isMarked(entry.path)
  return (
    <GridTile
      key={entry.path}
      name={entry.name}
      path={entry.path}
      index={index}
      rect={rect}
      media={tilePicture(entry, selected, look, pictures)}
      selected={selected}
      primary={entry.path === props.selectedPath}
      cursor={cursor === entry.path}
      cut={cut.has(key)}
      landing={props.landing?.has(key) ? (props.landing.get(key) ?? 0) : undefined}
      posInSet={index + 1}
      setSize={count}
      handlers={entryHandlers(v, entry, selected)}
      renameField={props.renamingPath === entry.path ? renameField(v, entry, 'tile') : undefined}
    />
  )
}

/** The rows of the list layer: dividers, blanks and entries. */
export function entryRows(
  v: EntryView,
  rendered: (BrowseEntry | null | undefined)[],
  firstItem: number
): JSX.Element[] {
  const { props, cut, cursor, look, pictures, count, divided, groupOf, searching } = v
  return rendered.map((entry, offset) => {
    const itemIndex = firstItem + offset
    const divider = divided?.divider(itemIndex)
    if (divider)
      return (
        <DividerRow key={`group-${divider.group}`} group={divider.group} label={divider.label} />
      )
    if (!entry) return <PendingRow key={`pending-${itemIndex}`} unavailable={entry === null} />
    const key = entry.path.toLowerCase()
    const primary = entry.path === props.selectedPath
    const selected = v.isMarked(entry.path)
    // A marked run is one block: its edge is drawn round the
    // run, never between two marked neighbours (browse.css).
    const above = rendered[offset - 1]
    const below = rendered[offset + 1]
    const renamingHere = props.renamingPath === entry.path
    return (
      <BrowseRow
        key={entry.path}
        entry={entry}
        itemIndex={itemIndex}
        posInSet={(divided ? (divided.entryAt(itemIndex) ?? 0) : itemIndex) + 1}
        setSize={divided ? props.entries.length : count}
        primary={primary}
        selected={selected}
        joinUp={selected && !!above && v.isMarked(above.path)}
        joinDown={selected && !!below && v.isMarked(below.path)}
        cursor={cursor === entry.path}
        cut={cut.has(key)}
        landing={props.landing?.has(key) ? props.landing.get(key) : undefined}
        description={
          [groupOf?.[divided?.entryAt(itemIndex) ?? -1], cut.has(key) ? 'Cut' : '']
            .filter(Boolean)
            .join(', ') || undefined
        }
        searching={searching}
        bin={!!props.bin}
        archive={!!props.archive}
        picture={rowPicture(entry, selected, look, pictures)}
        renameField={renamingHere ? renameField(v, entry, 'row') : null}
        handlers={entryHandlers(v, entry, selected)}
      />
    )
  })
}
