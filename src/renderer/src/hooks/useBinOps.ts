import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { BIN_PLACE } from '@shared/binPlace'
import type { MoveOnClash } from '@shared/ipcTypes'
import type { Ask } from '../dialogs/asks'
import type { UndoEntry } from '../lib/undo'
import { withFileJob } from '../lib/fileJob'
import { markLanded } from '../lib/landMarks'
import { noteBinned, noteGoing, noteStayed } from '../lib/binnedRows'
import {
  binDeleteFailure,
  binHoldDirs,
  binRestoreFailure,
  binStopped,
  namesOfBinPaths
} from '../lib/binActions'

/** One row of the bin's list, as the hook needs it: the bin entry's path, its
 *  ORIGINAL name, and the folder it came from. */
export interface BinRowInfo {
  path: string
  name: string
  from?: string
}

export interface BinOpsDeps {
  setAsk: Dispatch<SetStateAction<Ask | null>>
  setRefreshKey: Dispatch<SetStateAction<number>>
  noteUndo: (entry: UndoEntry) => void
  /** The bin list on screen now (empty when the bin is not what is shown). */
  rows: () => readonly BinRowInfo[]
}

export interface BinOps {
  /** Restore: asks only when a name is taken where the item goes back. */
  restore: (paths: string[]) => void
  /** The answer to the clash question, or the 'ask' pass itself. */
  runRestore: (paths: string[], mode: MoveOnClash) => Promise<void>
  /** Delete permanently: the final question first. */
  askDelete: (paths: string[]) => void
  runDelete: (paths: string[]) => Promise<void>
  /** Empty Recycle Bin: the final question first (with the count when known). */
  askEmpty: () => void
  runEmpty: () => Promise<void>
}

/**
 * THE RECYCLE BIN'S THREE JOBS (Recycle Bin, D13 to D18): Restore, Delete
 * permanently and Empty, each through `withFileJob` so each gets the one-second
 * threshold, the hold on the list, Cancel and the `finally` that always ends
 * the bar. Main does the work and answers what it did (`binOps.ts`); this
 * decides what is said and what is remembered. Only Restore is undoable
 * (`unbin`, D18): Delete permanently and Empty are final and never on the stack.
 */
export function useBinOps({ setAsk, setRefreshKey, noteUndo, rows }: BinOpsDeps): BinOps {
  const fromOf = useCallback(
    (path: string): string | undefined => rows().find((r) => r.path === path)?.from,
    [rows]
  )

  const runRestore = useCallback(
    async (paths: string[], mode: MoveOnClash): Promise<void> => {
      setAsk(null)
      if (!paths.length) return
      const one = paths.length === 1 ? namesOfBinPaths(paths, rows())[0] : undefined
      await withFileJob(
        {
          kind: 'bin',
          verb: 'Restoring',
          name: one,
          total: paths.length,
          dirs: binHoldDirs(paths, fromOf)
        },
        async (job) => {
          noteGoing(paths)
          let r
          try {
            r = await window.prism.binRestore(paths, mode, job.id)
          } catch {
            noteStayed(paths)
            setAsk({ kind: 'failed', message: binRestoreFailure(paths.length, paths.length), op: 'bin-restore' })
            return
          }
          // A name is taken where they go: nothing moved, the same question as a
          // paste asks (D13).
          if (mode === 'ask' && r.clashes.length) {
            noteStayed(paths)
            setAsk({ kind: 'bin-clash', paths, names: r.clashes.map((c) => c.name) })
            return
          }
          noteStayed(r.left)
          noteBinned(r.restored.length ? paths.filter((p) => !r.left.includes(p)) : [])
          setRefreshKey((n) => n + 1)
          if (r.restored.length) {
            // Marked where they land (#101). They are on disk already; the list
            // showing that folder (this tab's next place, or another tab) marks them.
            markLanded(r.restored)
            noteUndo({ kind: 'unbin', paths: r.restored })
          }
          if (r.cancelled) {
            job.note(binStopped('Restored', r.restored.length, paths.length))
            return
          }
          const failed = r.failed.length || (r.refused ? paths.length - r.restored.length : 0)
          if (failed)
            setAsk({ kind: 'failed', message: binRestoreFailure(failed, paths.length), op: 'bin-restore' })
        }
      )
    },
    [fromOf, noteUndo, rows, setAsk, setRefreshKey]
  )

  const restore = useCallback((paths: string[]): void => void runRestore(paths, 'ask'), [runRestore])

  const askDelete = useCallback(
    (paths: string[]): void => {
      if (!paths.length) return
      setAsk({ kind: 'bin-delete', paths, names: namesOfBinPaths(paths, rows()) })
    },
    [rows, setAsk]
  )

  const runDelete = useCallback(
    async (paths: string[]): Promise<void> => {
      setAsk(null)
      if (!paths.length) return
      const one = paths.length === 1 ? namesOfBinPaths(paths, rows())[0] : undefined
      await withFileJob(
        { kind: 'bin', verb: 'Deleting', name: one, total: paths.length, dirs: [BIN_PLACE] },
        async (job) => {
          noteGoing(paths)
          let r
          try {
            r = await window.prism.binDelete(paths, job.id)
          } catch {
            noteStayed(paths)
            setAsk({ kind: 'failed', message: binDeleteFailure(paths.length, paths.length), op: 'bin-delete' })
            return
          }
          noteStayed(r.left)
          noteBinned(paths.filter((p) => !r.left.includes(p)))
          setRefreshKey((n) => n + 1)
          if (r.cancelled) {
            job.note(binStopped('Deleted', r.deleted, r.total))
            return
          }
          if (r.left.length)
            setAsk({ kind: 'failed', message: binDeleteFailure(r.left.length, r.total), op: 'bin-delete' })
        }
      )
    },
    [rows, setAsk, setRefreshKey]
  )

  const askEmpty = useCallback((): void => {
    // The count only when the bin is the list on screen.
    const count = rows().length
    setAsk({ kind: 'bin-empty', ...(count ? { count } : {}) })
  }, [rows, setAsk])

  const runEmpty = useCallback(async (): Promise<void> => {
    setAsk(null)
    await withFileJob(
      { kind: 'bin', verb: 'Emptying', dirs: [BIN_PLACE] },
      async (job) => {
        let r
        try {
          r = await window.prism.binEmpty(job.id)
        } catch {
          setAsk({ kind: 'failed', message: 'The Recycle Bin could not be emptied.', op: 'bin-empty' })
          return
        }
        setRefreshKey((n) => n + 1)
        if (r.cancelled) {
          job.note(binStopped('Deleted', r.deleted, r.total))
          return
        }
        if (r.left.length)
          setAsk({ kind: 'failed', message: binDeleteFailure(r.left.length, r.total), op: 'bin-empty' })
      }
    )
  }, [setAsk, setRefreshKey])

  return { restore, runRestore, askDelete, runDelete, askEmpty, runEmpty }
}
