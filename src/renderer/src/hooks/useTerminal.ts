import {
  useCallback,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { type DockEdge, loadDock, loadTermSize, saveDock, dockAxis, saveTermSize } from '../lib/termDock'
import {
  addTab,
  addTerm,
  isExplorerTab,
  setTabTerm,
  toggleTermView,
  type Tab,
  type TabState
} from '../lib/tabs/tabs'
import { nextTabId, nextTermId } from '../lib/sessionIds'

// THE TERMINAL, App's half (out of App.tsx, structure cleanup 2026-10-12,
// unchanged): the dock's edge and size, the root each shell was started in,
// a terminal tab at a folder, and showing or hiding the tab's shell. The
// terminal itself is prism-term-core's. Several shells and panes:
// useTermPanes.ts.

export interface TerminalDeps {
  /** Where each live session was SPAWNED (App's ref). */
  termRoots: RefObject<Map<string, string>>
  termCwd: RefObject<Map<string, string>>
  setTabState: Dispatch<SetStateAction<TabState>>
  active: Tab | null
}

export interface Terminal {
  termFolder: (id: string) => string | undefined
  pickDock: (edge: DockEdge) => void
  applyTermView: (fn: typeof toggleTermView) => void
  termTabAt: (root: string) => void
  openTermFull: () => void
  toggleTerm: () => void
  dockEdge: DockEdge
  termSizes: { x: number; y: number }
  resizeTermPanel: (px: number) => void
}

export function useTerminal({ termRoots, termCwd, setTabState, active }: TerminalDeps): Terminal {
  const [dockEdge, setDockEdge] = useState<DockEdge>(loadDock)
  const [termSizes, setTermSizes] = useState(() => ({ x: loadTermSize('x'), y: loadTermSize('y') }))
  const pickDock = useCallback((edge: DockEdge) => {
    setDockEdge(edge)
    saveDock(edge)
  }, [])
  const resizeTermPanel = useCallback(
    (px: number) => {
      const axis = dockAxis(dockEdge)
      setTermSizes((s) => ({ ...s, [axis]: px }))
      saveTermSize(axis, px)
    },
    [dockEdge]
  )
  /** Apply a term-view transition to the active tab, spawning ids as needed.
   *  The shell itself only dies to exit, tab close, or quit. */
  /** The folder a shell is standing in: its own report if it has made one,
   *  else where it was spawned. Used for persistence, so a shell comes back
   *  where it was and its agent resumes THAT folder's conversation. */
  const termFolder = useCallback(
    (id: string): string | undefined => termCwd.current.get(id) ?? termRoots.current.get(id),
    [termCwd, termRoots]
  )
  const termTabAt = useCallback(
    (root: string) => {
      void window.prism.openRoot(root).then((p) => {
        if (!p) return
        setTabState((s) => addTab(s.tabs, p, nextTabId()))
        setTabState((s) => {
          const tab = s.tabs.find((t) => t.id === s.activeId)
          if (!tab || tab.term) return s
          const termId = nextTermId()
          termRoots.current.set(termId, tab.root)
          return { ...s, tabs: addTerm(s.tabs, tab.id, termId, 'full') }
        })
      })
    },
    [setTabState, termRoots]
  )

  const applyTermView = useCallback(
    (fn: typeof toggleTermView) =>
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab || tab.kind === 'settings') return s
        const next = fn(tab.term, nextTermId())
        if (next.id !== tab.term?.id) termRoots.current.set(next.id, tab.root)
        const tabs = setTabTerm(s.tabs, tab.id, next)
        return { ...s, tabs }
      }),
    [setTabState, termRoots]
  )
  /** The sidebar button and Ctrl+`: full view, the terminal's home. */
  const toggleTerm = useCallback(() => {
    if (active && isExplorerTab(active)) termTabAt(active.browse.path)
    else applyTermView(toggleTermView)
  }, [active, termTabAt, applyTermView])
  /** Ctrl+Shift+T: open full, unconditionally (never hides). */
  const openTermFull = useCallback(() => {
    if (active && isExplorerTab(active)) termTabAt(active.browse.path)
    else applyTermView((term, id) => (term ? { ...term, view: 'full' } : { id, view: 'full' }))
  }, [active, termTabAt, applyTermView])
  return {
    termFolder,
    pickDock,
    applyTermView,
    termTabAt,
    openTermFull,
    toggleTerm,
    dockEdge,
    termSizes,
    resizeTermPanel
  }
}
