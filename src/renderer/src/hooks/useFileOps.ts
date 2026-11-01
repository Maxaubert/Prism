import { isInside } from '@shared/path'
import { followFolderIcons } from '../lib/folderIcons'
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { type Tab, type TabState } from '../lib/tabs/tabs'
import type { OnClash, ViewerFile } from '@shared/types'
import {
  rememberRename,
  type UndoEntry,
  undone,
  describe as describeUndo,
  redone,
  type UndoState
} from '../lib/undo'
import type { MoveOnClash } from '@shared/ipcTypes'
import {
  type FileMove,
  captureMoveViews,
  releaseMoveViews,
  movedPath,
  restoreMoveViews
} from '../lib/moveViews'
import { sessionTime, wasPaused, wasPlaying, rememberTime, rememberPaused } from '../lib/playState'
import { movedOn } from '../lib/fileOpsFollow'
import { type UndoOps, undoEntry, redoEntry } from '../lib/undoApply'
import type { DragPayload } from '../lib/drag/dragDrop'
import { archivePassword } from '../lib/archivePass'
import { endJob, startJob } from '../lib/jobs'
import { PASTE_MESSAGES, pasteMessage } from './useFilePaste'
import { browseParent } from '../lib/browse'
import type { Ask } from '../dialogs/asks'
import type { useArchiveActions } from '../components/browse/useArchiveActions'
import { markLanded } from '../lib/landMarks'

// THE FILE OPERATIONS (out of App.tsx, structure cleanup 2026-10-12,
// unchanged): rename, new folder, delete, move and the drops that move, and
// undo and redo over them (the inverse table is `undoApply.ts`). App holds
// the undo stack's state and draws the questions these raise (AskDialogs).

/** What a drop says when its folder cannot take files. */
const DROP_REFUSED = 'This folder is not available for dropping files.'

export interface FileOpsDeps {
  active: Tab | null
  openBrowseFile: (
    file: string | ViewerFile,
    full?: boolean,
    play?: boolean
  ) => Promise<boolean | undefined>
  setAsk: Dispatch<SetStateAction<Ask | null>>
  setRefreshKey: Dispatch<SetStateAction<number>>
  rekeyBuffer: (from: string, to: string) => void
  setUndoState: Dispatch<SetStateAction<UndoState>>
  file: ViewerFile | null
  noteUndo: (entry: UndoEntry) => void
  setTabState: Dispatch<SetStateAction<TabState>>
  dropBuffers: (paths: readonly string[]) => void
  view: { files: ViewerFile[]; index: number } | null
  showNothing: () => void
  tabs: Tab[]
  buffers: RefObject<Map<string, { path: string; text: string }>>
  undoState: UndoState
  flashUndo: (text: string) => void
  /** Only its `drop`: a drop into a zip takes the archive verbs. */
  archiveActions: Pick<ReturnType<typeof useArchiveActions>, 'drop'>
}

export interface FileOps {
  redo: () => void
  undo: () => void
  onDropIntoTab: (tabId: string, payload: DragPayload) => void
  runDelete: (path: string) => Promise<void>
  runDeleteMany: (paths: string[]) => Promise<void>
  runMove: (
    paths: string[],
    dest: string,
    mode: MoveOnClash,
    track?: boolean
  ) => Promise<{ from: string; to: string }[]>
  runRename: (
    path: string,
    name: string,
    onClash: OnClash,
    track?: boolean
  ) => Promise<string | null>
  onBrowseDropInto: (dest: string, payload: DragPayload, tabId?: string | undefined) => void
  makeNewFolder: (dir: string) => Promise<string | null>
}

