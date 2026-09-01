import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import type { OpenWithApp, ViewerFile } from '@shared/types'
import type { TreeState } from '../lib/tabs'
import { fileKind } from '@shared/fileKind'
import { lastSplitDir, type SplitDir } from '../lib/panes'
import { ancestorChain, parentDir, stepRow, toggleExpanded, visibleRows } from '../lib/fileTree'
import { sortFiles, useSort } from '../lib/sortPrefs'
import { useAutoScroll, useTreeSide, useTreeSize } from '../lib/treePrefs'
import { ContextMenu } from './ContextMenu'
import { Dialog } from './Dialog'
import { PropertiesDialog } from './PropertiesDialog'
import { Rows } from './TreeRows'
import { SearchResults } from './SearchResults'
import { SortMenu } from './SortMenu'
import { formatBytes } from '../lib/format'
import { TreeProvider } from '../lib/treeContext'
import { clickSelect, emptySelection, type Selection } from '../lib/selection'
import { DRAG_MIME, dragPayload, droppedPaths, setDrag, type DragPayload } from '../lib/dragDrop'

// The folder tree, rooted at the folder Prism was opened in. Children load the
// first time a folder is opened and are cached after that; main refuses anything
// outside the root, so there is no way up and no ".." row.

// Panel width: dragged from the edge, remembered, and bounded so it can't be
// squeezed into uselessness or grow to swallow the media.
const WIDTH_KEY = 'prism.sidebar.width'
const MIN_W = 170
const MAX_W = 520
const DEFAULT_W = 260

/** How many folders the gap-filler asks for at once. */
const LOAD_AT_ONCE = 6

const clampWidth = (n: number): number => Math.round(Math.min(MAX_W, Math.max(MIN_W, n)))

function loadWidth(): number {
  const v = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(v) && v > 0 ? clampWidth(v) : DEFAULT_W
}

/**
 * Bring the open file into view inside the tree, keeping a few rows of context
 * around it.
 *
 * Two behaviours, which is what makes it feel like following rather than
 * snapping: a row that is somewhere on screen is only nudged, and only once it
 * comes within `margin` of an edge - so paging through a folder from the top
 * doesn't move the tree at all until the selection nears the bottom. A row that
 * is off screen entirely (the sidebar was just opened on a file deep in a big
 * folder) is placed near the top, with those few rows above it rather than
 * pinned to the edge.
 */
function revealRow(box: HTMLElement, row: HTMLElement, smooth: boolean): void {
  const height = box.clientHeight
  if (!height) return
  const boxRect = box.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const top = rowRect.top - boxRect.top + box.scrollTop
  const bottom = top + rowRect.height
  // Three rows of context, but never so much that it swallows a short panel.
  const margin = Math.min(Math.max(rowRect.height * 3, 40), height * 0.35)
  const viewTop = box.scrollTop
  const viewBottom = viewTop + height

  let next: number
  if (bottom <= viewTop || top >= viewBottom) next = top - margin
  else if (top < viewTop + margin) next = top - margin
  else if (bottom > viewBottom - margin) next = bottom - height + margin
  else return

  next = Math.max(0, Math.min(next, box.scrollHeight - height))
  if (Math.abs(next - viewTop) < 1) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  box.scrollTo({ top: next, behavior: smooth && !still ? 'smooth' : 'auto' })
}

interface Menu {
  x: number
  y: number
  path: string
  name: string
  isFolder: boolean
  /** Bytes on disk, for the Properties row's hint. Folders carry none. */
  size?: number
  /** "Open in" candidates: undefined for folders, null while they load. */
  apps?: OpenWithApp[] | null
  /** Set when the right-click landed inside a multi-selection: every selected
   *  path, and the menu acts on all of them. */
  multi?: string[]
}

