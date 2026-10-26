import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { DetectedAgent } from 'prism-term-core/shared/types'
import { newTabMode, newTabFolder } from '../lib/prefs/newTabPrefs'
import { nextTabId, disposeSession, nextTermId } from '../lib/sessionIds'
import { visitedDirectories } from '../lib/visitedDirectories'
import type { OpenPayload } from '@shared/types'
import {
  addExplorerTab,
  isPinnedExplorer,
  closeTab,
  type Tab,
  rerootTab,
  sameRoot,
  setTabTerm,
  reorderTabs,
  type TabState
} from '../lib/tabs/tabs'
import { useWinEOpen } from './useWinEOpen'
import type { useFolderBrowsing } from './useFolderBrowsing'
import { forgetTabVolume } from '../lib/tabs/tabVolume'
import { baseName } from '@shared/path'
import { isTouched, idleAtPrompt } from 'prism-term-core/renderer/lib/termActivity'
import { decideFollow } from 'prism-term-core/shared/termCwd'
import { asksBeforeClosingTab } from 'prism-term-core/renderer/lib/agentClose'
import { workingFor } from 'prism-term-core/renderer/lib/agentClock'
import { focusTermSession } from 'prism-term-core/renderer/components/TerminalPanel'
import { rememberRoot, forgetRoot } from '@renderer/lib/recentRoots'
import type { Ask } from '../dialogs/asks'

// THE TABS (out of App.tsx, structure cleanup 2026-10-12, unchanged): a new
// tab, closing one (asking first when it strands unsaved text or ends an
// agent), re-rooting one, the recent folders, picking and reordering, and
// handing a showing terminal its focus back. App holds the tab state.

export interface TabOpsDeps {
  setTabState: Dispatch<SetStateAction<TabState>>
  setHasNavigated: Dispatch<SetStateAction<boolean>>
  tabState: TabState
  browsing: ReturnType<typeof useFolderBrowsing>
  setup: boolean
  fullscreen: boolean
  setFs: (on: boolean) => void
  termRoots: RefObject<Map<string, string>>
  bufferOwners: RefObject<Map<string, Set<string>>>
  buffers: RefObject<Map<string, { path: string; text: string }>>
  tabs: Tab[]
  syncDirty: () => void
  agentKinds: RefObject<Map<string, DetectedAgent>>
  termCwd: RefObject<Map<string, string>>
  activeId: string | null
  setAsk: Dispatch<SetStateAction<Ask | null>>
  workingIds: ReadonlySet<string>
  agentIds: ReadonlySet<string>
}

export interface TabOps {
  restoreTermFocus: (id?: string | undefined) => void
  newTab: () => void
  closeActiveTab: () => void
  reorderTab: (id: string, toIndex: number) => void
  openRecent: (path: string) => void
  pickTab: (id: string) => void
  closeOneTab: (id: string) => void
  discardTabBuffers: (id: string) => void
  forceCloseTab: (id: string) => void
  applyReroot: (id: string | null, p: OpenPayload) => void
  rerootHere: () => void
}

