/* eslint-disable react-hooks/refs -- the Explorer widths and preview hooks hand back a ref (workspace) next to plain values, and the peek flag is a ref written while rendering, as App always did; the compiler lint did not look at the file before the split (audit #8, 2026-11-21). */
import { useFullscreenVeil } from './hooks/useFullscreenVeil'
import { useWindowClose } from './hooks/useWindowClose'
import { useAppKeys } from './hooks/useAppKeys'
import { useTabOps } from './hooks/useTabOps'
import { useTabTear } from './hooks/useTabTear'
import { useExplorerArrival } from './hooks/useExplorerArrival'
import { useAppTabs } from './hooks/useAppTabs'
import { useAppLayout } from './hooks/useAppLayout'
import { useAppOpening } from './hooks/useAppOpening'
import { useAppSelection } from './hooks/useAppSelection'
import { useAppPreviews } from './hooks/useAppPreviews'
import { askAnswersFor, useAppDialogs } from './hooks/useAppDialogs'
import { usePasteProgress } from './hooks/usePasteProgress'
import { useWindowDrop } from './hooks/useWindowDrop'
import { readOnlyFile } from './lib/readOnlyFile'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { sameRoot } from './lib/tabs/tabs'
import { fileKind, isMarkdown } from '@shared/fileKind'
import { baseName, extOf } from '@shared/path'
import { useTextBuffers } from './hooks/useTextBuffers'
import { useWarmViewers } from './hooks/useWarmViewers'
import UpdateChip from 'prism-term-core/renderer/components/UpdateChip'
import UpdateDialog from 'prism-term-core/renderer/components/UpdateDialog'
import { TopBar } from './components/titlebar/TopBar'
import { TitleButtons } from './components/titlebar/TitleButtons'
import { ViewerStage } from './components/stage/ViewerStage'
import { titleBarMoreMenu } from './menus/moreMenu'
import { ContextMenu } from './components/ContextMenu'
import { useFolderBrowsing } from './hooks/useFolderBrowsing'
import { browseParent } from './lib/browse'
import { BIN_PLACE } from '@shared/binPlace'
import { BrowseToolbar } from './components/browse/BrowseToolbar'
import { ExplorerResize } from './components/browse/ExplorerResize'
import { ExplorerHost } from './components/explorer/ExplorerHost'
import { ExplorerMenus } from './components/explorer/ExplorerMenus'
import { useExplorerController } from './components/explorer/useExplorerController'
import { useAppPaste } from './hooks/useAppPaste'
import { useAppDeck } from './hooks/useAppDeck'
import './components/browse/workspace.css'
import { browsableArchive, within } from '@shared/archivePlace'
import { Settings } from './components/settings/Settings'
import { TabStrip } from './components/TabStrip'
import { PanelToggle } from './components/PanelToggle'
import { useTitleBarMode } from './lib/prefs/titleBarPrefs'
import { useSidebarPeek } from './hooks/useSidebarPeek'
import { Onboarding } from './components/Onboarding'
import { ACCENT_THEME_ID } from './lib/viz/styles'
import {
  setBarTheme as setVizBarTheme,
  setCycle as setVizCycle,
  setGlow as setVizGlow,
  setMove as setVizMove,
  setTheme as setVizTheme
} from './lib/viz/vizStore'
import { AskDialogs } from './dialogs/AskDialogs'
import { PhoneDialog } from './components/PhoneDialog'
import { useInternalFileDrag } from './lib/drag/internalFileDrag'
import { onboardedPref } from './lib/prefs/layoutPrefs'
import { JobChip } from './components/JobChip'
import { Toast } from './components/Toast'
import { SayNotice } from './dialogs/SayNotice'
import { nextTabId } from './lib/sessionIds'

