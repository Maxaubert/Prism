import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { newTabMode, newTabFolder } from '../lib/prefs/newTabPrefs'
import { nextTabId } from '../lib/sessionIds'
import { visitedDirectories } from '../lib/visitedDirectories'
import type { OpenPayload } from '@shared/types'
import {
  addExplorerTab,
  isPinnedExplorer,
  closeTab,
  type Tab,
  reorderTabs,
  type TabState
} from '../lib/tabs/tabs'
import { useWinEOpen } from './useWinEOpen'
import type { useFolderBrowsing } from './useFolderBrowsing'
import { forgetTabVolume } from '../lib/tabs/tabVolume'
import { baseName } from '@shared/path'
import { rememberRoot, forgetRoot } from '@renderer/lib/recentRoots'
import type { Ask } from '../dialogs/asks'

// THE TABS (out of App.tsx, structure cleanup 2026-10-12, unchanged): a new
// tab, closing one (asking first when it strands unsaved text), opening a
// picked folder, the recent folders, and picking and reordering. App holds the tab state.

export interface TabOpsDeps {
  setTabState: Dispatch<SetStateAction<TabState>>
  setHasNavigated: Dispatch<SetStateAction<boolean>>
  tabState: TabState
  browsing: ReturnType<typeof useFolderBrowsing>
  setup: boolean
  fullscreen: boolean
  setFs: (on: boolean) => void
  bufferOwners: RefObject<Map<string, Set<string>>>
  buffers: RefObject<Map<string, { path: string; text: string }>>
  tabs: Tab[]
  syncDirty: () => void
  activeId: string | null
  setAsk: Dispatch<SetStateAction<Ask | null>>
}

export interface TabOps {
  newTab: () => void
  closeActiveTab: () => void
  reorderTab: (id: string, toIndex: number) => void
  openRecent: (path: string) => void
  pickTab: (id: string) => void
  closeOneTab: (id: string) => void
  discardTabBuffers: (id: string) => void
  forceCloseTab: (id: string) => void
  openFolderTab: () => void
}

