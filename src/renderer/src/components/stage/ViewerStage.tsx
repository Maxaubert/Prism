import { Suspense, lazy, type Dispatch, type JSX, type SetStateAction } from 'react'
import type { ViewerFile } from '@shared/types'
import { isExplorerTab, type Tab } from '../../lib/tabs/tabs'
import type { deckOf } from '../../lib/mediaDeck'
import type { TransportStyle } from '../../lib/transport'
import type { StepDir } from '../../lib/slideshow'
import type { UndoEntry } from '../../lib/undo'
import type { useWarmViewers } from '../../hooks/useWarmViewers'
import type { useTextBuffers } from '../../hooks/useTextBuffers'
import type { useTabOps } from '../../hooks/useTabOps'
import type { FileOps } from '../../hooks/useFileOps'
import type { ExplorerController } from '../explorer/useExplorerController'
import { EditorLoading, Viewer } from './Viewer'
import { EmptyState, NoFileState } from './EmptyState'
import { PreviewEmpty } from '../browse/PreviewEmpty'
import { PreviewWindow } from '../previewWindow/PreviewWindow'
// The code editor for markdown's pencil, split out like every viewer chunk
// (ViewerSwitch): CodeMirror is ~770KB and not on the path of a photo.
const CodeView = lazy(() => import('../CodeView').then((m) => ({ default: m.CodeView })))

// What the viewer box holds (audit #8, 2026-11-21), moved out of App.tsx
// unchanged: every tab's own player, the warm viewers, the markdown editor,
// the empty states and the preview window. A fragment, so the box's children
// and their order are what they were.

export interface ViewerStageProps {
  tabs: Tab[]
  activeId: string | null
  active: Tab | null
  file: ViewerFile | null
  deck: ReturnType<typeof deckOf>['entries']
  warm: ReturnType<typeof useWarmViewers>
  restoring: boolean
  /** The Explorer's list is what the window shows (a folder, not a file). */
  browsingFolder: boolean
  showBrowsePreview: boolean
  previewWindowUp: boolean
  previewWindowGen: number
  windowShown: boolean
  closePreviewWindow: () => void
  go: (delta: number) => void
  editMode: boolean
  setEditMode: Dispatch<SetStateAction<boolean>>
  docVersion: number
  setDocVersion: Dispatch<SetStateAction<number>>
  refreshKey: number
  fullscreen: boolean
  toggleFullscreen: () => void
  transportStyle: TransportStyle
  transportBg: number
  noteUndo: (entry: UndoEntry) => void
  runRename: FileOps['runRename']
  openLocal: (path: string) => void
  openArchive: (path: string) => void
  openArchiveMember: (member: string, zip: ViewerFile) => void
  advanceSameKind: () => void
  stepSameKind: (dir: StepDir) => void
  sameKindIndex: (dir: 1 | -1) => number
  onBuffer: ReturnType<typeof useTextBuffers>['onBuffer']
  getPending: ReturnType<typeof useTextBuffers>['getPending']
  onExternalChange: (path: string) => void
  reloadAnswer: { path: string; reload: boolean } | null
  archiveActions: ExplorerController['archiveActions']
  onBrowseDropInto: FileOps['onBrowseDropInto']
  newTab: ReturnType<typeof useTabOps>['newTab']
  openFolderTab: ReturnType<typeof useTabOps>['openFolderTab']
}

