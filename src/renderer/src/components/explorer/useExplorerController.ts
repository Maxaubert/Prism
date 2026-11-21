import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { OpenWithApp, ViewerFile } from '@shared/types'
import type { BrowseDriveUsage } from '@shared/browse'
import { baseName } from '@shared/path'
import type { Tab, TabState } from '../../lib/tabs/tabs'
import { browseParent } from '../../lib/browse'
import { fileClipboardReady, copyFilePaths } from '../../lib/fileClipboard'
import { clipboardText } from '../../lib/clipboardText'
import { pinQuickAccess, useQuickAccess } from '../../lib/quickAccess'
import { emptyUndo, remember, type UndoEntry, type UndoState } from '../../lib/undo'
import { say } from '../../lib/say'
import type { Ask } from '../../dialogs/asks'
import { useBinOps, type BinRowInfo } from '../../hooks/useBinOps'
import { useFileOps } from '../../hooks/useFileOps'
import type { useFolderBrowsing } from '../../hooks/useFolderBrowsing'
import type { BrowseEntry } from '../browse/FolderBrowser'
import { useArchiveActions } from '../browse/useArchiveActions'

// The Explorer's own state and jobs (audit #8 and #12, 2026-11-21), out of
// App.tsx and moved unchanged: its context menu, the inline rename, the
// properties dialog, the Recycle Bin and archive actions, the quick access and
// the places, and the file jobs (rename, move, delete, undo). A hook, not a
// component, so the render tree stays the one the e2e and the CSS select by.
// ExplorerHost draws the surface and ExplorerMenus its menus and dialogs.

export interface BrowseMenuState {
  x: number
  y: number
  entry: BrowseEntry
  /** Several marked rows, when the press was on one of them (#257). */
  paths?: string[]
  /** Which of `paths` are folders, from the rows (search rows included). */
  folders?: string[]
  canPaste?: boolean
  apps?: OpenWithApp[] | null
}

export interface ExplorerControllerDeps {
  active: Tab | null
  browsing: ReturnType<typeof useFolderBrowsing>
  file: ViewerFile | null
  view: { files: ViewerFile[]; index: number } | null
  fullscreen: boolean
  tabs: Tab[]
  setTabState: Dispatch<SetStateAction<TabState>>
  showNothing: () => void
  setAsk: Dispatch<SetStateAction<Ask | null>>
  setRefreshKey: Dispatch<SetStateAction<number>>
  openInNewTab: (path: string, knownFolder?: boolean, reuse?: boolean) => void
  openBrowseFile: (
    file: string | ViewerFile,
    full?: boolean,
    play?: boolean,
    judged?: string | null,
    keep?: boolean
  ) => Promise<boolean | undefined>
  rekeyBuffer: (from: string, to: string) => void
  dropBuffers: (paths: readonly string[]) => void
  buffers: RefObject<Map<string, { path: string; text: string }>>
}

