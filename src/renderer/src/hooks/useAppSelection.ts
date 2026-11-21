import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { ViewerFile } from '@shared/types'
import { preloadImage } from '../lib/imageLoader'
import { neighbourImages } from '../lib/warmNeighbours'
import { isExplorerTab, type Tab } from '../lib/tabs/tabs'
import { sortFilesOnce, useSort } from '../lib/prefs/sortPrefs'
import { carriesOn, heldPaused, intendToPlay } from '../lib/playState'
import type { StepDir } from '../lib/slideshow'
import type { useFolderBrowsing } from './useFolderBrowsing'

// Which file is on show and how the user steps through the folder (audit #8,
// 2026-11-21): the list's order, the visible list, Up and Down, the next file
// of the same kind, the neighbour warm-up and the markdown pencil. Moved out
// of App.tsx unchanged.

const PRELOAD_MAX_BYTES = 80 * 1024 * 1024 // don't warm neighbours bigger than this

export interface AppSelectionDeps {
  active: Tab | null
  rawIndex: number
  browsing: ReturnType<typeof useFolderBrowsing>
  setRawIndex: (i: number) => void
  setHasNavigated: Dispatch<SetStateAction<boolean>>
}

export interface AppSelection {
  view: { files: ViewerFile[]; index: number } | null
  file: ViewerFile | null
  viewingFile: boolean
  go: (delta: number) => void
  sameKindIndex: (dir: 1 | -1) => number
  stepSameKind: (dir: StepDir) => void
  advanceSameKind: () => void
  editMode: boolean
  setEditMode: Dispatch<SetStateAction<boolean>>
  docVersion: number
  setDocVersion: Dispatch<SetStateAction<number>>
}

export function useAppSelection({
  active,
  rawIndex,
  browsing,
  setRawIndex,
  setHasNavigated
}: AppSelectionDeps): AppSelection {
  // The pencil: markdown's raw source, the one text kind with a rendered form
  // to toggle away from. Leaving the file leaves the editor; a save bumps
  // docVersion so the rendered view re-reads what was written.
  const [editMode, setEditMode] = useState(false)
  const [docVersion, setDocVersion] = useState(0)
  // The visible list: every viewable sibling, in the chosen order, and the
  // open file's position among them. Sorting reuses the same file objects, so
  // mapping back to rawIndex keeps working. (A kind filter lived here once,
  // removed 2026-08-20: a forgotten filter read as missing files.)
  // Keyed on the files, not the tab (review, 2026-10-16): the tab is a new
  // object on every patch of its browse state, and each one re-sorted them.
  // THE LIST'S ORDER, not a second one (owner, 2026-10-28: in full view "up
  // goes down and down goes up"). The viewer stepped by the old viewer sort
  // (name) while the list showed its own, Downloads newest first, so the next
  // file was not the next row. The list orders its files with the same
  // `sortFiles` (browse/entries.ts), so its key is used as is; only `path` (a
  // search's folder order) reads as name here.
  const sortPref = useSort()
  const listSort = browsing.sort
  const sort = useMemo(
    () =>
      listSort
        ? {
            field: listSort.key === 'path' ? ('name' as const) : listSort.key,
            dir: listSort.direction
          }
        : sortPref,
    [listSort, sortPref]
  )
  const activeFiles = active?.files
  // ONE SORT PER FOLDER, NOT PER STEP (perf review #21, 2026-10-28): the
  // order depends on the files and the sort only, so an arrow press (a new
  // rawIndex) takes the folder's sorted list (`sortFilesOnce`) and only looks
  // its file up, instead of sorting the whole folder again.
  const view = useMemo(() => {
    if (!activeFiles || rawIndex < 0 || !activeFiles.length) return null
    const files = sortFilesOnce(activeFiles, sort.field, sort.dir)
    return { files, index: Math.max(0, files.indexOf(activeFiles[rawIndex])) }
  }, [activeFiles, rawIndex, sort])

  const go = useCallback(
    (delta: number) => {
      if (!active || !view) return
      const next = Math.max(0, Math.min(view.files.length - 1, view.index + delta))
      if (next === view.index) return // already at the edge; not a navigation
      const target = view.files[next]
      // Behind a shut list nothing is on screen (review of #491): a film stepped
      // to there is a sound with no picture.
      const shown = !browsing.folder || !!active.browse.preview
      // A STEP SHOWS A FILM, AND A FILM SHOWN STARTS (#491; owner, 2026-11-08:
      // "video dont always autopaly"), whichever way the step came, unless you
      // paused that film yourself. A track still waits for you.
      if (shown && target.kind === 'video') {
        const key = window.prism.mediaUrl(target.path)
        if (!heldPaused(key)) intendToPlay(key)
      }
      // A film or a track in the Explorer's pane steps by the list's own selection, or the
      // pane walks on and the row stays behind (#492).
      if (
        browsing.folder &&
        shown &&
        (view.files[view.index]?.kind === 'video' || view.files[view.index]?.kind === 'audio') &&
        browsing.listing?.files.some((f) => f.path === target.path)
      )
        browsing.select(target.path, false, false)
      else setRawIndex(active.files.indexOf(target))
      setHasNavigated(true)
    },
    [active, browsing, setRawIndex, view, setHasNavigated]
  )

  const file = view?.files[view.index] ?? null
  const viewingFile = !!file && !!active && isExplorerTab(active) && !browsing.folder

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
    (dir: StepDir) => {
      const kindNow = view?.files[view.index]?.kind
      const i = dir === 'first' ? (view?.files.findIndex((f) => f.kind === kindNow) ?? -1) : sameKindIndex(dir)
      if (i < 0 || !active || !view) return
      const next = view.files[i]
      // The playlist carries its own intent (2026-08-28). Nothing autoplays on
      // open any more, so the file a finished video hands over to - and the
      // one the menu's Next reaches for while you are watching - has to say
      // "I was already playing" on its own behalf. Stepping away from a file
      // you had PAUSED lands paused, which is the same rule; a file that ran
      // to its end was not paused by anyone (#491).
      if (file && carriesOn(window.prism.mediaUrl(file.path)))
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

  // Warm the immediate neighbours (images only) so arrowing to them is instant.
  // The shared image cache holds them (and enforces the memory policy), so we just
  // fire the requests; ±1 is enough to make stepping feel seamless. Very large
  // files are skipped: warming one costs more (memory, decode jank) than it saves.
  //
  // Keyed on the neighbours' PATHS, not on `view` (perf review, 2026-10-28):
  // the warm-up's reads are now given up when the step moves on, and `view` is
  // rebuilt by every details patch, which would abort and restart them.
  const warmPaths = useMemo(() => (view ? neighbourImages(view.files, view.index, PRELOAD_MAX_BYTES).join('\n') : ''), [view])
  useEffect(() => {
    if (!warmPaths) return
    const stop = new AbortController()
    // Wait for idle before warming neighbours. Load time is dominated by reading
    // the file, so firing these immediately makes two big neighbours compete with
    // the image the user is actually waiting for.
    const start = (): void => {
      for (const p of warmPaths.split('\n')) preloadImage(window.prism.mediaUrl(p), stop.signal)
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start, { timeout: 1500 })
      return () => {
        cancelIdleCallback(id)
        stop.abort()
      }
    }
    const t = setTimeout(start, 400)
    return () => {
      clearTimeout(t)
      stop.abort()
    }
  }, [warmPaths])

  return {
    view,
    file,
    viewingFile,
    go,
    sameKindIndex,
    stepSameKind,
    advanceSameKind,
    editMode,
    setEditMode,
    docVersion,
    setDocVersion
  }
}
