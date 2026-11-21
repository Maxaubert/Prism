import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { OpenPayload } from '@shared/types'
import { ownDrop, setDrag } from '../lib/drag/dragDrop'
import { droppedKind } from '../lib/droppedKind'
import { nextTabId } from '../lib/sessionIds'
import { isExplorerTab, type Tab } from '../lib/tabs/tabs'
import type { useFolderBrowsing } from './useFolderBrowsing'

// Drag-and-drop onto the window (audit #8, 2026-11-21), moved out of App.tsx
// unchanged. Path via webUtils, since Electron removed File.path.

export interface WindowDropDeps {
  setup: boolean
  active: Tab | null
  browsing: ReturnType<typeof useFolderBrowsing>
  arrive: (p: OpenPayload | null) => void
  openInNewTab: (path: string, knownFolder?: boolean, reuse?: boolean) => void
  setDragging: Dispatch<SetStateAction<boolean>>
}

export function useWindowDrop({
  setup,
  active,
  browsing,
  arrive,
  openInNewTab,
  setDragging
}: WindowDropDeps): void {
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
      // Prism's own rows carry paths in the payload, not as files. Dropping
      // one on the viewer means "show me this": a file opens here, a folder
      // is walked into. Archive members are not on disk, so they
      // are left to the archive view that owns them.
      // Prism's own cargo back from an OS drag (#103) reads as the row it was.
      const inside = ownDrop(e.dataTransfer)
      setDrag(null)
      if (inside?.kind === 'files' && !inside.external) {
        const first = inside.paths[0]
        if (!first) return
        void window.prism.statFile(first).then((st) => {
          if (st?.isFolder) {
            if (active && isExplorerTab(active)) void browsing.navigate(first)
            else openInNewTab(first, true)
          } else if (st) void browsing.openFile(first)
        })
        return
      }
      // A FILE dropped from Windows is a file from outside, and goes where a
      // double-click sends one: the Explorer tab (2026-09-22). A folder opens
      // an Explorer tab at it (2026-10-26).
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const dropped = window.prism.getDroppedPath(f)
      // No statFile first: it refuses a path outside the grants, a Desktop drop
      // among them (audit #23). A file's arrival, or the new tab's own read,
      // grants what it needs.
      void droppedKind(dropped, {
        stat: window.prism.statFile,
        probe: (p) => window.prism.browseDirectory(nextTabId(), p, { details: false })
      }).then((kind) => {
        if (kind === 'file') arrive({ explorerFile: dropped, files: [], index: -1, root: '' })
        else openInNewTab(dropped, true)
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
  }, [active, arrive, browsing, openInNewTab, setup, setDragging])
}