export function useTabOps({
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
}: TabOpsDeps): TabOps {
  /**
   * A new tab, immediately. No dialog: the + and Ctrl+T are meant to be instant,
   * so a tab arrives rooted at the user's own folder and you browse from there.
   *
   * It spawns unconditionally, unlike an arriving file: pressing + and watching
   * nothing happen because that root was already open would be worse than two
   * tabs on one folder.
   */
  const newTab = useCallback(() => {
    void (async () => {
      const mode = newTabMode()
      const home = (await window.prism.browseLocations()).find(
        (place) => place.name === 'Home'
      )?.path
      const path =
        mode === 'ask' ? await window.prism.pickFolder() : mode === 'folder' ? newTabFolder() : home
      if (!path) return
      const id = nextTabId()
      const directory =
        (await window.prism.browseDirectory(id, path)) ??
        (home ? await window.prism.browseDirectory(id, home) : null)
      if (!directory) return
      visitedDirectories.remember(directory)
      const p: OpenPayload = { root: directory.path, files: directory.listing.files, index: -1 }
      setTabState((s) => addExplorerTab(s.tabs, p, id))
      setHasNavigated(false)
    })()
  }, [setHasNavigated, setTabState])

  useWinEOpen(tabState, setTabState, browsing.folder && !setup && !fullscreen, nextTabId, () => {
    if (fullscreen) setFs(false)
  })

  /** Close one tab. The last one leaves an empty window rather than taking the
   *  window with it: Prism is resident, and a window that vanishes under a
   *  reflex keystroke is the failure this app has been careful to avoid. */
  const forceCloseTab = useCallback(
    (id: string) => {
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === id)
        if (tab && isPinnedExplorer(tab)) return s
        // The level the tab was playing at goes with it: the id never comes back.
        forgetTabVolume(id)
        window.prism.browseRelease(id)
        bufferOwners.current.delete(id)
        return closeTab(s.tabs, id, s.activeId)
      })
    },
    [bufferOwners, setTabState]
  )
  const bufferBelongsTo = useCallback(
    (tab: Tab, path: string): boolean => {
      const key = path.toLowerCase()
      return (
        !!bufferOwners.current.get(tab.id)?.has(key) ||
        tab.files[tab.index]?.path.toLowerCase() === key
      )
    },
    [bufferOwners]
  )
  /** Throw away the unsaved text a tab holds (its answer was Discard). */
  const discardTabBuffers = useCallback(
    (id: string): void => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return
      for (const key of [...buffers.current.keys()]) {
        if (bufferBelongsTo(tab, key)) buffers.current.delete(key)
      }
      syncDirty()
    },
    [tabs, bufferBelongsTo, syncDirty, buffers]
  )
  /**
   * Open a folder the user picks in a tab of its own (the empty window's
   * button). Tabs no longer re-root: a folder is a place to walk to, and the
   * Explorer does that.
   */
  const openFolderTab = useCallback(() => {
    void window.prism.pickFolder().then((path) => {
      if (!path) return
      const id = nextTabId()
      void window.prism.browseDirectory(id, path).then((directory) => {
        if (!directory) return
        visitedDirectories.remember(directory)
        setTabState((s) =>
          addExplorerTab(s.tabs, { root: directory.path, files: directory.listing.files, index: -1 }, id)
        )
        setHasNavigated(false)
      })
    })
  }, [setHasNavigated, setTabState])
  /** Close a tab, asking first when that would strand unsaved text. */
  const closeOneTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return
      if (isPinnedExplorer(tab)) return
      if (tab.kind === 'settings') {
        forceCloseTab(id)
        return
      }
      // Unsaved text asks first; anything else closes at once.
      const names = [...buffers.current.values()]
        .filter((b) => bufferBelongsTo(tab, b.path))
        .map((b) => baseName(b.path))
      if (names.length) setAsk({ kind: 'close-tab', id, names })
      else forceCloseTab(id)
    },
    [bufferBelongsTo, forceCloseTab, tabs, buffers, setAsk]
  )
  const closeActiveTab = useCallback(() => {
    if (activeId) closeOneTab(activeId)
  }, [activeId, closeOneTab])
  /* The folders Prism has been opened in (2026-08-23): the strip's + offers
     the last few on a right-click. Every root a tab holds is remembered as it
     appears, so the list is what actually happened rather than a curated
     thing to maintain. */
  // Writing only: the menu reads the list when it opens, so there is no
  // second copy of it to keep in step.
  const seenRoots = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind === 'settings' || !t.root) continue
      const key = t.root.toLowerCase()
      if (seenRoots.current.has(key)) continue
      seenRoots.current.add(key)
      rememberRoot(t.root)
    }
  }, [tabs])
  /** A folder from that menu: a tab rooted there, exactly like the + makes.
   *  One that has since been moved or deleted drops out of the list. */
  const openRecent = useCallback(
    (path: string) => {
      const id = nextTabId()
      void window.prism.browseDirectory(id, path).then((directory) => {
        if (!directory) {
          forgetRoot(path)
          setAsk({ kind: 'failed', message: 'That folder is not there any more.' })
          return
        }
        visitedDirectories.remember(directory)
        setTabState((s) =>
          addExplorerTab(
            s.tabs,
            {
              root: directory.path,
              files: directory.listing.files,
              index: -1
            },
            id
          )
        )
        setHasNavigated(false)
      })
    },
    [setAsk, setHasNavigated, setTabState]
  )

  const pickTab = useCallback(
    (id: string) => {
      setTabState((s) => ({ ...s, activeId: id }))
    },
    [setTabState]
  )
  /** The strip's own drag: a tab lands in front of `toIndex` (#70). */
  const reorderTab = useCallback(
    (id: string, toIndex: number) =>
      // Focus is the strip's business: it puts back whatever the drag
      // interrupted - a tree row, the search box.
      setTabState((s) => ({ ...s, tabs: reorderTabs(s.tabs, id, toIndex) })),
    [setTabState]
  )
  return {
    newTab,
    closeActiveTab,
    reorderTab,
    openRecent,
    pickTab,
    closeOneTab,
    discardTabBuffers,
    forceCloseTab,
    openFolderTab
  }
}