export function useExplorerController({
  active,
  browsing,
  file,
  view,
  fullscreen,
  tabs,
  setTabState,
  showNothing,
  setAsk,
  setRefreshKey,
  openInNewTab,
  openBrowseFile,
  rekeyBuffer,
  dropBuffers,
  buffers
}: ExplorerControllerDeps) {
  const [browseMenu, setBrowseMenu] = useState<BrowseMenuState | null>(null)
  const browseMenuPath = browseMenu?.entry.path
  const browseMenuFolder = browseMenu?.entry.isFolder
  // A row of the Recycle Bin asks Windows nothing: no paste state, no "open
  // with" apps for a path that is Windows' own bin entry (Recycle Bin, D12).
  const inBinList = browsing.listing?.bin === true
  /** The bin's rows as the jobs need them: entry path, ORIGINAL name, origin
   *  folder. Empty unless the bin is what the list shows. */
  const binListing = browsing.listing
  const binRowsOf = useCallback((): BinRowInfo[] => {
    if (!binListing?.bin) return []
    return [...binListing.folders, ...binListing.files].map((row) => ({
      path: row.path,
      name: row.name,
      from: row.binned?.from,
      size: row.size
    }))
  }, [binListing])
  useEffect(() => {
    if (!browseMenuPath || inBinList) return
    let cancelled = false
    void fileClipboardReady()
      .then(() => window.prism.clipboardHasFiles())
      .then((canPaste) => {
        if (!cancelled) setBrowseMenu((menu) => menu ? { ...menu, canPaste } : null)
      })
      .catch(() => {})
    if (!browseMenuFolder) {
      void window.prism.appsFor(browseMenuPath)
        .catch(() => [])
        .then((apps) => {
          if (!cancelled) setBrowseMenu((menu) => menu ? { ...menu, apps } : null)
        })
    }
    return () => { cancelled = true }
  }, [browseMenuPath, browseMenuFolder, browseMenu?.x, browseMenu?.y, inBinList])
  const [browseRename, setBrowseRename] = useState<BrowseEntry | null>(null)
  // The folder Ctrl+Shift+N just made and is asking the name of: its dialog
  // says New folder, not Rename (owner, 2026-11-10). Any other entry is F2's.
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null)
  const [browseProps, setBrowseProps] = useState<(BrowseEntry & { drive?: BrowseDriveUsage }) | null>(null)
  const quickAccessDefaults = useMemo(
    () =>
      browsing.locations
        .filter((location) => location.group === 'quick')
        .map((location) => ({
          path: location.path,
          label: location.name,
          isFolder: true
        })),
    [browsing.locations]
  )
  const quickAccess = useQuickAccess(quickAccessDefaults)
  // The phone's drawer lists the same pinned folders (2026-10-14); main keeps
  // what was last sent and never reads this window's storage itself.
  useEffect(() => {
    window.prism.phonePins(quickAccess.filter((p) => p.isFolder).map((p) => ({ name: p.label, path: p.path })))
  }, [quickAccess])
  const pinQuickAccessPaths = useCallback(
    async (paths: string[], beforePath?: string) => {
      if (!active) return
      const pins = await Promise.all(
        paths.map(async (path) => {
          const parent = browseParent(path) ?? path
          await window.prism.browseDirectory(active.id, parent, { details: false }).catch(() => null)
          const stat = await window.prism.statFile(path).catch(() => null)
          return stat
            ? {
                path,
                label: baseName(path),
                isFolder: stat.isFolder
              }
            : null
        })
      )
      pinQuickAccess(
        pins.filter((pin): pin is NonNullable<typeof pin> => pin !== null),
        beforePath
      )
      if (pins.some((pin) => pin === null))
        setAsk({
          kind: 'failed',
          op: 'pin',
          message:
            'Some items could not be pinned. Check that they still exist and are accessible, then try again.'
        })
    },
    [active, setAsk]
  )
  const browsePlaces = useMemo(
    () => [
      ...browsing.locations.map((location) => ({
        path: location.path,
        label: location.name,
        group: location.group === 'drive' ? ('This PC' as const) : ('Quick access' as const),
        known: location.known
      }))
    ],
    [browsing.locations]
  )

  /* Undo and redo (2026-08-22), for the things Prism WRITES: moving,
     renaming, binning and duplicating. The text editor keeps its own Ctrl+Z
     inside a focused document; this stack only sees the file operations. */
  const [undoState, setUndoState] = useState<UndoState>(emptyUndo)
  // Undo is otherwise invisible when the change is off screen, so it says what
  // it did for a moment. Deliberately not a dialog: nothing to answer.
  const flashUndo = useCallback((text: string): void => say(text, { op: 'undo' }), [])
  const noteUndo = useCallback((entry: UndoEntry) => setUndoState((u) => remember(u, entry)), [])
  /** What a place inside an archive does (#300): its menus, keys and drops. */
  /** The Explorer's list is on screen, so a rename happens in its row (#523). */
  const browseListShown = !!(browsing.folder && active && browsing.location && !fullscreen)
  const archiveActions = useArchiveActions({
    navigate: (path) => void browsing.navigate(path),
    openNewTab: (path, isFolder) => openInNewTab(path, isFolder),
    openMember: (file) => void browsing.openFile(file),
    refresh: () => setRefreshKey((key) => key + 1),
    noteUndo,
    outside: {
      copy: (entry) => void copyFilePaths([entry.path]),
      rename: (entry) => setBrowseRename(entry),
      remove: (entry) =>
        setAsk({ kind: 'delete', path: entry.path, name: entry.name, isFolder: entry.isFolder }),
      properties: (entry) => setBrowseProps(entry),
      show: (path) => window.prism.showInExplorer(path),
      copyPath: (path) => void clipboardText(path)
    }
  })
  // A rename never outlives the place it began in (#523): the field lives in a
  // row, and another folder or tab has no such row. Adjusted during render.
  const renamePlace = active ? `${active.id}|${active.browse.path}` : ''
  const [renamePlaceSeen, setRenamePlaceSeen] = useState(renamePlace)
  if (renamePlaceSeen !== renamePlace) {
    setRenamePlaceSeen(renamePlace)
    setBrowseRename(null)
    setNewFolderPath(null)
    archiveActions.cancelRename()
  }
  /** The Recycle Bin's Restore, Delete permanently and Empty (Recycle Bin,
   *  D13 to D18): jobs of their own, asked about before they destroy. */
  const binOps = useBinOps({
    setAsk,
    setRefreshKey,
    noteUndo,
    rows: binRowsOf
  })
  /** The list's empty space inside an archive was right-clicked (#300). */
  const [emptyMenu, setEmptyMenu] = useState<{ x: number; y: number } | null>(null)
  const browseArchive = browsing.listing?.archive ?? null

  // Renaming, new folders, deleting, moving, the drops that move, and undo
  // and redo over them (hooks/useFileOps; the inverse table is lib/undoApply).
  const fileOps = useFileOps({
    active,
    openBrowseFile,
    setAsk,
    setRefreshKey,
    rekeyBuffer,
    setUndoState,
    file,
    noteUndo,
    setTabState,
    dropBuffers,
    view,
    showNothing,
    tabs,
    buffers,
    undoState,
    flashUndo,
    archiveActions
  })
  /** The inline rename ends (#523): the name is already trimmed and new. */
  const submitBrowseRename = (name: string): void => {
    const entry = browseRename
    if (!entry) return
    const wasNew = entry.path === newFolderPath
    void fileOps.runRename(entry.path, name, 'ask').then((to) => {
      // The folder keeps the selection under its new name, so the
      // keyboard ends on it (owner, 2026-11-10). Quiet: a mark, not a pick.
      if (wasNew && to) browsing.select(to, true)
    })
    setNewFolderPath(null)
    setBrowseRename(null)
  }
  const cancelBrowseRename = (): void => {
    setNewFolderPath(null)
    setBrowseRename(null)
  }

  return {
    fileOps,
    archiveActions,
    binOps,
    quickAccess,
    pinQuickAccessPaths,
    browsePlaces,
    noteUndo,
    inBinList,
    browseArchive,
    browseListShown,
    browseMenu,
    setBrowseMenu,
    browseRename,
    setBrowseRename,
    setNewFolderPath,
    submitBrowseRename,
    cancelBrowseRename,
    browseProps,
    setBrowseProps,
    emptyMenu,
    setEmptyMenu
  }
}

export type ExplorerController = ReturnType<typeof useExplorerController>