export function ViewerStage(p: ViewerStageProps): JSX.Element {
  const {
    tabs,
    activeId,
    active,
    file,
    deck,
    warm,
    restoring,
    browsingFolder,
    showBrowsePreview,
    previewWindowUp,
    previewWindowGen,
    windowShown,
    closePreviewWindow,
    go,
    editMode,
    setEditMode,
    docVersion,
    setDocVersion,
    refreshKey,
    fullscreen,
    toggleFullscreen,
    transportStyle,
    transportBg,
    noteUndo,
    runRename,
    openLocal,
    openArchive,
    openArchiveMember,
    advanceSameKind,
    stepSameKind,
    sameKindIndex,
    onBuffer,
    getPending,
    onExternalChange,
    reloadAnswer,
    archiveActions,
    onBrowseDropInto,
    newTab,
    openFolderTab
  } = p
  // The tabs' own players, all of them mounted, only one on screen.
  // Absolutely placed so the hidden ones take no room and the
  // visible one fills the pane exactly as a viewer always did.
  // A background tab answers nothing: no paging, no stepping.
  const noop = (): void => {}
  const filmShut = (tabId: string): boolean => {
    if (tabId === activeId) return browsingFolder && !showBrowsePreview
    const t = tabs.find((x) => x.id === tabId)
    return !!t && isExplorerTab(t) && t.browse.surface === 'folder' && !t.browse.preview
  }
  // In window mode the front tab's player and view are drawn in
  // the preview window, the others stay here, mounted and hidden.
  const inWindow = (tabId: string): boolean => previewWindowUp && tabId === activeId
  const players = deck.map((e) => (
    <div
      key={e.tabId}
      data-player-tab={e.tabId}
      inert={e.tabId !== activeId || (browsingFolder && !showBrowsePreview)}
      aria-hidden={e.tabId === activeId ? undefined : true}
      className={
        e.tabId === activeId
          ? 'absolute inset-0'
          : 'pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0'
      }
    >
      <Viewer
        file={e.file}
        background={e.tabId !== activeId || (browsingFolder && !showBrowsePreview)}
        volumeKey={e.tabId}
        onUndoable={noteUndo}
        onRenameSelf={(name) => void runRename(e.file.path, name, 'ask')}
        refreshKey={refreshKey}
        onToggleFullscreen={inWindow(e.tabId) ? noop : toggleFullscreen}
        fullscreen={fullscreen}
        transportStyle={transportStyle}
        transportBg={transportBg}
        onOpenLocal={openLocal}
        // A tab you are not looking at does not choose what plays
        // next: autoplay and the menu's Next belong to the front.
        onAutoAdvance={e.tabId === activeId ? advanceSameKind : () => {}}
        onStep={e.tabId === activeId ? stepSameKind : () => {}}
        canStep={(dir) => (e.tabId === activeId ? sameKindIndex(dir) >= 0 : false)}
        onBuffer={onBuffer}
        getPending={getPending}
        onExternalChange={onExternalChange}
        reloadAnswer={reloadAnswer}
        onOpenArchive={openArchive}
        onOpenArchiveMember={openArchiveMember}
        archiveCardMenu={archiveActions.cardMenu}
        archiveCardCopy={archiveActions.copy}
        archiveCardDrop={onBrowseDropInto}
        note={!browsingFolder}
        preview={browsingFolder}
        // Shut behind the list: no sound and no live job. The
        // element stays, so its place and its route do. A tab
        // behind this one counts too, or a shut film started
        // again the moment you switched away from it.
        shut={filmShut(e.tabId)}
      />
    </div>
  ))
  const liveContent =
    file && editMode && file.kind === 'text' ? (
      <Suspense fallback={<EditorLoading />}>
        <CodeView
          path={file.path}
          name={file.name}
          onClose={() => setEditMode(false)}
          onSaved={() => {
            setEditMode(false)
            setDocVersion((v) => v + 1) // the rendered view re-reads what was saved
          }}
          onBuffer={onBuffer}
          getPending={getPending}
          onExternalChange={onExternalChange}
          answer={reloadAnswer}
          fullscreen={fullscreen}
        />
      </Suspense>
    ) : warm.length ? (
      <>
        {warm.filter((w) => !inWindow(w.tabId)).map((w) => (
          <div
            key={w.tabId}
            inert={w.tabId !== activeId || (browsingFolder && !showBrowsePreview)}
            aria-hidden={w.tabId === activeId ? undefined : true}
            className={
              w.tabId === activeId
                ? 'absolute inset-0'
                : 'pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0'
            }
          >
            <Viewer
              // Keyed by TAB, so switching does not remount it -
              // which would destroy the very thing being kept. The
              // kind is in the key because a tab that changes kind
              // is a different viewer; docVersion is, because a
              // markdown save has to re-read from disk.
              key={`${w.tabId}:${w.file.kind}:${docVersion}`}
              file={w.file}
              onUndoable={noteUndo}
              onRenameSelf={(name) => void runRename(w.file.path, name, 'ask')}
              refreshKey={refreshKey}
              onToggleFullscreen={toggleFullscreen}
              fullscreen={fullscreen}
              transportStyle={transportStyle}
              transportBg={transportBg}
              onOpenLocal={openLocal}
              // A tab you are not looking at does not page the
              // folder or answer the keyboard, exactly as the
              // media deck already has it.
              onAutoAdvance={w.tabId === activeId ? advanceSameKind : noop}
              onStep={w.tabId === activeId ? stepSameKind : noop}
              canStep={(dir) =>
                w.tabId === activeId ? sameKindIndex(dir) >= 0 : false
              }
              onBuffer={onBuffer}
              getPending={getPending}
              onExternalChange={onExternalChange}
              reloadAnswer={reloadAnswer}
              onOpenArchive={openArchive}
              onOpenArchiveMember={openArchiveMember}
              archiveCardMenu={archiveActions.cardMenu}
              archiveCardCopy={archiveActions.copy}
              archiveCardDrop={onBrowseDropInto}
              note={!browsingFolder}
            />
          </div>
        ))}
        {!file && active && !previewWindowUp && (browsingFolder ? <PreviewEmpty /> : <NoFileState />)}
      </>
    ) : file ? // a transparent ring, which is where it showed through. // why it went unseen for months, and the audio visualizer is // player either way: a film's picture covers it, which is // with the nothing-open notice. It was drawn under the // BY DESIGN, and this branch used to answer that emptiness // Media lives in the PLAYER deck, so `warm` is empty for it // FLAC opened with "No file selected" written across it). // A FILM OR A TRACK IS NOT "no file" (2026-09-08, owner: a
    // There IS a file here; the player above is drawing it.
    null : active ? (
      previewWindowUp ? null : browsingFolder ? <PreviewEmpty /> : <NoFileState />
    ) : restoring ? (
      // NOTHING TO READ WHILE THE TABS ARRIVE (#271; owner,
      // 2026-10-04: "I don't ever want to see that"). The Explorer
      // tab is sent first, from the cache or a names-only read, so
      // this is a frame or two of plain ground, never a message.
      <div aria-hidden="true" className="h-full" />
    ) : (
      <EmptyState onNewTab={newTab} onOpenFolder={openFolderTab} />
    )
  // THE PREVIEW WINDOW (owner, 2026-11-08): the front tab's
  // player or view, the same element the pane would show, and the
  // empty state when nothing is picked. A portal, so its DOM is in
  // the window and this box stays hidden behind the list.
  const frontWarm = warm.find((w) => inWindow(w.tabId))
  const windowContent = previewWindowUp ? (
    <>
      {players.filter((_, i) => inWindow(deck[i].tabId))}
      {frontWarm && !(file && editMode && file.kind === 'text') && (
        <div key={frontWarm.tabId} className="absolute inset-0">
          <Viewer
            key={`${frontWarm.tabId}:${frontWarm.file.kind}:${docVersion}`}
            file={frontWarm.file}
            onUndoable={noteUndo}
            onRenameSelf={(name) => void runRename(frontWarm.file.path, name, 'ask')}
            refreshKey={refreshKey}
            onToggleFullscreen={noop}
            fullscreen={false}
            transportStyle={transportStyle}
            transportBg={transportBg}
            onOpenLocal={openLocal}
            onAutoAdvance={advanceSameKind}
            onStep={stepSameKind}
            canStep={(dir) => sameKindIndex(dir) >= 0}
            onBuffer={onBuffer}
            getPending={getPending}
            onExternalChange={onExternalChange}
            reloadAnswer={reloadAnswer}
            onOpenArchive={openArchive}
            onOpenArchiveMember={openArchiveMember}
            archiveCardMenu={archiveActions.cardMenu}
            archiveCardCopy={archiveActions.copy}
            archiveCardDrop={onBrowseDropInto}
            note={false}
          />
        </div>
      )}
      {!file && <PreviewEmpty />}
    </>
  ) : null
  return (
    <>
      {players.filter((_, i) => !inWindow(deck[i].tabId))}
      {liveContent}
      {previewWindowUp && (
        <PreviewWindow
          key={previewWindowGen}
          open={windowShown}
          title={file?.name ?? ''}
          onClose={closePreviewWindow}
          onStep={file && (file.kind === 'video' || file.kind === 'audio' || file.kind === 'image' || file.kind === 'comic') ? go : undefined}
        >
          {windowContent}
        </PreviewWindow>
      )}
    </>
  )
}