export function useFileOps({
  active,
  openBrowseFile,
  setAsk,
  setRefreshKey,
  rekeyBuffer,
  setUndoState,
  file,
  noteUndo,
  setTabState,
  dropBuffers,
  view,
  showNothing,
  tabs,
  buffers,
  undoState,
  flashUndo,
  archiveActions
}: FileOpsDeps): FileOps {
  // Renaming, deleting, duplicating and the editor's save are the things Prism
  // does that change your files; the destructive ones are confirmable, and
  // nothing is destroyed: an overwritten or deleted file goes to the Recycle
  // Bin. (`refreshKey` and `ask` are declared above, with the edit guard.)

  /** True when `p` is `parent` itself or sits inside it. Renaming or binning a
   *  folder moves everything under it, including possibly the open file. */
  const within = (p: string, parent: string): boolean => isInside(parent, p, { orEqual: true })

  /** Show `p` again after a rename or delete. NOT a pick (2026-10-16): it went
   *  through `openBrowseFile`'s default `play = true`, which is the intent to
   *  play, so a paused film resumed with sound after an unrelated rename or
   *  delete in an Explorer tab. Only a caller that knows the file was playing
   *  passes `play`. */
  const reopen = useCallback(
    (p: string, play = false) => {
      if (!active) return
      void openBrowseFile(p, active.browse.surface === 'viewer', play)
    },
    [active, openBrowseFile]
  )

  /** What is on screen NOW, for the end of a slow rename or delete (2026-10-16):
   *  `file` from the render that started it is stale by then, and re-opening
   *  it pulled the viewer back to the old file after the user had arrowed on. */
  const shown = useRef(file)
  useLayoutEffect(() => {
    shown.current = file
  }, [file])

  const runRename = useCallback(
    async (path: string, name: string, onClash: OnClash, track = true): Promise<string | null> => {
      const cur = file?.path
      const r = await window.prism.renameFile(path, name, onClash)
      if (!r.ok) {
        if (r.reason === 'clash')
          setAsk({ kind: 'clash', path, name, suggestion: r.suggestion ?? name })
        else setAsk({ kind: 'failed', message: r.message ?? 'That could not be renamed.' })
        return null
      }
      setAsk(null)
      setRefreshKey((n) => n + 1)
      // Unsaved text follows the file to its new name.
      rekeyBuffer(path, r.path)
      // So does a folder's icon, and the icons under it (D9). An undo or redo
      // renames through here too.
      followFolderIcons([{ from: path, to: r.path }])
      // A rename that names a folder Ctrl+Shift+N just made folds into that
      // entry (#330), so one Ctrl+Z takes the folder away, Explorer's way.
      if (track !== false)
        setUndoState((u) =>
          rememberRename(u, { kind: 'rename', from: path, to: r.path, replaced: r.replaced })
        )
      // Follow whatever is on screen: it may have been the thing renamed, or a
      // file inside the folder that was, in which case its path just moved.
      if (!cur || movedOn(cur, shown.current?.path)) return r.path
      // The renamed file plays on only if it was playing.
      if (within(cur, path))
        reopen(r.path + cur.slice(path.length), wasPlaying(window.prism.mediaUrl(cur)))
      else reopen(cur)
      return r.path
    },
    [file, reopen, rekeyBuffer, setAsk, setRefreshKey, setUndoState]
  )

  /**
   * NEW FOLDER (#330; owner, 2026-10-07, Ctrl+Shift+N in the Explorer and the
   * project tree: the explicit yes to "new folder is a fresh decision"). Main
   * picks the name and checks the place; the folder goes on the undo stack,
   * where Ctrl+Z bins it again while it is still empty. The caller starts the
   * rename that follows, each surface its own way.
   */
  const makeNewFolder = useCallback(
    async (dir: string): Promise<string | null> => {
      const made = await window.prism.newFolder(dir)
      if (!made) {
        setAsk({ kind: 'failed', message: 'A new folder could not be made here.' })
        return null
      }
      noteUndo({ kind: 'mkdir', path: made })
      return made
    },
    [noteUndo, setAsk]
  )

  /**
   * LET GO OF A FILE BEFORE IT GOES (2026-09-03, owner: "still getting the
   * block when trying to delete a movie I'm watching"). A film that is
   * playing - in this tab or any other, since the deck keeps their players
   * mounted - holds an open handle through the media stream, and the
   * Recycle Bin refuses a file with a handle open. So every tab showing the
   * file steps off it FIRST, which unmounts its element, and the bin is
   * asked after a beat and with retries, because Chromium closes the stream
   * on its own clock rather than on ours. Returns whether anything had it.
   */
  const releaseFiles = useCallback(
    (paths: string[]): boolean => {
      let held = false
      setTabState((s) => {
        const tabs = s.tabs.map((t) => {
          const cur = t.index >= 0 ? t.files[t.index]?.path : undefined
          if (!cur || !paths.some((p) => within(cur, p))) return t
          held = true
          return { ...t, index: -1 }
        })
        return held ? { ...s, tabs } : s
      })
      return held
    },
    [setTabState]
  )
  const trashWithRetry = useCallback(async (path: string, held: boolean): Promise<boolean> => {
    if (held) await new Promise((r) => setTimeout(r, 350))
    for (let i = 0; i < 4; i += 1) {
      if (await window.prism.trashFile(path)) return true
      await new Promise((r) => setTimeout(r, 300))
    }
    return false
  }, [])

  const runDelete = useCallback(
    async (path: string): Promise<void> => {
      setAsk(null)
      const held = releaseFiles([path])
      const ok = await trashWithRetry(path, held)
      if (!ok) {
        setAsk({ kind: 'failed', message: 'That could not be moved to the Recycle Bin.' })
        return
      }
      setRefreshKey((n) => n + 1)
      dropBuffers([path])
      noteUndo({ kind: 'trash', paths: [path] })
      const cur = file?.path
      if (movedOn(cur, shown.current?.path)) return
      if (!cur || !within(cur, path)) {
        if (cur) reopen(cur)
        return
      }
      // What we were looking at is gone. Step to the nearest surviving neighbour,
      // skipping anything that lived inside the same folder.
      const survivors = view?.files.filter((f) => !within(f.path, path)) ?? []
      const next = survivors[Math.min(view?.index ?? 0, survivors.length - 1)]
      if (next) reopen(next.path)
      else showNothing()
    },
    [
      dropBuffers,
      file,
      noteUndo,
      reopen,
      showNothing,
      view,
      releaseFiles,
      trashWithRetry,
      setAsk,
      setRefreshKey
    ]
  )
  /** The multi-selection's delete (2026-08-22): every path to the bin, one
   *  refresh, and the viewer steps off anything that just vanished. */
  const runDeleteMany = useCallback(
    async (paths: string[]): Promise<void> => {
      setAsk(null)
      const held = releaseFiles(paths)
      const binned: string[] = []
      for (const p of paths) {
        if (await trashWithRetry(p, held && binned.length === 0)) binned.push(p)
      }
      const failed = paths.length - binned.length
      setRefreshKey((n) => n + 1)
      // Only the ones that really went: undoing a path that never left would
      // restore a file the user deliberately binned earlier.
      if (binned.length) {
        dropBuffers(binned)
        noteUndo({ kind: 'trash', paths: binned })
      }
      const cur = file?.path
      if (movedOn(cur, shown.current?.path)) {
        /* the user is on another file now; leave them there */
      } else if (cur && paths.some((p) => within(cur, p))) {
        const survivors = view?.files.filter((f) => !paths.some((p) => within(f.path, p))) ?? []
        const next = survivors[Math.min(view?.index ?? 0, survivors.length - 1)]
        if (next) reopen(next.path)
        else showNothing()
      } else if (cur) reopen(cur)
      if (failed)
        setAsk({
          kind: 'failed',
          message: `${failed} of ${paths.length} could not be moved to the Recycle Bin.`
        })
    },
    [
      dropBuffers,
      file,
      noteUndo,
      reopen,
      showNothing,
      view,
      releaseFiles,
      trashWithRetry,
      setAsk,
      setRefreshKey
    ]
  )

  /** A drop landed on a folder (#70): files move in, archive members extract
   *  there. Moving asks about taken names before it touches anything. */
  const moveTabs = useRef(tabs)
  const moveQueue = useRef<Promise<void>>(Promise.resolve())
  const moveCommits = useRef<Array<() => void>>([])
  useLayoutEffect(() => {
    moveTabs.current = tabs
    for (const done of moveCommits.current.splice(0)) done()
  }, [tabs])
  const runMove = useCallback(
    (
      paths: string[],
      dest: string,
      mode: MoveOnClash,
      track = true
    ): Promise<Array<{ from: string; to: string }>> => {
      const operation = async (): Promise<FileMove[]> => {
        // Release every tab that holds this cargo, including background previews
        // and pinned players. Read the latest committed tabs after async grants.
        const held = captureMoveViews(moveTabs.current, paths)
        const marks = new Map<string, { t: number; paused: boolean }>()
        for (const entry of held) {
          const viewing = entry.live ? [entry.tab.files[entry.tab.index].path] : []
          for (const path of viewing) {
            const url = window.prism.mediaUrl(path)
            marks.set(path, { t: sessionTime(url), paused: wasPaused(url) })
          }
        }
        setTabState((state) => ({ ...state, tabs: releaseMoveViews(state.tabs, held) }))
        const restore = (moves: FileMove[]): Promise<void> => {
          for (const [path, mark] of marks) {
            const url = window.prism.mediaUrl(movedPath(path, moves))
            if (mark.t > 0) rememberTime(url, mark.t)
            rememberPaused(url, mark.paused)
          }
          for (const buffer of [...buffers.current.values()]) {
            const path = movedPath(buffer.path, moves)
            if (path !== buffer.path) rekeyBuffer(buffer.path, path)
          }
          // A queued move must see the restored viewers in committed React state.
          // Register first, then always issue a fresh tabs array to trigger the effect.
          return new Promise((resolve) => {
            moveCommits.current.push(resolve)
            setTabState((state) => ({ ...state, tabs: restoreMoveViews(state.tabs, held, moves) }))
          })
        }
        if (held.length) await new Promise((res) => setTimeout(res, 350))
        let moved: FileMove[] = []
        try {
          let r = await window.prism.moveEntries(paths, dest, mode)
          moved = r.moved
          if (mode === 'ask' && r.clashes.length) {
            setAsk({ kind: 'move-clash', paths, dest, names: r.clashes.map((c) => c.name) })
            return []
          }
          for (let i = 0; i < 3 && r.busy.length; i += 1) {
            await new Promise((res) => setTimeout(res, 300))
            const again = await window.prism.moveEntries(r.busy, dest, mode)
            const movedNow = new Set(again.moved.map((m) => m.from.toLowerCase()))
            r = {
              ...r,
              moved: [...r.moved, ...again.moved],
              failed: [
                ...r.failed.filter((p) => !movedNow.has(p.toLowerCase())),
                ...again.failed.filter((p) => !r.failed.includes(p))
              ],
              busy: again.busy,
              replaced: [...r.replaced, ...again.replaced],
              refused: r.refused || again.refused
            }
            moved = r.moved
          }
          setAsk(null)
          setRefreshKey((n) => n + 1)
          // Folder icons go where their folders went (D9); undo and redo
          // move through here too.
          followFolderIcons(r.moved)
          // A drop or a move the user made lands marked (#101); an undo's
          // or redo's moves are marked by the step, all at once.
          if (track && r.moved.length) markLanded(r.moved.map((m) => m.to))
          if (track && r.moved.length)
            noteUndo({
              kind: 'move',
              items: r.moved,
              replaced: r.replaced?.length ? r.replaced : undefined
            })
          moved = r.moved
          if (r.failed.length)
            setAsk({
              kind: 'failed',
              message: r.refused
                ? 'Those can only be moved inside the folder Prism opened, and a tab\u2019s own folder cannot be moved.'
                : r.busy.length
                  ? `${r.busy.length === 1 && paths.length === 1 ? 'That file' : `${r.busy.length} of ${paths.length}`} could not be moved: in use by another program.`
                  : `${r.failed.length} of ${paths.length} could not be moved.`
            })
          return r.moved
        } finally {
          await restore(moved)
        }
      }
      // Only one move can detach players at once, including moves queued while
      // another is waiting for Windows handles. A failure does not block the next.
      const result = moveQueue.current.then(operation)
      moveQueue.current = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
    [noteUndo, rekeyBuffer, buffers, setAsk, setRefreshKey, setTabState]
  )

  /** What undoing and redoing each entry does is `lib/undoApply.ts`; this is
   *  how it reaches App's own moves, renames and questions. */
  const undoOps = useMemo(
    (): UndoOps => ({
      move: (paths, dest) => runMove(paths, dest, 'keep-both', false),
      rename: (path, name) => runRename(path, name, 'keep-both', false),
      refresh: () => setRefreshKey((n) => n + 1),
      fail: (message) => setAsk({ kind: 'failed', message }),
      land: markLanded,
      prism: window.prism
    }),
    [runMove, runRename, setAsk, setRefreshKey]
  )
  const applyUndo = useCallback((entry: UndoEntry) => undoEntry(entry, undoOps), [undoOps])
  const applyRedo = useCallback((entry: UndoEntry) => redoEntry(entry, undoOps), [undoOps])
  // One at a time. Restoring from the Recycle Bin spawns PowerShell and takes
  // half a second; a held Ctrl+Z would otherwise run the next inverse against
  // a file the previous one has not put back yet.
  const undoChain = useRef<Promise<void>>(Promise.resolve())
  /** An inverse can land somewhere else than it left (a taken name). Patching
   *  the entry by identity keeps the OTHER direction honest. */
  const patchEntry = useCallback(
    (was: UndoEntry, now: UndoEntry): void => {
      setUndoState((u) => ({
        past: u.past.map((e) => (e === was ? now : e)),
        future: u.future.map((e) => (e === was ? now : e))
      }))
    },
    [setUndoState]
  )
  const queueUndo = useCallback(
    (entry: UndoEntry, run: () => Promise<UndoEntry | void>): void => {
      undoChain.current = undoChain.current
        .then(async () => {
          const corrected = await run()
          if (corrected) patchEntry(entry, corrected)
        })
        .catch(() => {})
    },
    [patchEntry]
  )
  const undo = useCallback((): void => {
    const step = undone(undoState)
    if (!step) {
      flashUndo('Nothing to undo')
      return
    }
    setUndoState(step.state)
    flashUndo(`Undid ${describeUndo(step.entry)}`)
    queueUndo(step.entry, () => applyUndo(step.entry))
  }, [applyUndo, flashUndo, queueUndo, setUndoState, undoState])
  const redo = useCallback((): void => {
    const step = redone(undoState)
    if (!step) {
      flashUndo('Nothing to redo')
      return
    }
    setUndoState(step.state)
    flashUndo(`Redid ${describeUndo(step.entry)}`)
    queueUndo(step.entry, () => applyRedo(step.entry))
  }, [applyRedo, flashUndo, queueUndo, setUndoState, undoState])
  /**
   * FILES FROM WINDOWS ARE COPIED IN (#103, D3; owner, 2026-10-31). A drop
   * from Explorer, the desktop or another app used to MOVE them, though the
   * payload always said "only copied in". It is the paste engine on the
   * dropped paths: the job chip, the landing rows, names that never collide.
   */
  const copyIn = useCallback(
    async (paths: string[], dest: string): Promise<void> => {
      const job = startJob('paste', 'Copying')
      try {
        const result = await window.prism.copyInto(dest, paths, job)
        const said = pasteMessage(result, DROP_REFUSED)
        if (said) setAsk({ kind: 'failed', message: said })
        setRefreshKey((n) => n + 1)
        markLanded(result.paths ?? [])
      } catch {
        setAsk({ kind: 'failed', message: PASTE_MESSAGES.threw })
      } finally {
        endJob(job)
      }
    },
    [setAsk, setRefreshKey]
  )
  const onDropInto = useCallback(
    (dest: string, payload: DragPayload): void => {
      if (payload.kind === 'files') {
        // From Windows: a copy. Prism's own rows, in this window or back from
        // an OS drag that left a Prism window (D4): a move.
        if (payload.external) void copyIn(payload.paths, dest)
        else void runMove(payload.paths, dest, 'ask')
        return
      }
      // Members out of an archive: extracted where they were dropped, with the
      // password the archive view already asked for, if it needed one.
      //
      // This route used to show NOTHING while it ran (2026-09-19, #166,
      // owner: "the progress bar works differently based on like how you
      // extracted"), and then a dialog of its own when it failed. It is a job
      // like the other four now: main opens the extraction window, and a
      // failure is that window's error, password sentence included. A
      // cancelled drag still refreshes nothing, because nothing landed.
      void window.prism
        .archiveExtractTo(payload.archive, payload.entries, dest, archivePassword(payload.archive))
        .then((r) => {
          if (r.ok) setRefreshKey((n) => n + 1)
        })
    },
    [copyIn, runMove, setRefreshKey]
  )
  const onBrowseDropInto = useCallback(
    (dest: string, payload: DragPayload, tabId = active?.id): void => {
      if (!tabId) return
      // A desktop drop explicitly chooses both ends, including a drive or a
      // breadcrumb the tab has not visited. These grants never widen phone roots.
      const directories = new Set([
        dest,
        ...(payload.kind === 'files'
          ? payload.paths.map((path) => browseParent(path)).filter((path): path is string => !!path)
          : [])
      ])
      void Promise.all(
        [...directories].map((path) =>
          window.prism.browseDirectory(tabId, path, { details: false })
        )
      )
        .then((results) => {
          if (results.some((result) => !result || result.listing.unreadable)) {
            setAsk({
              kind: 'failed',
              message: 'The source or destination folder could not be opened.'
            })
            return
          }
          // INTO A ZIP (#300): the destination's own answer says it is a
          // place inside an archive, and the archive verbs take it.
          const inside = results[0]?.listing.archive
          if (inside) archiveActions.drop(dest, payload, inside)
          else onDropInto(dest, payload)
        })
        .catch(() =>
          setAsk({
            kind: 'failed',
            message: 'The source or destination folder could not be opened.'
          })
        )
    },
    [active, onDropInto, archiveActions, setAsk]
  )
  const onDropIntoTab = useCallback(
    (tabId: string, payload: DragPayload): void => {
      const target = moveTabs.current.find((tab) => tab.id === tabId)
      if (!target || target.kind === 'settings') return
      onBrowseDropInto(target.browse.path, payload, target.id)
    },
    [onBrowseDropInto]
  )
  return {
    redo,
    undo,
    onDropIntoTab,
    runDelete,
    runDeleteMany,
    runMove,
    runRename,
    onBrowseDropInto,
    makeNewFolder
  }
}