/** Menu glyphs: outlined, so they read as actions rather than as file kinds. */
const MenuIcon = ({ d }: { d: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={13}
    height={13}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="opacity-80"
    aria-hidden
  >
    <path d={d} />
  </svg>
)

/** What the search box can do, taught where you look for it: a placeholder
 *  cannot hold five lines and a help panel in a viewer's sidebar would be
 *  chrome nobody asked for (2026-08-28). */
const SEARCH_HELP = [
  'Every word, in any order. Also:',
  '*.mp4 or img_??.jpg   a pattern',
  'ext:mp4   the extension',
  '"two words"   the phrase',
  '-raw   leave these out'
].join('\n')

export function Sidebar({
  open,
  root,
  tabId,
  currentPath,
  dirtyPaths,
  refreshKey,
  onOpenFile,
  onRename,
  onDelete,
  onDeleteMany,
  onDropInto,
  onDuplicated,
  onNav,
  wash,
  onOpenFolder,
  onToggleTerm,
  termOpen,
  onPinSplit,
  onUnpinSplit,
  pinnedPaths,
  onOpenNewTab,
  onTermNewTab,
  onTermHere,
  onTermSplit,
  onClearTerm,
  state,
  onTree
}: {
  open: boolean
  root: string
  /** Which tab this sidebar is serving; the search query is kept per tab. */
  tabId: string
  currentPath: string | null
  /** Every file holding unsaved text, keyed lowercase. Any of them can be
   *  marked, not just the open one: leaving a file no longer discards it. */
  dirtyPaths: ReadonlySet<string>
  /** Bumped by App after a rename or delete, to re-read the folders on screen. */
  refreshKey: number
  onOpenFile: (path: string) => void
  onRename: (path: string, name: string) => void
  onDelete: (path: string, name: string, isFolder: boolean) => void
  /** A multi-selection's delete: one question, then every path to the bin. */
  onDeleteMany: (paths: string[]) => void
  /** Something was dropped on a folder row: files to move in, or archive
   *  members to extract there. App owns the questions either can raise. */
  onDropInto: (destDir: string, payload: DragPayload) => void
  /** A copy was just made: App remembers the source AND the copy, so Ctrl+Z
   *  can take it away and Ctrl+Y can ask for another one. */
  onDuplicated: (source: string, copyPath: string) => void
  /** Lends App the tree's arrow keys. The callback returns false when the tree
   *  has nothing to say, and App pages the folder itself instead. */
  onNav: (step: ((dir: 'up' | 'down' | 'left' | 'right') => boolean) | null) => void
  /** Whether the style's light reaches the panel. Follows the window. */
  wash: boolean
  /** Point this tab at a different folder. Beside the search box rather than
   *  with sort and filter: those narrow what you are looking at, this changes
   *  it, and they do not belong in one cluster. */
  onOpenFolder: () => void
  /** Toggle this tab's terminal (full view). Lives in the footer row. */
  onToggleTerm: () => void
  termOpen: boolean
  /** Pin a file as a split pane; no direction means the remembered one. */
  onPinSplit: (path: string, dir?: SplitDir) => void
  onUnpinSplit: (path: string) => void
  /** Paths currently pinned: their menu offers the way OUT. */
  pinnedPaths: readonly string[]
  /** A fresh tab rooted at the file's folder. */
  onOpenNewTab: (path: string) => void
  /** The terminal button menu's "Open in new tab". */
  onTermNewTab: () => void
  /** A folder row's "Open terminal here": a shell spawned in that folder. */
  onTermHere: (folder: string) => void
  /** The terminal button's own right-click menu. */
  onTermSplit: () => void
  /** Null while no shell exists: there is nothing to clear yet. */
  onClearTerm: (() => void) | null
  /** The tree's expanded folders and loaded children. Owned by the tab. */
  state: TreeState
  onTree: (update: (s: TreeState) => TreeState) => void
}): JSX.Element {
  // The tree's state belongs to the TAB, not to this component. Owned here it
  // reset on every tab switch, which made a tab feel like a reload rather than
  // a place you left, so App holds it and hands it down.
  //
  // Updates go up as functions, never as values: this component no longer holds
  // the current state, so only the owner can apply one. That is also what keeps
  // this handle stable, which the loading effect below depends on.
  const setState = onTree
  const [revealed, setRevealed] = useState<string | null>(null)
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  // The search box. A query swaps the tree for a flat result list; clearing it
  // brings the tree back exactly as it was (its state never unmounts).
  /**
   * PER TAB (2026-09-01). One Sidebar instance serves every tab, so a single
   * `query` state meant that typing a search in one tab and switching to
   * another left the second one showing results for a search nobody had made
   * there - and clearing it in one tab cleared it in all of them. A search is
   * about the tree you are looking at, so it belongs to the tab.
   *
   * Kept as a map in state rather than a ref swapped while rendering: `query`
   * is then simply derived, and this file's own rule that a ref may not be
   * written during a render still holds.
   */
  const [queries, setQueries] = useState<Record<string, string>>({})
  const query = queries[tabId] ?? ''
  const setQuery = useCallback(
    (v: string) => setQueries((m) => ({ ...m, [tabId]: v })),
    [tabId]
  )
  /** The hits the search panel is showing, lent upward so the arrows can walk
   *  them. Empty while the tree is showing. */
  const [hitRows, setHitRows] = useState<Array<{ path: string; name: string; isFolder: boolean }>>(
    []
  )
  const [props, setProps] = useState<Omit<Menu, 'x' | 'y' | 'apps'> | null>(null)
  // The terminal button's right-click menu: its own tiny state, since the file
  // menu carries a path and this one is about the tab's shell.
  const [termMenu, setTermMenu] = useState<{ x: number; y: number } | null>(null)
  const panel = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // The file the tree has already been positioned for. Scrolling away by hand
  // doesn't clear it, so collapsing and reopening leaves the tree where you put
  // it; only a new file asks to be found again.
  const placed = useRef<string | null>(null)
  const size = useTreeSize()
  const sort = useSort()
  const autoScroll = useAutoScroll()
  // On the right, everything that faces the media flips: the edge it draws, the
  // handle you grab, and which way dragging makes it wider.
  const side = useTreeSide()
  const right = side === 'right'

  /* ---------- loading ---------- */

  /* The selection (2026-08-22): a click opens as it always did; shift ranges
     and ctrl toggles build a selection without opening. */
  const [sel, setSel] = useState<Selection>(emptySelection)
  /** The tree's DEAD SPACE menu: verbs on the PLACE rather than on a row
   *  (2026-08-31). The archive panel has had one since 2026-08-30, and a
   *  right-click that missed every row here simply read as a miss. */
  const [placeMenu, setPlaceMenu] = useState<{ x: number; y: number } | null>(null)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  /** A folder something was just dropped INTO. State and not a ref, because
   *  the reset below reads it while RENDERING, which a ref may not be. */
  const [droppedOn, setDroppedOn] = useState<string | null>(null)
  // A new place - or anything that rewrote the folder (a delete, a rename, a
  // move) - starts clean: the old paths may not exist any more, and acting on
  // them later took files the user could no longer see.
  const [selFor, setSelFor] = useState(`${root}\u0000${refreshKey}`)
  if (selFor !== `${root}\u0000${refreshKey}`) {
    setSelFor(`${root}\u0000${refreshKey}`)
    // The one exception is the folder a drop just landed in: it still
    // exists, it is what you are now looking at, and the refresh being
    // cleared up after is the move's own.
    setSel(droppedOn ? { anchor: droppedOn, items: new Set([droppedOn]) } : emptySelection)
    // Consumed once: left set it would restore that folder's mark on the NEXT
    // refresh too, after a rename or a delete with nothing to do with it.
    if (droppedOn) setDroppedOn(null)
  }
  // What a drag carries when the dragged row is part of a selection.
  // Mirrored via effect (refs must not be written during render).
  const selRef = useRef(sel)
  useEffect(() => {
    selRef.current = sel
  }, [sel])

  /**
   * A press anywhere that is not a tree ROW drops the marks (2026-08-25).
   *
   * Highlighting says "these are what I am about to act on", so it should not
   * outlive walking away from them: click the empty space under the tree, or
   * anything in the viewer, and the selection goes. What stays marked is the
   * OPEN file, because that is the one you are actually looking at, and it is
   * marked for being open rather than for being selected.
   *
   * Exempt: a menu or dialog, which IS the act on the selection, and the
   * rename input, which is editing the row it belongs to.
   */
  /** Was the last press inside the tree? Ctrl+A belongs to the surface you are
   *  in, and the archive panel keeps one of these too. */
  const hasFocus = useRef(false)
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (!el) return
      hasFocus.current = !!panel.current?.contains(el)
      if (el.closest('[data-row],[role="menu"],[role="dialog"],[data-owns-escape],input,textarea'))
        return
      setSel((s) => (s.items.size ? emptySelection : s))
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [])

  /** Fetches in flight, so the same folder is never asked for twice at once.
   *  Without it the gap-filling effect below re-issues every outstanding load
   *  each time one of them lands, which is O(n^2) requests on a big tree. */
  const loading = useRef(new Set<string>())

  /** Load a folder's children once, then keep them. A refusal (outside the root)
   *  is cached as unreadable so the row says so instead of spinning forever. */
  const load = useCallback(
    async (p: string, force = false): Promise<void> => {
      if (!force && loading.current.has(p)) return
      loading.current.add(p)
      try {
        await loadNow(p, force)
      } finally {
        loading.current.delete(p)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, setState]
  )

  const loadNow = useCallback(
    async (p: string, force = false): Promise<void> => {
      const listing = (await window.prism.listDir(root, p)) ?? {
        folders: [],
        files: [],
        unreadable: true
      }
      setState((s) =>
        s.children[p] && !force ? s : { ...s, children: { ...s.children, [p]: listing } }
      )
    },
    [root, setState]
  )

  const toggle = useCallback(
    (p: string) => {
      setState((s) => {
        const expanded = toggleExpanded(s.expanded, p)
        // Collapsing hides rows: anything selected under this folder would
        // stay selected and invisible, and the next Delete would take it.
        if (!expanded.has(p)) {
          const under = p.toLowerCase() + '\\'
          setSel((sel) => {
            const kept = [...sel.items].filter((x) => !x.toLowerCase().startsWith(under))
            if (kept.length === sel.items.size) return sel
            return {
              anchor: sel.anchor && kept.includes(sel.anchor) ? sel.anchor : p,
              items: new Set(kept)
            }
          })
        }
        return { ...s, expanded }
      })
      void load(p)
    },
    [load, setState]
  )

  /**
   * A folder hit in the search results (2026-08-30).
   *
   * Folders match the query now, and a folder is not something to open in a
   * viewer: clicking one leaves the search, walks the tree to it and expands
   * it, which is where you were trying to get. Reuses the reveal chain rather
   * than writing a second expander.
   */
  const revealFolder = useCallback(
    (p: string): void => {
      setQuery('')
      setState((s) => {
        const expanded = new Set(s.expanded)
        ancestorChain(root, p).forEach((a) => expanded.add(a))
        expanded.add(p)
        return { ...s, expanded }
      })
      void load(p)
    },
    [load, root, setState]
  )

  // Reveal: when the open file changes, expand every folder between the root and
  // it. Adjusting state during render (rather than in an effect) keeps a folder
  // the user collapsed collapsed until the file actually moves.
  if (currentPath !== revealed) {
    setRevealed(currentPath)
    const chain = currentPath ? ancestorChain(root, currentPath) : [root]
    if (chain.length) {
      setState((s) => {
        const expanded = new Set(s.expanded)
        chain.forEach((p) => expanded.add(p))
        return { ...s, expanded }
      })
    }
  }

  // Fetch what the reveal just opened (the root included, on first paint).
  useEffect(() => {
    const chain = currentPath ? ancestorChain(root, currentPath) : []
    ;[root, ...chain].forEach((p) => void load(p))
  }, [root, currentPath, load])

  /**
   * Fill in anything EXPANDED but not loaded (2026-08-31).
   *
   * Only a toggle ever fetched a folder's children, which was fine while the
   * only open folders were ones you had just clicked. A RESTORED tree arrives
   * with its folders already open and nothing in them, so every one of those
   * rows sat on "loading..." forever and had to be collapsed and reopened by
   * hand.
   *
   * Bounded, and that is not a nicety: a tree restored 400 folders deep would
   * otherwise fire 400 listDir calls at once into the same libuv pool the
   * fsmedia:// Range handler reads a playing film through, which is the
   * failure the performance rules already name.
   */
  useEffect(() => {
    const missing = [...state.expanded].filter((p) => !state.children[p] && !loading.current.has(p))
    if (!missing.length) return
    void (async () => {
      for (let i = 0; i < missing.length; i += LOAD_AT_ONCE) {
        await Promise.all(missing.slice(i, i + LOAD_AT_ONCE).map((p) => load(p)))
      }
    })()
  }, [state.expanded, state.children, load])

  // Follow the open file. While the panel is shut nothing moves, so the scroll
  // it wakes up with is the one it went to sleep with; the reveal then happens
  // on the way open, for a file it hasn't been positioned for yet.
  useEffect(() => {
    if (!autoScroll || !open || !currentPath) return
    if (placed.current === currentPath) return
    const box = scroller.current
    if (!box) return
    // The row may not exist yet: its folder can still be loading.
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      const row = box.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')
      if (!row) {
        if (tries++ < 40) frame = requestAnimationFrame(attempt)
        return
      }
      const first = placed.current === null
      placed.current = currentPath
      revealRow(box, row, !first)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [autoScroll, open, currentPath, state.children])

  // A file changed on disk: re-read every folder we're showing, so the row that
  // was renamed or removed matches reality.
  useEffect(() => {
    if (!refreshKey) return
    Object.keys(state.children).forEach((p) => void load(p, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the bump alone; re-running per cache change would loop
  }, [refreshKey])

  /* ---------- resizing ---------- */

  const resize = useCallback((next: number) => {
    const w = clampWidth(next)
    setWidth(w)
    localStorage.setItem(WIDTH_KEY, String(w))
  }, [])

  const onHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }, [])

  const onHandleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !panel.current) return
      const box = panel.current.getBoundingClientRect()
      resize(right ? box.right - e.clientX : e.clientX - box.left)
    },
    [dragging, resize, right]
  )

  const onHandleUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

  const onHandleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const wider = right ? 'ArrowLeft' : 'ArrowRight'
      if (e.key === wider) resize(width + 16)
      else if (e.key === (right ? 'ArrowRight' : 'ArrowLeft')) resize(width - 16)
      else return
      e.preventDefault()
    },
    [resize, width, right]
  )

  /* ---------- row actions ---------- */

  const onMenu = useCallback(
    (
      e: MouseEvent,
      path: string,
      name: string,
      isFolder: boolean,
      size?: number,
      fromSearch = false
    ) => {
      e.preventDefault()
      // Right-clicking INSIDE a multi-selection acts on all of it. OUTSIDE it,
      // the row is only the menu's TARGET and is marked in grey by `menuPath`
      // (TreeRows' `onMenuHl`) - it does not become the accent selection.
      // The accent means "these are what I am about to act on", and the menu
      // already acts on the row it was opened over, so selecting it as well
      // says the same thing twice in the louder of the two ways.
      //
      // Existing marks are DROPPED for that same reason: right-clicking row A
      // while B and C are marked leaves the verb going to A, and marks that
      // claim otherwise are lying about what is about to happen. Same rule as
      // a press on dead space.
      //
      // A SEARCH hit never inherits the tree's selection: those are different
      // lists, and the menu would have acted on rows the user could not see.
      const multi =
        !fromSearch && sel.items.has(path) && sel.items.size > 1 ? [...sel.items] : undefined
      if (!multi && !fromSearch && sel.items.size) setSel(emptySelection)
      setMenu({
        x: e.clientX,
        y: e.clientY,
        path,
        name,
        isFolder,
        size,
        multi,
        apps: isFolder ? undefined : null
      })
      // The app list arrives while the menu is up; ignore it if the menu has
      // meanwhile moved to another row (or closed).
      if (!isFolder && !multi) {
        void window.prism.appsFor(path).then((apps) => {
          setMenu((m) => (m && m.path === path ? { ...m, apps } : m))
        })
      }
    },
    [sel]
  )

  const submitRename = useCallback(
    (path: string, name: string) => {
      setEditing(null)
      onRename(path, name)
    },
    [onRename]
  )

  /* ---------- the keyboard cursor ---------- */

  // Which row the arrows are on. Normally that is the open file, but it parts
  // company with it the moment the cursor steps onto a folder: a folder isn't
  // something to view, so landing there must not disturb what's on screen.
  const [cursor, setCursor] = useState<string | null>(null)
  const at = cursor ?? currentPath

  // Reset to the open file whenever the viewer moves on its own (a click, a
  // drop, autoplay), so the cursor never trails a file the user has left.
  const [cursorFor, setCursorFor] = useState<string | null>(null)
  if (currentPath !== cursorFor) {
    setCursorFor(currentPath)
    setCursor(currentPath)
    // The selection follows the viewer too: what is on screen is the one
    // selected row, until the user builds a bigger selection by hand.
    setSel(currentPath ? { anchor: currentPath, items: new Set([currentPath]) } : emptySelection)
  }

  const rows = useMemo(
    () =>
      visibleRows(root, state.expanded, state.children, {
        orderFiles: (files) => sortFiles(files as ViewerFile[], sort.field, sort.dir),
        foldersReversed: sort.field === 'name' && sort.dir === 'desc'
      }),
    [root, state.expanded, state.children, sort]
  )

  /** The flattened visible rows, top to bottom: the order shift-ranges and
   *  shift-ranges count through. */
  const order = useMemo(() => rows.map((r) => r.path), [rows])

  /**
   * Ctrl+A marks every row the tree is SHOWING - what is expanded, folders
   * included - rather than everything under the root, which would mark files
   * you cannot see and the next Delete would take.
   *
   * Only while the tree is the surface you last touched (the archive panel
   * has the same rule for its own rows), and never while something is being
   * typed into: the search box, a rename, the editor and the shell keep it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || (e.key !== 'a' && e.key !== 'A')) return
      if (!hasFocus.current || !order.length) return
      const el = e.target as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      if (el?.closest('.xterm')) return
      e.preventDefault()
      setSel({ anchor: order[0], items: new Set(order) })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [order])
  const onRowClick = useCallback(
    (e: MouseEvent, path: string, isFolder: boolean): void => {
      // Was this row ALREADY the whole selection before this click? Read
      // before the click changes it, since that is what a second click means.
      const wasOnlySelection = sel.items.size === 1 && sel.items.has(path)
      setSel((s) => clickSelect(order, s, path, { shift: e.shiftKey, ctrl: e.ctrlKey }))
      setCursor(path)
      // A FILE keeps the tree's quick-look reflex: one click opens it, which
      // is what the sidebar is for. A FOLDER selects first and expands on the
      // second click (owner decision, 2026-08-31) - it is a destination for
      // drops, a rename target and the thing "Open terminal here" acts on, so
      // being able to point at one without walking into it is worth a click.
      // This narrows the 2026-08-22 rule rather than reversing it: single
      // click still opens FILES, and double-click still opens nothing.
      //
      // Shift and ctrl select WITHOUT opening or expanding either way - that
      // is what makes select-then-right-click and multi-select work.
      if (!e.shiftKey && !e.ctrlKey) {
        if (!isFolder) onOpenFile(path)
        else if (wasOnlySelection) toggle(path)
      }
    },
    [order, toggle, onOpenFile, sel]
  )
  const selJoin = useCallback(
    (path: string): { top: boolean; bottom: boolean } => {
      if (!sel.items.has(path)) return { top: false, bottom: false }
      const i = order.indexOf(path)
      return {
        top: i > 0 && sel.items.has(order[i - 1]),
        bottom: i >= 0 && i < order.length - 1 && sel.items.has(order[i + 1])
      }
    },
    [order, sel]
  )

  /* Drag and drop (#70): rows are cargo, folder rows are destinations. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const onRowDragStart = useCallback((e: DragEvent, path: string): void => {
    // Dragging a row that is part of a multi-selection takes all of it.
    const items = selRef.current.items
    setDrag({ kind: 'files', paths: items.has(path) && items.size > 1 ? [...items] : [path] })
    e.dataTransfer.setData(DRAG_MIME, 'files')
    e.dataTransfer.effectAllowed = 'move'
  }, [])
  const onDropOn = useCallback(
    (e: DragEvent, folderPath: string): void => {
      setDropTarget(null)
      const payload = dragPayload(e.dataTransfer)
      setDrag(null)
      // The folder you dropped ONTO becomes the marked row (2026-08-31). What
      // you dragged has left - its row is about to disappear from where it was
      // - so leaving the mark on it points at nothing, and clearing it points
      // at nothing either. The destination is the thing you are now looking
      // at, and it is where the arrows should carry on from.
      setDroppedOn(folderPath)
      setSel({ anchor: folderPath, items: new Set([folderPath]) })
      setCursor(folderPath)
      if (payload) onDropInto(folderPath, payload)
      else {
        // Nothing of ours: Explorer, then. Its files are outside the root, so
        // main will refuse them - App says so rather than failing silently.
        const outside = droppedPaths(e.dataTransfer)
        if (outside.length) onDropInto(folderPath, { kind: 'files', paths: outside })
      }
    },
    [onDropInto]
  )

  /** Put the cursor on a row: folders only highlight, files open. */
  const land = useCallback(
    (row: { path: string; isFolder: boolean }, keepFocus = false): void => {
      setCursor(row.path)
      setSel({ anchor: row.path, items: new Set([row.path]) })
      if (!row.isFolder) onOpenFile(row.path)
      // Arrowing from inside the SEARCH BOX must not take the caret out of it
      // (2026-08-30): one press moved focus to the row, and the letters that
      // followed reached the viewer's own shortcuts instead of the query.
      if (keepFocus) return
      // Roving focus, so Enter and Space reach the row without any key handling
      // of our own, and so a screen reader follows the cursor. preventScroll:
      // the scroller below decides how the row is brought into view.
      requestAnimationFrame(() => {
        const el = scroller.current?.querySelector<HTMLElement>(
          `[data-row="${CSS.escape(row.path)}"]`
        )
        el?.focus({ preventScroll: true })
        el?.scrollIntoView({ block: 'nearest' })
      })
    },
    [onOpenFile]
  )

  // The tree's answer to an arrow key. Returns false when it has nothing to
  // say, and App pages the folder the old way instead: while the panel is shut,
  // while search has replaced the tree, or at the ends of the tree.
  const step = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right'): boolean => {
      if (!open) return false
      // The SAME test the render uses. Gating on the raw query let a stale hit
      // list be walked (and a file opened) while the tree was back on screen:
      // typing a single space leaves `query` truthy and `query.trim()` empty.
      const searching = !!query.trim()
      // While search has replaced the tree, the arrows walk the HITS. They used
      // to bail here, so Up/Down paged the folder behind the panel instead -
      // the results scrolled past under a cursor that was not in them.
      if (searching) {
        if (!hitRows.length) return false
        // A flat list: up/left and down/right mean the same thing in it.
        const next = stepRow(hitRows, at, dir === 'down' || dir === 'right' ? 1 : -1, false)
        if (!next) return false
        // Keep the caret where it is when the press came from the search box:
        // an INPUT has the focus only when someone is typing a query.
        land(next, (document.activeElement as HTMLElement | null)?.tagName === 'INPUT')
        return true
      }
      const here = rows.find((r) => r.path.toLowerCase() === (at ?? '').toLowerCase())
      // Left and right on a folder are its chevron: collapse, or open.
      if (here?.isFolder && (dir === 'left' || dir === 'right')) {
        const isOpen = state.expanded.has(here.path)
        if (dir === 'right' && !isOpen) toggle(here.path)
        else if (dir === 'left' && isOpen) toggle(here.path)
        else if (dir === 'right') {
          // Already open: step into it, the way a tree does.
          const next = stepRow(rows, here.path, 1)
          if (next) land(next)
        }
        return true
      }
      // Up/Down walk every row; Left/Right keep meaning previous/next FILE.
      const delta = dir === 'down' || dir === 'right' ? 1 : -1
      const next = stepRow(rows, at, delta, dir === 'left' || dir === 'right')
      if (!next) return false
      land(next)
      return true
    },
    [open, query, hitRows, rows, at, state.expanded, toggle, land]
  )

  // Lend the tree's keyboard to App, which owns the window's key handling and
  // all the guards that go with it (settings, fullscreen, a focused document).
  useEffect(() => {
    onNav(step)
    return () => onNav(null)
  }, [onNav, step])

  const rootListing = state.children[root]

  return (
    // The panel stays mounted and collapses to zero width, so opening and closing
    // slides. Its contents keep the full width throughout (the outer box just
    // clips), which keeps the rows from reflowing on every frame of the slide.
    <aside
      ref={panel}
      inert={!open}
      aria-hidden={!open}
      style={{ width: open ? width : 0 }}
      className={`p-styled-font relative h-full shrink-0 overflow-hidden bg-[var(--p-side)] ${wash ? 'p-wash ' : ''}${
        dragging
          ? ''
          : 'transition-[width] duration-[180ms] [transition-timing-function:cubic-bezier(.23,1,.32,1)]'
      }`}
    >
      <div
        // The one edge that stands against the VIEWER uses the OPAQUE hairline:
        // an alpha line here sampled whatever was behind it, so over a playing
        // video it shimmered lighter and darker down its length.
        className={`flex h-full flex-col ${right ? 'border-l' : 'border-r'} border-[color:var(--p-edge)]`}
        style={{ width }}
      >
        {/* ONE row for the panel's controls (owner, 2026-08-23): the folder
            name used to head the sidebar, but the tab already says where you
            are, and repeating it cost a whole row. Reroot, search and sort
            now share the line. The search box is a hairline and nothing else,
            so it wears whatever the style wears (a filled grey panel glowed
            on true black); the accent arrives with focus, Escape clears. */}
        <div className="mx-2 mb-1.5 mt-2 flex shrink-0 items-center gap-1.5">
          <button
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] text-[var(--p-icon)] transition-colors hover:border-[color:var(--p-accent-hi)] hover:text-[var(--p-text)]"
            onClick={onOpenFolder}
            title="Open a different folder in this tab"
            aria-label="Open folder"
          >
            <svg
              viewBox="0 0 24 24"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M12 11v5m2.5-2.5h-5" />
            </svg>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[color:var(--p-line)] bg-transparent px-2 py-1 font-normal normal-case tracking-normal transition-colors focus-within:border-[color:var(--p-accent-hi)]">
            <svg
              viewBox="0 0 24 24"
              width={12}
              height={12}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-[var(--p-dim2)]"
              aria-hidden
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQuery('')
                  e.currentTarget.blur()
                  return
                }
                // Up/Down walk the results while the caret stays in the box, so
                // typing a query and arrowing to the one you want is one
                // gesture. App's typing guard treats an INPUT as owning every
                // key, so this has to be done here. Left/Right are deliberately
                // left to the caret: someone editing a query expects them.
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  e.stopPropagation()
                  step(e.key === 'ArrowDown' ? 'down' : 'up')
                }
              }}
              placeholder="Search"
              aria-label="Search files"
              // Where the operators are taught. A placeholder cannot hold them
              // and a help panel in a viewer's sidebar would be chrome, so the
              // box says what it can do when you rest on it (2026-08-28).
              title={SEARCH_HELP}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--p-text)] outline-none placeholder:text-[var(--p-dim2)]"
            />
            {query && (
              <button
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[var(--p-dim2)] hover:text-[var(--p-text)]"
                onClick={() => setQuery('')}
                title="Clear"
                aria-label="Clear search"
              >
                <svg
                  viewBox="0 0 24 24"
                  width={10}
                  height={10}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
          <SortMenu />
        </div>
        {/* No scrollbar: the tree scrolls, it just doesn't advertise it. */}
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          // A right-click that lands on no row is about the PLACE, not about a
          // file. Rows stop it themselves, exactly as the archive panel's do.
          onContextMenu={(e) => {
            if ((e.target as HTMLElement | null)?.closest('[data-row]')) return
            e.preventDefault()
            setPlaceMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          {query.trim() ? (
            <SearchResults
              key={root}
              root={root}
              query={query.trim()}
              refreshKey={refreshKey}
              currentPath={currentPath}
              size={size}
              onOpen={(path, isFolder) => (isFolder ? revealFolder(path) : onOpenFile(path))}
              onRows={setHitRows}
              cursorPath={at}
              onMenu={(e, path, name, isFolder) =>
                onMenu(e, path, name, !!isFolder, undefined, true)
              }
              onMultiMenu={(e, paths) =>
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  path: paths[0],
                  name: '',
                  isFolder: false,
                  multi: paths
                })
              }
            />
          ) : (
            <TreeProvider
              value={{
                expanded: state.expanded,
                children: state.children,
                currentPath,
                dirtyPaths,
                cursor: at,
                size,
                editing,
                menuPath: menu?.path ?? null,
                selected: sel.items,
                selJoin,
                onRowDragStart,
                dropTarget,
                onDropHover: setDropTarget,
                onDragDone: () => {
                  setDropTarget(null)
                  setDrag(null)
                },
                onDropOn,
                onRowClick,
                onToggle: toggle,
                onOpenFile,
                onStartRename: setEditing,
                onSubmitRename: submitRename,
                onCancelRename: () => setEditing(null),
                // Del on a row inside a multi-selection takes the whole
                // selection; anywhere else it stays the single-row question.
                onDelete: (path, name, isFolder) =>
                  sel.items.size > 1 && sel.items.has(path)
                    ? onDeleteMany([...sel.items])
                    : onDelete(path, name, isFolder),
                onMenu
              }}
            >
              {rootListing ? (
                <ul role="tree" aria-label="Folder contents" className="list-none">
                  <Rows listing={rootListing} depth={0} />
                </ul>
              ) : (
                <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">
                  loading…
                </div>
              )}
            </TreeProvider>
          )}
        </div>
        {/* The footer row: the sidebar's actions on the place itself. One
            button today, right-aligned; a row so the next one has a home. The
            state reads through the GLYPH, not a border: outlined shut, filled
            open, the way the tab-strip accent belongs to the state it marks. */}
        <div className="flex h-9 shrink-0 items-center justify-end gap-1.5 border-t border-[color:var(--p-line)] px-2">
          {/* Bare prompt, frameless (picked from the button lab, 2026-08-21):
              just the glyph. Hover brings the tree rows' grey tile; open tints
              the glyph accent and nothing else. */}
          <button
            className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[3px] transition-colors hover:bg-[var(--p-hover)] ${
              termOpen
                ? 'text-[var(--p-accent-hi)]'
                : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
            }`}
            onClick={onToggleTerm}
            onContextMenu={(e) => {
              e.preventDefault()
              setTermMenu({ x: e.clientX, y: e.clientY })
            }}
            title="Terminal (Ctrl+`)"
            aria-label="Terminal"
            aria-pressed={termOpen}
          >
            <svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5.5 6.5l6 5.5-6 5.5M13.5 18.5H19" />
            </svg>
          </button>
        </div>
      </div>

      {/* Drag the edge to resize; double-click snaps back to the default. The hit
          area is wider than the line it draws, so it's grabbable without hunting. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file tree"
        aria-valuenow={width}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        tabIndex={open ? 0 : -1}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        onDoubleClick={() => resize(DEFAULT_W)}
        onKeyDown={onHandleKey}
        className={`no-drag group absolute inset-y-0 z-10 w-2 cursor-col-resize focus-visible:outline-none ${
          right ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
        }`}
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 group-hover:bg-[var(--p-accent-hi)] group-focus-visible:bg-[var(--p-accent-hi)] ${
            dragging ? 'bg-[var(--p-accent-hi)]' : 'bg-transparent'
          }`}
        />
      </div>

      {termMenu && (
        <ContextMenu
          x={termMenu.x}
          y={termMenu.y}
          onClose={() => setTermMenu(null)}
          items={[
            {
              label: 'Open in split view',
              icon: <MenuIcon d="M4 5h16v14H4zM13 5v14" />,
              onPick: onTermSplit
            },
            {
              label: 'Open in new tab',
              icon: <MenuIcon d="M4 6h10v12H4zM14 6h6v12h-6M17 9v6M14 12h6" />,
              onPick: onTermNewTab
            },
            // Only once a shell exists: there is nothing to clear before that.
            ...(onClearTerm
              ? [
                  {
                    label: 'Clear terminal',
                    icon: <MenuIcon d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5" />,
                    onPick: onClearTerm
                  }
                ]
              : [])
          ]}
        />
      )}

      {placeMenu && (
        <ContextMenu
          x={placeMenu.x}
          y={placeMenu.y}
          onClose={() => setPlaceMenu(null)}
          items={[
            {
              label: 'Paste',
              icon: <MenuIcon d="M9 3.5h6v3H9zM7 5H4.5v15.5h15V5H17" />,
              onPick: () => {
                void window.prism.pasteInto(root).then((r) => {
                  // Said out loud rather than silently: a paste that finds an
                  // empty clipboard looks exactly like one that failed.
                  if (r.empty) setPasteNote('There are no files on the clipboard.')
                  else if (r.refused) setPasteNote('That folder is outside this tab.')
                  else if (!r.pasted) setPasteNote('Nothing could be pasted here.')
                  else if (r.failed)
                    setPasteNote(`Pasted ${r.pasted}, but ${r.failed} could not be copied.`)
                })
              }
            },
            {
              label: 'Open terminal here',
              icon: <MenuIcon d="M5.5 6.5l6 5.5-6 5.5M13.5 18.5H19" />,
              onPick: () => onTermHere(root)
            },
            {
              label: 'Show in File Explorer',
              icon: <MenuIcon d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />,
              onPick: () => window.prism.showInExplorer(root)
            },
            {
              label: 'Copy path',
              icon: (
                <MenuIcon d="M9 15l6-6M7.5 10.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M16.5 13.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
              ),
              onPick: () => void navigator.clipboard.writeText(root)
            }
          ]}
        />
      )}

      {pasteNote && (
        <Dialog
          title="Paste"
          body={pasteNote}
          onCancel={() => setPasteNote(null)}
          choices={[{ label: 'Close', primary: true, onPick: () => setPasteNote(null) }]}
        />
      )}

      {menu && menu.multi && (
        // A multi-selection's menu: the verbs that make sense N at a time.
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: `Copy ${menu.multi.length} files`,
              icon: <MenuIcon d="M8 8h12v12H8zM16 8V4H4v12h4" />,
              onPick: () => void window.prism.copyFilesToClipboard(menu.multi!)
            },
            {
              label: 'Copy paths',
              icon: (
                <MenuIcon d="M9 15l6-6M7.5 10.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M16.5 13.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
              ),
              onPick: () => void navigator.clipboard.writeText(menu.multi!.join('\n'))
            },
            {
              label: `Delete ${menu.multi.length} items`,
              hint: 'Del',
              danger: true,
              icon: <MenuIcon d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
              onPick: () => onDeleteMany(menu.multi!)
            }
          ]}
        />
      )}
      {menu && !menu.multi && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            // Files also go places: another app, Explorer, the clipboard.
            ...(!menu.isFolder
              ? [
                  // Split panes are file-agnostic: pin any file beside the
                  // live one. The parent click reuses the remembered
                  // direction; the flyout names one. A pinned file's menu
                  // offers the way back out instead.
                  pinnedPaths.some((pp) => pp.toLowerCase() === menu.path.toLowerCase())
                    ? {
                        label: 'Remove from split view',
                        icon: <MenuIcon d="M4 5h16v14H4zM13 5v14M6.5 10.5l2 1.5-2 1.5" />,
                        onPick: () => onUnpinSplit(menu.path)
                      }
                    : {
                        label: 'Open in split view',
                        icon: <MenuIcon d="M4 5h16v14H4zM13 5v14" />,
                        onPick: () => onPinSplit(menu.path),
                        // The remembered direction wears a check: it is where a
                        // bare click on the parent will put the file.
                        children: (['left', 'right', 'top', 'bottom'] as const).map((d) => ({
                          label: d[0].toUpperCase() + d.slice(1),
                          icon:
                            d === lastSplitDir() ? (
                              <MenuIcon d="M5 12.5l4.5 4.5L19 7" />
                            ) : (
                              <span className="w-[13px] shrink-0" aria-hidden />
                            ),
                          onPick: () => onPinSplit(menu.path, d)
                        }))
                      },
                  {
                    label: 'Open in new tab',
                    icon: <MenuIcon d="M4 6h10v12H4zM14 6h6v12h-6M17 9v6M14 12h6" />,
                    onPick: () => onOpenNewTab(menu.path)
                  },
                  {
                    label: 'Open in',
                    icon: (
                      <MenuIcon d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
                    ),
                    children: [
                      {
                        label: 'Default app',
                        icon: <MenuIcon d="M12 3l8 5-8 5-8-5 8-5zM4 13l8 5 8-5" />,
                        onPick: () => window.prism.openInDefault(menu.path)
                      },
                      ...(menu.apps === null
                        ? [{ label: 'Looking for apps…', disabled: true }]
                        : (menu.apps ?? []).map((a) => ({
                            label: a.name,
                            icon: a.icon ? (
                              <img
                                src={a.icon}
                                width={14}
                                height={14}
                                alt=""
                                className="shrink-0"
                              />
                            ) : (
                              <MenuIcon d="M4 5h16v14H4zM4 9h16" />
                            ),
                            onPick: () => void window.prism.openWith(menu.path, a.id)
                          }))),
                      {
                        label: 'Choose another app…',
                        icon: <MenuIcon d="M12 8v8M8 12h8M3.5 5h17v14h-17z" />,
                        onPick: () => window.prism.openWithChooser(menu.path)
                      }
                    ]
                  }
                ]
              : []),
            ...(menu.isFolder
              ? [
                  {
                    label: 'Open terminal here',
                    icon: <MenuIcon d="M5.5 6.5l6 5.5-6 5.5M13.5 18.5H19" />,
                    onPick: () => onTermHere(menu.path)
                  }
                ]
              : []),
            {
              label: 'Show in File Explorer',
              icon: <MenuIcon d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />,
              onPick: () => window.prism.showInExplorer(menu.path)
            },
            {
              label: 'Copy path',
              icon: (
                <MenuIcon d="M9 15l6-6M7.5 10.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M16.5 13.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
              ),
              onPick: () => void navigator.clipboard.writeText(menu.path)
            },
            {
              label: 'Copy file',
              icon: <MenuIcon d="M8 8h12v12H8zM16 8V4H4v12h4" />,
              onPick: () => void window.prism.copyFileToClipboard(menu.path)
            },
            ...(!menu.isFolder
              ? [
                  {
                    label: 'Duplicate',
                    icon: <MenuIcon d="M8 8h12v12H8zM16 8V4H4v12h4M14 11v6M11 14h6" />,
                    onPick: () =>
                      void window.prism.duplicateFile(menu.path).then((copy) => {
                        if (copy) {
                          onDuplicated(menu.path, copy)
                          void load(parentDir(menu.path), true)
                        }
                      })
                  }
                ]
              : []),
            {
              label: 'Rename',
              hint: 'F2',
              icon: <MenuIcon d="M4 20h4L19 9l-4-4L4 16z" />,
              onPick: () => setEditing(menu.path)
            },
            {
              label: 'Properties',
              // The size right on the row: the question Properties answers most.
              hint: menu.isFolder ? undefined : formatBytes(menu.size ?? NaN) || undefined,
              icon: (
                <MenuIcon d="M12 8.2v.01M12 11v5M3.8 12a8.2 8.2 0 1 0 16.4 0 8.2 8.2 0 0 0-16.4 0z" />
              ),
              onPick: () =>
                setProps({
                  path: menu.path,
                  name: menu.name,
                  isFolder: menu.isFolder,
                  size: menu.size
                })
            },
            {
              label: 'Delete',
              hint: 'Del',
              danger: true,
              icon: <MenuIcon d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
              onPick: () => onDelete(menu.path, menu.name, menu.isFolder)
            }
          ]}
        />
      )}

      {props && (
        <PropertiesDialog
          root={root}
          path={props.path}
          name={props.name}
          kind={fileKind(/\.[^.\\/]*$/.exec(props.name)?.[0] ?? '', props.name)}
          isFolder={props.isFolder}
          onClose={() => setProps(null)}
        />
      )}
    </aside>
  )
}