// Phase 0/1 shell: a dark frameless window that opens a file (launch arg, drag,
// or dialog), routes by kind to a viewer, and pages through the folder. Video,
// audio, and image are the built "perfect" viewers; pdf/text are still stubs and
// get their own phase. All viewers eventually come from prism-core.
//
// App is the shell (audit #8 and #12, 2026-11-21): it wires the hooks
// (hooks/useApp*, the Explorer's useExplorerController) and draws the chrome.
// The tabs, the layout, how tabs arrive, the file on show, the preview and the
// questions each live in a hook of their own; the Explorer's surface, its
// menus and the viewer box are components that add no element of their own.
// `appSize.test.ts` keeps this file from growing back.

// There is deliberately no DOC kind-set here any more. Which keys a document
// owns is a question about FOCUS, not about file kind: a pdf nobody has clicked
// into has no more claim on Up/Down than a photo does. See docFocused() in
// hooks/useAppKeys.

export default function App(): JSX.Element {
  usePasteProgress()
  const {
    tabState,
    setTabState,
    restoring,
    setRestoring,
    tabs,
    activeId,
    active,
    rawIndex,
    settingsOpen,
    tabStateNow,
    activeIdRef,
    tabsRef,
    toggleSettings,
    closeSettingsTab,
    putSettingsAway,
    showNothing,
    setRawIndex,
    stepTab,
    jumpTab
  } = useAppTabs()
  const {
    hasNavigated,
    setHasNavigated,
    dragging,
    setDragging,
    fullscreen,
    setFullscreen,
    transportStyle,
    transportBg,
    pickTransport,
    pickTransportBg,
    setup,
    setSetup,
    explorerSide,
    panelSliding,
    placesVisible,
    compactRail,
    peekingRef,
    pinPanel,
    togglePanel
  } = useAppLayout(settingsOpen, active)
  // Unsaved text lives HERE, keyed by path, not inside the editor. That is what
  // lets you edit a file, look at three others, come back, and find your edits
  // still sitting there - and it is why leaving a file now asks nothing. Only
  // closing the window can actually destroy any of it, so only closing asks.
  // Keyed case-insensitively, as Windows paths are, but keeping the real path:
  // that is what gets written, and what the tree matches its rows against.
  const {
    buffers,
    bufferOwners,
    dirtyPaths,
    unsavedNames,
    syncDirty,
    dropBuffers,
    rekeyBuffer,
    getPending,
    onBuffer,
    saveAll
  } = useTextBuffers(activeIdRef)
  // The questions the window asks (hooks/useAppDialogs).
  const dialogs = useAppDialogs(saveAll)
  const { ask, setAsk, reloadAnswer, onExternalChange, changeFolderIcon } = dialogs
  const [refreshKey, setRefreshKey] = useState(0)
  const browsing = useFolderBrowsing(active, setTabState, refreshKey)
  // A file from outside goes to the Explorer tab (2026-09-22). The fullscreen
  // exit is called when a file arrives, long after setFs exists.
  // A ZIP FROM WINDOWS WALKS THE EXPLORER INTO IT (#300): it is a folder now,
  // and "Files from Windows open in" is about files. Back returns to where the
  // Explorer was.
  const browsingNavigate = browsing.navigate
  const browsingOpenFile = browsing.openFile
  const arriveFromWindows = useCallback(
    (path: string, full: boolean): Promise<boolean | undefined> =>
      browsableArchive(baseName(path))
        ? browsingNavigate(path).then(() => true)
        : browsingOpenFile(path, full),
    [browsingNavigate, browsingOpenFile]
  )
  // Fullscreen and the fade to black over its swap (hooks/useFullscreenVeil).
  const { setFs, viewerBox, fsVeilOuter, fsVeilEl } = useFullscreenVeil({ setFullscreen, fullscreen })
  const arriveInExplorer = useExplorerArrival(tabState, setTabState, arriveFromWindows, nextTabId, () => {
    if (fullscreen) setFs(false)
  })
  // How tabs arrive: restored, handed over by Windows, "Open in new tab"
  // (hooks/useAppOpening).
  const { open, openInNewTab, arrive } = useAppOpening({
    setTabState,
    setHasNavigated,
    setRestoring,
    tabsRef,
    arriveInExplorer
  })
  // More > Phone (#104; the button was Tools until #272): the menu under the
  // title bar's three dots and the dialog its first row opens. The dialog is
  // handed the ACTIVE tab's root, so the QR it shows pairs a phone to the
  // folder you are looking at. The button TOGGLES the menu (#272): the menu
  // is told which button owns it, so the press on that button does not shut
  // it only for the click to open it again.
  const [moreMenu, setMoreMenu] = useState<{
    x: number
    y: number
    anchor: HTMLElement
    keyboard: boolean
  } | null>(null)
  const toggleMore = useCallback((button: HTMLElement, keyboard = false): void => {
    setMoreMenu((open) => {
      if (open) return null
      const r = button.getBoundingClientRect()
      return { x: r.left, y: r.bottom + 2, anchor: button, keyboard }
    })
  }, [])
  const [phoneOpen, setPhoneOpen] = useState(false)
  // Closing, and the update install that ends in a quit (hooks/useWindowClose).
  const { update, leave, runInstall } = useWindowClose({ setAsk, dirtyPaths, ask })
  /** The running version, for the window's "You have" line. Asked once. */
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    void window.prism.appVersion().then(setAppVersion)
  }, [])

  // The tabs: new, close, re-root, recent, pick, reorder (hooks/useTabOps).
  const {
    newTab,
    closeActiveTab,
    reorderTab,
    openRecent,
    pickTab,
    closeOneTab,
    discardTabBuffers,
    forceCloseTab,
    openFolderTab
  } = useTabOps({
    setTabState,
    setHasNavigated,
    tabState,
    browsing,
    setup,
    fullscreen,
    setFs,
    bufferOwners,
    buffers,
    tabs,
    syncDirty,
    activeId,
    setAsk
  })

  // A tab pulled out of the strip into a window of its own, and a tab handed
  // to this window that way (tab tear-off step 3, hooks/useTabTear).
  const tear = useTabTear({ tabStateNow, setTabState, buffers, bufferOwners, syncDirty, open })
  useInternalFileDrag(stepTab)
  // A link to a local file inside a viewer (a markdown page, a document): the
  // Explorer opens it in the full viewer, its folder behind it.
  const openBrowseFile = browsing.openFile
  const openLocal = useCallback(
    (path: string) => {
      if (active) void openBrowseFile(path)
    },
    [active, openBrowseFile]
  )
  /** GO INTO AN ARCHIVE (#300): its card's Open. The Explorer walks into it
   *  like a folder. */
  const openArchive = useCallback(
    (path: string) => {
      if (active) void browsing.navigate(path)
    },
    [active, browsing]
  )
  /**
   * A FILE DOUBLE-CLICKED IN THE ZIP'S CARD (#483; owner, 2026-11-06: "on
   * clicking an item in the zip preview opens it in main view dont do that i
   * wanna use it while its in the preview"). The member opens in full view
   * and the Explorer stays where it is, the zip still its selection: no walk
   * into the zip. Coming back from the viewer returns to that folder with the
   * card in the preview (`returnToFolder`), not into the zip.
   */
  const cardReturn = useRef<{ tabId: string; folder: string; zip: ViewerFile } | null>(null)
  const openArchiveMember = useCallback(
    (member: string, zip: ViewerFile) => {
      if (!active) return
      cardReturn.current = { tabId: active.id, folder: active.browse.path, zip }
      const name = baseName(member)
      const ext = extOf(name)
      const opened: ViewerFile = { path: member, name, ext, kind: fileKind(ext, name), member: true }
      void browsing.openFile(opened, true, true, null, true)
    },
    [active, browsing]
  )

  const toggleFullscreen = useCallback(() => setFs(!fullscreen), [fullscreen, setFs])

  // The file on show and the steps through its folder (hooks/useAppSelection).
  const {
    view,
    file,
    viewingFile,
    go,
    sameKindIndex,
    stepSameKind,
    advanceSameKind,
    editMode,
    setEditMode,
    docVersion,
    setDocVersion
  } = useAppSelection({ active, rawIndex, browsing, setRawIndex, setHasNavigated })
  // THE COLLAPSED PANEL PEEKS (#250): which panel is collapsed and could come
  // out over the content right now. Never over Settings (its rail collapses to
  // glyphs, it does not hide), the first-run setup or fullscreen, and only over a
  // folder, where the places panel lives.
  const titleBar = useTitleBarMode()
  const peekTarget =
    !active || fullscreen || setup || settingsOpen
      ? null
      : browsing.folder && active.browse.surface === 'folder' && !placesVisible
        ? `places:${active.id}`
        : null
  const { phase: peekPhase, end: endPeek } = useSidebarPeek({
    target: peekTarget,
    side: explorerSide,
    zone: () => document.querySelector<HTMLElement>('.browse-workspace'),
    panel: () =>
      document.querySelector<HTMLElement>('[data-testid="folder-browser"] .browse-places')
  })
  peekingRef.current = peekPhase === 'in'
  // The peeking panel's own toggle pins it; so does Ctrl+B (togglePanel).
  const pinFromPeek = useCallback(() => {
    endPeek()
    pinPanel()
  }, [endPeek, pinPanel])
  // A binned file's place is the bin (D12), never the `$Recycle.Bin` folder its
  // entry lives in: the crumbs say Recycle Bin and Back returns to its list.
  const viewerDirectory = file
    ? file.binned
      ? BIN_PLACE
      : (browseParent(file.path) ?? active?.browse.path)
    : active?.browse.path
  const returnToFolder = useCallback(() => {
    // Out of a member the zip's card opened (#483): the folder the Explorer
    // never left, and the card back in the preview where it was.
    const card = cardReturn.current
    cardReturn.current = null
    if (
      card &&
      active &&
      file &&
      card.tabId === active.id &&
      sameRoot(card.folder, active.browse.path) &&
      within(card.zip.path, file.path)
    ) {
      browsing.showFolder()
      void browsing.openFile(card.zip, false, false, null, true)
      return
    }
    if (viewerDirectory && active && !sameRoot(viewerDirectory, active.browse.path))
      void browsing.navigate(viewerDirectory)
    else {
      // THE LIST COMES BACK TO THE FILE ON SHOW (Stage 5, spec 5.2; rows too,
      // owner 2026-11-12): Up and Down in the viewer walk the folder without
      // moving the list's pick, so the list is told which file that was (a
      // quiet pick, nothing opens) and follows it into view.
      if (file) browsing.select(file.path, true)
      browsing.showFolder()
    }
  }, [viewerDirectory, active, browsing, file])
  // Pasting files, and what a paste does to unsaved text (hooks/useAppPaste).
  const pasteFiles = useAppPaste(buffers, rekeyBuffer, setAsk, setRefreshKey)
  // The preview, in its pane or in a window (hooks/useAppPreviews).
  const previews = useAppPreviews({
    active,
    activeId,
    browsing,
    file,
    fullscreen,
    editMode,
    placesVisible,
    viewerBox
  })
  const {
    showBrowsePreview,
    paneShown,
    windowShown,
    previewWindowUp,
    previewWindowGen,
    previewSlide,
    previewFlush,
    headVars,
    explorerWidths,
    closePreviewWindow
  } = previews
  // The Explorer's menus, rename, properties, bin, quick access and file jobs
  // (components/explorer/useExplorerController).
  const explorer = useExplorerController({
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
  })
  const { fileOps, archiveActions, binOps, noteUndo, setBrowseRename } = explorer
  // The window's keys (hooks/useAppKeys).
  useAppKeys({
    setup,
    settingsOpen,
    fullscreen,
    active,
    browsing,
    viewerDirectory,
    pasteFiles,
    file,
    setBrowseRename,
    setAsk,
    viewingFile,
    returnToFolder,
    setFs,
    redo: fileOps.redo,
    undo: fileOps.undo,
    newTab,
    closeActiveTab,
    stepTab,
    jumpTab,
    togglePanel,
    go,
    hasNavigated
  })

  // Every tab holding media keeps its player (hooks/useAppDeck).
  const deck = useAppDeck(tabs, activeId)

  /* ------------------------------------------------------------------
   * The warm viewers: the same idea for the kinds that do not play.
   *
   * Switching tabs used to unmount the viewer and throw away everything it
   * had built - a parsed pdf and its rendered pages, a decoded image, an
   * editor's document - so coming back paid for all of it again. Every warm
   * tab is mounted; the strip only decides which one is on screen.
   *
   * HELD WHILE THE WINDOW HAS THE FOCUS, and for a minute after it loses it,
   * because coming back to the app is the common case and a viewer nobody is
   * looking at should not hold a decoded document for the rest of the
   * session. The timer only ever RELEASES, so the worst a missed signal can
   * do is keep memory that the next switch will bound anyway.
   * ------------------------------------------------------------------ */
  const warm = useWarmViewers(tabs, activeId)

  // Drag-and-drop (path via webUtils, since Electron removed File.path).
  useWindowDrop({ setup, active, browsing, arrive, openInNewTab, setDragging })

  // The style's light belongs to an empty window, a visualizer, or a page of
  // Prism's own - never behind someone's photo.
  const washed = settingsOpen || setup || !file || file.kind === 'audio'

  // What both shapes of the chrome carry (#250): the bar and the tab row draw
  // the same toggle, chip and strip from one place.
  const panelPinned = settingsOpen ? !compactRail : placesVisible
  const panelToggle = viewingFile && !settingsOpen ? undefined : togglePanel
  // Only markdown takes the pencil. Code and plain text have no rendered form
  // to leave, so they are simply editable where they sit.
  // A member of an archive is read-only (#300): no pencil.
  const editable = file?.kind === 'text' && isMarkdown(file.name) && !readOnlyFile(file)
  const chip = (
    <UpdateChip
      info={update.state.info}
      phase={update.state.phase}
      onOpen={update.open}
      // Under the chip only while the window is not up to say it itself.
      notice={update.state.open ? null : update.state.notice}
      onDismissNotice={update.dismissNotice}
    />
  )
  const stripProps = {
    tabs,
    activeId,
    onDropFile: openInNewTab,
    onDropIntoTab: fileOps.onDropIntoTab,
    onReorder: reorderTab,
    onOpenRecent: openRecent,
    onPick: pickTab,
    onClose: closeOneTab,
    onNew: newTab,
    tear,
    wash: washed
  }
  const askAnswers = askAnswersFor({
    dialogs,
    unsavedNames,
    fileOps,
    binOps,
    leave,
    discardAll: () => {
      buffers.current.clear()
      syncDirty()
    },
    discardTabBuffers,
    forceCloseTab,
    runInstall
  })

  // Fullscreen is for watching, not browsing: no tree, no arrows, no chrome.
  // Outside fullscreen the panel stays mounted even when closed, so it can slide.
  return (
    <div className="prism-desktop flex h-full flex-col text-[var(--p-text)] [font-size:var(--p-size)]">
      {/* The fullscreen fade, OUTSIDE the fullscreen element: it covers the
          whole window - sidebar, tabs and title bar included - so everything
          darkens together rather than the picture going first and the chrome
          disappearing after. It stops rendering once fullscreen begins, by
          which time the inner veil is already opaque. */}
      <div
        ref={fsVeilOuter}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[300] bg-black opacity-0 will-change-[opacity]"
      />
      {!fullscreen && (setup || titleBar === 'shown') && (
        <TopBar
          // The open file is named in the toolbar over the viewer, not here.
          name={''}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
          panelOpen={panelPinned}
          onTogglePanel={panelToggle}
          setup={setup}
          wash={washed}
          editable={editable}
          editing={editMode}
          dirty={dirtyPaths.size > 0}
          onToggleEdit={() => setEditMode((v) => !v)}
          chip={chip}
          onMore={toggleMore}
          moreOpen={!!moreMenu}
        />
      )}
      {/* Under the bar, and only once there are two or more: one tab is exactly
          the chrome Prism has always had, so someone quick-looking a single
          photo never meets a workspace element. Gone in fullscreen with the
          rest of it. */}
      {!fullscreen && (setup || titleBar === 'shown') && <TabStrip {...stripProps} />}
      {/* NO TITLE BAR (#250; owner, 2026-10-02: "normal prism should also have
          no titlebar option", Prism Terminal's #91): ONE row. The panel toggle
          first, then the tabs and their +, then what the bar carried on its
          right. The wordmark and the file's name go: the tab and the tree
          already say where you are. The strip's own empty space is the handle
          the window moves by; tabs and buttons are no-drag, as in the bar.
          The first-run setup keeps the bar it was designed with. */}
      {!fullscreen && !setup && titleBar === 'hidden' && (
        <div
          data-title-bar="tabs"
          className={`drag p-styled-font flex h-9 shrink-0 items-stretch border-b border-[var(--p-divider)] bg-[var(--p-tabs)] text-[13px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${washed ? 'p-wash' : ''}`}
        >
          {panelToggle && (
            <div className="flex shrink-0 items-center pl-1.5 pr-1">
              <PanelToggle open={panelPinned} settingsOpen={settingsOpen} onToggle={panelToggle} />
            </div>
          )}
          {tabs.length > 0 ? (
            <>
              <TabStrip {...stripProps} inTitleRow />
              {/* A handle that is always there: with Dynamic tab width about
                  five tabs fill the strip, and its empty space was then the
                  only place to grab the window (review of #250). */}
              <span data-drag-spacer className="w-10 shrink-0" />
            </>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <div className="flex shrink-0 items-center gap-3 pl-2 pr-3">
            {dirtyPaths.size > 0 && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--p-accent-hi)]"
                title="Unsaved changes (Ctrl+S)"
                aria-label="Unsaved changes"
              />
            )}
            <TitleButtons
              setup={false}
              chip={chip}
              onMore={toggleMore}
              moreOpen={!!moreMenu}
              editable={editable}
              editing={editMode}
              onToggleEdit={() => setEditMode((v) => !v)}
              settingsOpen={settingsOpen}
              onToggleSettings={toggleSettings}
            />
          </div>
        </div>
      )}
      {/* Settings covers this area. Hiding it (rather than leaving it painted
          underneath) is what lets a translucent style show its material through
          the settings page; `invisible` keeps a playing video alive. */}
      {viewingFile && active && viewerDirectory && !fullscreen && !settingsOpen && !setup && (
        <div className="browse-viewer-toolbar">
          <BrowseToolbar
            directory={viewerDirectory}
            onDropInto={fileOps.onBrowseDropInto}
            fileName={file?.name}
            filePath={file && !readOnlyFile(file) ? file.path : undefined}
            canBack={active.browse.cursor > 0}
            canForward={active.browse.cursor < active.browse.history.length - 1}
            onReturnToFolder={returnToFolder}
            onBack={() => browsing.travel(-1)}
            onForward={() => browsing.travel(1)}
            onUp={returnToFolder}
            onNavigate={(path, typed) => void browsing.navigate(path, undefined, typed)}
          />
          {browsing.error && (
            <div className="browse-navigation-error" role="status">
              {browsing.error}
            </div>
          )}
        </div>
      )}
      <div
        inert={settingsOpen || setup}
        ref={explorerWidths.workspace}
        style={active ? ({ ...explorerWidths.style, ...headVars } as CSSProperties) : undefined}
        data-preview-sliding={previewSlide.sliding || undefined}
        data-sidebar-side={explorerSide === 'right' ? 'right' : undefined}
        className={`browse-workspace relative flex min-h-0 flex-1 ${browsing.folder ? 'is-browsing' : ''} ${explorerSide === 'right' ? 'flex-row-reverse' : ''} ${
          settingsOpen || setup ? 'invisible' : ''
        }`}
      >
        {/* The job chip floats over the window (the project sidebar's footer,
            its old home, is gone with the tree; 2026-10-26): a paste must stay
            visible whichever tab is in front. */}
        {active && active.kind !== 'settings' && !fullscreen && <JobChip floating />}
        {active && browsing.folder && !fullscreen && placesVisible && (
          <ExplorerResize
            section="places"
            bounds={explorerWidths.bounds.places}
            onResize={(width) => explorerWidths.resize('places', width)}
            onLive={(width) => explorerWidths.live('places', width)}
            edge={explorerSide}
          />
        )}
        <div className="relative flex min-w-0 min-h-0 flex-1 flex-col">
          {browsing.folder && active && browsing.location && !fullscreen && (
            <ExplorerHost
              explorer={explorer}
              browsing={browsing}
              location={browsing.location}
              active={active}
              previews={previews}
              pasteFiles={pasteFiles}
              openInNewTab={openInNewTab}
              openBrowseFile={openBrowseFile}
              setAsk={setAsk}
              setRefreshKey={setRefreshKey}
              changeFolderIcon={changeFolderIcon}
              placesVisible={placesVisible}
              panelSliding={panelSliding}
              peekPhase={peekPhase}
              explorerSide={explorerSide}
              onPinPlaces={pinFromPeek}
              onPlacePicked={endPeek}
              covered={!!ask || update.state.open || settingsOpen || !!setup}
            />
          )}
          {paneShown && !previewSlide.sliding && !fullscreen && (
            <ExplorerResize
              section="preview"
              bounds={explorerWidths.bounds.preview}
              onResize={(width) => explorerWidths.resize('preview', width)}
              onLive={(width) => explorerWidths.live('preview', width)}
              edge={explorerSide === 'right' ? 'left' : 'right'}
            />
          )}
          <div
            // As the Explorer's PREVIEW the box sits over the folder
            // browser, which already paints the window's ground there: it
            // paints nothing of its own (#294; owner, 2026-10-06: "the
            // preview also isn't acrylic"), since a second see-through coat
            // is an opaque pane on glass. A file of its own, or full screen,
            // has nothing under it and paints the ground itself. FULL SCREEN
            // IS BLACK for every file (owner, 2026-11-26): the theme only
            // windowed, so the borders round a picture or a page are black.
            className={`group relative flex min-w-0 min-h-0 flex-1 items-center justify-center overflow-hidden ${
              fullscreen ? 'bg-black' : previewSlide.out ? '' : `bg-[var(--p-bg)] ${washed ? 'p-wash' : ''}`
            } ${dragging ? 'ring-2 ring-inset ring-[var(--p-accent-solid)]' : ''} ${
              browsing.folder && !fullscreen && !previewSlide.out ? 'hidden' : ''
            }`}
            ref={viewerBox}
            data-browse-preview={(previewSlide.out && !fullscreen) || undefined}
            data-preview-flush={(previewSlide.out && !fullscreen && previewFlush) || undefined}
            data-workspace-viewer
          >
            {/* the fullscreen fade-to-black, inside the fullscreen element */}
            <div
              ref={fsVeilEl}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[200] bg-black opacity-0 will-change-[opacity]"
            />
            {/* Keyed by KIND, not by path. Keying by path remounted the viewer on
              every arrow press, which threw the current picture away before the
              next one had decoded and flashed the window black between them.
              A viewer keeps itself in order across files of its own kind; only
              a change of kind needs a fresh one. */}
            <ViewerStage
              tabs={tabs}
              activeId={activeId}
              active={active}
              file={file}
              deck={deck}
              warm={warm}
              restoring={restoring}
              browsingFolder={browsing.folder}
              showBrowsePreview={showBrowsePreview}
              previewWindowUp={previewWindowUp}
              previewWindowGen={previewWindowGen}
              windowShown={windowShown}
              closePreviewWindow={closePreviewWindow}
              go={go}
              editMode={editMode}
              setEditMode={setEditMode}
              docVersion={docVersion}
              setDocVersion={setDocVersion}
              refreshKey={refreshKey}
              fullscreen={fullscreen}
              toggleFullscreen={toggleFullscreen}
              transportStyle={transportStyle}
              transportBg={transportBg}
              noteUndo={noteUndo}
              runRename={fileOps.runRename}
              openLocal={openLocal}
              openArchive={openArchive}
              openArchiveMember={openArchiveMember}
              advanceSameKind={advanceSameKind}
              stepSameKind={stepSameKind}
              sameKindIndex={sameKindIndex}
              onBuffer={onBuffer}
              getPending={getPending}
              onExternalChange={onExternalChange}
              reloadAnswer={reloadAnswer}
              archiveActions={archiveActions}
              onBrowseDropInto={fileOps.onBrowseDropInto}
              newTab={newTab}
              openFolderTab={openFolderTab}
            />
            {/* No on-screen arrows: paging is the keyboard's job. Left and right,
              up and down, PageUp and PageDown, in or out of fullscreen. */}
          </div>
        </div>
      </div>
      <Settings
        open={settingsOpen}
        onShowSetup={() => {
          closeSettingsTab()
          setSetup(true)
        }}
        compactRail={compactRail}
        onClose={putSettingsAway}
        transportStyle={transportStyle}
        onPickTransport={pickTransport}
        transportBg={transportBg}
        onPickTransportBg={pickTransportBg}
      />

      <AskDialogs ask={ask} layer="under" answers={askAnswers} />

      {/* What undo just did, said quietly and briefly: the change is often
          off screen, and a dialog would be asking a question nobody has. */}
      <Toast />
      <SayNotice />

      {/* The update window (#168). Mounted once, here: the chip lives in the
          title bar, the window it opens belongs to the whole app. Not during
          first-run setup, where the chip is not drawn either. */}
      {update.state.open && update.state.info && (
        <UpdateDialog
          info={update.state.info}
          currentVersion={appVersion}
          phase={update.state.phase}
          pct={update.state.pct}
          aborting={update.state.aborting}
          notice={update.state.notice}
          onInstall={update.install}
          onCancel={update.cancel}
          onAbort={update.abort}
        />
      )}


      <ExplorerMenus
        explorer={explorer}
        browsing={browsing}
        active={active}
        pasteFiles={pasteFiles}
        openInNewTab={openInNewTab}
        setAsk={setAsk}
        changeFolderIcon={changeFolderIcon}
      />
      <AskDialogs ask={ask} layer="over" answers={askAnswers} />
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          anchor={moreMenu.anchor}
          keyboard={moreMenu.keyboard}
          onClose={() => setMoreMenu(null)}
          items={titleBarMoreMenu({ openPhone: () => setPhoneOpen(true) })}
        />
      )}
      {phoneOpen && (
        <PhoneDialog
          // Where a newly paired phone starts (2026-10-14): the folder the
          // Explorer is showing, or This PC (null) with Settings in front.
          start={!active || active.kind === 'settings' ? null : active.browse.path || null}
          onClose={() => setPhoneOpen(false)}
        />
      )}
      {setup && (
        <Onboarding
          onDone={() => {
            onboardedPref.set(true)
            // The colour you picked is the colour the visualizer plays in:
            // that one accent, lit, rather than a spectrum sweeping past.
            setVizTheme(ACCENT_THEME_ID)
            setVizBarTheme(ACCENT_THEME_ID)
            setVizGlow(true)
            setVizCycle(false)
            setVizMove(false)
            setSetup(false)
          }}
        />
      )}
    </div>
  )
}
