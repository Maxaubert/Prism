import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'fs'
import { cp, rm, rmdir } from 'fs/promises'
import { basename, dirname, join, resolve, sep } from 'path'
import { uniqueName } from './fileOps'

// Moving files and folders between real folders - the "move" verb CLAUDE.md
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
  /** What 'replace' sent to the bin, so undo can bring it back. */
  replaced: string[]
}

const lower = (p: string): string => resolve(p).toLowerCase()

/** True when `dest` is `src` itself or lives inside it: moving a folder into
 *  its own subtree would eat it, and the OS error for it is inscrutable. */
export function insideSelf(src: string, dest: string): boolean {
  const s = lower(src)
  const d = lower(dest)
  return d === s || d.startsWith(s.endsWith(sep) ? s : s + sep)
}

/**
 * One move, rename first: `renameSync` is atomic on the same volume and costs
 * a syscall, so it stays synchronous. Only a CROSS-VOLUME move falls back to
 * copy-then-remove, and that one is async (2026-08-28): copying a folder from
 * one disk to another with cpSync blocked the whole main process - every
 * window, every IPC reply, the terminals and the Range handler a playing film
 * depends on - for as long as the copy took.
 */
async function moveOne(src: string, target: string): Promise<void> {
  try {
    // The parent may not exist: undoing a MERGE puts files back into a folder
    // that was emptied and removed on the way in.
    mkdirSync(dirname(target), { recursive: true })
    renameSync(src, target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await cp(src, target, { recursive: true, force: true })
    await rm(src, { recursive: true, force: true })
  }
}

/** Are both of these folders? Then landing one on the other is a MERGE. */
function bothFolders(src: string, target: string): boolean {
  try {
    return statSync(src).isDirectory() && statSync(target).isDirectory()
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
function mergeClashes(src: string, target: string): MoveClash[] {
  const out: MoveClash[] = []
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(src, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const s = join(src, e.name)
    const dst = join(target, e.name)
    if (!existsSync(dst)) continue
    if (bothFolders(s, dst)) out.push(...mergeClashes(s, dst))
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
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, e.name)
    let to = join(target, e.name)
    try {
      if (existsSync(to)) {
        if (bothFolders(from, to)) {
          await mergeInto(from, to, onClash, trash, out)
          continue
        }
        if (onClash === 'replace') {
          out.replaced.push(to)
          await trash(to)
        } else to = join(target, uniqueName(target, e.name))
      }
      await moveOne(from, to)
      out.moved.push({ from, to })
    } catch {
      out.failed.push(from)
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
  const out: MoveResult = { moved: [], clashes: [], failed: [], replaced: [] }
  if (!existsSync(destDir) || !statSync(destDir).isDirectory()) {
    return { moved: [], clashes: [], failed: [...paths], replaced: [] }
  }
  const usable: string[] = []
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
    if (!existsSync(p)) {
      out.failed.push(p)
      continue
    }
    usable.push(p)
  }
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
    if (existsSync(target) && bothFolders(p, target)) {
      out.clashes.push(...mergeClashes(p, target))
      claimed.add(name.toLowerCase())
      continue
    }
    if (existsSync(target) || claimed.has(name.toLowerCase())) out.clashes.push({ path: p, name })
    claimed.add(name.toLowerCase())
  }
  if (onClash === 'ask' && out.clashes.length) return out

  for (const p of usable) {
    const name = basename(p)
    let target = join(destDir, name)
    try {
      if (existsSync(target)) {
        // Same name, both folders: pour one into the other rather than
        // landing a second copy beside it.
        if (bothFolders(p, target)) {
          await mergeInto(p, target, onClash, trash, out)
          continue
        }
        // Only an explicit 'replace' may destroy; everything else lands beside
        // what is there. 'ask' must never reach a write it did not ask about.
        if (onClash === 'replace') {
          out.replaced.push(target)
          await trash(target)
        } else target = join(destDir, uniqueName(destDir, name))
      }
      await moveOne(p, target)
      out.moved.push({ from: p, to: target })
    } catch {
      out.failed.push(p)
    }
  }
  return out
}
