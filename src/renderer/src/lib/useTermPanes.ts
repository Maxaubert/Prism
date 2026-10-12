import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { OpenPayload, ViewerFile } from '@shared/types'
import { disposeSession, nextTermId } from './sessionIds'
import {
  addTerm,
  isExplorerTab,
  pickTerm,
  removeTerm,
  setTabPanes,
  setTabTerm,
  type Tab,
  type TabState,
  type toggleTermView
} from './tabs'
import { unpinPane, type SplitDir, lastSplitDir, saveSplitDir, pinTermPane } from './panes'

// SEVERAL TERMINALS PER TAB, AND THE SPLIT'S PANES (out of App.tsx, structure
// cleanup 2026-10-12, unchanged): open, pick, close and pin a shell, and close
// one window of a split. The dock and the view: useTerminal.ts.

export interface TermPanesDeps {
  applyTermView: (fn: typeof toggleTermView) => void
  active: Tab | null
  termRoots: RefObject<Map<string, string>>
  setTabState: Dispatch<SetStateAction<TabState>>
  setPaneFocus: Dispatch<SetStateAction<string>>
  termTabAt: (root: string) => void
  paneSeqRef: RefObject<number>
  fullscreen: boolean
  unpinSplitId: (paneId: string) => void
  openBrowseFile: (
    file: string | ViewerFile,
    full?: boolean,
    play?: boolean
  ) => Promise<boolean | undefined>
  open: (p: OpenPayload | null) => void
}

export interface TermPanes {
  closeTermId: (termId: string) => void
  openTermSplit: () => void
  pickTermId: (termId: string) => void
  openNewTerm: () => void
  splitTermId: (termId: string) => void
  closeTerm: () => void
  closeFilePane: () => void
  pinTermAsPane: (termId: string, dir?: SplitDir | undefined) => void
  closeTermPane: () => void
}

