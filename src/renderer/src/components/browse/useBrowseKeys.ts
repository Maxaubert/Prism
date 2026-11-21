import { type KeyboardEvent, type MutableRefObject, type RefObject } from 'react'
import { goesToWindows } from '../../lib/unsupported'
import { explorerZoom, zoomIn, zoomOut } from '../../lib/explorerZoom'
import type { GridLayout } from '../../lib/gridLayout'
import type { divideRows } from '../../lib/dateGroups'
import { listKey, spaceKey, stepTo, type ListKey } from '../../lib/listKeys'
import { nearerEscape } from '../../lib/nearerEscape'
import { menuOrDialogUp } from '../../lib/pageDocuments'
import { gridKey, gridStep, type GridKey } from '../../lib/gridNav'
import type { BrowseEntry } from './types'
import type { BrowseListProps } from './listProps'

/** The common keys the list answers itself (#330). */
const LIST_OWN: ReadonlySet<ListKey> = new Set<ListKey>([
  'select-all',
  'clear',
  'extend-up',
  'extend-down',
  'extend-home',
  'extend-end',
  'focus-up',
  'focus-down',
  'focus-home',
  'focus-end',
  'toggle-mark'
])

export type KeysIn = {
  props: BrowseListProps
  scrollerRef: RefObject<HTMLDivElement | null>
  count: number
  layout: GridLayout | null
  cols: number
  rowHeight: number
  height: number
  scale: number
  lead: number
  logicalTop: number
  rowAt: (index: number) => BrowseEntry | null | undefined
  divided: ReturnType<typeof divideRows> | null
  selectedIndex: number
  cursor: string | null
  setCursor: (path: string | null) => void
  cursorIndex: number
  cursorDropped: MutableRefObject<boolean>
  indexOfPath: (path: string) => number
  scrollToRow: (node: HTMLDivElement, index: number) => void
  pendingFocus: MutableRefObject<number | null>
  selectionPosition: MutableRefObject<{ path: string; index: number }>
  typed: MutableRefObject<{ text: string; at: number }>
  zoomTo: RefObject<(next: number, pointerY: number | null, pointerX?: number) => void>
}

