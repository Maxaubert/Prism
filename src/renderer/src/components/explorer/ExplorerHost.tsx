import type { Dispatch, JSX, SetStateAction } from 'react'
import { crumb } from 'prism-term-core/renderer/lib/diag'
import type { ViewerFile } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { baseName, extOf } from '@shared/path'
import type { Tab } from '../../lib/tabs/tabs'
import { browseParent } from '../../lib/browse'
import { copyFilePaths } from '../../lib/fileClipboard'
import { clipboardText } from '../../lib/clipboardText'
import { moveQuickAccess, unpinQuickAccess } from '../../lib/quickAccess'
import type { useFolderBrowsing } from '../../hooks/useFolderBrowsing'
import type { useFilePaste } from '../../hooks/useFilePaste'
import type { AppPreviews } from '../../hooks/useAppPreviews'
import type { useSidebarPeek } from '../../hooks/useSidebarPeek'
import type { Ask } from '../../dialogs/asks'
import { FolderBrowser } from '../browse/FolderBrowser'
import type { ExplorerController } from './useExplorerController'

// The Explorer's surface in the window (audit #8 and #12, 2026-11-21): the
// folder browser with every callback it is handed, moved out of App.tsx
// unchanged. It renders the same `browse-surface-host` box App always drew, so
// the DOM is the one the e2e and the CSS select by. State and jobs live in
// useExplorerController.

export interface ExplorerHostProps {
  explorer: ExplorerController
  browsing: ReturnType<typeof useFolderBrowsing>
  /** The folder browsing's location, already known to exist by the caller. */
  location: NonNullable<ReturnType<typeof useFolderBrowsing>['location']>
  active: Tab
  previews: AppPreviews
  pasteFiles: ReturnType<typeof useFilePaste>
  openInNewTab: (path: string, knownFolder?: boolean, reuse?: boolean) => void
  openBrowseFile: (
    file: string | ViewerFile,
    full?: boolean,
    play?: boolean,
    judged?: string | null,
    keep?: boolean
  ) => Promise<boolean | undefined>
  setAsk: Dispatch<SetStateAction<Ask | null>>
  setRefreshKey: Dispatch<SetStateAction<number>>
  changeFolderIcon: (paths: string[], name: string) => void
  placesVisible: boolean
  panelSliding: boolean
  peekPhase: ReturnType<typeof useSidebarPeek>['phase']
  explorerSide: 'left' | 'right'
  onPinPlaces: () => void
  onPlacePicked: () => void
  /** A question, the update window, Settings or the setup is over the Explorer. */
  covered: boolean
}