export function useTermPanes({
  applyTermView,
  active,
  termRoots,
  setTabState,
  setPaneFocus,
  termTabAt,
  paneSeqRef,
  fullscreen,
  unpinSplitId,
  openBrowseFile,
  open
}: TermPanesDeps): TermPanes {
  /** The terminal button's own context menu. */
  const openTermSplit = useCallback(
    () => applyTermView((term, id) => (term ? { ...term, view: 'split' } : { id, view: 'split' })),
    [applyTermView]
  )
  /**
   * CLOSE THE TERMINAL means close it (owner, 2026-09-03): the shell is
   * killed and the tab forgets it, so the next open spawns a FRESH shell in
   * the tab's CURRENT root - which is how a tab that re-rooted since gets a
   * terminal in the right folder. Hiding (Ctrl+`, the X) still keeps the
   * shell running; this is the verb for when you are done with it.
   */
  const closeTermId = useCallback(
    (termId: string) => {
      if (!active) return
      window.prism.termKill(termId)
      disposeSession(termId)
      termRoots.current.delete(termId)
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === active.id)
        if (!tab) return s
        // A pane holding this shell goes with it; the survivors keep their
        // places, and the most recent survivor becomes current.
        const pane = tab.panes.find((pn) => pn.term === termId)
        let tabs = pane ? setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, pane.id)) : s.tabs
        tabs = removeTerm(tabs, tab.id, termId)
        return { ...s, tabs }
      })
      setPaneFocus('live')
    },
    [active, setPaneFocus, setTabState, termRoots]
  )
  const closeTerm = useCallback(() => {
    if (active?.term) closeTermId(active.term.id)
  }, [active, closeTermId])

  /**
   * SEVERAL TERMINALS PER TAB (2026-09-03, owner). "Open new terminal" mints
   * a shell and makes it current; picking one from the button's menu makes
   * THAT one current (the button's left click always opens the most recent);
   * and a shell can be pinned as a PANE beside the live file or another
   * shell, through the same grid the file pins use.
   */

  const openNewTerm = useCallback(() => {
    if (!active || active.kind === 'settings') return
    if (isExplorerTab(active)) {
      termTabAt(active.browse.path)
      return
    }
    const termId = nextTermId()
    termRoots.current.set(termId, active.root)
    setTabState((s) => ({
      ...s,
      tabs: addTerm(s.tabs, active.id, termId, 'full')
    }))
    setPaneFocus('term')
  }, [active, termTabAt, setPaneFocus, setTabState, termRoots])
  const pickTermId = useCallback(
    (termId: string) => {
      if (!active) return
      setTabState((s) => ({ ...s, tabs: pickTerm(s.tabs, active.id, termId) }))
      setPaneFocus('term')
    },
    [active, setPaneFocus, setTabState]
  )
  const pinTermAsPane = useCallback(
    (termId: string, dir?: SplitDir) => {
      if (!active || active.kind === 'settings') return
      const d = dir ?? lastSplitDir()
      saveSplitDir(d)
      const already = active.panes.find((pn) => pn.term === termId)
      const paneId = already?.id ?? `pane-${Date.now()}-${(paneSeqRef.current += 1)}`
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === active.id)
        if (!tab || tab.kind === 'settings' || !tab.terms.includes(termId)) return s
        // From a FULL terminal the split is TERMINALS ONLY (owner, 2026-09-03:
        // "I just wanted the two terminals"): the file pins are already gone
        // (applyTermView) and the current shell stays full, with the pinned
        // shells drawn inside the terminal area beside it. From fullscreen a
        // pin starts fresh; otherwise it adds to the grid you can see.
        const cur = tab.term
        const base =
          cur?.view === 'full' ? tab.panes.filter((pn) => !!pn.term) : fullscreen ? [] : tab.panes
        let tabs = setTabPanes(s.tabs, tab.id, pinTermPane(base, paneId, termId, d))
        // A shell that just became a pane leaves the dock, or it would be
        // drawn twice.
        if (cur?.id === termId) tabs = setTabTerm(tabs, tab.id, { ...cur, view: 'hidden' })
        return { ...s, tabs }
      })
      setPaneFocus(paneId)
    },
    [active, fullscreen, paneSeqRef, setPaneFocus, setTabState]
  )
  /** "Open in split view" for one of several is a TOGGLE (owner, 2026-09-03):
   *  a shell on screen comes out of the split, one that is not goes in - the
   *  current shell through the dock, any other as a pane. */
  const splitTermId = useCallback(
    (termId: string) => {
      if (!active) return
      const pane = active.panes.find((pn) => pn.term === termId)
      if (pane) return unpinSplitId(pane.id)
      if (active.term?.id === termId) {
        // openTermSplit is declared further down and resolved at call time;
        // it is not a dep on purpose (its own deps are stable). It folds a
        // showing dock back and opens a hidden one, which is the toggle.
        openTermSplit()
        return
      }
      pinTermAsPane(termId)
    },
    // unpinSplitId is declared further down too, and resolved at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [active, pinTermAsPane]
  )

  /** The split's X buttons and the context menu's "Remove from split view".
   *  Closing ONE window of a split leaves the others standing: with pinned
   *  panes up, closing the live file promotes the OLDEST pin into the live
   *  slot and the terminal (if any) stays where it is. Only with nothing else
   *  on the file side does closing the file hand the terminal the full view;
   *  closing the TERMINAL pane always just leaves the files. */
  const closeFilePane = useCallback(() => {
    const first = active?.panes[0]
    if (active && first) {
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab) return s
        return { ...s, tabs: setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, first.id)) }
      })
      if (isExplorerTab(active)) void openBrowseFile(first.path)
      else void window.prism.openWithin(active.root, first.path).then((p) => p && open(p))
      setPaneFocus('live')
      return
    }
    applyTermView((term, id) => (term ? { ...term, view: 'full' } : { id, view: 'full' }))
  }, [active, applyTermView, open, openBrowseFile, setPaneFocus, setTabState])
  const closeTermPane = useCallback(
    () =>
      applyTermView((term, id) => (term ? { ...term, view: 'hidden' } : { id, view: 'hidden' })),
    [applyTermView]
  )
  return {
    closeTermId,
    openTermSplit,
    pickTermId,
    openNewTerm,
    splitTermId,
    closeTerm,
    closeFilePane,
    pinTermAsPane,
    closeTermPane
  }
}
