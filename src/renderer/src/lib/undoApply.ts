// THE INVERSE TABLE (out of App.tsx, structure cleanup 2026-10-12, unchanged):
// what undoing and redoing each kind of `UndoEntry` does. `undo.ts` stays the
// pure stack; this is the half with effects, which it reaches only through
// `UndoOps`, so a test can drive it with fakes.

import { placeOf } from '@shared/archivePlace'
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
  /** What the step put back or made again, for the list to mark (#101). */
  land?: (paths: readonly string[]) => void
  prism: Pick<
    typeof window.prism,
    | 'restoreFromBin'
    | 'trashFile'
    | 'binIfEmpty'
    | 'archiveDelete'
    | 'duplicateFile'
    | 'newFolder'
    | 'archiveAdd'
    | 'archiveMoveMembers'
  >
}

type ZipMove = Extract<UndoEntry, { kind: 'archive-move' }>

/** The folder a name inside a zip is in, '' at its root. */
const innerParent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * Move each member of a zip move one way (#70 D8): `back` from where it went
 * to where it was, else again. One call per destination folder, each member
 * under the name it had there; a taken name lands as "name (2)" (undo never
 * asks). The entry comes back naming where each member really is, and what
 * moved is marked where the Explorer shows it.
 */
async function zipMoves(entry: ZipMove, ops: UndoOps, back: boolean): Promise<ZipMove> {
  const groups = new Map<string, number[]>()
  entry.items.forEach((it, i) => {
    const dest = innerParent(back ? it.from : it.to)
    groups.set(dest, [...(groups.get(dest) ?? []), i])
  })
  const items = entry.items.map((it) => ({ ...it }))
  const landed: string[] = []
  let stuck = 0
  for (const [dest, indexes] of groups) {
    const r = await ops.prism.archiveMoveMembers(
      entry.zip,
      indexes.map((i) => (back ? entry.items[i].to : entry.items[i].from)),
      dest,
      true,
      indexes.map((i) => baseName(back ? entry.items[i].from : entry.items[i].to))
    )
    const moved = typeof r === 'object' ? r.moved : []
    for (const i of indexes) {
      const it = entry.items[i]
      const done = moved.find((m) => m.from === (back ? it.to : it.from))
      if (!done) {
        stuck += 1
        continue
      }
      items[i] = back ? { from: done.to, to: it.to } : { from: it.from, to: done.to }
      landed.push(done.to)
    }
  }
  ops.refresh()
  if (entry.base && landed.length) ops.land?.(landed.map((p) => placeOf(entry.base as string, p)))
  if (stuck)
    ops.fail(
      `${stuck} of ${entry.items.length} could not be moved ${back ? 'back' : 'again'} inside the archive.`
    )
  return { ...entry, items }
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
      // Only what really came back is marked: a stuck item has no row to wait for.
      const items: Array<{ from: string; to: string }> = []
      const landed: string[] = []
      for (const it of entry.items) {
        const [back] = await ops.move([it.to], parentDir(it.from))
        items.push(back ? { from: back.to, to: it.to } : it)
        if (back) landed.push(back.to)
      }
      // The name is free again only now, so the replaced file comes back
      // after the mover has left, not before.
      if (entry.replaced?.length) await prism.restoreFromBin(entry.replaced)
      ops.refresh()
      ops.land?.(landed)
      return { ...entry, items, replaced: undefined }
    }
    case 'rename': {
      const back = await ops.rename(entry.to, baseName(entry.from))
      if (entry.replaced) await prism.restoreFromBin([entry.replaced])
      ops.refresh()
      if (back) ops.land?.([back])
      return back ? { ...entry, from: back, replaced: undefined } : entry
    }
    case 'trash': {
      const ok = await prism.restoreFromBin(entry.paths)
      ops.refresh()
      if (ok) ops.land?.(entry.paths)
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
    case 'archive-move':
      return zipMoves(entry, ops, true)
    case 'archive-in': {
      // Both halves: the members leave the zip, the originals come back.
      // A folder member has no entry of its own, which deleteMember now
      // handles by taking its subtree; a refusal is worth saying out loud
      // rather than leaving a copy behind silently.
      let stuck = 0
      for (const e of entry.entries) {
        if (!(await prism.archiveDelete(entry.zip, e))) stuck += 1
      }
      const back = entry.originals.length ? await prism.restoreFromBin(entry.originals) : false
      ops.refresh()
      if (back) ops.land?.(entry.originals)
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
      const landed: string[] = []
      for (const it of entry.items) {
        const [again] = await ops.move([it.from], parentDir(it.to))
        items.push(again ? { from: it.from, to: again.to } : it)
        if (again) landed.push(again.to)
      }
      ops.land?.(landed)
      return { ...entry, items }
    }
    case 'rename': {
      const again = await ops.rename(entry.from, baseName(entry.to))
      if (again) ops.land?.([again])
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
      ops.land?.([copy])
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
      ops.land?.([made])
      return { ...entry, path: made }
    }
    case 'archive-move':
      return zipMoves(entry, ops, false)
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
