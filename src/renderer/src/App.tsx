import { useFullscreenVeil } from './lib/useFullscreenVeil'
import { useWindowClose } from './lib/useWindowClose'
import { useFileOps } from './lib/useFileOps'
import { useAppKeys } from './lib/useAppKeys'
import { useTerminal } from './lib/useTerminal'
import { useTermPanes } from './lib/useTermPanes'
import { useTabOps } from './lib/useTabOps'
import { useExplorerArrival } from './lib/useExplorerArrival'
import { visitedDirectories } from './lib/visitedDirectories'
import { tabCrumbs } from './lib/tabCrumbs'
import { crumb } from 'prism-term-core/renderer/lib/diag'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import type { OpenPayload, OpenWithApp } from '@shared/types'
import type { BrowseDriveUsage } from '@shared/browse'
import { preloadImage } from './lib/imageLoader'
import {
  addTab,
  addRestoredTab,
  addExplorerTab,
  addProjectTab,
  isExplorerTab,
  ensurePinnedExplorer,
  closeTab,
  toggleSettingsTab,
  receiveFile,
  sameRoot,
  setTabPanes,
  setTabTerm,
  type TabState,
  type TreeState,
  setBrowseSurface,
  removeTerm,
  termLabel
} from './lib/tabs'
import {
  lastSplitDir,
  paneAreas,
  pinPane,
  saveSplitDir,
  unpinPane,
  type SplitDir,
  pinTermPane
} from './lib/panes'
import { fileKind, isMarkdown } from '@shared/fileKind'
import { baseName, extOf } from '@shared/path'
import { dockAxis, dockFlex } from './lib/termDock'
import { savedShellId } from 'prism-term-core/renderer/lib/termPrefs'
import { useAgentIndicator } from 'prism-term-core/renderer/lib/useAgentIndicator'
import { useDictationArm } from 'prism-term-core/renderer/lib/useDictation'
import UpdateChip from 'prism-term-core/renderer/components/UpdateChip'
import UpdateDialog from 'prism-term-core/renderer/components/UpdateDialog'
import { newTabShow } from './lib/newTabPrefs'
import {
  idleAtPrompt,
  isTouched,
  markResume,
} from 'prism-term-core/renderer/lib/termActivity'
import { onCwd } from 'prism-term-core/renderer/lib/termBus'
import { ancestorChain } from './lib/fileTree'
import { decideFollow } from 'prism-term-core/shared/termCwd'
import CopiedBadge from 'prism-term-core/renderer/components/CopiedBadge'
import { TermDock } from './components/TermDock'
import { TopBar } from './components/titlebar/TopBar'
import { TitleButtons } from './components/titlebar/TitleButtons'
import { EditorLoading, Viewer } from './components/stage/Viewer'
import { PinnedPaneView } from './components/stage/PinnedPaneView'
import { EmptyState, NoFileState } from './components/stage/EmptyState'
import { ContextMenu } from './components/ContextMenu'
import { explorerRowMenu } from './menus/explorerRow'
import { titleBarMoreMenu } from './menus/moreMenu'
import { useFolderBrowsing } from './lib/useFolderBrowsing'
import { browseParent } from './lib/browse'
import { terminalRestoreOrder } from './lib/terminalRestore'
import { FolderBrowser, type BrowseEntry } from './components/browse/FolderBrowser'
import { BrowseToolbar } from './components/browse/BrowseToolbar'
import { BrowseIcon } from './components/icons/BrowseIcon'
import { ExplorerResize } from './components/browse/ExplorerResize'
import { useExplorerWidths } from './lib/useExplorerWidths'
import { usePreviewSlide } from './lib/usePreviewSlide'
import { copyFilePaths, fileClipboardReady } from './lib/fileClipboard'
import { useFilePaste } from './lib/useFilePaste'
import {
  useQuickAccess,
  pinQuickAccess,
  unpinQuickAccess,
  moveQuickAccess,
  sameQuickAccessPath
} from './lib/quickAccess'
import { BrowseRename } from './components/browse/BrowseRename'
import { PropertiesDialog } from './components/properties/PropertiesDialog'
import './components/browse/workspace.css'
import { sortFiles, useSort } from './lib/sortPrefs'
import { useExplorerSide } from './lib/explorerSidePrefs'
import { useTreeSide } from './lib/treePrefs'
import { PreviewEmpty } from './components/browse/PreviewEmpty'
import { PasswordDialog } from './dialogs/PasswordDialog'
import { browsableArchive } from '@shared/archivePlace'
import { useArchiveActions } from './components/browse/useArchiveActions'
import { clipboardText } from './lib/clipboardText'
// The code editor for markdown's pencil, split out like every viewer chunk
// (ViewerSwitch): CodeMirror is ~770KB and not on the path of a photo.
const CodeView = lazy(() => import('./components/CodeView').then((m) => ({ default: m.CodeView })))
import { Settings } from './components/settings/Settings'
import { Sidebar } from './components/Sidebar'
import { TabStrip } from './components/TabStrip'
import { PanelToggle } from './components/PanelToggle'
import { useTitleBarMode } from './lib/titleBarPrefs'
import { useSidebarPeek } from './lib/useSidebarPeek'
import { Onboarding } from './components/Onboarding'
import { ACCENT_THEME_ID } from './lib/viz/styles'
import {
  setBarTheme as setVizBarTheme,
  setCycle as setVizCycle,
  setGlow as setVizGlow,
  setMove as setVizMove,
  setTheme as setVizTheme
} from './lib/vizStore'
import { AskDialogs, type AskAnswers } from './dialogs/AskDialogs'
import type { Ask } from './dialogs/asks'
import { PhoneDialog } from './components/PhoneDialog'
import {
  loadTransportBg,
  loadTransportStyle,
  saveTransportBg,
  saveTransportStyle,
  type TransportStyle
} from './lib/transport'
import { deckOf } from './lib/mediaDeck'
import { warmOf } from './lib/viewerCache'

/** How long a viewer stays in memory after the window stops being the one in
 *  front. Coming back is the common case, so releasing on the very first blur
 *  would throw the cache away every time somebody glanced at another window. */
const WARM_COOLDOWN_MS = 60_000
import { intendToPlay, wasPlaying } from './lib/playState'
import { dragPayload, setDrag } from './lib/dragDrop'
import { useInternalFileDrag } from './lib/internalFileDrag'
import { explorerHeadVars, useExplorerSize } from './lib/explorerSize'
import { compactRailPref, onboardedPref, placesPref, sidebarPref } from './lib/layoutPrefs'
import { JobChip } from './components/JobChip'
import { emptyUndo, remember, type UndoEntry, type UndoState } from './lib/undo'
import { Icon } from './components/icons/Icon'
import { disposeSession, nextTabId, nextTermId } from './lib/sessionIds'

// Phase 0/1 shell: a dark frameless window that opens a file (launch arg, drag,
// or dialog), routes by kind to a viewer, and pages through the folder. Video,
// audio, and image are the built "perfect" viewers; pdf/text are still stubs and
// get their own phase. All viewers eventually come from prism-core.

// There is deliberately no DOC kind-set here any more. Which keys a document
// owns is a question about FOCUS, not about file kind: a pdf nobody has clicked
// into has no more claim on Up/Down than a photo does. See docFocused() in
// lib/useAppKeys, beside PLAYABLE.
const PRELOAD_MAX_BYTES = 80 * 1024 * 1024 // don't warm neighbours bigger than this

