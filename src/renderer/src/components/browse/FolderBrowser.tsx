import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { formatBytes } from '../../lib/format'
import { BrowseIcon, PreviewGlyph } from './BrowseIcon'
import { BrowseList } from './BrowseList'
import { BrowseSearchStatus } from './BrowseSearchStatus'
import { BrowseSearchPopup } from './BrowseSearchPopup'
import { BrowsePlaces } from './BrowsePlaces'
import { BrowseToolbar } from './BrowseToolbar'
import { browseEntries, datesKnown } from './entries'
import { dateDividers } from '../../lib/dateGroups'
import { dateView } from '../../lib/downloadsView'
import { useFolderSizes } from '../../hooks/useFolderSizes'
import { clickSelect, rangeSelect } from '../../lib/selection'
import { listKey } from '../../lib/listKeys'
import { sweepSelect } from '../../lib/marquee'
import { explorerHeadVars, explorerRow, useExplorerSize } from '../../lib/explorerSize'
import type { BrowseEntry, FolderBrowserProps } from './types'
import { useListingPrefetch } from '../../lib/useListingPrefetch'
import { browsableArchive } from '@shared/archivePlace'
import type { FolderSizes } from '../../lib/folderSize'
import { ArchiveStrip } from './ArchiveStrip'
import { withinFolder, type PlaceRow } from '../../lib/placeMark'
import { useActiveArea } from './useActiveArea'
import './browse.css'
import './archive.css'

/** The common keys FolderBrowser answers for the list (#330). */
const FOLDER_KEYS = new Set(['new-folder', 'bin', 'search', 'properties', 'copy-paths', 'open-new-tab'])

export type {
  BrowseEntry,
  BrowsePlace,
  BrowseSearchState,
  BrowseSort,
  FolderBrowserProps
} from './types'

/** The accepted folder layout extends Prism's own continuous canvas and file rows.
 * Location, history and selection belong to the tab; this surface owns no session.
 * The preview slot can be empty when App positions its existing mounted viewer over it.
 */
