import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import { crumb } from 'prism-term-core/renderer/lib/diag'
import { tabCrumbs } from '../lib/tabs/tabCrumbs'
import {
  closeTab,
  toggleSettingsTab,
  settingsCloseIsLast,
  settingsEscapeCloses,
  type Tab,
  type TabState
} from '../lib/tabs/tabs'

// The open tabs and what App does with them directly (audit #8, 2026-11-21):
// the one tab state, the Settings tab, stepping between tabs, the crumbs on
// the diagnostics timeline and the list main persists. Moved out of App.tsx
// unchanged.

export interface AppTabs {
  tabState: TabState
  setTabState: Dispatch<SetStateAction<TabState>>
  restoring: boolean
  setRestoring: Dispatch<SetStateAction<boolean>>
  tabs: Tab[]
  activeId: string | null
  active: Tab | null
  rawIndex: number
  settingsOpen: boolean
  tabStateNow: MutableRefObject<TabState>
  activeIdRef: MutableRefObject<string | null>
  tabsRef: MutableRefObject<Tab[]>
  toggleSettings: () => void
  closeSettingsTab: () => void
  putSettingsAway: () => void
  showNothing: () => void
  setRawIndex: (i: number) => void
  stepTab: (delta: number) => void
  jumpTab: (n: number) => void
}

export function useAppTabs(): AppTabs {
  // The open tabs. A tab carries every viewable sibling main found for its
  // folder and which of them is on screen; `active` is the one you are looking at.
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
  // to, a file reaching the player. Read off the state
  // (lib/tabs/tabCrumbs), since a tab changes from a dozen places.
  const crumbedTabs = useRef<TabState>({ tabs: [], activeId: null })
  useEffect(() => {
    for (const c of tabCrumbs(crumbedTabs.current, tabState)) crumb(c.a, c.fields, { often: c.often })
    crumbedTabs.current = tabState
  }, [tabState])
  const rawIndex = active?.index ?? -1
  const settingsOpen = active?.kind === 'settings'
  // Settings rides the strip as a tab of its own kind, so it can be flipped
  // to and from like any other. `settingsOpen` is simply "the settings tab is
  // in front"; the page itself stays mounted underneath either way, keeping
  // its own internal state.
  const settingsSeq = useRef(0)
  // The strip as it stands, for the Settings closes below: whether one would
  // leave no tab is decided before the state changes, not inside an updater.
  const tabStateNow = useRef(tabState)
  useEffect(() => {
    tabStateNow.current = tabState
  }, [tabState])
  const toggleSettings = useCallback(() => {
    const now = tabStateNow.current
    // Settings as the last tab: the gear closes the window, like any last
    // tab (review, 2026-10-28; it left an empty window).
    if (settingsCloseIsLast(now.tabs, now.activeId)) return window.prism.close()
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
  /** Settings' Escape: it puts the page away only when another tab is left.
   *  ESCAPE NEVER CLOSES THE WINDOW (#14, owner, 2026-11-01: "escape should
   *  not interact with app close"); this used to close it from the last tab. */
  const putSettingsAway = useCallback(() => {
    if (settingsEscapeCloses(tabStateNow.current.tabs)) closeSettingsTab()
  }, [closeSettingsTab])
  /**
   * Show NOTHING in the active tab, without closing it (2026-09-02).
   *
   * `index: -1` is the state a tab already has when its folder holds nothing
   * viewable, and NoFileState is what renders there. Deleting the last file
   * used to close the tab instead: a tab that vanishes takes its folder with
   * it, and only an explicit close takes a tab (the last one takes the
   * window after the unsaved-text ask, as File Explorer does; owner,
   * 2026-10-28). Paste a file into an empty
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
  const activeIdRef = useRef<string | null>(null)
  // Where the active tab is rooted, for handlers that must stay stable (the
  // + is handed to main once and must not be rebuilt whenever a tab changes).
  const activeRootRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    activeRootRef.current = tabs.find((t) => t.id === activeId)?.root
    activeIdRef.current = activeId
  }, [tabs, activeId])
  /** The tabs as they stand, for the one place that must look before it acts
   *  (a folder from outside, in useAppOpening) without being rebuilt on every change. */
  const tabsRef = useRef<Tab[]>([])
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  // Tell main what is open, whenever it changes: persistence for next launch.
  const hadTabs = useRef(false)
  useEffect(() => {
    const folderTabs = tabs.filter((t) => t.kind !== 'settings')
    // Mount says nothing (there is nothing to persist); once a tab has
    // existed, an empty list is real news: the last tab closed.
    if (folderTabs.length) hadTabs.current = true
    else if (!hadTabs.current) return
    window.prism.tabsChanged(
      folderTabs.map((t) => ({
        id: t.id,
        role: t.role,
        pinned: t.pinned,
        root: t.root,
        browse: t.browse,
        file: t.files[t.index]?.path
      })),
      Math.max(
        0,
        folderTabs.findIndex((t) => t.id === activeId)
      )
    )
  }, [tabs, activeId])

  /** Step the active tab by `delta`, wrapping, so Ctrl+Tab cycles. */
  const stepTab = useCallback((delta: number) => {
    setTabState((s) => {
      if (s.tabs.length < 2) return s
      const i = s.tabs.findIndex((t) => t.id === s.activeId)
      return { ...s, activeId: s.tabs[(i + delta + s.tabs.length) % s.tabs.length].id }
    })
  }, [])
  /** Jump to the nth tab, 1-based, for Ctrl+1..Ctrl+9. */
  const jumpTab = useCallback((n: number) => {
    setTabState((s) => (s.tabs[n - 1] ? { ...s, activeId: s.tabs[n - 1].id } : s))
  }, [])

  return {
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
  }
}