export function ExplorerHost({
  explorer,
  browsing,
  location,
  active,
  previews,
  pasteFiles,
  openInNewTab,
  openBrowseFile,
  setAsk,
  setRefreshKey,
  changeFolderIcon,
  placesVisible,
  panelSliding,
  peekPhase,
  explorerSide,
  onPinPlaces,
  onPlacePicked,
  covered
}: ExplorerHostProps): JSX.Element {
  const {
    fileOps,
    archiveActions,
    binOps,
    quickAccess,
    pinQuickAccessPaths,
    browsePlaces,
    browseArchive,
    browseRename,
    setBrowseRename,
    setNewFolderPath,
    submitBrowseRename,
    cancelBrowseRename,
    setBrowseProps,
    setBrowseMenu,
    setEmptyMenu
  } = explorer
  const { previewSlide, explorerWidths, windowShown, closePreviewWindow, togglePreview } = previews
  return (
    <div className="browse-surface-host absolute inset-0">
      <FolderBrowser
        directory={active.browse.path}
        onDropInto={fileOps.onBrowseDropInto}
        listing={browsing.listing}
        pending={browsing.pending}
        pendingPath={browsing.pendingPath}
        error={browsing.error}
        places={browsePlaces}
        quickAccess={quickAccess}
        readDrives={window.prism.browseDrives}
        // Only the double-click and Enter say `full`: one click on a pin
        // is a look, and a look never starts a program (#494). A file
        // Prism cannot show is looked at in its row, so the second
        // click of a double-click still finds the pin there.
        onQuickAccessFile={(path, full) => {
          if (full) void browsing.openDeliberately(path)
          else void openBrowseFile(path, !active.browse.preview && fileKind(extOf(path), baseName(path)) !== 'other')
        }}
        onUnpinQuickAccess={unpinQuickAccess}
        onMoveQuickAccess={moveQuickAccess}
        onPinQuickAccessPaths={(paths, beforePath) =>
          void pinQuickAccessPaths(paths, beforePath)
        }
        onChangeFolderIcon={changeFolderIcon}
        placesVisible={placesVisible}
        placesSliding={panelSliding}
        placesPeek={peekPhase}
        side={explorerSide}
        onPinPlaces={onPinPlaces}
        onPlacePicked={onPlacePicked}
        onOpenNewTab={openInNewTab}
        searchState={browsing.searchState}
        onSearchRange={browsing.searchRange}
        onCancelSearch={browsing.cancelSearch}
        owner={active.id}
        selectedPath={location.selected}
        scrollTop={location.scrollTop}
        query={location.query}
        sort={browsing.sort}
        downloads={browsing.downloads}
        weekStart={browsing.weekStart}
        canBack={active.browse.cursor > 0}
        canForward={active.browse.cursor < active.browse.history.length - 1}
        onNavigate={(path, typed) => void browsing.navigate(path, undefined, typed)}
        onBack={() => browsing.travel(-1)}
        onForward={() => browsing.travel(1)}
        onUp={() => {
          const parent = browseParent(active.browse.path)
          if (parent) void browsing.navigate(parent)
        }}
        onSelect={browsing.select}
        onOpen={(file) => void browsing.openDeliberately(file)}
        onScroll={browsing.keepScroll}
        onQueryChange={browsing.searchFor}
        // A header click is a pick made here (#285): Downloads keeps it.
        onSortChange={(sort) => {
          crumb('sort', { key: sort.key, direction: sort.direction })
          browsing.patch({ sort, sortChosen: true, scrollTop: 0 })
        }}
        onCopy={(entry) =>
          browseArchive
            ? archiveActions.copy([entry.path], browseArchive, new Set(entry.isFolder ? [entry.path] : []))
            : void copyFilePaths([entry.path])
        }
        onCut={(entry) => void copyFilePaths([entry.path], true)}
        onCopyPaths={(paths, cut) =>
          browseArchive
            ? archiveActions.copy(
                paths,
                browseArchive,
                new Set(browsing.listing?.folders.map((f) => f.path) ?? [])
              )
            : void copyFilePaths(paths, cut)
        }
        onDeleteMany={(paths) =>
          browseArchive
            ? archiveActions.remove(paths, browseArchive)
            : setAsk({ kind: 'delete-many', paths })
        }
        onPaste={(directory) => void pasteFiles(directory)}
        // Ctrl+Shift+N (#330): made, marked quietly, then renamed in
        // the same dialog F2 opens. Never inside a zip (FolderBrowser
        // does not offer it there, and main refuses it).
        onNewFolder={(directory) =>
          void fileOps.makeNewFolder(directory).then((made) => {
            if (!made) return
            setRefreshKey((key) => key + 1)
            browsing.select(made, true)
            setNewFolderPath(made)
            setBrowseRename({ path: made, name: baseName(made), isFolder: true })
          })
        }
        onProperties={(entry, drive) => setBrowseProps(drive ? { ...entry, drive } : entry)}
        // Ctrl+Shift+C (#330): the paths as text, the menu's Copy path.
        onCopyPathText={(paths) => void clipboardText(paths.join('\n'))}
        // Inside an archive F2 renames a FILE of a writable zip and
        // Delete is the permanent question; both are inert elsewhere
        // there (#300).
        onRename={(entry) =>
          browseArchive ? archiveActions.rename(entry, browseArchive) : setBrowseRename(entry)
        }
        // The row or tile being renamed holds the field itself (#523, owner
        // 2026-11-19: inline everywhere, a zip's member too).
        renamingPath={browseArchive ? archiveActions.renamingPath : (browseRename?.path ?? null)}
        onRenameSubmit={(name) =>
          browseArchive ? archiveActions.commitRename(name) : submitBrowseRename(name)
        }
        onRenameCancel={() =>
          browseArchive ? archiveActions.cancelRename() : cancelBrowseRename()
        }
        onDelete={(entry) =>
          browseArchive
            ? archiveActions.remove([entry.path], browseArchive)
            : setAsk({
                kind: 'delete',
                path: entry.path,
                name: entry.name,
                isFolder: entry.isFolder
              })
        }
        onArchiveExtract={(meta, here) =>
          archiveActions.extractWhole(meta, here, [
            ...(browsing.listing?.folders.map((f) => f.path) ?? []),
            ...(browsing.listing?.files.map((f) => f.path) ?? [])
          ])
        }
        archiveDone={archiveActions.done}
        onEmptyContextMenu={(event) => setEmptyMenu({ x: event.clientX, y: event.clientY })}
        // The Recycle Bin's strip, keys and sidebar row (Recycle Bin,
        // D13 to D15 and D19): each asks before it destroys.
        onBinRestore={binOps.restore}
        onBinDelete={binOps.askDelete}
        onEmptyBin={binOps.askEmpty}
        onBinEmptyContextMenu={(event) => setEmptyMenu({ x: event.clientX, y: event.clientY })}
        onRefresh={() => {
          void window.prism
            .refreshFolderSizes(active.browse.path)
            .catch(() => {})
            .finally(() => {
              setRefreshKey((key) => key + 1)
            })
        }}
        onContextMenu={(event, entry, _source, paths, folders) =>
          setBrowseMenu({ x: event.clientX, y: event.clientY, entry, paths, folders })
        }
        previewEnabled={active.browse.preview}
        previewVisible={previewSlide.out}
        listSlideWidth={previewSlide.sliding ? explorerWidths.listWidth : undefined}
        previewWindowOpen={windowShown}
        onPreviewWindowClose={closePreviewWindow}
        onPreviewToggle={togglePreview}
        covered={covered}
      />
    </div>
  )
}