export function FolderBrowser(props: FolderBrowserProps): JSX.Element {
  const shell = useRef<HTMLDivElement>(null)
  const sizeId = useExplorerSize()
  const rowLook = explorerRow(sizeId)
  const [visibleFolders, setVisibleFolders] = useState<string[]>([])
  const onVisibleFolders = useCallback((paths: string[]) => {
    setVisibleFolders((previous) =>
      previous.length === paths.length && previous.every((path, index) => path === paths[index])
        ? previous
        : paths
    )
  }, [])
  // The sidebar marks ONE place (#296, lib/placeMark.ts): the one last
  // clicked while the folder stays inside it. Held here, not in the panel,
  // which unmounts while hidden. Once the folder leaves it, it is forgotten,
  // so a Back into it later marks by the exact path, as File Explorer does.
  // Adjusted while rendering when the folder changes (React's pattern for
  // state that follows a prop), not in an effect.
  const [chosenPlace, setChosenPlace] = useState<PlaceRow | null>(null)
  const [placeFolder, setPlaceFolder] = useState(props.directory)
  if (placeFolder !== props.directory) {
    setPlaceFolder(props.directory)
    if (chosenPlace && !withinFolder(props.directory, chosenPlace.path)) setChosenPlace(null)
  }
  const area = useActiveArea(shell)
  const focusList = (): void => {
    shell.current?.querySelector<HTMLElement>('.browse-list')?.focus({ preventScroll: true })
  }
  const retainListFocus = (): void => {
    if (document.activeElement?.closest('.browse-list')) focusList()
  }
  // The list survives folder loads; its rows do not. It also takes the keyboard
  // when returning from a full-file viewer, before a row is available again.
  useLayoutEffect(() => {
    focusList()
  }, [])
  // While the places panel slides its column shrinks, but its contents keep
  // the width they had open (the Sidebar's own rule), so the rows do not
  // reflow on every frame. Read while it stands still, applied only mid-slide.
  const sliding = !!props.placesSliding
  useLayoutEffect(() => {
    if (sliding || props.placesVisible === false) return
    const width = shell.current?.querySelector<HTMLElement>('.browse-places')?.offsetWidth
    if (width) shell.current?.style.setProperty('--browse-places-frozen', `${width}px`)
  })
  // INSIDE AN ARCHIVE (#300) the container's own listing carries every
  // folder's total, so nothing asks `folder:size` about a path not on disk,
  // and nothing reads ahead into a container.
  const archive = props.listing?.archive ?? null
  const folderPaths = useMemo(
    () => (archive ? [] : (props.listing?.folders.map((folder) => folder.path) ?? [])),
    [props.listing, archive]
  )
  const measured = useFolderSizes(
    folderPaths,
    !archive && props.pending === 'none' && !props.searchState?.running && !props.searchState?.window,
    archive ? [] : visibleFolders
  )
  const folderSizes = useMemo((): FolderSizes => {
    if (!archive || !props.listing) return measured
    const sizes: FolderSizes = {}
    for (const f of props.listing.folders)
      sizes[f.path] = {
        bytes: f.size ?? 0,
        files: f.items ?? 0,
        folders: 0,
        unreadable: 0,
        skippedLinks: 0,
        truncated: false,
        countsKnown: true
      }
    return sizes
  }, [archive, props.listing, measured])
  // DOWNLOADS BY DATE (#285, lib/downloadsView.ts): files and folders mixed,
  // newest first, under File Explorer's date groups. Never a search.
  const dated = dateView(!!props.downloads, props.sort, !!props.query.trim() || !!props.searchState)
  const entries = useMemo(
    () =>
      browseEntries(
        props.listing,
        props.searchState ? '' : props.query,
        props.sort,
        folderSizes,
        dated
      ),
    [props.listing, props.query, props.sort, props.searchState, folderSizes, dated]
  )
  const weekStart = props.weekStart
  const dividers = useMemo(
    () =>
      dated && datesKnown(props.listing)
        ? dateDividers(entries, (e) => (e.file ? e.file.mtimeMs : e.mtimeMs), new Date(), weekStart)
        : undefined,
    [dated, props.listing, entries, weekStart]
  )
  const selected = entries.find((entry) => entry.path === props.selectedPath)
  // READ AHEAD (#271): the folder under the pointer, the selected folder, the
  // parent, a small folder's subfolders and Quick access.
  const hoverFolder = useListingPrefetch({
    directory: props.directory,
    listing: props.listing,
    selectedFolder: selected?.isFolder ? selected.path : null,
    quickAccess: props.quickAccess,
    ready: props.pending === 'none' && !props.searchState && !archive
  })
  const searchWindow = props.searchState?.window
  const searchWindows = props.searchState?.windows
  const indexedRows = useMemo(() => {
    if (!searchWindow) return undefined
    const byPath = new Map(entries.map((entry) => [entry.path, entry]))
    const rows = new Map<number, BrowseEntry | null>()
    for (const window of searchWindows ?? []) {
      window.paths.forEach((path, index) => {
        const entry = path ? byPath.get(path) : null
        rows.set(
          window.offset + index,
          entry
            ? {
                ...entry,
                folderSize: window.folderSizes?.[entry.path] ?? null
              }
            : null
        )
      })
    }
    return rows
  }, [entries, searchWindow, searchWindows])
  const total = props.searchState?.window?.total ?? entries.length
  /**
   * MORE THAN ONE ROW MARKED (#257). The tab keeps ONE selected path, the
   * keyboard's place and what the preview shows; a sweep or a Ctrl or Shift
   * click marks more rows around it, held here. It belongs to the folder on
   * screen and goes with it: a new folder, a search or a new sort starts with
   * the one path again, and so does any plain pick (a click, the arrows).
   * Marks that no longer hold the selected path are stale and read as none.
   */
  const [marks, setMarks] = useState<{ key: string; items: ReadonlySet<string> } | null>(null)
  const anchor = useRef<string | null>(null)
  // The tab is part of the key: one FolderBrowser serves every tab, and two
  // tabs on the same folder must not share each other's marks.
  const marksKey = `${props.owner ?? ''}\u0000${props.directory}\u0000${props.query}\u0000${props.sort.key}${props.sort.direction}`
  const marked =
    marks && marks.key === marksKey && props.selectedPath && marks.items.has(props.selectedPath)
      ? marks.items
      : null
  const markedEntries = marked ? entries.filter((entry) => marked.has(entry.path)) : []
  const many = markedEntries.length > 1
  const markedPaths = (): string[] => markedEntries.map((entry) => entry.path)
  const pickOne = (path: string | null, quiet = false): void => {
    setMarks(null)
    anchor.current = path
    props.onSelect(path, quiet)
  }
  const order = (): string[] =>
    indexedRows
      ? [...indexedRows]
          .sort(([a], [b]) => a - b)
          .flatMap(([, entry]) => (entry ? [entry.path] : []))
      : entries.map((entry) => entry.path)
  const pickPath = (path: string, mods: { ctrl: boolean; shift: boolean }): void => {
    const now = marked ?? new Set(props.selectedPath ? [props.selectedPath] : [])
    const next = clickSelect(
      order(),
      { anchor: anchor.current ?? props.selectedPath, items: now },
      path,
      mods
    )
    anchor.current = next.anchor
    // The clicked row is where the keyboard goes, unless Ctrl just took it
    // back out; then any row still marked, or none.
    const primary = next.items.has(path) ? path : ([...next.items][0] ?? null)
    setMarks(next.items.size > 1 ? { key: marksKey, items: next.items } : null)
    // Quiet, even when it leaves one row (#263): a Ctrl or Shift click marks,
    // it does not preview or play what it lands on.
    props.onSelect(primary, true)
  }
  const pick = (entry: BrowseEntry, mods: { ctrl: boolean; shift: boolean }): void =>
    pickPath(entry.path, mods)
  /* THE COMMON KEYS (#330), every one of them QUIET (#263): marking by
     keyboard previews, plays and opens nothing, as a Ctrl or Shift click. */
  /** Shift+arrows, Shift+Home/End: the run from the anchor to `path`. */
  const extendTo = (path: string): void => {
    const now = marked ?? new Set(props.selectedPath ? [props.selectedPath] : [])
    const next = rangeSelect(order(), { anchor: anchor.current ?? props.selectedPath, items: now }, path)
    anchor.current = next.anchor
    setMarks(next.items.size > 1 ? { key: marksKey, items: next.items } : null)
    props.onSelect(path, true)
  }
  /** Ctrl+A: every row the list holds (a search's rows as far as they came). */
  const selectAll = (): void => {
    const all = order()
    if (!all.length) return
    const keep = props.selectedPath && all.includes(props.selectedPath) ? props.selectedPath : all[0]
    anchor.current = anchor.current && all.includes(anchor.current) ? anchor.current : all[0]
    setMarks(all.length > 1 ? { key: marksKey, items: new Set(all) } : null)
    props.onSelect(keep, true)
  }
  /** Ctrl+Shift+A and Escape: nothing marked. False when nothing was. */
  const clearMarks = (): boolean => {
    if (!props.selectedPath && !marked) return false
    pickOne(null, true)
    return true
  }
  const swept = (paths: string[], near: string | null, add: boolean): void => {
    const base: ReadonlySet<string> = add
      ? (marked ?? new Set(props.selectedPath ? [props.selectedPath] : []))
      : new Set()
    const items = sweepSelect(base, paths)
    // A sweep is marking, however few rows it caught (#263).
    if (items.size <= 1) return pickOne([...items][0] ?? null, true)
    const primary = near && items.has(near) ? near : [...items][0]
    anchor.current = primary
    setMarks({ key: marksKey, items })
    props.onSelect(primary, true)
  }
  /**
   * THE SEARCH POPUP (#267). Open on the search button or Ctrl+F, never over
   * something else in front (a question, the update window: one layer, one
   * thing), and it leaves when what is in front changes: another tab, another
   * folder, or a layer arriving over it. The focus goes back where it was.
   */
  const [searching, setSearching] = useState<{ owner?: string; directory: string } | null>(null)
  const searchOpen =
    !!searching && searching.owner === props.owner && searching.directory === props.directory && !props.covered
  const returnFocus = useRef<HTMLElement | null>(null)
  const openSearch = (): void => {
    if (props.covered || document.querySelector('[role="dialog"][aria-modal="true"]')) return
    const focused = document.activeElement
    returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : null
    setSearching({ owner: props.owner, directory: props.directory })
  }
  const closeSearch = (refocus = true): void => {
    setSearching(null)
    const back = returnFocus.current
    returnFocus.current = null
    if (!refocus) return
    if (back?.isConnected) back.focus({ preventScroll: true })
    else focusList()
  }
  // Left behind by a tab switch, a walk elsewhere or a layer over it: gone,
  // not waiting to reappear when that layer does. Settled while rendering,
  // React's own pattern for state that follows props.
  if (searching && !searchOpen) setSearching(null)
  const activate = (entry: BrowseEntry): void => {
    // AN ARCHIVE OPENS LIKE A FOLDER (#300; owner, 2026-10-06: "they keep the
    // icon but you open them like any other folder").
    if (entry.isFolder || (entry.file?.kind === 'archive' && browsableArchive(entry.name))) {
      retainListFocus()
      props.onNavigate(entry.path)
    } else if (entry.file) props.onOpen(entry.file)
  }
  // NO LOADING TEXT, EVER (#271; owner, 2026-10-04: "I don't ever want to see
  // that"). A folder still on its way says nothing in the list: its old rows
  // stay, or past 300 ms the header and a thin bar (BrowseList).
  const message =
    props.pending !== 'none'
      ? null
      : props.error ||
      (props.listing?.unreadable
        ? 'This folder could not be read. Try another location.'
        : !total
          ? props.query.trim()
            ? props.searchState?.running
              ? 'Searching this folder and subfolders…'
              : props.searchState?.cancelled || props.searchState?.truncated
                ? 'No matches found before the search stopped. Refine your search and try again.'
                : 'No matching items in this folder or its subfolders.'
            : 'This folder is empty.'
          : null)

  // SIDEBAR POSITION (#304; owner, 2026-10-07): on the right the places
  // panel takes the right edge and the preview the left. The places come
  // after the list in the DOM then too, so Tab walks the row left to right.
  const right = props.side === 'right'
  const previewToggle = (
    <button
      className="browse-icon-button"
      aria-label="Preview pane"
      title="Preview pane"
      aria-pressed={props.previewEnabled}
      onClick={props.onPreviewToggle}
    >
      <PreviewGlyph open={props.previewEnabled} />
    </button>
  )
  const places = (props.placesVisible !== false || sliding || !!props.placesPeek) && (
    <BrowsePlaces
      places={props.places}
      onDropInto={props.onDropInto}
      quickAccess={props.quickAccess}
      readDrives={props.readDrives}
      onQuickAccessFile={
        props.placesPeek && props.onQuickAccessFile
          ? (path, full) => {
              props.onPlacePicked?.()
              props.onQuickAccessFile?.(path, full)
            }
          : props.onQuickAccessFile
      }
      onPin={props.placesPeek === 'in' ? props.onPinPlaces : undefined}
      onUnpinQuickAccess={props.onUnpinQuickAccess}
      onMoveQuickAccess={props.onMoveQuickAccess}
      onPinQuickAccessPaths={props.onPinQuickAccessPaths}
      directory={props.directory}
      chosenPlace={chosenPlace}
      onChoosePlace={setChosenPlace}
      onNavigate={
        props.placesPeek
          ? (path) => {
              props.onPlacePicked?.()
              props.onNavigate(path)
            }
          : props.onNavigate
      }
      onNewTerminal={props.onNewTerminal}
      onOpenProject={props.onOpenProject}
      onOpenNewTab={props.onOpenNewTab}
    />
  )

  return (
    <div
      ref={shell}
      className="folder-browser"
      // One size for the list AND Quick access (#257): the row look is set
      // here, where both read it.
      style={
        {
          '--browse-row-h': `${rowLook.height}px`,
          '--browse-row-font': `${rowLook.font}px`,
          '--browse-row-icon': `${rowLook.icon}px`,
          '--browse-row-gap': `${rowLook.gap}px`,
          '--browse-row-pad': `${rowLook.padX}px`,
          // The header's band, which Quick access's heading is centred in (#283).
          ...explorerHeadVars(sizeId)
        } as CSSProperties
      }
      data-preview={props.previewVisible || undefined}
      data-places-hidden={props.placesVisible === false || undefined}
      data-places-sliding={sliding || undefined}
      data-places-peek={props.placesPeek || undefined}
      data-side={right ? 'right' : undefined}
      data-testid="folder-browser"
      // Where the user last acted (useActiveArea): the side not acted in
      // draws its mark dimmed, File Explorer's inactive selection.
      data-active-area={area}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement
        const typing = target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.cm-editor,.xterm,[role="dialog"],[role="menu"]'
        )
        if (target.closest('[role="dialog"],[role="menu"]')) return
        const inList = !!target.closest('.browse-list')
        // THE COMMON KEYS (#330) that act on the folder or a row rather than
        // on the marks (the list answers those itself). From the list only,
        // never while typing, and CLAIMED even where they do nothing (inside
        // a zip), so no window-wide viewer key answers them instead: F3 was
        // the PDF's find from anywhere.
        const common = !typing && inList ? listKey(e) : null
        if (common && FOLDER_KEYS.has(common)) {
          e.preventDefault()
          e.stopPropagation()
          // The row with the keyboard (a cursor the Ctrl keys moved), else
          // the selected one.
          const at = target.closest<HTMLElement>('[data-browse-path]')?.dataset.browsePath
          const focused =
            (at && (entries.find((entry) => entry.path === at) ?? [...(indexedRows?.values() ?? [])].find((entry) => entry?.path === at))) ||
            selected
          if (common === 'search') openSearch()
          else if (common === 'copy-paths') {
            const paths = many ? markedPaths() : focused ? [focused.path] : []
            if (paths.length) props.onCopyPathText?.(paths)
          } else if (archive) return
          else if (common === 'new-folder') props.onNewFolder?.(props.directory)
          else if (common === 'bin') {
            // Ctrl+D and Shift+Delete are Delete (owner, 2026-10-07: Shift+
            // Delete is NOT permanent here): the question, then the bin.
            if (many && props.onDeleteMany) props.onDeleteMany(markedPaths())
            else if (selected) props.onDelete?.(selected)
          } else if (common === 'properties') {
            if (focused) props.onProperties?.(focused)
          } else if (common === 'open-new-tab') {
            if (focused?.isFolder) props.onOpenNewTab?.(focused.path, true)
          }
          return
        }
        if (e.key === 'F5' && props.onRefresh) {
          e.preventDefault()
          e.stopPropagation()
          retainListFocus()
          props.onRefresh()
        } else if (
          !typing &&
          inList &&
          selected &&
          e.key === 'Delete' &&
          !e.ctrlKey &&
          !e.shiftKey &&
          props.onDelete
        ) {
          e.preventDefault()
          e.stopPropagation()
          if (many && props.onDeleteMany) props.onDeleteMany(markedPaths())
          else props.onDelete(selected)
        } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
          e.preventDefault()
          e.stopPropagation()
          shell.current
            ?.querySelector<HTMLButtonElement>('[data-testid="browse-edit-path"]')
            ?.click()
        } else if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          e.key.toLowerCase() === 'f' &&
          // An editor or a shell inside keeps its own find.
          !target.closest('.cm-editor,.xterm,[data-doc-scroller],[data-pdf-scroller]')
        ) {
          e.preventDefault()
          e.stopPropagation()
          openSearch()
        } else if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Backspace') {
          e.preventDefault()
          e.stopPropagation()
          retainListFocus()
          if (props.canBack) props.onBack()
          else props.onUp()
        } else if (!typing && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          retainListFocus()
          if (e.key === 'ArrowLeft' && props.canBack) props.onBack()
          if (e.key === 'ArrowRight' && props.canForward) props.onForward()
          if (e.key === 'ArrowUp') props.onUp()
        } else if (!typing && inList && selected && !many && e.key === 'F2' && props.onRename) {
          e.preventDefault()
          e.stopPropagation()
          props.onRename(selected)
        } else if (
          !typing &&
          inList &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          ['c', 'x', 'v'].includes(e.key.toLowerCase())
        ) {
          e.preventDefault()
          e.stopPropagation()
          const key = e.key.toLowerCase()
          // Inside a zip, Cut and Paste are inert (#300): nothing leaves a
          // container by a cut, and a paste into one is not a route yet.
          if (archive && key !== 'c') return
          if (key === 'v') props.onPaste?.(props.directory)
          else if (many && props.onCopyPaths) props.onCopyPaths(markedPaths(), key === 'x')
          else if (selected && key === 'x') props.onCut?.(selected)
          else if (selected) props.onCopy?.(selected)
        }
      }}
    >
      <BrowseToolbar
        {...props}
        // The address commits at once; the rows follow when they answer.
        directory={props.pendingPath ?? props.directory}
        archiveChain={props.pendingPath ? undefined : props.listing ? (props.listing.archive?.chain ?? []) : undefined}
        // The preview toggle sits at the end of the row nearest the pane it
        // opens (#304): after the address with the pane on the right, before
        // the history buttons with it on the left.
        leading={right ? previewToggle : undefined}
        trailing={
          <>
            {props.terminalControls && (
              <div className="browse-terminal-controls">{props.terminalControls}</div>
            )}
            {!right && previewToggle}
            <button
              className="browse-icon-button browse-search-button"
              aria-label="Search this folder and subfolders"
              aria-haspopup="dialog"
              title="Search (Ctrl+F)"
              data-testid="browse-search-button"
              // Marks that the list shows a search. A mark for tests and
              // nothing else: the button wears no accent in any state (#308;
              // owner, 2026-10-06: "search is more minor and i dont think it
              // needs to be colored since you just see a search box when its
              // clicked").
              data-active={!!props.query.trim() || undefined}
              onClick={openSearch}
            >
              <BrowseIcon name="search" />
            </button>
          </>
        }
      />
      {searchOpen && (
        <BrowseSearchPopup
          tabId={props.owner}
          directory={props.directory}
          initialQuery={props.query}
          onClose={() => closeSearch()}
          onPick={(hit) => {
            closeSearch(false)
            focusList()
            if (hit.isFolder) props.onNavigate(hit.path)
            else if (hit.file) props.onOpen(hit.file)
          }}
          onShowAll={(query) => {
            closeSearch(false)
            focusList()
            props.onQueryChange(query)
          }}
        />
      )}
      {!right && places}
      <BrowseList
        {...props}
        loading={props.pending !== 'none'}
        entries={props.pending === 'slow' ? [] : entries}
        onFolderHover={archive ? undefined : hoverFolder}
        archive={archive}
        onEmptyContextMenu={archive ? props.onEmptyContextMenu : undefined}
        strip={
          archive && props.onArchiveExtract ? (
            <ArchiveStrip
              meta={archive}
              done={!!props.archiveDone}
              onExtractHere={() => props.onArchiveExtract?.(archive, true)}
              onExtractTo={() => props.onArchiveExtract?.(archive, false)}
            />
          ) : undefined
        }
        indexedRows={indexedRows}
        dividers={props.pending === 'slow' ? undefined : dividers}
        total={total}
        onActivate={activate}
        onSelect={pickOne}
        marked={marked}
        onPick={pick}
        onSweep={swept}
        onExtend={extendTo}
        onToggleMark={(path) => pickPath(path, { ctrl: true, shift: false })}
        onSelectAll={selectAll}
        onClear={clearMarks}
        // A right press inside several marked rows is a menu for all of them:
        // the marks stay lit, so a menu for the one row under the pointer
        // would delete one file while four looked chosen (review of #257).
        onContextMenu={
          props.onContextMenu &&
          ((e, entry, source) =>
            props.onContextMenu?.(
              e,
              entry,
              source,
              many && marked?.has(entry.path) ? markedPaths() : undefined
            ))
        }
        message={message}
        onVisibleFolders={onVisibleFolders}
      />
      {right && places}
      {props.previewVisible && (
        <aside className="browse-preview-slot" aria-label="File preview">
          {props.preview}
        </aside>
      )}
      <div className="browse-status" role="status">
        <span>
          {props.pending === 'slow'
            ? 'Reading folder'
            : props.pending === 'quiet' && !props.listing
              ? ''
              : `${total} ${total === 1 ? 'item' : 'items'}`}
        </span>
        {many ? (
          <span>
            {markedEntries.length} selected
            {/* A total only when every size is known: a file whose size has
                not arrived yet is unknown, not 0 bytes (#271). */}
            {markedEntries.some((entry) => entry.file) &&
            markedEntries.every((entry) => !entry.file || entry.file.size !== undefined)
              ? ` · ${formatBytes(markedEntries.reduce((sum, entry) => sum + (entry.file?.size ?? 0), 0))}`
              : ''}
          </span>
        ) : (
          selected && (
            <span>
              1 selected
              {selected.file?.size !== undefined ? ` · ${formatBytes(selected.file.size)}` : ''}
            </span>
          )
        )}
        {archive && <span data-archive-status>In {archive.display}</span>}
        {props.listing?.archiveError && !props.listing.unreadable && (
          <span role="status">{props.listing.archiveError.message}</span>
        )}
        {!!props.query.trim() && (
          <BrowseSearchStatus
            state={props.searchState}
            onCancel={props.onCancelSearch}
            onClear={() => {
              focusList()
              props.onQueryChange('')
            }}
          />
        )}
      </div>
    </div>
  )
}