export default function App(): JSX.Element {
  // The open projects. A tab carries every viewable sibling main found for its
  // root and which of them is on screen; `active` is the one you are looking at.
  // The list the user actually pages through is derived from those plus the
  // navigation scope, so changing the scope re-derives around the current file
  // instead of moving off it.
  // One piece of state, not two: every tab action is a pure function of the
  // whole thing, so each handler below is a plain updater and stays stable for
  // the life of the window. `open` in particular is handed to main once, through
  // onOpenFile, and must not be rebuilt whenever a tab changes.
  const [tabState, setTabState] = useState<TabState>({ tabs: [], activeId: null })
  const [restoring, setRestoring] = useState(true)
  const { tabs, activeId } = tabState
  const active = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId])
  // THE TAB STRIP ON THE DIAGNOSTICS TIMELINE (#322): opened, closed, switched
  // to, a project opened, a file reaching the player. Read off the state
  // (lib/tabCrumbs), since a tab changes from a dozen places.
  const crumbedTabs = useRef<TabState>({ tabs: [], activeId: null })
  useEffect(() => {
    for (const c of tabCrumbs(crumbedTabs.current, tabState)) crumb(c.a, c.fields, { often: c.often })
    crumbedTabs.current = tabState
  }, [tabState])
  /**
   * WHICH SHELLS HOST AN AGENT, WHICH ARE MID-ANSWER, WHICH FINISHED BEHIND
   * YOUR BACK: prism-term-core's rules, the same code Prism Terminal runs
   * (#154; owner, 2026-09-19: "Prism Terminal's indicator rules in both").
   * The title reader, the birth rule and the output fallback lived here until
   * then and were the original of that hook. A session is "in front" when it is
   * the active tab's current shell. Up here because the reroot and the close
   * path below both ask it.
   */
  const {
    agentIds,
    workingIds,
    doneIds,
    agentKinds,
    forget: forgetAgent
  } = useAgentIndicator(active?.term?.id ?? null)
  // DICTATION (#162) is armed with the shell that is SHOWING, or with nothing:
  // a hidden terminal is not something to speak into, and this window is a
  // media viewer most of the time. It renders nothing and re-renders nothing.
  useDictationArm(active?.term && active.term.view !== 'hidden' ? active.term.id : null)
  const rawIndex = active?.index ?? -1
  const settingsOpen = active?.kind === 'settings'
  const toggleSettings = useCallback(() => {
    setTabState((s) =>
      toggleSettingsTab(s.tabs, s.activeId, `settings-${(settingsSeq.current += 1)}`)
    )
  }, [])
  const closeSettingsTab = useCallback(() => {
    setTabState((s) => {
      const st = s.tabs.find((t) => t.kind === 'settings')
      return st ? closeTab(s.tabs, st.id, s.activeId) : s
    })
  }, [])
  /**
   * Show NOTHING in the active tab, without closing it (2026-09-02).
   *
   * `index: -1` is the state a tab already has when its folder holds nothing
   * viewable, and NoFileState is what renders there. Deleting the last file
   * used to close the tab instead, which is the same failure Ctrl+W's rule
   * exists to prevent: Prism is resident, and a tab that vanishes takes its
   * root, its tree and its terminal with it. Paste a file into an empty
   * folder, open it, delete it - and the folder you were working in was gone.
   */
  const showNothing = useCallback(
    () =>
      setTabState((s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, index: -1 } : t))
      })),
    []
  )

  /** Point the active tab at another of its files. */
  const setRawIndex = useCallback(
    (i: number) =>
      setTabState((s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, index: i } : t))
      })),
    []
  )
  // Whether the user has started paging through the folder in this session. A
  // freshly opened audio/video keeps the arrow keys for seeking; once you've
  // navigated, arrows keep paging even when they land on a playable file.
  const [hasNavigated, setHasNavigated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [transportStyle, setTransportStyle] = useState<TransportStyle>(loadTransportStyle)
  const [transportBg, setTransportBg] = useState<number>(loadTransportBg)
  // Settings rides the strip as a tab of its own kind, so it can be flipped
  // to and from like any other. `settingsOpen` is simply "the settings tab is
  // in front"; the page itself stays mounted underneath either way, keeping
  // its own internal state.
  const settingsSeq = useRef(0)
  // Setup launches with --setup, which shows the guide even here, where it has
  // been through once already.
  const [setup, setSetup] = useState(
    () => window.prism.forceSetup === true || !onboardedPref.get()
  )
  // The file tree. Off on a fresh install: the media is the point.
  const [sidebar, setSidebar] = useState(sidebarPref.get)
  // TWO SIDEBAR POSITIONS (#304; owner, 2026-10-07: "No, it should be two
  // settings, one on the project tab and one on the explorer tab"): the
  // project tree's (Project settings) and the Explorer's places (Explorer >
  // Layout). Neither moves the other.
  const treeSide = useTreeSide()
  const explorerSide = useExplorerSide()
  // A PANEL SLIDES WHEN IT IS OPENED OR CLOSED, AND ONLY THEN (owner,
  // 2026-09-23: "when you collapse the explorer sidebar its not animated, it
  // should be", and "when you switch between a project and explorer with
  // sidebar open it has a sidebar animation on each tab change, it shouldnt").
  // True for one slide after a toggle. The project Sidebar sits behind every
  // tab and is shut on an Explorer tab, and one FolderBrowser serves every
  // tab, so without this a tab switch, a drag of an edge or a window resize
  // changed a width and played the slide too.
  const [panelSliding, setPanelSliding] = useState(false)
  const panelSlideTimer = useRef<number | undefined>(undefined)
  const slidePanel = useCallback(() => {
    setPanelSliding(true)
    window.clearTimeout(panelSlideTimer.current)
    panelSlideTimer.current = window.setTimeout(() => setPanelSliding(false), 240)
  }, [])
  const toggleSidebar = useCallback(() => {
    slidePanel()
    setSidebar((on) => {
      sidebarPref.set(!on)
      return !on
    })
  }, [slidePanel])
  const [placesVisible, setPlacesVisible] = useState(placesPref.get)
  // The pencil: markdown's raw source, the one text kind with a rendered form
  // to toggle away from. Leaving the file leaves the editor; a save bumps
  // docVersion so the rendered view re-reads what was written.
  const [editMode, setEditMode] = useState(false)
  const [docVersion, setDocVersion] = useState(0)
  // Unsaved text lives HERE, keyed by path, not inside the editor. That is what
  // lets you edit a file, look at three others, come back, and find your edits
  // still sitting there - and it is why leaving a file now asks nothing. Only
  // closing the window can actually destroy any of it, so only closing asks.
  // Keyed case-insensitively, as Windows paths are, but keeping the real path:
  // that is what gets written, and what the tree matches its rows against.
  const buffers = useRef(new Map<string, { path: string; text: string }>())
  const bufferOwners = useRef(new Map<string, Set<string>>())
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set())
  // The names as they are actually spelled. dirtyPaths is lowercased for
  // matching, which is no way to address someone's file in a dialog.
  const [unsavedNames, setUnsavedNames] = useState<readonly string[]>([])
  const syncDirty = useCallback(() => {
    setDirtyPaths(new Set(buffers.current.keys()))
    setUnsavedNames([...buffers.current.values()].map((b) => baseName(b.path)))
    // Main needs this too: it is what holds the window open on a close.
    window.prism.setDirty(buffers.current.size > 0)
  }, [])
  /**
   * A file Prism just binned has no unsaved text to save (2026-08-30).
   *
   * `file:write` no longer demands the target exist, which is what lets a
   * file renamed out from under a dirty buffer still be saved. The other side
   * of that coin is this: without dropping the buffer, closing the window and
   * answering "Save all changes" would RECREATE a file the user had put in
   * the Recycle Bin. Prism did the deleting, so Prism knows.
   */
  const dropBuffers = useCallback(
    (paths: readonly string[]) => {
      let hit = false
      for (const gone of paths) {
        const under = gone.toLowerCase()
        for (const key of [...buffers.current.keys()]) {
          // A folder takes its files with it.
          if (key === under || key.startsWith(under + '\\')) {
            buffers.current.delete(key)
            hit = true
          }
        }
      }
      if (hit) syncDirty()
    },
    [syncDirty]
  )

  /**
   * ...and a file Prism RENAMED keeps its unsaved text, under the new name.
   * Dropping it here would throw away the work; leaving it under the old name
   * would recreate the old file on the next save.
   */
  const rekeyBuffer = useCallback(
    (from: string, to: string) => {
      const old = from.toLowerCase()
      const buf = buffers.current.get(old)
      if (!buf) return
      buffers.current.delete(old)
      buffers.current.set(to.toLowerCase(), { path: to, text: buf.text })
      for (const owned of bufferOwners.current.values())
        if (owned.delete(old)) owned.add(to.toLowerCase())
      syncDirty()
    },
    [syncDirty]
  )

  /** What the editor should show for a file: unsaved text if we kept any. */
  const getPending = useCallback((p: string) => buffers.current.get(p.toLowerCase())?.text, [])
  /** The editor reports its buffer as it changes; null once it matches disk. */
  const onBuffer = useCallback(
    (path: string, text: string | null) => {
      const key = path.toLowerCase()
      if (text === null) buffers.current.delete(key)
      else {
        buffers.current.set(key, { path, text })
        if (activeIdRef.current) {
          const owned = bufferOwners.current.get(activeIdRef.current) ?? new Set<string>()
          owned.add(key)
          bufferOwners.current.set(activeIdRef.current, owned)
        }
      }
      syncDirty()
    },
    [syncDirty]
  )
  /**
   * Something outside Prism rewrote a file that holds unsaved edits
   * (2026-08-31). The editor swaps a CLEAN file silently - taking the new
   * version costs nothing and asking would be noise - and reports a dirty one
   * here, because Prism has no diff and no merge: it is keep mine or take
   * theirs, and only the user can pick.
   */
  const [reloadAnswer, setReloadAnswer] = useState<{ path: string; reload: boolean } | null>(null)
  const onExternalChange = useCallback((path: string) => {
    setAsk({ kind: 'file-changed', path, name: baseName(path) })
  }, [])
  /** The tree's arrow keys, lent up by Sidebar. Null while there is no tree to
   *  drive (panel shut, search showing); App then pages the folder itself. */
  const treeNav = useRef<((dir: 'up' | 'down') => boolean) | null>(null)
  const onNav = useCallback((step: typeof treeNav.current) => {
    treeNav.current = step
  }, [])
  /** Write every unsaved buffer. Returns the paths that could not be written,
   *  so a failing disk cancels the close instead of eating the work. */
  const saveAll = useCallback(async (): Promise<string[]> => {
    const failed: string[] = []
    for (const [key, buf] of [...buffers.current]) {
      if ((await window.prism.writeText(buf.path, buf.text)).ok) buffers.current.delete(key)
      else failed.push(buf.path)
    }
    syncDirty()
    return failed
  }, [syncDirty])
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
  const arriveInExplorer = useExplorerArrival(tabState, setTabState, arriveFromWindows, nextTabId, () => {
    if (fullscreen) setFs(false)
  })
  const [ask, setAsk] = useState<Ask | null>(null)
  /** "Save all changes" in an unsaved-changes question: write everything,
   *  then go on. A failed write must not close anything over the top of the
   *  text it failed to keep: we stay put and say which file. */
  const saveAllThen = useCallback(
    (then: () => void): void =>
      void saveAll().then((failed) => {
        if (failed.length) {
          setAsk({ kind: 'failed', message: `Couldn't save ${failed.map(baseName).join(', ')}.` })
          return
        }
        setAsk(null)
        then()
      }),
    [saveAll]
  )

  // Settings covers the tree, so over it the same control collapses that page's
  // rail instead: one button, one idea - narrow the panel on the left.
  const [compactRail, setCompactRail] = useState(compactRailPref.get)
  const toggleRail = useCallback(() => {
    setCompactRail((on) => {
      compactRailPref.set(!on)
      return !on
    })
  }, [])
  // A Ctrl+B or a click on the toggle while the panel PEEKS pins it where it
  // stands (#250): it is already out, so it must not slide in from nothing.
  const peekingRef = useRef(false)
  const pinPanel = useCallback(() => {
    if (active && isExplorerTab(active)) {
      setPlacesVisible(true)
      placesPref.set(true)
    } else {
      setSidebar(true)
      sidebarPref.set(true)
    }
  }, [active])
  const togglePanel = useCallback(() => {
    if (peekingRef.current && !settingsOpen) return pinPanel()
    if (settingsOpen) toggleRail()
    else if (active && isExplorerTab(active)) {
      if (active.browse.surface !== 'folder') return
      slidePanel()
      setPlacesVisible((visible) => {
        placesPref.set(!visible)
        return !visible
      })
    }
    else toggleSidebar()
  }, [settingsOpen, active, toggleRail, toggleSidebar, slidePanel, pinPanel])
  const pickTransport = useCallback((s: TransportStyle) => {
    setTransportStyle(s)
    saveTransportStyle(s)
  }, [])
  const pickTransportBg = useCallback((pct: number) => {
    setTransportBg(pct)
    saveTransportBg(pct)
  }, [])

  /**
   * A file or folder arriving from outside: argv, the second-instance handoff,
   * a drop, or either dialog. `receiveFile` decides where it lands - a tab whose
   * root already holds it, a new tab, or the empty window - and index -1 is a
   * folder that holds nothing viewable, which still opens as a place to browse
   * from rather than a refusal.
   */
  /**
   * Put the "New tabs show" setting into effect on the active tab: a terminal
   * in full view, nothing at all, or (the default) the folder's first file,
   * which is what the payload already carries.
   *
   * Shared by the + and by a FOLDER arriving from Explorer's menu, which is
   * the same act by another route and should not answer the question
   * differently.
   */
  const withNewTabShow = useCallback((st: TabState): TabState => {
    const show = newTabShow()
    const tab = st.tabs.find((t) => t.id === st.activeId)
    if (!tab) return st
    if (show === 'file') return { ...st, tabs: setBrowseSurface(st.tabs, tab.id, 'viewer') }
    if (show === 'terminal') {
      if (tab.term) return st
      const termId = nextTermId()
      termRoots.current.set(termId, tab.root)
      return { ...st, tabs: setTabTerm(st.tabs, tab.id, { id: termId, view: 'full' }) }
    }
    // The quiet start: the sidebar keeps the folder's files, but nothing
    // goes on screen (NoFileState) until the user picks one.
    return {
      ...st,
      tabs: setBrowseSurface(st.tabs, tab.id, 'viewer').map((item) =>
        item.id === tab.id ? { ...item, index: -1 } : item
      )
    }
  }, [])

  /** Each restored tab's saved place (#271), for the ones still arriving. */
  const restoreOrders = useRef(new Map<string, number>())
  /**
   * The user has clicked or typed in this page (review of #271). The restore
   * now sends the Explorer first and a project tab when it is ready, which can
   * be a transcript lookup later, so the saved active tab may land while the
   * window is already in use. It takes the front only if nobody has: a jump
   * after a click would take the click's target, and the keys after it, away.
   */
  const userActed = useRef(false)
  useEffect(() => {
    const acted = (e: Event): void => {
      if (e.isTrusted) userActed.current = true
    }
    window.addEventListener('pointerdown', acted, true)
    window.addEventListener('keydown', acted, true)
    return () => {
      window.removeEventListener('pointerdown', acted, true)
      window.removeEventListener('keydown', acted, true)
    }
  }, [])
  const open = useCallback(
    (p: OpenPayload | null) => {
      if (!p) return
      // A FOLDER from outside (Explorer's menu on a folder, or on the empty
      // space inside one): it roots a tab, and what that tab SHOWS is the "New
      // tabs show" setting, exactly as the + would decide it. A folder Prism
      // already has a tab for switches there instead of making a second - one
      // tab per root - and keeps whatever that tab was showing.
      if (p.folder && !p.restore) {
        // Decided INSIDE the update, against the tabs as they stand: a folder
        // arriving while the strip is still being restored would otherwise
        // look at an empty strip and make a second tab on the same root.
        setTabState((s) => {
          const hit = s.tabs.find(
            (t) => t.kind !== 'settings' && !isExplorerTab(t) && sameRoot(t.root, p.root)
          )
          return hit ? { ...s, activeId: hit.id } : withNewTabShow(addTab(s.tabs, p, nextTabId()))
        })
        setHasNavigated(false)
        return
      }
      // An Explorer tab's first frame has rows (#271): the listing main sent
      // with it goes into the shared snapshots before the tab exists.
      if (p.listing) visitedDirectories.remember(p.listing)
      setTabState((s) => {
        // A RESTORED tab is always its own tab: receiveFile's same-root fold is
        // for files arriving from outside, and folding a restore silently
        // deleted one of two tabs that shared a root. It goes back to its
        // saved place, whatever order the payloads arrive in (#271).
        const st = p.restore
          ? addRestoredTab(s.tabs, p, nextTabId(), (tabId) => restoreOrders.current.get(tabId))
          : receiveFile(s.tabs, p, nextTabId())
        // For a restore the tab in question is the one just added; for an
        // arrival it is whichever tab the payload landed in (now active).
        const target = st.tabs.find((t) => t.id === st.activeId)
        if (p.restore && target && p.restoreOrder !== undefined)
          restoreOrders.current.set(target.id, p.restoreOrder)
        let tabs = st.tabs
        // A restored tab that was showing its terminal comes back AS a terminal:
        // a fresh shell where the old one stood (sessions die with the app),
        // same view.
        if (p.term && target && !target.term) {
          const termId = nextTermId()
          // Where that shell WAS, which is the root unless "Open terminal
          // here" or a cd moved it (2026-09-09). Main has already checked it
          // is the root or inside it, so the wall's spawn check passes.
          const spawnAt = p.termCwd ?? target.root
          termRoots.current.set(termId, spawnAt)
          // The shell hosted a Claude session at close: the fresh one launches
          // straight into it (spawn carries the id; see TerminalPanel). The
          // session spawns NOW, tab in front or not - every tab's conversation
          // resumes at launch, not when its tab is first visited.
          if (p.agentResume) markResume(termId, p.agentResume)
          void import('prism-term-core/renderer/components/TerminalPanel').then((m) =>
            m.ensureTermSession(termId, spawnAt, savedShellId())
          )
          tabs = setTabTerm(tabs, target.id, { id: termId, view: p.term })
          // The other shells the tab held get their SLOTS now and spawn when
          // picked (2026-09-03): a hidden terminal never mounts a panel, and
          // the panel is what spawns.
          for (let k = 1; k < (p.terms ?? 1); k += 1) {
            const extra = nextTermId()
            termRoots.current.set(extra, target.root)
            tabs = tabs.map((t) => (t.id === target.id ? { ...t, terms: [...t.terms, extra] } : t))
          }
          const restored = tabs.find((t) => t.id === target.id)!
          for (const pane of p.panes ?? []) {
            if (pane.termSlot === undefined) continue
            const term = restored.terms[pane.termSlot]
            if (term)
              tabs = setTabPanes(
                tabs,
                target.id,
                pinTermPane(tabs.find((t) => t.id === target.id)!.panes, pane.id, term, pane.dir)
              )
          }
        }
        // A file ARRIVING means "show me this file" (2026-09-04), exactly as
        // a tree click does: over a FULL terminal it hides the shell (still
        // running) and gives the file the room. It used to land underneath
        // the terminal, unseen, and - since a full terminal marks nothing in
        // the tree - unmarked as well, so Explorer's double-click looked like
        // it had done nothing. In split the file lands in its pane as before.
        if (!p.restore && target?.term?.view === 'full')
          tabs = setTabTerm(tabs, target.id, { ...target.term, view: 'hidden' })
        // Background restores keep the focus where it is: restore arrives in
        // SAVED ORDER now (no more active-goes-last splice, which scrambled the
        // strip), and only the saved active tab takes the front, and only
        // while the user has not started using the window.
        const activeId =
          p.restore && (!p.restoreActive || userActed.current) && s.activeId ? s.activeId : st.activeId
        return {
          tabs:
            p.pinned && p.role === 'explorer'
              ? ensurePinnedExplorer(tabs, p, target?.id ?? nextTabId())
              : tabs,
          activeId
        }
      })
      setHasNavigated(false) // a fresh open starts in "opened directly" mode
    },
    [withNewTabShow]
  )

  // Pre-warm: a tab in front with no shell probably gets one soon. After a
  // short dwell, main starts it; opening the terminal then ADOPTS a running
  // shell instead of paying pwsh's startup at the click. The xterm chunk is
  // prefetched once at idle for the same reason.
  useEffect(() => {
    if (!active || active.kind === 'settings' || isExplorerTab(active) || active.term) return
    const t = setTimeout(() => window.prism.termPrewarm(active.root, savedShellId()), 900)
    return () => clearTimeout(t)
  }, [active])
  useEffect(() => {
    const t = setTimeout(() => void import('prism-term-core/renderer/components/TerminalPanel'), 4000)
    return () => clearTimeout(t)
  }, [])

  // A FILE WINDOWS HANDS OVER PLAYS (2026-09-14, #139, owner: "if you click a
  // video file and that video file opens in Prism, it should autoplay").
  // Explorer's double-click is a pick, exactly as a tree click is, and the
  // tree's pick has played since 2026-09-03; this one arrived paused because
  // it came through the same door a RESTORE does. The restore still does not
  // play - a window full of restored tabs starting every film at once is the
  // 2026-08-28 rule, and it stands - so the intent is recorded here, on the
  // way in, for an arrival that is not a restore and not a folder.
  const arrive = useCallback(
    (p: OpenPayload | null) => {
      // A FILE from outside: the Explorer's, not a project's (2026-09-22). A
      // film or a track still plays - it was picked.
      if (p?.explorerFile) {
        const name = baseName(p.explorerFile)
        const kind = fileKind(extOf(name), name)
        if (kind === 'video' || kind === 'audio') intendToPlay(window.prism.mediaUrl(p.explorerFile))
        arriveInExplorer(p.explorerFile)
        return
      }
      if (p && !p.restore && !p.folder) {
        const f = p.index >= 0 ? p.files[p.index] : undefined
        if (f && (f.kind === 'video' || f.kind === 'audio'))
          intendToPlay(window.prism.mediaUrl(f.path))
      }
      open(p)
    },
    [open, arriveInExplorer]
  )
  useEffect(() => window.prism.onOpenFile(arrive, () => setRestoring(false)), [arrive])
  // Fullscreen and the fade to black over its swap (lib/useFullscreenVeil).
  const { setFs, viewerBox, fsVeilOuter, fsVeilEl } = useFullscreenVeil({ setFullscreen, fullscreen })
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
  // Closing, and the update install that ends in a quit (lib/useWindowClose).
  const { update, leave, runInstall } = useWindowClose({ workingIds, tabs, setAsk, agentKinds, dirtyPaths, ask })
  /** The running version, for the window's "You have" line. Asked once. */
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    void window.prism.appVersion().then(setAppVersion)
  }, [])

  // Where the active tab is rooted, for handlers that must stay stable (the
  // + is handed to main once and must not be rebuilt whenever a tab changes).
  const activeRootRef = useRef<string | undefined>(undefined)
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeRootRef.current = tabs.find((t) => t.id === activeId)?.root
    activeIdRef.current = activeId
  }, [tabs, activeId])

  /** Where each shell last said it was (#99): its prompt's own report. A
   *  shell that has never reported (WSL, a shell still starting) is absent,
   *  and absent means Prism does not know, so it does not act. */
  const termCwd = useRef(new Map<string, string>())
  const [cwdRevision, setCwdRevision] = useState(0)
  /** Where each live session was SPAWNED, for the reroot policy: an untouched
   *  shell whose folder no longer matches its tab gets replaced; Clear also
   *  re-syncs a stale one. */
  const termRoots = useRef(new Map<string, string>())
  // The tabs: new, close, re-root, recent, pick, reorder (lib/useTabOps).
  const {
    restoreTermFocus,
    newTab,
    closeActiveTab,
    reorderTab,
    openRecent,
    pickTab,
    closeOneTab,
    discardTabBuffers,
    forceCloseTab,
    applyReroot,
    rerootHere
  } = useTabOps({
    setTabState,
    setHasNavigated,
    tabState,
    browsing,
    setup,
    fullscreen,
    setFs,
    termRoots,
    bufferOwners,
    buffers,
    tabs,
    syncDirty,
    agentKinds,
    termCwd,
    activeId,
    setAsk,
    workingIds,
    agentIds
  })

  const openAsProject = useCallback(
    (entry: BrowseEntry) => {
      const root = entry.isFolder ? entry.path : browseParent(entry.path)
      if (!root) return
      void (async () => {
        const folder = await window.prism.openRoot(root)
        if (!folder) {
          setAsk({ kind: 'failed', message: 'This folder cannot be opened as a project.' })
          return
        }
        const payload = entry.isFolder ? folder : await window.prism.openWithin(root, entry.path)
        if (!payload) return
        setTabState((state) => {
          return entry.isFolder
            ? addProjectTab(state.tabs, payload, nextTabId())
            : addTab(state.tabs, { ...payload, role: 'project' }, nextTabId())
        })
        setSidebar(true)
        sidebarPref.set(true)
        setHasNavigated(false)
      })()
    },
    []
  )

  /* ----- the terminal ----- */

  // The dock, the shells' roots and the tab's terminal view (lib/useTerminal).
  const {
    termFolder,
    pickDock,
    applyTermView,
    termTabAt,
    openTermFull,
    toggleTerm,
    dockEdge,
    termSizes,
    resizeTermPanel
  } = useTerminal({
    termRoots,
    termCwd,
    setTabState,
    active
  })
  // Tell main what is open, whenever it changes: persistence for next launch.
  // The root wall is deliberately NOT rebuilt from this snapshot. A report
  // races payloads still in flight (a restore, plus a file Explorer just
  // opened), and replacing the set once tore out a root main had registered
  // for a tab this renderer had not built yet - whose listDir was refused and
  // cached as "can't read this folder". Instead the wall shrinks only by
  // explicit drops: a root that stopped being held by ANY tab. A diff against
  // what we last held cannot remove what we never knew about.
  const heldRoots = useRef<readonly string[]>([])
  const hadTabs = useRef(false)
  useEffect(() => {
    const folderTabs = tabs.filter((t) => t.kind !== 'settings')
    const now = folderTabs.filter((t) => !isExplorerTab(t)).map((t) => t.root)
    for (const was of heldRoots.current) {
      if (!now.some((r) => sameRoot(r, was))) window.prism.dropRoot(was)
    }
    heldRoots.current = now
    // Mount says nothing (there is nothing to persist and no root to drop);
    // once a tab has existed, an empty list is real news: the last tab closed.
    if (folderTabs.length) hadTabs.current = true
    else if (!hadTabs.current) return
    window.prism.tabsChanged(
      folderTabs.map((t) => ({
        id: t.id,
        role: t.role,
        pinned: t.pinned,
        root: t.root,
        browse: t.browse,
        panes: t.panes.map((pane) => ({
          id: pane.id,
          path: pane.path,
          dir: pane.dir,
          ...(pane.term
            ? { termSlot: terminalRestoreOrder(t.terms, t.term?.id).indexOf(pane.term) }
            : {})
        })),
        file: t.files[t.index]?.path,
        // A visible terminal is part of what the tab IS: a Claude-session tab
        // must reopen as a terminal next launch, not as an empty viewer.
        term: t.term?.view,
        // How many shells, so a tab with three comes back with three slots.
        terms: t.terms.length > 1 ? t.terms.length : undefined,
        // WHERE that shell was standing (2026-09-09). The tab's root is not
        // the answer: "Open terminal here" spawns a shell in a subfolder and
        // deliberately leaves the root alone, and so does a cd inside it, so
        // restoring at the root put the shell somewhere the user had left -
        // and sent the agent resume to the root's newest conversation rather
        // than the one held down there. The shell's OWN report first (#99's
        // OSC 9;9, the truth), the folder it was spawned in as the fallback
        // for a shell that has not reported yet or never will (WSL, bash).
        cwd: t.term ? termFolder(t.term.id) : undefined,
        // Where you had got to in the tree. Not a per-tab setting - the tab is
        // still a root and a file - but closing Prism used to collapse
        // everything, so a file six folders down came back unmarked in a
        // sidebar that showed none of the rows leading to it.
        open: [...t.tree.expanded],
        // ...and one hosting claude or codex resumes its conversation on
        // restore, each by its own flag. 'other' agents have nothing to
        // come back to, so they are not recorded.
        agent: (() => {
          if (!t.term || !agentIds.has(t.term.id)) return undefined
          const kind = agentKinds.current.get(t.term.id)
          return kind === 'claude' || kind === 'codex' ? kind : undefined
        })()
      })),
      Math.max(
        0,
        folderTabs.findIndex((t) => t.id === activeId)
      )
    )
  }, [tabs, activeId, agentIds, agentKinds, cwdRevision, termFolder])


  // The shell ended: typed exit, or died. App owns this rather than the panel,
  // because it must be heard even while the panel is hidden or another tab is
  // in front - the tab's term slot has to clear either way.
  useEffect(
    () =>
      window.prism.onTermExit((id) => {
        disposeSession(id)
        forgetAgent(id)
        termRoots.current.delete(id)
        setTabState((s) => {
          // Out of the LIST, not only out of the current slot (2026-09-03):
          // a dead id left in `terms` was handed the dock back the moment
          // its replacement closed. A pane holding it goes with it, and the
          // most recent survivor - if any - takes over.
          const tab = s.tabs.find((t) => t.terms.includes(id))
          if (!tab) return s
          const pane = tab.panes.find((pn) => pn.term === id)
          const tabs = pane ? setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, pane.id)) : s.tabs
          return { ...s, tabs: removeTerm(tabs, tab.id, id) }
        })
      }),
    [forgetAgent]
  )
  /** Step the active tab by `delta`, wrapping, so Ctrl+Tab cycles. */
  const stepTab = useCallback((delta: number) => {
    setTabState((s) => {
      if (s.tabs.length < 2) return s
      const i = s.tabs.findIndex((t) => t.id === s.activeId)
      return { ...s, activeId: s.tabs[(i + delta + s.tabs.length) % s.tabs.length].id }
    })
  }, [])
  useInternalFileDrag(stepTab)
  /** Jump to the nth tab, 1-based, for Ctrl+1..Ctrl+9. */
  const jumpTab = useCallback((n: number) => {
    setTabState((s) => (s.tabs[n - 1] ? { ...s, activeId: s.tabs[n - 1].id } : s))
  }, [])
  /**
   * The sidebar's tree state belongs to the tab, so switching back to one shows
   * the folders you left open rather than a collapsed tree.
   *
   * It takes an updater rather than a value: Sidebar cannot hold the current
   * state (it does not own it any more), and the owner applying the update is
   * the only version of this that stays stable. An update that changes nothing
   * returns the same object, so a cached folder cannot re-render its way into a
   * loop through the effect that loads it.
   */
  const setTree = useCallback((id: string, update: (t: TreeState) => TreeState) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const tree = update(tab.tree)
      if (tree === tab.tree) return s
      return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, tree } : t)) }
    })
  }, [])
  /**
   * The folder changed and Prism did not change it (2026-08-30).
   *
   * Only folders a tab has ALREADY loaded are re-listed: a change deep in a
   * collapsed subtree is not a reason to go and read it. Nothing else is
   * touched - expansion is a separate Set, the rows are keyed by path so the
   * scroll position and the DOM nodes survive, and refreshKey is deliberately
   * NOT bumped, because that is what clears the selection.
   */
  useEffect(
    () =>
      window.prism.onDirChanged(({ root, dirs }) => {
        setTabState((s) => {
          for (const tab of s.tabs) {
            if (tab.kind === 'settings' || !sameRoot(tab.root, root)) continue
            for (const dir of dirs) {
              // Never fetch a folder this tab has not opened.
              if (!(dir in tab.tree.children)) continue
              const id = tab.id
              void window.prism.listDir(tab.root, dir).then((listing) => {
                if (!listing) return
                setTree(id, (tree) =>
                  dir in tree.children
                    ? { ...tree, children: { ...tree.children, [dir]: listing } }
                    : tree
                )
              })
            }
          }
          return s
        })
      }),
    [setTree]
  )

  /** Bound to the active tab, so Sidebar's handle is stable within a tab. */
  const onTree = useCallback(
    (update: (t: TreeState) => TreeState) => activeId && setTree(activeId, update),
    [activeId, setTree]
  )
  /**
   * The shell walked somewhere (#99): its tab follows. INSIDE the root the
   * tree expands to the folder and marks it (the root stays - a project tab
   * that rerooted on every `cd src` would throw the project away, and no
   * editor surveyed does that; Warp pins to the git root for the same
   * reason). OUTSIDE it the tab reroots to the folder, since the tree would
   * otherwise show nothing true. Same place, nothing. Only the tab's CURRENT
   * shell drives it; a pane's shell reports and is remembered, no more.
   *
   * The report is the prompt's, so it arrives once per prompt, including the
   * prompt after a Set-Location Prism wrote itself - which is why "same as
   * last time" is checked first: that echo is exactly a no-op.
   */
  const [revealReq, setRevealReq] = useState<{ tabId: string; path: string; seq: number } | null>(
    null
  )
  const revealSeq = useRef(0)
  useEffect(
    () =>
      onCwd((sessionId, path) => {
        const before = termCwd.current.get(sessionId)
        termCwd.current.set(sessionId, path)
        if (before && decideFollow(before, path) === 'same') return
        setCwdRevision((revision) => revision + 1)
        // The tab whose CURRENT shell this is. `tabs` is a dependency, so the
        // subscription is renewed with the state and never reads a stale list.
        const tab = tabs.find((t) => t.kind !== 'settings' && t.term?.id === sessionId)
        if (!tab) return
        const where = decideFollow(tab.root, path)
        if (where === 'same') return
        if (where === 'inside') {
          const chain = [...ancestorChain(tab.root, path), path]
          setTree(tab.id, (t) => {
            if (chain.every((c) => t.expanded.has(c))) return t
            const expanded = new Set(t.expanded)
            chain.forEach((c) => expanded.add(c))
            return { ...t, expanded }
          })
          revealSeq.current += 1
          setRevealReq({ tabId: tab.id, path, seq: revealSeq.current })
          return
        }
        // A shell report changes only its own cwd. Register desktop access,
        // but never move the browser cursor, project identity or phone share.
        void window.prism.browseDirectory(tab.id, path, { details: false })
      }),
    [setTree, tabs]
  )
  // A click in the tree: the folder it lives in becomes the paging list, the
  // root stays where it was, so the tree doesn't move under you.
  const openBrowseFile = browsing.openFile
  const openFromTree = useCallback(
    (path: string) => {
      if (!active) return
      const id = active.id
      void openBrowseFile(path).then((opened) => {
        if (opened && activeIdRef.current === id) setPaneFocus('live')
      })
    },
    [active, openBrowseFile]
  )
  /**
   * GO INTO AN ARCHIVE (#300): its card's Open. The Explorer walks into it
   * like a folder; a project's tree opens its node and shows it.
   */
  const openArchive = useCallback(
    (path: string) => {
      if (!active) return
      if (isExplorerTab(active)) {
        void browsing.navigate(path)
        return
      }
      const chain = [...ancestorChain(active.root, path), path]
      setTree(active.id, (t) => {
        if (chain.every((c) => t.expanded.has(c))) return t
        const expanded = new Set(t.expanded)
        chain.forEach((c) => expanded.add(c))
        return { ...t, expanded }
      })
      revealSeq.current += 1
      setRevealReq({ tabId: active.id, path, seq: revealSeq.current })
    },
    [active, browsing, setTree]
  )

  /**
   * Which window of a split the user is IN: the live pane, a pinned pane (by
   * id), or the terminal. The sidebar's selected row follows it - the file in
   * the focused window is the one marked, and a focused terminal marks none.
   * Tracked from real pointer-downs and focus, so it needs no plumbing through
   * the viewers: each region wears a data attribute and the listener resolves
   * the innermost one.
   */
  const [paneFocus, setPaneFocus] = useState<'live' | 'term' | string>('live')
  // Opening a file in split view refocuses the terminal panel as it re-docks;
  // that focus is mechanical, not the user choosing the shell, and must not
  // steal the selection from the file that was just opened.
  const ignoreTermFocusUntil = useRef(0)
  useEffect(() => {
    const resolve = (target: EventTarget | null): void => {
      const el = target instanceof Element ? target : null
      const region = el?.closest('[data-pane], [data-term-region]')
      if (!region) return
      if (region.hasAttribute('data-term-region')) {
        if (Date.now() >= ignoreTermFocusUntil.current) setPaneFocus('term')
        return
      }
      const kind = region.getAttribute('data-pane')
      if (kind === 'pinned') setPaneFocus(region.getAttribute('data-pane-id') ?? 'live')
      else setPaneFocus('live')
    }
    const down = (e: PointerEvent): void => resolve(e.target)
    const focus = (e: FocusEvent): void => resolve(e.target)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('focusin', focus, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('focusin', focus, true)
    }
  }, [])
  // The focused thing can vanish: its pane unpinned, the terminal hidden, the
  // tab switched. Focus falls back to the live pane rather than pointing at
  // nothing.
  useEffect(() => setPaneFocus('live'), [activeId])
  useEffect(() => {
    setPaneFocus((f) => {
      if (f === 'term') return active?.term && active.term.view !== 'hidden' ? f : 'live'
      if (f !== 'live' && !active?.panes.some((pn) => pn.id === f)) return 'live'
      return f
    })
  }, [active])

  const paneSeq = useRef(0)
  const openBrowseSplit = browsing.openSplit
  const pinSplit = useCallback(
    (path: string, dir?: SplitDir) => {
      if (active && isExplorerTab(active)) {
        openBrowseSplit(path)
        setPaneFocus('live')
        return
      }
      const d = dir ?? lastSplitDir()
      saveSplitDir(d)
      // Over a FULL terminal, "open in split view" means: this file, beside
      // the shell. The terminal drops to its split, docked on the side
      // OPPOSITE the one picked for the file, and the file opens live -
      // nothing gets pinned, this is the terminal/file split.
      if (active && active.kind !== 'settings' && active.term?.view === 'full') {
        const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const
        pickDock(opposite[d])
        applyTermView((term, id) => (term ? { ...term, view: 'split' } : { id, view: 'split' }))
        void window.prism.openWithin(active.root, path).then((p) => p && open(p))
        // The just-opened file is the one selected, not the shell the re-dock
        // is about to mechanically refocus.
        ignoreTermFocusUntil.current = Date.now() + 800
        setPaneFocus('live')
        return
      }
      // A re-pin keeps its pane (pinPane moves it), so focus its EXISTING id.
      const already = active?.panes.find((pn) => pn.path.toLowerCase() === path.toLowerCase())
      const paneId = already?.id ?? `pane-${Date.now()}-${(paneSeq.current += 1)}`
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab || tab.kind === 'settings') return s
        // A SPLIT STARTS FRESH from a single-item view (owner, 2026-09-03):
        // fullscreen and a full-view terminal both hide the grid, and a pin
        // made from there used to bring every old pane back with it. What
        // you could not see is not what you meant to add to.
        const base = fullscreen || tab.term?.view === 'full' ? [] : tab.panes
        return { ...s, tabs: setTabPanes(s.tabs, tab.id, pinPane(base, paneId, path, d)) }
      })
      setPaneFocus(paneId) // the freshly pinned file is where the eye went
    },
    [active, applyTermView, openBrowseSplit, open, pickDock, fullscreen]
  )
  const unpinSplitId = useCallback((paneId: string) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeId)
      if (!tab) return s
      return { ...s, tabs: setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, paneId)) }
    })
  }, [])
  const unpinSplitPath = useCallback((path: string) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeId)
      if (!tab) return s
      const hit = tab.panes.find((pn) => pn.path.toLowerCase() === path.toLowerCase())
      return hit ? { ...s, tabs: setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, hit.id)) } : s
    })
  }, [])
  // Several shells per tab and the split's panes (lib/useTermPanes).
  const {
    closeTermId,
    openTermSplit,
    pickTermId,
    openNewTerm,
    splitTermId,
    closeTerm,
    closeFilePane,
    pinTermAsPane,
    closeTermPane
  } = useTermPanes({
    applyTermView,
    active,
    termRoots,
    setTabState,
    setPaneFocus,
    termTabAt,
    paneSeqRef: paneSeq,
    fullscreen,
    unpinSplitId,
    openBrowseFile,
    open
  })

  /**
   * Split-view pins: "Open in split view" adds the file as a pane beside the
   * live one - agnostic of what else is showing, files beside files. The
   * direction is remembered, a bare click reuses it, and the fourth window
   * FIFO-evicts the oldest pin.
   */
  /** "Open in new tab": a fresh tab rooted at the file's folder, like an
   *  Explorer open would make, spawned unconditionally. */
  const openInNewTab = useCallback((path: string, knownFolder?: boolean) => {
    void (async () => {
      // Places know their kind even before their directory has a desktop grant.
      // browseDirectory validates that destination and grants desktop access;
      // statFile intentionally refuses paths outside the existing grants.
      const isFolder = knownFolder ?? (await window.prism.statFile(path))?.isFolder
      if (isFolder === undefined) return
      const root = isFolder ? path : browseParent(path)
      if (!root) return
      const id = nextTabId()
      const directory = await window.prism.browseDirectory(id, root)
      if (!directory) return
      visitedDirectories.remember(directory)
      const payload = isFolder
        ? { root, files: directory.listing.files, index: -1 }
        : await window.prism.openWithin(root, path)
      if (!payload) return
      setTabState((s) =>
        isFolder
          ? addExplorerTab(s.tabs, payload, id)
          : addTab(s.tabs, { ...payload, role: 'explorer' }, id)
      )
    })()
  }, [])
  /** The terminal menu's version: a new tab on the same root, shell in front. */
  /** A fresh tab rooted at `root`, with its terminal in front. */

  /**
   * "Open terminal here", on a folder in the tree (2026-08-31).
   *
   * An untouched project shell can be replaced at the requested folder.
   * A touched shell or agent stays alive; the new shell joins the same
   * project's terminal list. Explorer alone opens a separate project tab.
   *
   * The tab's own root does not move: this opens a shell somewhere, it does
   * not renavigate the window. The sidebar's folder button is the verb for
   * that, and it is deliberately a different button.
   */
  const openTermHere = useCallback((folder: string) => {
    if (!active || active.kind === 'settings') return
    if (isExplorerTab(active)) {
      termTabAt(folder)
      return
    }
    const term = active.term
    if (term && !isTouched(term.id) && !agentIds.has(term.id) && !agentKinds.current.has(term.id))
      closeTermId(term.id)
    const termId = nextTermId()
    termRoots.current.set(termId, folder)
    setTabState((s) => ({
      ...s,
      tabs: setTabTerm(s.tabs, active.id, { id: termId, view: 'full' })
    }))
    setPaneFocus('term')
  }, [active, agentIds, agentKinds, closeTermId, termTabAt])

  const toggleFullscreen = useCallback(() => setFs(!fullscreen), [fullscreen, setFs])

  // The visible list: every viewable sibling, in the chosen order, and the
  // open file's position among them. Sorting reuses the same file objects, so
  // mapping back to rawIndex keeps working. (A kind filter lived here once,
  // removed 2026-08-20: a forgotten filter read as missing files.)
  const sort = useSort()
  const view = useMemo(() => {
    if (!active || rawIndex < 0 || !active.files.length) return null
    const files = sortFiles(active.files, sort.field, sort.dir)
    return { files, index: Math.max(0, files.indexOf(active.files[rawIndex])) }
  }, [active, rawIndex, sort])

  const go = useCallback(
    (delta: number) => {
      if (!active || !view) return
      const next = Math.max(0, Math.min(view.files.length - 1, view.index + delta))
      if (next === view.index) return // already at the edge; not a navigation
      setRawIndex(active.files.indexOf(view.files[next]))
      setHasNavigated(true)
    },
    [active, setRawIndex, view]
  )

  const file = view?.files[view.index] ?? null
  const termView = active?.term?.view ?? 'hidden'
  const viewingFile =
    !!file && !!active && isExplorerTab(active) && !browsing.folder && termView !== 'full'
  // THE COLLAPSED PANEL PEEKS (#250): which panel is collapsed and could come
  // out over the content right now. Never over Settings (its rail collapses to
  // glyphs, it does not hide), the first-run setup or fullscreen, and on an
  // Explorer tab only over a folder, where the places panel lives.
  const titleBar = useTitleBarMode()
  const peekTarget =
    !active || fullscreen || setup || settingsOpen
      ? null
      : isExplorerTab(active)
        ? browsing.folder && active.browse.surface === 'folder' && !placesVisible
          ? `places:${active.id}`
          : null
        : !sidebar
          ? `tree:${active.id}`
          : null
  const peekPlaces = !!peekTarget?.startsWith('places:')
  const { phase: peekPhase, end: endPeek } = useSidebarPeek({
    target: peekTarget,
    // Each panel peeks from its own Sidebar position (#304).
    side: peekPlaces ? explorerSide : treeSide,
    zone: () => document.querySelector<HTMLElement>('.browse-workspace'),
    panel: () =>
      document.querySelector<HTMLElement>(
        peekPlaces ? '[data-testid="folder-browser"] .browse-places' : '[data-project-sidebar]'
      )
  })
  peekingRef.current = peekPhase === 'in'
  // The side the open tab's sidebar sits on: an Explorer tab's places, else
  // the project tree (#304).
  const workspaceSide = active && isExplorerTab(active) ? explorerSide : treeSide
  // The peeking panel's own toggle pins it; so does Ctrl+B (togglePanel).
  const pinFromPeek = useCallback(() => {
    endPeek()
    pinPanel()
  }, [endPeek, pinPanel])
  // Opening a file from a peeking tree is what the peek was FOR: it goes, and
  // the file has the window.
  const openFromPeekableTree = useCallback(
    (path: string) => {
      endPeek()
      openFromTree(path)
    },
    [endPeek, openFromTree]
  )
  const viewerDirectory = file
    ? (browseParent(file.path) ?? active?.browse.path)
    : active?.browse.path
  const returnToFolder = useCallback(() => {
    if (viewerDirectory && active && !sameRoot(viewerDirectory, active.browse.path))
      void browsing.navigate(viewerDirectory)
    else browsing.showFolder()
  }, [viewerDirectory, active, browsing])
  const [browseMenu, setBrowseMenu] = useState<{
    x: number
    y: number
    entry: BrowseEntry
    /** Several marked rows, when the press was on one of them (#257). */
    paths?: string[]
    canPaste?: boolean
    apps?: OpenWithApp[] | null
  } | null>(null)
  const browseMenuPath = browseMenu?.entry.path
  const browseMenuFolder = browseMenu?.entry.isFolder
  useEffect(() => {
    if (!browseMenuPath) return
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
  }, [browseMenuPath, browseMenuFolder, browseMenu?.x, browseMenu?.y])
  const [browseRename, setBrowseRename] = useState<BrowseEntry | null>(null)
  const [browseProps, setBrowseProps] = useState<(BrowseEntry & { drive?: BrowseDriveUsage }) | null>(null)
  const refreshFiles = useCallback(() => setRefreshKey((key) => key + 1), [])
  const reportPasteError = useCallback(
    (message: string) => setAsk({ kind: 'failed', message }),
    []
  )
  const pasteFiles = useFilePaste(refreshFiles, reportPasteError)
  // The pane shows the file on display, or nothing at all when a navigation
  // took that file away while the pane was open (`previewHeld`, #300 review):
  // it stays at its width with "Select a file to preview".
  const showBrowsePreview =
    browsing.folder &&
    !!active?.browse.preview &&
    (browsing.previewFile
      ? file?.path === browsing.previewFile.path
      : !file && !!active.browse.previewHeld)
  // The pane slides open and shut on its toggle (#207): `out` keeps it laid
  // out while it closes, `widthShown` holds it at 0px for an opening's first frame.
  const previewSlide = usePreviewSlide(showBrowsePreview, viewerBox)
  // A file's own text in the preview starts on the column header's line (#283;
  // owner, 2026-10-04: "the position of the sorting bar ... that's the height
  // I want the txt files to start at"): the pane takes the header's top, the
  // first line is centred in the header's band and the full view button
  // floats in that band at the right. Text read as source only; a Markdown
  // page, a picture or a film keeps the button's own strip above it.
  const previewFlush = !!file && file.kind === 'text' && !isMarkdown(file.name) && !editMode
  const headVars = explorerHeadVars(useExplorerSize())
  const explorerWidths = useExplorerWidths(
    placesVisible,
    previewSlide.widthShown
  )
  const togglePreview = useCallback(() => {
    // Only a pane that is really on screen slides shut, and only one that is
    // really off slides open; a preview switched on over a folder shows nothing.
    if (showBrowsePreview) previewSlide.start(true)
    else if (!active?.browse.preview) previewSlide.start(false)
    browsing.togglePreview()
  }, [showBrowsePreview, active?.browse.preview, previewSlide, browsing])
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
          message:
            'Some items could not be pinned. Check that they still exist and are accessible, then try again.'
        })
    },
    [active]
  )
  const browsePlaces = useMemo(
    () => [
      ...browsing.locations.map((location) => ({
        path: location.path,
        label: location.name,
        group: location.group === 'drive' ? ('This PC' as const) : ('Quick access' as const),
        known: location.known
      })),
      ...tabs
        .filter((tab) => tab.kind !== 'settings' && tab.terms.length > 0)
        .filter(
          (tab, index, all) => all.findIndex((other) => sameRoot(other.root, tab.root)) === index
        )
        .map((tab) => ({ path: tab.root, label: baseName(tab.root), group: 'Projects' as const }))
    ],
    [browsing.locations, tabs]
  )
  const canChangeTerminalFolder =
    !!active?.term &&
    !agentIds.has(active.term.id) &&
    !agentKinds.current.has(active.term.id) &&
    idleAtPrompt(active.term.id) &&
    termCwd.current.has(active.term.id)
  const terminalBrowseControls = active?.term ? (
    <div className="browse-terminal-actions">
      {/* Each carries an icon and its words: the words go when the Explorer
          is narrow, so the address field keeps the room (review of #268). */}
      {termView !== 'full' && (
        <button
          onClick={openTermFull}
          aria-label="Return to terminal"
          title={termFolder(active.term.id)}
        >
          <BrowseIcon name="terminal" />
          <span>Return to terminal</span>
        </button>
      )}
      <button
        aria-label="Terminal folder"
        title="Terminal folder"
        onClick={() => {
          const path = termFolder(active.term!.id)
          if (path) void browsing.navigate(path)
        }}
      >
        <BrowseIcon name="folder" />
        <span>Terminal folder</span>
      </button>
      {termView !== 'full' && (
        <button
          className="browse-cd"
          aria-label="Use folder in terminal"
          disabled={!canChangeTerminalFolder}
          title={
            canChangeTerminalFolder
              ? 'Change the idle terminal to this folder'
              : 'Available at an idle shell prompt with no agent or typed command'
          }
          onClick={() => {
            const term = active.term
            if (
              !term ||
              agentKinds.current.has(term.id) ||
              !idleAtPrompt(term.id) ||
              !termCwd.current.has(term.id)
            )
              return
            window.prism.termCd(term.id, active.browse.path)
          }}
        >
          <BrowseIcon name="cdHere" />
          <span>Use folder in terminal</span>
        </button>
      )}
    </div>
  ) : null
  /** The terminal's own find bar. Lives here because Ctrl+Shift+F is claimed
   *  in App's key handler, like every other key the shell does not keep. */
  const [termFind, setTermFind] = useState(false)


  /* ------------------------------------------------------------------ *
   * Every tab holding media keeps its player, and the strip only decides
   * which one you can SEE (2026-08-27). Handing the sound to a second,
   * hidden element was audible - a pause and an unpause at every switch -
   * because nothing but the element itself surviving is seamless.
   *
   * The order is a ref rather than state on purpose: it is derived from the
   * tabs in the same pass that renders them, and it only ever appends, so
   * there is nothing for a re-render to settle.
   * ------------------------------------------------------------------ */
  const deckOrder = useRef<string[]>([])
  const deck = useMemo(() => {
    const next = deckOf(tabs, deckOrder.current, activeId)
    deckOrder.current = next.order
    return next.entries
  }, [tabs, activeId])

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
  const [keepWarm, setKeepWarm] = useState(true)
  useEffect(() => {
    let cool: ReturnType<typeof setTimeout> | null = null
    const off = window.prism.onWindowState((st) => {
      if (cool) {
        clearTimeout(cool)
        cool = null
      }
      if (st.focused && !st.minimised) setKeepWarm(true)
      else cool = setTimeout(() => setKeepWarm(false), WARM_COOLDOWN_MS)
    })
    return () => {
      if (cool) clearTimeout(cool)
      off()
    }
  }, [])
  const warmOrder = useRef<string[]>([])
  const warm = useMemo(() => {
    const next = warmOf(tabs, warmOrder.current, activeId, keepWarm)
    warmOrder.current = next.order
    return next.entries
  }, [tabs, activeId, keepWarm])

  // Autoplay's landing: the next file of the SAME kind, however many images or
  // documents sit between - a folder of episodes plays like a season, whatever
  // else lives beside them. Stops quietly at the end of the folder.
  /**
   * The next (or previous) file of the SAME KIND, stepping over everything
   * else - what autoplay does at the end of a video, and what the video's own
   * right-click menu offers as Next / Previous (2026-08-27).
   *
   * Returns the index it would land on, or -1: the menu greys its rows out
   * with the same answer it would act on, so a row is never offered when
   * there is nothing on the other side of it.
   */
  const sameKindIndex = useCallback(
    (dir: 1 | -1): number => {
      if (!view) return -1
      const current = view.files[view.index]
      if (!current) return -1
      for (let i = view.index + dir; i >= 0 && i < view.files.length; i += dir) {
        if (view.files[i].kind === current.kind) return i
      }
      return -1
    },
    [view]
  )
  const stepSameKind = useCallback(
    (dir: 1 | -1) => {
      const i = sameKindIndex(dir)
      if (i < 0 || !active || !view) return
      const next = view.files[i]
      // The playlist carries its own intent (2026-08-28). Nothing autoplays on
      // open any more, so the file a finished video hands over to - and the
      // one the menu's Next reaches for while you are watching - has to say
      // "I was already playing" on its own behalf. Stepping away from a file
      // you had PAUSED lands paused, which is the same rule.
      if (file && wasPlaying(window.prism.mediaUrl(file.path)))
        intendToPlay(window.prism.mediaUrl(next.path))
      setRawIndex(active.files.indexOf(next))
    },
    [active, file, sameKindIndex, setRawIndex, view]
  )
  const advanceSameKind = useCallback(() => stepSameKind(1), [stepSameKind])

  // A different file closes the editor (render-phase adjustment, the sidebar's
  // pattern): the pencil applies to what you were looking at, not what's next.
  const [editedPath, setEditedPath] = useState<string | null>(null)
  if ((file?.path ?? null) !== editedPath) {
    setEditedPath(file?.path ?? null)
    setEditMode(false)
  }

  /* Undo and redo (2026-08-22), for the things Prism WRITES: moving,
     renaming, binning and duplicating. The text editor keeps its own Ctrl+Z
     inside a focused document; this stack only sees the file operations. */
  const [undoState, setUndoState] = useState<UndoState>(emptyUndo)
  // Undo is otherwise invisible when the change is off screen, so it says what
  // it did for a moment. Deliberately not a dialog: nothing to answer.
  const [undoNote, setUndoNote] = useState<string | null>(null)
  const noteTimer = useRef<number | null>(null)
  const flashUndo = useCallback((text: string): void => {
    setUndoNote(text)
    if (noteTimer.current) window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setUndoNote(null), 2600)
  }, [])
  const noteUndo = useCallback((entry: UndoEntry) => setUndoState((u) => remember(u, entry)), [])
  /** What a place inside an archive does (#300): its menus, keys and drops. */
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
  /** The list's empty space inside an archive was right-clicked (#300). */
  const [emptyMenu, setEmptyMenu] = useState<{ x: number; y: number } | null>(null)
  const browseArchive = browsing.listing?.archive ?? null

  // Renaming, new folders, deleting, moving, the drops that move, and undo
  // and redo over them (lib/useFileOps; the inverse table is lib/undoApply).
  const {
    redo,
    undo,
    onDropIntoTab,
    runDelete,
    runDeleteMany,
    runMove,
    runRename,
    onBrowseDropInto,
    makeNewFolder
  } = useFileOps({
    active,
    openBrowseFile,
    open,
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
  // The window's keys (lib/useAppKeys).
  useAppKeys({
    setup,
    settingsOpen,
    fullscreen,
    active,
    termView,
    browsing,
    viewerDirectory,
    pasteFiles,
    file,
    setBrowseRename,
    setAsk,
    viewingFile,
    returnToFolder,
    setFs,
    redo,
    undo,
    restoreTermFocus,
    toggleTerm,
    setTermFind,
    openTermFull,
    newTab,
    unpinSplitId,
    closeActiveTab,
    stepTab,
    jumpTab,
    togglePanel,
    go,
    treeNav,
    hasNavigated
  })

  // Warm the immediate neighbours (images only) so arrowing to them is instant.
  // The shared image cache holds them (and enforces the memory policy), so we just
  // fire the requests; ±1 is enough to make stepping feel seamless. Very large
  // files are skipped: warming one costs more (memory, decode jank) than it saves.
  useEffect(() => {
    if (!view) return
    // Wait for idle before warming neighbours. Load time is dominated by reading
    // the file, so firing these immediately makes two big neighbours compete with
    // the image the user is actually waiting for.
    const start = (): void => {
      for (const d of [-1, 1]) {
        const n = view.files[view.index + d]
        // An unknown size (#271) is warmed, as 0 (could not stat) always was.
        if (n && n.kind === 'image' && (n.size ?? 0) <= PRELOAD_MAX_BYTES) {
          preloadImage(window.prism.mediaUrl(n.path))
        }
      }
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start, { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(start, 400)
    return () => clearTimeout(t)
  }, [view])

  // Drag-and-drop (path via webUtils, since Electron removed File.path).
  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      if (!setup) setDragging(true)
    }
    const leave = (): void => setDragging(false)
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      if (setup) return
      // A drop on the terminal panel types the path there; it is not an open.
      if ((e.target as HTMLElement | null)?.closest?.('[data-term-panel]')) return
      // Prism's own rows carry paths in the payload, not as files. Dropping
      // one on the viewer means "show me this": a file opens here, a folder
      // becomes this tab's root. Archive members are not on disk, so they
      // are left to the archive view that owns them.
      const inside = dragPayload(e.dataTransfer)
      setDrag(null)
      if (inside?.kind === 'files') {
        const first = inside.paths[0]
        if (!first) return
        void window.prism.statFile(first).then((st) => {
          if (st?.isFolder) {
            if (active && isExplorerTab(active)) void browsing.navigate(first)
            else void window.prism.openRoot(first).then((payload) => {
              if (payload) open({ ...payload, folder: true })
            })
          } else void window.prism.openPath(first).then(open)
        })
        return
      }
      // A FILE dropped from Windows is a file from outside, and goes where a
      // double-click sends one: the Explorer tab (2026-09-22). A folder keeps
      // the route it always had.
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const dropped = window.prism.getDroppedPath(f)
      void window.prism.statFile(dropped).then((st) => {
        if (st && !st.isFolder) arrive({ explorerFile: dropped, files: [], index: -1, root: '' })
        else void window.prism.openPath(dropped).then(open)
      })
    }
    // The ring clears in the CAPTURE phase (2026-09-03): a drop on a sidebar
    // row stops propagation - rightly, or the window handler would also OPEN
    // what was dropped - and the bubble-phase clear then never ran, leaving
    // the accent ring around the viewer until restart. Capture fires before
    // any child can swallow the event, and dragend covers a drag that ends
    // with no drop at all.
    const end = (): void => setDragging(false)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('drop', end, true)
    window.addEventListener('dragend', end, true)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('drop', end, true)
      window.removeEventListener('dragend', end, true)
    }
  }, [active, arrive, browsing, open, setup])

  // The style's light belongs to an empty window, a visualizer, or a page of
  // Prism's own - never behind someone's photo.
  const washed = settingsOpen || setup || !file || file.kind === 'audio'

  const many = (view?.files.length ?? 0) > 1
  // No folder position over a FULL terminal either: it counts a file that
  // isn't on screen.
  const pos = many && termView !== 'full' ? `${view!.index + 1} / ${view!.files.length}` : ''

  // What both shapes of the chrome carry (#250): the bar and the tab row draw
  // the same toggle, chip and strip from one place.
  const panelPinned = settingsOpen
    ? !compactRail
    : active && isExplorerTab(active)
      ? placesVisible
      : sidebar
  const panelToggle = viewingFile && !settingsOpen ? undefined : togglePanel
  // Only markdown takes the pencil. Code and plain text have no rendered form
  // to leave, so they are simply editable where they sit. A FULL terminal
  // hides it: the document is not on screen to edit, the same reason the bar
  // drops the file's name there.
  // A member of an archive is read-only (#300): no pencil.
  const editable =
    termView !== 'full' && file?.kind === 'text' && isMarkdown(file.name) && !file.member
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
    workingIds,
    doneIds,
    agentIds,
    onDropFile: openInNewTab,
    onDropIntoTab,
    onReorder: reorderTab,
    onOpenRecent: openRecent,
    onPick: pickTab,
    onClose: closeOneTab,
    onNew: newTab,
    wash: washed
  }
  const askAnswers: AskAnswers = {
    dismiss: () => setAsk(null),
    unsavedNames,
    runDelete: (path) => void runDelete(path),
    runDeleteMany: (paths) => void runDeleteMany(paths),
    runMove: (paths, dest, mode) => void runMove(paths, dest, mode),
    runRename: (path, name, onClash) => void runRename(path, name, onClash),
    leave,
    discardAll: () => {
      buffers.current.clear()
      syncDirty()
    },
    saveAllThen,
    discardTabBuffers,
    forceCloseTab,
    applyReroot,
    answerReload: (path, reload) => setReloadAnswer({ path, reload }),
    runInstall
  }

  // Fullscreen is for watching, not browsing: no tree, no arrows, no chrome.
  // Outside fullscreen the panel stays mounted even when closed, so it can slide.
  return (
    <div className="prism-desktop flex h-full flex-col text-[var(--p-text)] [font-size:var(--p-size)]">
      {/* "Copied", at the bottom centre, for every terminal copy (#215): the
          core's badge, answering the core's copyText. */}
      <CopiedBadge />
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
          // The tree already names (and highlights) the open file; the bar only
          // repeats it when the tree isn't there to say it. A FULL terminal
          // names nothing: the file it would name is not what's on screen.
          name={
            !active || isExplorerTab(active) || settingsOpen || sidebar || termView === 'full'
              ? '' : (file?.name ?? '')
          }
          pos={pos}
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
            {pos && <span className="text-[var(--p-dim)]">{pos}</span>}
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
            onDropInto={onBrowseDropInto}
            fileName={file?.name}
            canBack={active.browse.cursor > 0}
            canForward={active.browse.cursor < active.browse.history.length - 1}
            onReturnToFolder={returnToFolder}
            onBack={() => browsing.travel(-1)}
            onForward={() => browsing.travel(1)}
            onUp={returnToFolder}
            onNavigate={(path) => void browsing.navigate(path)}
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
        style={
          active && isExplorerTab(active)
            ? ({ ...explorerWidths.style, ...headVars } as CSSProperties)
            : undefined
        }
        data-preview-sliding={previewSlide.sliding || undefined}
        data-sidebar-side={workspaceSide === 'right' ? 'right' : undefined}
        className={`browse-workspace relative flex min-h-0 flex-1 ${browsing.folder ? 'is-browsing' : ''} ${workspaceSide === 'right' ? 'flex-row-reverse' : ''} ${
          settingsOpen || setup ? 'invisible' : ''
        }`}
      >
        {/* The job chip floats when the panel is shut (2026-09-03): the sidebar
            footer is its home, and a paste must stay visible either way. */}
        {active && active.kind !== 'settings' && !fullscreen && !sidebar && <JobChip floating />}
        {active && isExplorerTab(active) && browsing.folder && !fullscreen && placesVisible && (
          <ExplorerResize
            section="places"
            bounds={explorerWidths.bounds.places}
            onResize={(width) => explorerWidths.resize('places', width)}
            onLive={(width) => explorerWidths.live('places', width)}
            edge={explorerSide}
          />
        )}
        {active && active.kind !== 'settings' && !fullscreen && (
          <Sidebar
            open={sidebar && !isExplorerTab(active)}
            sliding={panelSliding}
            peek={peekPlaces ? null : peekPhase}
            onPin={pinFromPeek}
            root={active.root}
            tabId={active.id}
            onOpenFolder={rerootHere}
            onToggleTerm={toggleTerm}
            termOpen={termView !== 'hidden'}
            onPinSplit={pinSplit}
            onUnpinSplit={unpinSplitPath}
            pinnedPaths={active.panes.map((pn) => pn.path)}
            onOpenNewTab={openInNewTab}
            onOpenProject={(path, isFolder) => openAsProject({ path, name: path, isFolder })}
            onTermHere={openTermHere}
            onTermSplit={openTermSplit}
            terms={active.terms.map((id) => ({
              id,
              label:
                termLabel(active, id) +
                (agentIds.has(id) && agentKinds.current.get(id)
                  ? ` · ${agentKinds.current.get(id)}`
                  : ''),
              current: active.term?.id === id,
              // On screen now: the current shell while it is showing, or one
              // pinned as a pane. What the split checklist ticks.
              shown:
                (active.term?.id === id && active.term.view !== 'hidden') ||
                active.panes.some((pn) => pn.term === id)
            }))}
            onPickTerm={pickTermId}
            onNewTerm={openNewTerm}
            onCloseTermId={closeTermId}
            onSplitTermId={splitTermId}
            onCloseTerm={active.term ? closeTerm : null}
            state={active.tree}
            onTree={onTree}
            reveal={revealReq && revealReq.tabId === active.id ? revealReq : null}
            // The selected row follows what is ON SCREEN: a pinned pane marks
            // its file, the terminal marks nothing - in a split when it holds
            // the focus, and in FULL view always, where the viewer is not
            // showing anything at all - and otherwise the open file.
            currentPath={
              paneFocus === 'term' || termView === 'full'
                ? null
                : (active.panes.find((pn) => pn.id === paneFocus)?.path ?? file?.path ?? null)
            }
            // Only the open file can hold unsaved text, so one flag is enough
            // to mark the one row that needs marking.
            dirtyPaths={dirtyPaths}
            onNav={onNav}
            refreshKey={refreshKey}
            onOpenFile={openFromPeekableTree}
            // Renaming or binning the edited file (or a folder over it) would
            // silently drop the editor's unsaved text; those ask first too.
            onRename={(p, name) => runRename(p, name, 'ask')}
            onDelete={(path, name, isFolder) => setAsk({ kind: 'delete', path, name, isFolder })}
            onDeleteMany={(paths) => setAsk({ kind: 'delete-many', paths })}
            onDropInto={onBrowseDropInto}
            archive={archiveActions}
            onDuplicated={(source, copy) => noteUndo({ kind: 'duplicate', source, path: copy })}
            onNewFolder={makeNewFolder}
            wash={washed}
          />
        )}
        <div
          className="relative flex min-w-0 min-h-0 flex-1"
          style={{ flexDirection: dockFlex(dockEdge) }}
        >
          {browsing.folder && active && browsing.location && !fullscreen && (
            <div className="browse-surface-host absolute inset-0">
              <FolderBrowser
                directory={active.browse.path}
                onDropInto={onBrowseDropInto}
                listing={browsing.listing}
                pending={browsing.pending}
                pendingPath={browsing.pendingPath}
                error={browsing.error}
                places={browsePlaces}
                quickAccess={quickAccess}
                readDrives={window.prism.browseDrives}
                onQuickAccessFile={(path, full) => void openBrowseFile(path, full ?? !active.browse.preview)}
                onUnpinQuickAccess={unpinQuickAccess}
                onMoveQuickAccess={moveQuickAccess}
                onPinQuickAccessPaths={(paths, beforePath) =>
                  void pinQuickAccessPaths(paths, beforePath)
                }
                placesVisible={isExplorerTab(active) ? placesVisible : false}
                placesSliding={isExplorerTab(active) && panelSliding}
                placesPeek={peekPlaces ? peekPhase : null}
                side={explorerSide}
                onPinPlaces={pinFromPeek}
                onPlacePicked={endPeek}
                onOpenProject={isExplorerTab(active) ? openAsProject : undefined}
                onOpenNewTab={openInNewTab}
                searchState={browsing.searchState}
                onSearchRange={browsing.searchRange}
                onCancelSearch={browsing.cancelSearch}
                owner={active.id}
                selectedPath={browsing.location.selected}
                scrollTop={browsing.location.scrollTop}
                query={browsing.location.query}
                sort={browsing.sort}
                downloads={browsing.downloads}
                weekStart={browsing.weekStart}
                canBack={active.browse.cursor > 0}
                canForward={active.browse.cursor < active.browse.history.length - 1}
                onNavigate={(path) => void browsing.navigate(path)}
                onBack={() => browsing.travel(-1)}
                onForward={() => browsing.travel(1)}
                onUp={() => {
                  const parent = browseParent(active.browse.path)
                  if (parent) void browsing.navigate(parent)
                }}
                onSelect={browsing.select}
                onOpen={(file) => void browsing.openFile(file)}
                onScroll={(scrollTop) => browsing.patch({ scrollTop })}
                onQueryChange={browsing.searchFor}
                // A header click is a pick made here (#285): Downloads keeps it.
                onSortChange={(sort) => {
                  crumb('sort', { key: sort.key, direction: sort.direction })
                  browsing.patch({ sort, sortChosen: true, scrollTop: 0 })
                }}
                onNewTerminal={termTabAt}
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
                  void makeNewFolder(directory).then((made) => {
                    if (!made) return
                    setRefreshKey((key) => key + 1)
                    browsing.select(made, true)
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
                onRefresh={() => {
                  void window.prism
                    .refreshFolderSizes(active.browse.path)
                    .catch(() => {})
                    .finally(() => {
                      setRefreshKey((key) => key + 1)
                    })
                }}
                onContextMenu={(event, entry, _source, paths) =>
                  setBrowseMenu({ x: event.clientX, y: event.clientY, entry, paths })
                }
                previewEnabled={active.browse.preview}
                previewVisible={previewSlide.out}
                onPreviewToggle={togglePreview}
                terminalControls={terminalBrowseControls}
                covered={!!ask || update.state.open || settingsOpen || !!setup}
              />
            </div>
          )}
          {showBrowsePreview && !previewSlide.sliding && !fullscreen && (
            <ExplorerResize
              section="preview"
              bounds={explorerWidths.bounds.preview}
              onResize={(width) => explorerWidths.resize('preview', width)}
              onLive={(width) => explorerWidths.live('preview', width)}
              edge={explorerSide === 'right' ? 'left' : 'right'}
            />
          )}
          {!browsing.folder &&
            active &&
            isExplorerTab(active) &&
            termView === 'full' &&
            !fullscreen && (
              <div className="browse-return-row">
                <button onClick={browsing.showFolder} title="Return to folder">
                  Browse files
                </button>
                <span
                  title={
                    termView === 'full' && active.term
                      ? termFolder(active.term.id)
                      : active.browse.path
                  }
                >
                  {termView === 'full' && active.term
                    ? termFolder(active.term.id)
                    : active.browse.path}
                </span>
                {terminalBrowseControls}
              </div>
            )}
          <div
            // As the Explorer's PREVIEW the box sits over the folder
            // browser, which already paints the window's ground there: it
            // paints nothing of its own (#294; owner, 2026-10-06: "the
            // preview also isn't acrylic"), since a second see-through coat
            // is an opaque pane on glass. A file of its own, or full screen,
            // has nothing under it and paints the ground itself.
            className={`group relative flex min-w-0 min-h-0 flex-1 items-center justify-center overflow-hidden ${
              previewSlide.out && !fullscreen ? '' : `bg-[var(--p-bg)] ${washed ? 'p-wash' : ''}`
            } ${dragging ? 'ring-2 ring-inset ring-[var(--p-accent-solid)]' : ''} ${
              // Full view: the terminal takes the whole area, but the viewer
              // stays MOUNTED so scroll, zoom and playback survive the visit -
              // the same reason hidden shells stay alive.
              termView === 'full' || (browsing.folder && !fullscreen && !previewSlide.out)
                ? 'hidden'
                : ''
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
            {(() => {
              // The tabs' own players, all of them mounted, only one on screen.
              // Absolutely placed so the hidden ones take no room and the
              // visible one fills the pane exactly as a viewer always did.
              // A background tab answers nothing: no paging, no stepping.
              const noop = (): void => {}
              const players = deck.map((e) => (
                <div
                  key={e.tabId}
                  data-player-tab={e.tabId}
                  inert={
                    e.tabId !== activeId ||
                    (browsing.folder && !showBrowsePreview) ||
                    termView === 'full'
                  }
                  aria-hidden={e.tabId === activeId ? undefined : true}
                  className={
                    e.tabId === activeId
                      ? 'absolute inset-0'
                      : 'pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0'
                  }
                >
                  <Viewer
                    file={e.file}
                    background={e.tabId !== activeId || (browsing.folder && !showBrowsePreview)}
                    volumeKey={e.tabId}
                    onUndoable={noteUndo}
                    onRenameSelf={(name) => void runRename(e.file.path, name, 'ask')}
                    refreshKey={refreshKey}
                    onToggleFullscreen={toggleFullscreen}
                    fullscreen={fullscreen}
                    transportStyle={transportStyle}
                    transportBg={transportBg}
                    onOpenLocal={openFromTree}
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
                    note={!browsing.folder}
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
                    {warm.map((w) => (
                      <div
                        key={w.tabId}
                        inert={
                          w.tabId !== activeId ||
                          (browsing.folder && !showBrowsePreview) ||
                          termView === 'full'
                        }
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
                          onOpenLocal={openFromTree}
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
                          note={!browsing.folder}
                        />
                      </div>
                    ))}
                    {!file && active && (browsing.folder ? <PreviewEmpty /> : <NoFileState />)}
                  </>
                ) : file ? // a transparent ring, which is where it showed through. // why it went unseen for months, and the audio visualizer is // player either way: a film's picture covers it, which is // with the nothing-open notice. It was drawn under the // BY DESIGN, and this branch used to answer that emptiness // Media lives in the PLAYER deck, so `warm` is empty for it // FLAC opened with "No file selected" written across it). // A FILM OR A TRACK IS NOT "no file" (2026-09-08, owner: a
                // There IS a file here; the player above is drawing it.
                null : active ? (
                  browsing.folder ? <PreviewEmpty /> : <NoFileState />
                ) : restoring ? (
                  // NOTHING TO READ WHILE THE TABS ARRIVE (#271; owner,
                  // 2026-10-04: "I don't ever want to see that"). The Explorer
                  // tab is sent first, from the cache or a names-only read, so
                  // this is a frame or two of plain ground, never a message.
                  <div aria-hidden="true" className="h-full" />
                ) : (
                  <EmptyState onNewTab={newTab} onOpenFolder={rerootHere} />
                )
              // While the terminal is FULL its panes are drawn in the terminal
              // area, not here: this grid sits hidden behind it, and mounting a
              // shell's panel twice would attach one xterm to one session twice.
              const pins = (
                browsing.folder || (active && isExplorerTab(active)) ? [] : (active?.panes ?? [])
              ).filter(
                (pn) => termView !== 'full' || !pn.term
              )
              const withPlayers = (
                <>
                  {players}
                  {liveContent}
                </>
              )
              if (!pins.length || fullscreen) return withPlayers
              // The quadrant grid: the live pane plus up to three pinned files,
              // hairline-separated, one window per corner at the full four.
              const areas = paneAreas(pins)
              return (
                <div
                  className="grid h-full w-full gap-px bg-[var(--p-divider)]"
                  style={{ gridTemplateRows: '1fr 1fr', gridTemplateColumns: '1fr 1fr' }}
                >
                  <div
                    data-pane="live"
                    className="group/live relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[var(--p-bg)]"
                    style={{ gridArea: areas.live }}
                  >
                    {withPlayers}
                    {/* Its own X, like every pinned pane: closing the live
                      window promotes the oldest pin, the rest stand. */}
                    <button
                      className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover/live:opacity-100"
                      onClick={closeFilePane}
                      title="Remove from split view"
                      aria-label="Remove the open file from split view"
                    >
                      <Icon name="close" size={11} weight="2.2" join={false} />
                    </button>
                  </div>
                  {pins.map((pn, i) => (
                    <PinnedPaneView
                      key={pn.id}
                      paneId={pn.id}
                      path={pn.path}
                      area={areas.pinned[i]}
                      dir={pn.dir}
                      term={pn.term}
                      termRoot={
                        pn.term ? (termRoots.current.get(pn.term) ?? active?.root ?? '') : undefined
                      }
                      shellId={pn.term ? savedShellId() : undefined}
                      onMove={(d) => (pn.term ? pinTermAsPane(pn.term, d) : pinSplit(pn.path, d))}
                      onClose={() => unpinSplitId(pn.id)}
                      viewerProps={{
                        onUndoable: noteUndo,
                        // A pinned pane renames the file IT holds, not the one
                        // in the main viewer.
                        onRenameSelf: (name: string) => void runRename(pn.path, name, 'ask'),
                        refreshKey,
                        onToggleFullscreen: toggleFullscreen,
                        fullscreen,
                        transportStyle,
                        transportBg,
                        onOpenLocal: openFromTree,
                        onAutoAdvance: () => {},
                        onStep: () => {},
                        canStep: () => false,
                        onBuffer,
                        getPending,
                        onExternalChange,
                        reloadAnswer,
                        volumeKey: `${activeId ?? ''}:pin:${pn.path}`
                      }}
                    />
                  ))}
                </div>
              )
            })()}
            {/* No on-screen arrows: paging is the keyboard's job. Left and right,
              up and down, PageUp and PageDown, in or out of fullscreen. */}
            {/* The region-level X only when the region IS one window: with the
              pane grid up, each window carries its own. */}
            {termView === 'split' && !fullscreen && !active?.panes.length && (
              <button
                className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
                onClick={closeFilePane}
                title="Remove from split view"
                aria-label="Remove the file from the split"
              >
                <Icon name="close" size={11} weight="2.2" join={false} />
              </button>
            )}
          </div>
          {/* The tab's shell, when it is visible. Only the ACTIVE tab's panel is
            in the DOM; hidden tabs' sessions stay alive in the store, and
            coming back reattaches them with scrollback intact. Full view is
            the terminal's home; split is the dock. Fullscreen is for watching:
            no terminal, like the rest of the chrome. */}
          {active?.term &&
            termView !== 'hidden' &&
            !fullscreen &&
            (() => {
              const dock = (
                <TermDock
                  mode={termView}
                  onClose={closeTermPane}
                  onKill={closeTerm}
                  edge={dockEdge}
                  size={termSizes[dockAxis(dockEdge)]}
                  onResize={resizeTermPanel}
                  onDockPick={pickDock}
                  sessionId={active.term.id}
                  root={termRoots.current.get(active.term.id) ?? active.root}
                  shellId={savedShellId()}
                  find={termFind}
                  onFind={setTermFind}
                  // Only while the setting is on: off, the app offers it nowhere.
                />
              )
              // TERMINALS ONLY, in full view (owner, 2026-09-03): the shells
              // pinned as panes share the terminal's own area with it - the
              // current one in the live slot - and no file pane is drawn.
              const termPanes = active.panes.filter((pn) => !!pn.term)
              if (termView !== 'full' || !termPanes.length) return dock
              const ta = paneAreas(termPanes)
              return (
                <div
                  className="grid min-h-0 min-w-0 flex-1 gap-px bg-[var(--p-divider)]"
                  data-workspace-term-grid
                  style={{ gridTemplateRows: '1fr 1fr', gridTemplateColumns: '1fr 1fr' }}
                >
                  <div className="flex min-h-0 min-w-0" style={{ gridArea: ta.live }}>
                    {dock}
                  </div>
                  {termPanes.map((pn, i) => (
                    <PinnedPaneView
                      key={pn.id}
                      paneId={pn.id}
                      path={pn.path}
                      area={ta.pinned[i]}
                      dir={pn.dir}
                      term={pn.term}
                      termRoot={termRoots.current.get(pn.term ?? '') ?? active.root}
                      shellId={savedShellId()}
                      onMove={(d) => pinTermAsPane(pn.term ?? '', d)}
                      onClose={() => unpinSplitId(pn.id)}
                    />
                  ))}
                </div>
              )
            })()}
        </div>
      </div>
      <Settings
        open={settingsOpen}
        onShowSetup={() => {
          closeSettingsTab()
          setSetup(true)
        }}
        compactRail={compactRail}
        onClose={closeSettingsTab}
        transportStyle={transportStyle}
        onPickTransport={pickTransport}
        transportBg={transportBg}
        onPickTransportBg={pickTransportBg}
      />

      <AskDialogs ask={ask} layer="under" answers={askAnswers} />

      {/* What undo just did, said quietly and briefly: the change is often
          off screen, and a dialog would be asking a question nobody has. */}
      {undoNote && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-3.5 py-1.5 text-[12px] text-[var(--p-text-soft)] shadow-[0_10px_28px_rgba(0,0,0,.45)]"
        >
          {undoNote}
        </div>
      )}

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


      {browseMenu && (
        <ContextMenu
          x={browseMenu.x}
          y={browseMenu.y}
          onClose={() => setBrowseMenu(null)}
          items={archiveActions.menu(
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
              openFile: (file) => void browsing.openFile(file),
              newTerminalAt: (path) => termTabAt(path),
              showInPreview: (path) => {
                pinSplit(path)
              },
              openInNewTab,
              openAsProject,
              copyFiles: (paths, cut) => void copyFilePaths(paths, cut),
              paste: (directory) => void pasteFiles(directory),
              pinQuickAccess,
              unpinQuickAccess,
              duplicate: (path) => {
                void window.prism.duplicateFile(path).then((copy) => {
                  if (copy) {
                    noteUndo({ kind: 'duplicate', source: path, path: copy })
                    setRefreshKey((key) => key + 1)
                  }
                })
              },
              rename: (entry) => setBrowseRename(entry),
              askDelete: (entry) =>
                setAsk({ kind: 'delete', path: entry.path, name: entry.name, isFolder: entry.isFolder }),
              askDeleteMany: (paths) => setAsk({ kind: 'delete-many', paths }),
              properties: (entry) => setBrowseProps(entry)
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
      {archiveActions.dialogs}
      {browsing.archiveAsk && (
        <PasswordDialog
          name={browsing.archiveAsk.name}
          wrong={browsing.archiveAsk.wrong}
          onSubmit={(pw) => browsing.answerArchive(pw)}
          onCancel={() => browsing.answerArchive(null)}
        />
      )}
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
      {browseRename && (
        <BrowseRename
          name={browseRename.name}
          onCancel={() => setBrowseRename(null)}
          onSave={(name) => {
            void runRename(browseRename.path, name, 'ask')
            setBrowseRename(null)
          }}
        />
      )}
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
          // The Settings tab owns no root; the dialog then says to open a
          // folder rather than offering a code for nowhere.
          root={active && active.kind !== 'settings' ? active.root : null}
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
