import type { Dispatch, JSX, SetStateAction } from 'react'
import type { Tab } from '../../lib/tabs/tabs'
import { binnedPath } from '../../lib/binView'
import { copyFilePaths } from '../../lib/fileClipboard'
import { clipboardText } from '../../lib/clipboardText'
import { saveCopiesJob } from '../../lib/saveCopies'
import { explorerZoom, setExplorerZoom } from '../../lib/explorerZoom'
import { pinQuickAccess, sameQuickAccessPath, unpinQuickAccess } from '../../lib/quickAccess'
import { explorerRowMenu } from '../../menus/explorerRow'
import { binEmptySpaceMenu, binRowMenu } from '../../menus/binRow'
import { zoomBlankMenu } from '../../menus/zoomMenu'
import type { useFolderBrowsing } from '../../hooks/useFolderBrowsing'
import type { useFilePaste } from '../../hooks/useFilePaste'
import type { Ask } from '../../dialogs/asks'
import { ContextMenu } from '../ContextMenu'
import { BrowseRename } from '../browse/BrowseRename'
import { PropertiesDialog } from '../properties/PropertiesDialog'
import type { ExplorerController } from './useExplorerController'

// The Explorer's four context menus, its archive dialogs, the properties
// dialog and the inline rename for a file in full view (audit #8 and #12,
// 2026-11-21), moved out of App.tsx unchanged. A fragment, so the siblings
// and their order in the window's tree are what they were.

export interface ExplorerMenusProps {
  explorer: ExplorerController
  browsing: ReturnType<typeof useFolderBrowsing>
  active: Tab | null
  pasteFiles: ReturnType<typeof useFilePaste>
  openInNewTab: (path: string, knownFolder?: boolean, reuse?: boolean) => void
  setAsk: Dispatch<SetStateAction<Ask | null>>
  changeFolderIcon: (paths: string[], name: string) => void
}

export function ExplorerMenus({
  explorer,
  browsing,
  active,
  pasteFiles,
  openInNewTab,
  setAsk,
  changeFolderIcon
}: ExplorerMenusProps): JSX.Element {
  const {
    fileOps,
    archiveActions,
    binOps,
    quickAccess,
    inBinList,
    browseArchive,
    browseListShown,
    browseMenu,
    setBrowseMenu,
    browseRename,
    setBrowseRename,
    submitBrowseRename,
    cancelBrowseRename,
    browseProps,
    setBrowseProps,
    emptyMenu,
    setEmptyMenu
  } = explorer
  const openBrowseSplit = browsing.openSplit
  return (
    <>
      {browseMenu && (
        <ContextMenu
          x={browseMenu.x}
          y={browseMenu.y}
          onClose={() => setBrowseMenu(null)}
          items={(inBinList
            ? binRowMenu({
                entry: browseMenu.entry,
                paths: browseMenu.paths,
                openFile: (f) => void browsing.openDeliberately(f),
                showInPreview: (f) => openBrowseSplit(f),
                restore: binOps.restore,
                askDelete: binOps.askDelete,
                copyOriginalPaths: (paths) => {
                  // The ORIGINAL full paths, one per line (D16), from the listing's rows.
                  const rows = [...(browsing.listing?.folders ?? []), ...(browsing.listing?.files ?? [])]
                  const lines = paths.map((p) => {
                    const row = rows.find((r) => r.path === p)
                    return row?.binned ? binnedPath(row.binned.from, row.name) : p
                  })
                  void clipboardText(lines.join('\n'))
                }
              })
            : null) ?? archiveActions.menu(
            {
              entry: browseMenu.entry,
              paths: browseMenu.paths,
              folders: new Set(browsing.listing?.folders.map((f) => f.path) ?? [])
            },
            browseArchive,
            active?.browse.path ?? ''
          ) ??
            explorerRowMenu({
              entry: browseMenu.entry,
              paths: browseMenu.paths,
              canPaste: browseMenu.canPaste,
              apps: browseMenu.apps,
              pinned: quickAccess.some((pin) => sameQuickAccessPath(pin.path, browseMenu.entry.path)),
              openFolder: (path) => void browsing.navigate(path),
              openFile: (file) => void browsing.openDeliberately(file),
              showInPreview: (path) => openBrowseSplit(path),
              openInNewTab,
              copyFiles: (paths, cut) => void copyFilePaths(paths, cut),
              paste: (directory) => void pasteFiles(directory),
              pinQuickAccess,
              unpinQuickAccess,
              duplicate: (path) => void fileOps.runDuplicate(path),
              rename: (entry) => setBrowseRename(entry),
              askDelete: (entry) =>
                setAsk({ kind: 'delete', path: entry.path, name: entry.name, isFolder: entry.isFolder }),
              askDeleteMany: (paths) => setAsk({ kind: 'delete-many', paths }),
              properties: (entry) => setBrowseProps(entry),
              changeIcon: (paths) =>
                changeFolderIcon(paths, paths.length === 1 ? browseMenu.entry.name : `${paths.length} folders`),
              // The marked rows say which are folders (search results are
              // not in the folder's listing: review of the folder icons).
              isFolder: (() => {
                const folders = new Set(
                  (browseMenu.folders ?? browsing.listing?.folders.map((f) => f.path) ?? []).map((p) =>
                    p.toLowerCase()
                  )
                )
                return (path: string) => folders.has(path.toLowerCase())
              })(),
              // Save copies as (#474): one job on the chip, the copies marked.
              saveCopies: (paths, format) => void saveCopiesJob(paths, format)
            })}
        />
      )}
      {emptyMenu && browseArchive && active && (
        <ContextMenu
          x={emptyMenu.x}
          y={emptyMenu.y}
          onClose={() => setEmptyMenu(null)}
          items={archiveActions.menu({ entry: null }, browseArchive, active.browse.path) ?? []}
        />
      )}
      {emptyMenu && inBinList && active && (
        // The Recycle Bin's blank space: Empty Recycle Bin, and nothing that writes.
        <ContextMenu
          x={emptyMenu.x}
          y={emptyMenu.y}
          onClose={() => setEmptyMenu(null)}
          items={binEmptySpaceMenu({
            count: (browsing.listing?.folders.length ?? 0) + (browsing.listing?.files.length ?? 0),
            onEmpty: binOps.askEmpty
          })}
        />
      )}
      {emptyMenu && !inBinList && !browseArchive && active && (
        // A plain folder's blank space: Show as grid / Show as list (Stage 6).
        <ContextMenu
          x={emptyMenu.x}
          y={emptyMenu.y}
          onClose={() => setEmptyMenu(null)}
          items={zoomBlankMenu({ step: explorerZoom(), setStep: setExplorerZoom })}
        />
      )}
      {archiveActions.dialogs}
      {browseProps && active && (
        <PropertiesDialog
          root={active.browse.path}
          path={browseProps.path}
          name={browseProps.name}
          kind={browseProps.file?.kind ?? 'other'}
          isFolder={browseProps.isFolder}
          drive={browseProps.drive}
          onOpenFolder={(path) => {
            setBrowseProps(null)
            void browsing.navigate(path)
          }}
          onClose={() => setBrowseProps(null)}
        />
      )}
      {browseRename && !browseListShown && (
        // Only a file open full view, where no row is on screen to hold the field.
        <BrowseRename name={browseRename.name} onCancel={cancelBrowseRename} onSave={submitBrowseRename} />
      )}
    </>
  )
}
