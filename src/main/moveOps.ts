import type { Dirent } from 'fs'
import { cp, mkdir, readdir, rename, rm, rmdir, stat } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { isInside, pathKey } from '@shared/path'
import { uniqueNameAsync } from './fileOps'
import { exists, isBusyError } from './fsUtil'

// Moving files and folders between real folders - the "move" verb docs/features.md
// reserved, decided 2026-08-22 and reachable only by dragging. Deliberately
// free of electron imports so it can be unit-tested; binning what an overwrite
// replaces is passed in, exactly as renameFile does it.

export type MoveClash = { path: string; name: string }
export type MoveResult = {
  /** Where each one came from and landed: undo needs both halves. */
  moved: Array<{ from: string; to: string }>
  /** Names already taken at the destination; with onClash 'ask' nothing moved. */
  clashes: MoveClash[]
  /** Paths that could not be moved at all (gone, locked, into themselves). */
  failed: string[]
  /** The ones among `failed` that Windows refused because something holds
   *  the file open (EBUSY, EPERM) - which is Prism's own player as often as
   *  not (#127), so the renderer lets go and tries these again. */
  busy: string[]
  /** What 'replace' sent to the bin, so undo can bring it back. */
  replaced: string[]
}

const lower = (p: string): string => pathKey(resolve(p))

/** True when `dest` is `src` itself or lives inside it: moving a folder into
 *  its own subtree would eat it, and the OS error for it is inscrutable. */
export function insideSelf(src: string, dest: string): boolean {
  return isInside(resolve(src), resolve(dest), { orEqual: true })
}

/**
 * One move, rename first: a rename is atomic on the same volume. Only a
 * CROSS-VOLUME move falls back to copy-then-remove. All of it is async: copying
 * a folder from one disk to another with cpSync blocked the whole main process
 * (2026-08-28) - every window, every IPC reply, the terminals and the Range
 * handler a playing film depends on - for as long as the copy took, and even
 * the rename can stall on a busy or network disk (2026-10-12).
 */
