import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { addExplorerTab, isPinnedExplorer, type TabState } from './tabs'

/** A shortcut opens the browser without repurposing any project or its terminal. */
export function useWinEOpen(
  state: TabState,
  setState: Dispatch<SetStateAction<TabState>>,
  visible: boolean,
  nextId: () => string,
  exitFullscreen: () => void
): void {
  const latest = useRef({ state, exitFullscreen })
  useLayoutEffect(() => {
    latest.current = { state, exitFullscreen }
  }, [state, exitFullscreen])
  const [pending, setPending] = useState<string[]>([])
  useEffect(() => {
    let live = true
    let queue = Promise.resolve()
    const unsubscribe = window.prism.onWinEOpen((requestId) => {
      queue = queue
        .then(async () => {
          if (!live) return
          latest.current.exitFullscreen()
          const pinned = latest.current.state.tabs.find(isPinnedExplorer)
          if (pinned) {
            setState((current) => ({
              ...current,
              activeId: pinned.id,
              tabs: current.tabs.map((tab) =>
                tab.id === pinned.id
                  ? {
                      ...tab,
                      browse: { ...tab.browse, surface: 'folder' },
                      term: tab.term ? { ...tab.term, view: 'hidden' } : null
                    }
                  : tab
              )
            }))
          } else {
            const home = (await window.prism.browseLocations()).find(
              (place) => place.name === 'Home'
            )
            if (!home || !live) return
            const id = nextId()
            const directory = await window.prism.browseDirectory(id, home.path)
            if (!directory || !live) return
            setState((current) =>
              addExplorerTab(
                current.tabs,
                {
                  root: directory.path,
                  files: directory.listing.files,
                  index: -1
                },
                id,
                true
              )
            )
          }
          if (live) setPending((requests) => [...requests, requestId])
        })
        .catch(() => {
          /* No acknowledgement lets the native helper fall back. */
        })
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [setState, nextId])

  useEffect(() => {
    const active = state.tabs.find((tab) => tab.id === state.activeId)
    if (
      !pending.length ||
      !visible ||
      !active ||
      !isPinnedExplorer(active) ||
      active.browse.surface !== 'folder'
    )
      return
    const frame = requestAnimationFrame(() => {
      const browser = document.querySelector<HTMLElement>('[data-testid="folder-browser"]')
      if (!browser?.getClientRects().length) return
      for (const id of pending) window.prism.winEReady(id)
      setPending((requests) => requests.filter((id) => !pending.includes(id)))
    })
    return () => cancelAnimationFrame(frame)
  }, [state, visible, pending])
}
