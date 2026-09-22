import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { browseParent } from './browse'
import { openMode } from './openPrefs'
import { addExplorerTab, frontPinnedExplorer, isPinnedExplorer, type TabState } from './tabs'

/**
 * A FILE FROM OUTSIDE OPENS IN THE EXPLORER TAB (owner, 2026-09-22: "that file
 * opened in prism's explorer rather than as a project"). A double-click, "Open
 * with", the Explorer menu's "Open file", the command line and a drop on the
 * window all end here. The pinned Explorer comes to the front, walks to the
 * file's folder and shows the file the way the "Files from Windows open in"
 * setting says: in the preview pane, or in full view.
 *
 * Two steps, because the Explorer's own open (`openFile`, the call a Quick
 * access file pin makes, which grants the folder to the tab and walks there)
 * acts on the tab in FRONT: first the Explorer is brought forward, then, once
 * it is the active tab, the file is opened in it. One file at a time, in the
 * order they came, so the last one named is the one left on screen.
 */
export function useExplorerArrival(
  state: TabState,
  setState: Dispatch<SetStateAction<TabState>>,
  openFile: (path: string, full: boolean) => Promise<boolean | undefined>,
  nextId: () => string,
  exitFullscreen: () => void
): (path: string) => void {
  const latest = useRef({ state, exitFullscreen })
  useLayoutEffect(() => {
    latest.current = { state, exitFullscreen }
  }, [state, exitFullscreen])
  const queue = useRef<string[]>([])
  const [pending, setPending] = useState<{ path: string; full: boolean } | null>(null)
  const busy = useRef(false)
  // Bumped when a file is given up on, so the next one in the queue is taken.
  const [skipped, setSkipped] = useState(0)

  const pump = useCallback(async () => {
    if (busy.current) return
    const path = queue.current.shift()
    if (!path) return
    busy.current = true
    latest.current.exitFullscreen()
    const full = openMode() === 'full'
    if (latest.current.state.tabs.some(isPinnedExplorer)) {
      setState((s) => {
        const front = frontPinnedExplorer(s.tabs, !full)
        return front ? { ...s, ...front } : s
      })
    } else {
      // Not a state main leaves the strip in (it makes the pinned Explorer at
      // every start), but a file must never be dropped for want of one.
      const folder = browseParent(path) ?? path
      const id = nextId()
      const directory = await window.prism.browseDirectory(id, folder).catch(() => null)
      if (!directory) {
        busy.current = false
        setSkipped((n) => n + 1)
        return
      }
      setState((s) => {
        const added = addExplorerTab(
          s.tabs,
          { root: directory.path, files: directory.listing.files, index: -1 },
          id,
          true
        )
        return { ...s, ...(frontPinnedExplorer(added.tabs, !full) ?? added) }
      })
    }
    setPending({ path, full })
  }, [setState, nextId])

  // Step two: the Explorer is in front, so its own open acts on it.
  const started = useRef<object | null>(null)
  useEffect(() => {
    if (!pending || started.current === pending) return
    const active = state.tabs.find((tab) => tab.id === state.activeId)
    if (!active || !isPinnedExplorer(active)) return
    started.current = pending
    void openFile(pending.path, pending.full)
      .catch(() => false)
      .finally(() => {
        busy.current = false
        setPending(null)
      })
  }, [pending, state, openFile])

  // The next file in the queue, once the last one has landed or been dropped.
  useEffect(() => {
    if (!pending) void pump()
  }, [pending, skipped, pump])

  return useCallback(
    (path: string) => {
      queue.current.push(path)
      void pump()
    },
    [pump]
  )
}