export function useTabOps({
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
}: TabOpsDeps): TabOps {
  /**
   * A new tab, immediately. No dialog: the + and Ctrl+T are meant to be instant,
   * so a tab arrives rooted at the user's own folder and you browse from there.
   * Choosing a folder is the sidebar's button, which changes THIS tab.
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
        // The tab's shell dies with it, both halves: main's pty and the
        // renderer's xterm instance.
        const tab = s.tabs.find((t) => t.id === id)
        if (tab && isPinnedExplorer(tab)) return s
        // EVERY shell the tab held (2026-09-03), not only the current one.
        for (const termId of tab?.terms ?? []) {
          window.prism.termKill(termId)
          disposeSession(termId)
          termRoots.current.delete(termId)
        }
        // ...and so does the level it was playing at: the id never comes back.
        forgetTabVolume(id)
        window.prism.browseRelease(id)
        bufferOwners.current.delete(id)
        return closeTab(s.tabs, id, s.activeId)
      })
    },
    [bufferOwners, setTabState, termRoots]
  )
  /** Unsaved buffers living under a tab's root, as their names are spelled. */
  const dirtyUnder = useCallback(
    (root: string): string[] => {
      const r = root.toLowerCase()
      return [...buffers.current.values()]
        .filter((b) => b.path.toLowerCase().startsWith(r))
        .map((b) => baseName(b.path))
    },
    [buffers]
  )
  const bufferBelongsTo = useCallback(
    (tab: Tab, path: string): boolean => {
      const key = path.toLowerCase()
      return (
        !!bufferOwners.current.get(tab.id)?.has(key) ||
        tab.files[tab.index]?.path.toLowerCase() === key ||
        tab.panes.some((pane) => pane.path.toLowerCase() === key)
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
  const applyReroot = useCallback(
    (id: string | null, p: OpenPayload) => {
      setTabState((s) => {
        const next = rerootTab(s.tabs, id, p, nextTabId())
        // The terminal policy on a folder change: an UNTOUCHED shell simply
        // follows - killed and respawned in the new folder, view kept. A
        // touched one (a Claude session, half-typed work) stays where it was;
        // Clear later re-syncs it.
        const tab = next.tabs.find((t) => t.id === id)
        if (
          tab?.term &&
          !isTouched(tab.term.id) &&
          !agentKinds.current.has(tab.term.id) &&
          !sameRoot(termRoots.current.get(tab.term.id) ?? '', p.root)
        ) {
          window.prism.termKill(tab.term.id)
          disposeSession(tab.term.id)
          termRoots.current.delete(tab.term.id)
          const termId = nextTermId()
          termRoots.current.set(termId, p.root)
          return {
            ...next,
            tabs: setTabTerm(next.tabs, tab.id, { id: termId, view: tab.term.view })
          }
        }
        // A TOUCHED shell follows too now (#99, owner decision 2026-09-04), by
        // one Set-Location written into it - and only at a moment that cannot
        // hurt: it has reported a prompt and nothing has been typed since (so
        // no half-typed line runs with the cd in front of it), no agent is
        // living in it (its folder is the agent's, not the tab's), and it is
        // not already there. Anything else, it is left alone, silently: the
        // shell is somebody's work and a folder change is not a reason to
        // interrupt it.
        if (
          tab?.term &&
          isTouched(tab.term.id) &&
          !agentKinds.current.has(tab.term.id) &&
          idleAtPrompt(tab.term.id) &&
          decideFollow(p.root, termCwd.current.get(tab.term.id) ?? '') !== 'same' &&
          termCwd.current.has(tab.term.id)
        ) {
          termCwd.current.set(tab.term.id, p.root)
          window.prism.termCd(tab.term.id, p.root)
        }
        return next
      })
      setHasNavigated(false)
    },
    [agentKinds, setHasNavigated, setTabState, termCwd, termRoots]
  )
  /**
   * The sidebar's folder button: this tab becomes that folder, rather than a new
   * tab beside it. The strip's `+` is the one that accumulates.
   *
   * It asks first when the tab holds unsaved text, because the consequence is
   * the close-a-tab consequence: the route back to those buffers goes with the
   * root. A folder already open in another tab switches there instead, so the
   * one-tab-per-root rule the arriving-file logic leans on still holds.
   */
  const rerootHere = useCallback(() => {
    void window.prism.openFolder(tabs.find((t) => t.id === activeId)?.root).then((p) => {
      if (!p) return
      const here = tabs.find((t) => t.id === activeId)
      const names = here && !sameRoot(here.root, p.root) ? dirtyUnder(here.root) : []
      if (names.length && activeId) setAsk({ kind: 'reroot', id: activeId, names, payload: p })
      else applyReroot(activeId, p)
    })
  }, [activeId, applyReroot, dirtyUnder, tabs, setAsk])
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
      // Unsaved text asks in EVERY mode: the setting below only governs the
      // plain "you are closing a tab" confirmation, never data loss.
      const names = [...buffers.current.values()]
        .filter((b) => bufferBelongsTo(tab, b.path))
        .map((b) => baseName(b.path))
      if (names.length) setAsk({ kind: 'close-tab', id, names })
      else {
        // THE CLOSE QUESTION IS ONE RULE, NOT A SETTING (owner, 2026-09-19;
        // prism-term-core's agentClose, the same in Prism Terminal): a plain
        // shell closes unasked, a tab whose shell HOSTS an agent asks, working
        // or idle. It replaced the Agents / Off setting that lived here.
        // ANY of the tab's shells (2026-09-03): an agent in a hidden second
        // terminal is exactly what the question exists to protect; a working
        // one is named ahead of an idle one, being what is most at stake.
        const hostId =
          tab.terms.find((t) => workingIds.has(t)) ?? tab.terms.find((t) => agentIds.has(t))
        if (hostId === undefined || !asksBeforeClosingTab(true)) forceCloseTab(id)
        else
          setAsk({
            kind: 'close-tab-confirm',
            id,
            label: baseName(tab.root),
            agent: {
              kind: agentKinds.current.get(hostId) ?? 'other',
              forMs: workingIds.has(hostId) ? workingFor(hostId) : null
            }
          })
      }
    },
    [agentIds, agentKinds, bufferBelongsTo, forceCloseTab, tabs, workingIds, buffers, setAsk]
  )
  const closeActiveTab = useCallback(() => {
    if (activeId) closeOneTab(activeId)
  }, [activeId, closeOneTab])
  /** Whatever a tab interaction did to DOM focus, a SHOWING terminal gets the
   *  keyboard back: clicking or dragging a tab is not "I left the shell", and
   *  losing focus there sent the arrows off to page the folder instead. */
  const restoreTermFocus = useCallback(
    (id?: string) => {
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === (id ?? s.activeId))
        if (tab?.term && tab.term.view !== 'hidden')
          requestAnimationFrame(() => focusTermSession(tab.term!.id))
        return s
      })
    },
    [setTabState]
  )
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
      restoreTermFocus(id)
    },
    [restoreTermFocus, setTabState]
  )
  /** The strip's own drag: a tab lands in front of `toIndex` (#70). */
  const reorderTab = useCallback(
    (id: string, toIndex: number) =>
      // Focus is the strip's business: it puts back whatever the drag
      // interrupted - a shell, a tree row, the search box - rather than
      // assuming the terminal.
      setTabState((s) => ({ ...s, tabs: reorderTabs(s.tabs, id, toIndex) })),
    [setTabState]
  )
  return {
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
  }
}
