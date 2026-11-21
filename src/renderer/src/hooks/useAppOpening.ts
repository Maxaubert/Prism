import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import type { OpenPayload } from '@shared/types'
import { isBinPlace } from '@shared/binPlace'
import { fileKind } from '@shared/fileKind'
import { baseName, extOf } from '@shared/path'
import { visitedDirectories } from '../lib/visitedDirectories'
import { browseParent, navigateBrowseState, newBrowse } from '../lib/browse'
import { intendToPlay } from '../lib/playState'
import { nextTabId } from '../lib/sessionIds'
import {
  addRestoredTab,
  addExplorerTab,
  ensurePinnedExplorer,
  sameRoot,
  type Tab,
  type TabState
} from '../lib/tabs/tabs'

// How tabs arrive (audit #8, 2026-11-21): a restored tab from main, a file or
// folder handed over by Windows, and "Open in new tab". Moved out of App.tsx
// unchanged.

export interface AppOpeningDeps {
  setTabState: Dispatch<SetStateAction<TabState>>
  setHasNavigated: Dispatch<SetStateAction<boolean>>
  setRestoring: Dispatch<SetStateAction<boolean>>
  tabsRef: MutableRefObject<Tab[]>
  arriveInExplorer: (path: string) => void
}

export interface AppOpening {
  open: (p: OpenPayload | null) => void
  openInNewTab: (path: string, knownFolder?: boolean, reuse?: boolean) => void
  arrive: (p: OpenPayload | null) => void
}

export function useAppOpening({
  setTabState,
  setHasNavigated,
  setRestoring,
  tabsRef,
  arriveInExplorer
}: AppOpeningDeps): AppOpening {
  /** Each restored tab's saved place (#271), for the ones still arriving. */
  const restoreOrders = useRef(new Map<string, number>())
  /**
   * The user has clicked or typed in this page (review of #271). The restore
   * now sends the folder tabs first and a tab with a file open when it is
   * ready, which can be a read later, so the saved active tab may land while the
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
  /** A RESTORED tab arriving from main: it goes back to its saved place. */
  const open = useCallback(
    (p: OpenPayload | null) => {
      if (!p) return
      // An Explorer tab's first frame has rows (#271): the listing main sent
      // with it goes into the shared snapshots before the tab exists.
      if (p.listing) visitedDirectories.remember(p.listing)
      setTabState((s) => {
        // A RESTORED tab is always its own tab, and goes back to its saved
        // place, whatever order the payloads arrive in (#271).
        const st = addRestoredTab(s.tabs, p, nextTabId(), (tabId) => restoreOrders.current.get(tabId))
        const target = st.tabs.find((t) => t.id === st.activeId)
        if (target && p.restoreOrder !== undefined) restoreOrders.current.set(target.id, p.restoreOrder)
        const tabs = st.tabs
        // Background restores keep the focus where it is: restore arrives in
        // SAVED ORDER now (no more active-goes-last splice, which scrambled the
        // strip), and only the saved active tab takes the front, and only
        // while the user has not started using the window.
        const activeId =
          p.restore && (!p.restoreActive || userActed.current) && s.activeId ? s.activeId : st.activeId
        return {
          tabs: p.pinned ? ensurePinnedExplorer(tabs, p, target?.id ?? nextTabId()) : tabs,
          activeId
        }
      })
      setHasNavigated(false) // a fresh open starts in "opened directly" mode
    },
    [setTabState, setHasNavigated]
  )

  /** "Open in new tab": a fresh Explorer tab at the folder, or at the file's
   *  folder with the file open, spawned unconditionally. Also where a folder
   *  from outside (the shell verb, the command line, a drop) lands, and that
   *  one (`reuse`) switches to a tab already showing exactly that folder
   *  instead of piling up a twin. */
  const openInNewTab = useCallback(
    (path: string, knownFolder?: boolean, reuse = false) => {
      if (reuse) {
        const hit = tabsRef.current.find(
          (t) => t.kind !== 'settings' && t.browse.surface === 'folder' && sameRoot(t.browse.path, path)
        )
        if (hit) {
          setTabState((s) => ({ ...s, activeId: hit.id }))
          return
        }
      }
      if (isBinPlace(path)) {
        // THE RECYCLE BIN IN A NEW TAB (Recycle Bin, D6): the tab is rooted at
        // Home, as a new tab is, with the bin as its first place in the history
        // (Back leads to Home). The bin is no folder to root a tab in.
        void (async () => {
          const home = (await window.prism.browseLocations()).find((p) => p.name === 'Home')?.path
          if (!home) return
          const id = nextTabId()
          const directory = await window.prism.browseDirectory(id, home)
          if (!directory) return
          visitedDirectories.remember(directory)
          const browse = navigateBrowseState(newBrowse(home), path)
          setTabState((s) =>
            addExplorerTab(s.tabs, { root: home, files: directory.listing.files, index: -1, browse }, id)
          )
        })()
        return
      }
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
        // A file opens in the full viewer, with its folder behind it.
        setTabState((s) =>
          addExplorerTab(s.tabs, isFolder ? payload : { ...payload, browse: newBrowse(root, 'viewer') }, id)
        )
      })()
    },
    [setTabState, tabsRef]
  )

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
      // A FILE from outside goes to the Explorer (2026-09-22). A film or a
      // track still plays - it was picked.
      if (p?.explorerFile) {
        const name = baseName(p.explorerFile)
        const kind = fileKind(extOf(name), name)
        if (kind === 'video' || kind === 'audio') intendToPlay(window.prism.mediaUrl(p.explorerFile))
        arriveInExplorer(p.explorerFile)
        return
      }
      // A FOLDER from outside opens an Explorer tab at it (2026-10-26).
      if (p?.explorerFolder) {
        openInNewTab(p.explorerFolder, true, true)
        return
      }
      open(p)
    },
    [open, arriveInExplorer, openInNewTab]
  )
  useEffect(() => window.prism.onOpenFile(arrive, () => setRestoring(false)), [arrive, setRestoring])

  return { open, openInNewTab, arrive }
}