/** The list's key table: an ordered list of handlers, the first to claim wins. */
export function useBrowseKeys(a: KeysIn): {
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
} {
  const {
    props,
    scrollerRef,
    count,
    layout,
    cols,
    rowHeight,
    height,
    scale,
    lead,
    logicalTop,
    rowAt,
    divided,
    selectedIndex,
    cursor,
    setCursor,
    cursorIndex,
    cursorDropped,
    indexOfPath,
    scrollToRow,
    pendingFocus,
    selectionPosition,
    typed,
    zoomTo
  } = a
  /** Bring a row into view, stepping off a divider the way 	oward points. */
  const reveal = (index: number, toward: 1 | -1): { index: number; entry: BrowseEntry } | null => {
    const node = scrollerRef.current
    if (!node) return null
    while (index >= 0 && index < count && rowAt(index) === null) index += toward
    if (index < 0 || index >= count) return null
    scrollToRow(node, index)
    const entry = rowAt(index)
    if (!entry) return null
    requestAnimationFrame(() =>
      node
        .querySelector<HTMLElement>(`[data-browse-index="${index}"]`)
        ?.focus({ preventScroll: true })
    )
    return { index, entry }
  }
  const focusRow = (index: number): void => {
    const node = scrollerRef.current
    if (!node) return
    setCursor(null)
    const direction = index === 0 ? 1 : index < selectedIndex || index === count - 1 ? -1 : 1
    while (index >= 0 && index < count && rowAt(index) === null) index += direction
    if (index < 0 || index >= count) return
    // A group's first row going up brings its divider into view with it.
    scrollToRow(node, index)
    const entry = rowAt(index)
    if (entry) {
      pendingFocus.current = null
      props.onSelect(entry.path)
      requestAnimationFrame(() =>
        node
          .querySelector<HTMLElement>(`[data-browse-index="${index}"]`)
          ?.focus({ preventScroll: true })
      )
    } else {
      pendingFocus.current = index
      node.focus({ preventScroll: true })
      props.onSearchRange?.(Math.floor((node.scrollTop * scale) / rowHeight))
    }
  }
  /** The common keys that act on the list's own rows (#330); the rest of them
   *  (new folder, the bin, F3, Properties...) are FolderBrowser's. True when
   *  the key was taken. */
  const listOwnKey = (k: ListKey): boolean => {
    if (k === 'clear') return !!props.onClear?.()
    if (k === 'select-all') {
      if (!count || !props.onSelectAll) return false
      if (cursor !== null && cursor !== props.selectedPath) cursorDropped.current = true
      setCursor(null)
      props.onSelectAll()
      return true
    }
    // From the keyboard's place: the cursor while it is apart, else the row
    // the selection is on (or was on, when it has scrolled away).
    const here = cursor !== null ? indexOfPath(cursor) : -1
    const from = here >= 0 ? here : selectedIndex >= 0 ? selectedIndex : -1
    if (k === 'toggle-mark') {
      const path = here >= 0 ? cursor : props.selectedPath
      if (!path || !props.onToggleMark) return false
      props.onToggleMark(path)
      // The focus stays on the row whether it went in or out.
      setCursor(path)
      return true
    }
    const move = /^(extend|focus)-(up|down|home|end)$/.exec(k)
    if (!move) return false
    const to = stepTo(count, from, move[2] as 'up' | 'down' | 'home' | 'end')
    if (to === null) return true
    const toward: 1 | -1 = move[2] === 'up' || move[2] === 'end' ? -1 : 1
    const landed = reveal(to, toward)
    if (!landed) return true
    if (move[1] === 'focus') {
      setCursor(landed.entry.path)
      return true
    }
    // Shift: the marks run from the anchor to here, and here is the place.
    setCursor(null)
    props.onExtend?.(landed.entry.path)
    return true
  }
  /**
   * THE GRID'S ARROWS (Stage 5, spec 5.2): the keyboard's place moves in two
   * dimensions through `gridStep`, and the three modes are the list's own
   * (a pick, Shift's range from the anchor, Ctrl's focus without marks), so
   * the marks, the cursor and the reveal are the code the rows use.
   */
  const gridMove = (g: GridKey): void => {
    const here = cursor !== null ? indexOfPath(cursor) : -1
    const remembered =
      selectedIndex >= 0
        ? selectedIndex
        : selectionPosition.current.path === props.selectedPath
          ? selectionPosition.current.index
          : -1
    const pending = pendingFocus.current
    const from =
      pending !== null && Number.isFinite(pending) ? pending : here >= 0 ? here : remembered
    const to = gridStep(count, cols, from, g.to, Math.floor(height / rowHeight))
    if (to === null) return
    if (g.mode === 'move') {
      focusRow(to)
      return
    }
    const landed = reveal(to, g.to === 'up' || g.to === 'left' || g.to === 'end' ? -1 : 1)
    if (!landed) return
    if (g.mode === 'focus') {
      setCursor(landed.entry.path)
      return
    }
    // Shift: the marks run over the index range from the anchor to here.
    setCursor(null)
    props.onExtend?.(landed.entry.path)
  }
  // THE LIST'S KEYS: an ordered table, first handler to claim a key wins.
  // A handler returns true when it is done with the key (claimed or not) and
  // false to let the next one look. The order is the old handler's order.
  type ListKeyHandler = (e: KeyboardEvent<HTMLDivElement>) => boolean
  /** Whether the list or one of its rows (never a field inside it) has the keyboard. */
  const listOwnsKeyboard = (e: KeyboardEvent<HTMLDivElement>): boolean => {
    const at = e.target as HTMLElement
    return (
      at === e.currentTarget || (at.matches('.browse-row, .browse-tile') && !at.isContentEditable)
    )
  }
  // Ctrl+Plus, Ctrl+Minus and Ctrl+0 are the wheel's keys (nothing else in
  // the Explorer binds them; the app menu is gone). Only while the list or
  // one of its rows has the keyboard, never a field inside it.
  const zoomKeys: ListKeyHandler = (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return false
    const change =
      e.key === '+' || e.key === '='
        ? 1
        : e.key === '-' || e.key === '_'
          ? -1
          : e.key === '0'
            ? 0
            : null
    if (change === null || !listOwnsKeyboard(e)) return false
    e.preventDefault()
    e.stopPropagation()
    const step = explorerZoom()
    zoomTo.current(change === 0 ? 1 : change > 0 ? zoomIn(step) : zoomOut(step), null)
    return true
  }
  // THE GRID'S ARROWS come before the common keys: Left and Right are the
  // grid's alone (the list leaves them to the viewer), and the rest of the
  // arrows, Home, End and the Page keys move by line there. Never from a
  // field inside the list (the rename box).
  const gridKeys: ListKeyHandler = (e) => {
    if (!layout || !count) return false
    const g = gridKey(e, true)
    const at = e.target as HTMLElement
    if (!g || at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName)) return false
    e.preventDefault()
    e.stopPropagation()
    gridMove(g)
    return true
  }
  const commonKeys: ListKeyHandler = (e) => {
    const common = listKey(e)
    if (!common) return false
    // Escape is a nearer closer's first (a peek, the PDF's find bar, a
    // menu): those listen on the window, after this (review of #330).
    if (common === 'clear' && e.key === 'Escape' && nearerEscape()) return true
    // The preview window first (owner, 2026-11-08): Escape closes it and
    // leaves the marks; the next Escape clears them as before.
    if (common === 'clear' && e.key === 'Escape' && props.previewWindowOpen && !e.repeat) {
      const front = props.covered || menuOrDialogUp()
      if (!front) {
        e.preventDefault()
        e.stopPropagation()
        props.onPreviewWindowClose?.()
        return true
      }
    }
    if (LIST_OWN.has(common) && listOwnKey(common)) {
      // Claimed: the player's window-wide keys (Ctrl+Space is play, Shift+
      // Home a seek) yield to a key the list took.
      e.preventDefault()
      e.stopPropagation()
    }
    return true
  }
  // SPACE TOGGLES THE PREVIEW PANE (owner, 2026-11-08: "can you bind
  // preview to space bar", then "Toggle the preview panel"): the toolbar
  // button's own toggle, with or without a row picked, but only while the
  // list or one of its rows has the keyboard (never a field inside it).
  // A space inside a type-to-jump run is part of the name instead.
  const spaceKeys: ListKeyHandler = (e) => {
    const space = spaceKey(e, typed.current, performance.now())
    if (!space) return false
    if (!listOwnsKeyboard(e)) return true
    e.preventDefault()
    e.stopPropagation()
    // Something in front of the list (a menu opened with the mouse leaves
    // the focus on its row, a question, Settings): the key is taken but
    // nothing behind it changes.
    const front = props.covered || menuOrDialogUp()
    if (space === 'preview' && !front) props.onPreviewToggle?.()
    return space !== 'type'
  }
  const modifierKeys: ListKeyHandler = (e) => e.altKey || e.ctrlKey || e.metaKey
  const emptyListKeys: ListKeyHandler = (e) => {
    if (count) return false
    if (
      props.searchState?.running &&
      ['Home', 'End', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(e.key)
    ) {
      e.preventDefault()
      e.stopPropagation()
      pendingFocus.current = e.key === 'End' ? Infinity : 0
    }
    return true
  }
  /** The row the plain arrows start from. */
  const keyboardIndex = (): number => {
    const rememberedIndex =
      selectedIndex >= 0
        ? selectedIndex
        : selectionPosition.current.path === props.selectedPath
          ? selectionPosition.current.index
          : -1
    // The plain arrows carry on from a cursor the Ctrl keys moved (#330).
    return (
      pendingFocus.current ??
      (cursorIndex >= 0
        ? cursorIndex
        : rememberedIndex < 0
          ? Math.max(0, Math.floor((logicalTop - lead) / rowHeight)) * cols - 1
          : rememberedIndex)
    )
  }
  const moveKeys: ListKeyHandler = (e) => {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1) * cols
    let next: number
    if (e.key === 'ArrowDown') next = Math.min(count - 1, keyboardIndex() + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, keyboardIndex() - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else if (e.key === 'PageDown') next = Math.min(count - 1, Math.max(0, keyboardIndex()) + page)
    else if (e.key === 'PageUp') next = Math.max(0, keyboardIndex() - page)
    else return false
    e.preventDefault()
    e.stopPropagation()
    focusRow(next)
    return true
  }
  const enterKey: ListKeyHandler = (e) => {
    if (e.key !== 'Enter' || !props.selectedPath) return false
    e.preventDefault()
    e.stopPropagation()
    const entry =
      rowAt(selectedIndex) ?? props.entries.find((entry) => entry.path === props.selectedPath)
    // A HELD ENTER IS ONE OPEN (#494; review, 2026-11-09): the key repeating
    // handed the program to Windows thirty times a second, and an Enter
    // held from a question or the search box repeated onto this row.
    // `openGuards` e2e.
    if (entry && !(e.repeat && entry.file && goesToWindows(entry.file))) props.onActivate(entry)
    return true
  }
  const typeAheadKeys: ListKeyHandler = (e) => {
    if (e.key.length !== 1 || e.shiftKey) return true
    const now = performance.now()
    typed.current = {
      text:
        now - typed.current.at < 700
          ? typed.current.text + e.key.toLowerCase()
          : e.key.toLowerCase(),
      at: now
    }
    const match = props.entries.findIndex((entry) =>
      entry.name.toLowerCase().startsWith(typed.current.text)
    )
    if (match < 0) return true
    const matched = props.entries[match]
    const next = props.indexedRows
      ? ([...props.indexedRows].find(([, entry]) => entry?.path === matched.path)?.[0] ?? -1)
      : divided
        ? divided.rowOf(match)
        : match
    if (next < 0) return true
    e.preventDefault()
    e.stopPropagation()
    focusRow(next)
    return true
  }
  const LIST_KEY_HANDLERS: ListKeyHandler[] = [
    zoomKeys,
    gridKeys,
    commonKeys,
    spaceKeys,
    modifierKeys,
    emptyListKeys,
    moveKeys,
    enterKey,
    typeAheadKeys
  ]
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    for (const handle of LIST_KEY_HANDLERS) if (handle(e)) return
  }
  return { onKeyDown }
}