async function moveOne(src: string, target: string): Promise<void> {
  try {
    // The parent may not exist: undoing a MERGE puts files back into a folder
    // that was emptied and removed on the way in.
    await mkdir(dirname(target), { recursive: true })
    await rename(src, target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await cp(src, target, { recursive: true, force: true })
    await rm(src, { recursive: true, force: true })
  }
}

/** Are both of these folders? Then landing one on the other is a MERGE. */
async function bothFolders(src: string, target: string): Promise<boolean> {
  try {
    return (await stat(src)).isDirectory() && (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Every FILE clash a merge of `src` into `target` would hit, however deep.
 *
 * Two folders of the same name are not a clash - they are one folder with
 * more in it - so the question is only ever about the files inside them, and
 * only about the ones whose names are actually taken. Walked before anything
 * moves, so 'ask' can report the lot and leave the disk untouched.
 */
async function mergeClashes(src: string, target: string): Promise<MoveClash[]> {
  const out: MoveClash[] = []
  let entries: Dirent[]
  try {
    entries = await readdir(src, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const s = join(src, e.name)
    const dst = join(target, e.name)
    if (!(await exists(dst))) continue
    if (await bothFolders(s, dst)) out.push(...(await mergeClashes(s, dst)))
    else out.push({ path: s, name: e.name })
  }
  return out
}

/**
 * Pour `src` into `target`, which already exists and is also a folder.
 *
 * Recursive, because a merge can meet another same-named folder one level
 * down and the same rule applies there. Only genuine FILE collisions consult
 * `onClash`. The emptied source is removed non-recursively on the way out, so
 * anything that could not be moved keeps its folder rather than being deleted
 * along with it.
 */
async function mergeInto(
  src: string,
  target: string,
  onClash: 'ask' | 'keep-both' | 'replace',
  trash: (p: string) => Promise<void>,
  out: MoveResult
): Promise<void> {
  for (const e of await readdir(src, { withFileTypes: true })) {
    const from = join(src, e.name)
    let to = join(target, e.name)
    try {
      if (await exists(to)) {
        if (await bothFolders(from, to)) {
          await mergeInto(from, to, onClash, trash, out)
          continue
        }
        if (onClash === 'replace') {
          out.replaced.push(to)
          await trash(to)
        } else to = join(target, await uniqueNameAsync(target, e.name))
      }
      await moveOne(from, to)
      out.moved.push({ from, to })
    } catch (e) {
      out.failed.push(from)
      if (isBusyError(e)) out.busy.push(from)
    }
  }
  // Empty now, unless something above failed - in which case it stays, with
  // whatever is left in it. `rmdir` and not `rm`: rm refuses a directory
  // without `recursive`, and `recursive` would delete exactly the leftovers
  // this is trying to preserve.
  await rmdir(src).catch(() => {})
}

/**
 * Move every path into `destDir`. Files and folders alike.
 *
 * `onClash` decides what a taken name does, mirroring renameFile: 'ask' reports
 * the clashes and moves NOTHING (so the user answers before anything happens),
 * 'keep-both' lands them as "name (2)", 'replace' bins what it replaces first.
 */
export async function moveEntries(
  paths: readonly string[],
  destDir: string,
  onClash: 'ask' | 'keep-both' | 'replace',
  trash: (p: string) => Promise<void>
): Promise<MoveResult> {
  const out: MoveResult = { moved: [], clashes: [], failed: [], replaced: [], busy: [] }
  const dest = await stat(destDir).catch(() => null)
  if (!dest?.isDirectory()) {
    return { moved: [], clashes: [], failed: [...paths], replaced: [], busy: [] }
  }
  const candidates: string[] = []
  for (const p of paths) {
    // A folder and something inside it can both be selected; moving the
    // folder already carries the child, so the child is not a failure - it
    // simply has nothing left to do.
    if (paths.some((q) => lower(q) !== lower(p) && insideSelf(q, p))) continue
    // A folder dropped on itself (or into its own subtree), or anything
    // dropped where it already lives: the gesture asks for nothing, so
    // nothing happens - and nothing is reported either. Only a path that has
    // GONE is a failure worth a word.
    if (insideSelf(p, destDir) || lower(dirname(p)) === lower(destDir)) continue
    candidates.push(p)
  }
  // Probed together (a multi-select drag can be hundreds), reported in order.
  const present = await Promise.all(candidates.map(exists))
  const usable: string[] = []
  candidates.forEach((p, i) => {
    if (present[i]) usable.push(p)
    else out.failed.push(p)
  })
  // The clash pass counts names the BATCH itself claims, not just what is
  // already on disk: two files called photo.jpg from different folders are a
  // clash with each other, and silently overwriting one was data loss.
  const claimed = new Set<string>()
  for (const p of usable) {
    const name = basename(p)
    const target = join(destDir, name)
    // TWO FOLDERS OF THE SAME NAME ARE NOT A CLASH (2026-08-31). They are one
    // folder with more in it, which is what every file manager does and what
    // anybody dragging one expects; asking "keep both or replace" there
    // offered a second copy of a tree or the destruction of one. The question
    // survives for the FILES inside, and only for the names actually taken.
    const taken = await exists(target)
    if (taken && (await bothFolders(p, target))) {
      out.clashes.push(...(await mergeClashes(p, target)))
      claimed.add(name.toLowerCase())
      continue
    }
    if (taken || claimed.has(name.toLowerCase())) out.clashes.push({ path: p, name })
    claimed.add(name.toLowerCase())
  }
  if (onClash === 'ask' && out.clashes.length) return out

  for (const p of usable) {
    const name = basename(p)
    let target = join(destDir, name)
    try {
      if (await exists(target)) {
        // Same name, both folders: pour one into the other rather than
        // landing a second copy beside it.
        if (await bothFolders(p, target)) {
          await mergeInto(p, target, onClash, trash, out)
          continue
        }
        // Only an explicit 'replace' may destroy; everything else lands beside
        // what is there. 'ask' must never reach a write it did not ask about.
        if (onClash === 'replace') {
          out.replaced.push(target)
          await trash(target)
        } else target = join(destDir, await uniqueNameAsync(destDir, name))
      }
      await moveOne(p, target)
      out.moved.push({ from: p, to: target })
    } catch (e) {
      out.failed.push(p)
      if (isBusyError(e)) out.busy.push(p)
    }
  }
  return out
}
