// THE INVERSE TABLE (out of App.tsx, structure cleanup 2026-10-12, unchanged):
// what undoing and redoing each kind of `UndoEntry` does. `undo.ts` stays the
// pure stack; this is the half with effects, which it reaches only through
// `UndoOps`, so a test can drive it with fakes.

import { baseName, parentDir } from '@shared/path'
import type { UndoEntry } from './undo'

export interface UndoOps {
  /** Move without asking (keep both) and without remembering it. */
  move: (paths: string[], dest: string) => Promise<Array<{ from: string; to: string }>>
  /** Rename without asking (keep both) and without remembering it; the new
   *  path, or null when it failed (the rename has said why). */
  rename: (path: string, name: string) => Promise<string | null>
  /** The listings changed under Prism's own write. */
  refresh: () => void
  /** Say that something did not work ("That didn't work"). */
  fail: (message: string) => void
  prism: Pick<
    typeof window.prism,
    | 'restoreFromBin'
    | 'trashFile'
    | 'binIfEmpty'
    | 'archiveDelete'
    | 'duplicateFile'
    | 'newFolder'
    | 'archiveAdd'
  >
}

/** Reverse one action. Undo never asks: it puts things back beside whatever
 *  has appeared in the meantime rather than overwriting it. The entry comes
 *  back corrected when the inverse landed somewhere else (a taken name). */
export async function undoEntry(entry: UndoEntry, ops: UndoOps): Promise<UndoEntry | void> {
  const { prism } = ops
  switch (entry.kind) {
    case 'move': {
      // Undo lands beside whatever appeared meanwhile, so the file may now
      // sit under a "(2)" name. The entry is corrected to where it REALLY
      // is, or a redo would move a stranger.
      const items: Array<{ from: string; to: string }> = []
      for (const it of entry.items) {
        const [back] = await ops.move([it.to], parentDir(it.from))
        items.push(back ? { from: back.to, to: it.to } : it)
      }
      // The name is free again only now, so the replaced file comes back
      // after the mover has left, not before.
      if (entry.replaced?.length) await prism.restoreFromBin(entry.replaced)
      ops.refresh()
      return { ...entry, items, replaced: undefined }
    }
    case 'rename': {
      const back = await ops.rename(entry.to, baseName(entry.from))
      if (entry.replaced) await prism.restoreFromBin([entry.replaced])
      ops.refresh()
      return back ? { ...entry, from: back, replaced: undefined } : entry
    }
    case 'trash': {
      const ok = await prism.restoreFromBin(entry.paths)
      ops.refresh()
      if (!ok)
        ops.fail(
          'Windows would not give those back. They may have been emptied from the Recycle Bin.'
        )
      break
    }
    case 'duplicate':
      if (!(await prism.trashFile(entry.path)))
        ops.fail('That copy could not be moved to the Recycle Bin.')
      ops.refresh()
      break
    case 'mkdir': {
      // Only while it is still empty: what was put in it since is yours.
      const r = await prism.binIfEmpty(entry.path)
      ops.refresh()
      if (r === 'not-empty')
        ops.fail('That folder has something in it now, so it was left where it is.')
      else if (r === 'failed') ops.fail('That folder could not be moved to the Recycle Bin.')
      break
    }
    case 'archive-in': {
      // Both halves: the members leave the zip, the originals come back.
      // A folder member has no entry of its own, which deleteMember now
      // handles by taking its subtree; a refusal is worth saying out loud
      // rather than leaving a copy behind silently.
      let stuck = 0
      for (const e of entry.entries) {
        if (!(await prism.archiveDelete(entry.zip, e))) stuck += 1
      }
      if (entry.originals.length) await prism.restoreFromBin(entry.originals)
      ops.refresh()
      if (stuck)
        ops.fail(`${stuck} of ${entry.entries.length} could not be taken back out of the archive.`)
      break
    }
  }
}

/** Do one again, after it was undone. */
export async function redoEntry(entry: UndoEntry, ops: UndoOps): Promise<UndoEntry | void> {
  const { prism } = ops
  switch (entry.kind) {
    case 'move': {
      const items: Array<{ from: string; to: string }> = []
      for (const it of entry.items) {
        const [again] = await ops.move([it.from], parentDir(it.to))
        items.push(again ? { from: it.from, to: again.to } : it)
      }
      return { ...entry, items }
    }
    case 'rename': {
      const again = await ops.rename(entry.from, baseName(entry.to))
      return again ? { ...entry, to: again } : entry
    }
    case 'trash':
      for (const p of entry.paths) await prism.trashFile(p)
      ops.refresh()
      break
    case 'duplicate': {
      // Ask the SOURCE for another copy and remember the one it made: the
      // name is chosen by the folder, not by us.
      const copy = await prism.duplicateFile(entry.source)
      ops.refresh()
      if (!copy) {
        ops.fail('That could not be duplicated again.')
        break
      }
      return { ...entry, path: copy }
    }
    case 'mkdir': {
      // The same name in the same place, or "(2)" when it was taken since.
      const made = await prism.newFolder(parentDir(entry.path), baseName(entry.path))
      ops.refresh()
      if (!made) {
        ops.fail('That folder could not be made again.')
        break
      }
      return { ...entry, path: made }
    }
    case 'archive-in': {
      const r = await prism.archiveAdd(entry.zip, entry.originals, entry.dest, true)
      if (r === 'encrypted' || r === 'failed') {
        ops.fail('That archive could not be written, so nothing was moved into it.')
        break
      }
      // Bin only what actually landed - never the whole wish list - and
      // remember the member names keep-both actually used.
      for (const a of r.added) await prism.trashFile(a.src)
      ops.refresh()
      return {
        ...entry,
        entries: r.added.map((a) => a.entry),
        originals: r.added.map((a) => a.src)
      }
    }
  }
}
