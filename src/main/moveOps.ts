import { existsSync, renameSync, statSync } from 'fs'
import { cp, rm } from 'fs/promises'
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
    renameSync(src, target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await cp(src, target, { recursive: true, force: true })
    await rm(src, { recursive: true, force: true })
  }
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
    if (existsSync(join(destDir, name)) || claimed.has(name.toLowerCase()))
      out.clashes.push({ path: p, name })
    claimed.add(name.toLowerCase())
  }
  if (onClash === 'ask' && out.clashes.length) return out

  for (const p of usable) {
    const name = basename(p)
    let target = join(destDir, name)
    try {
      if (existsSync(target)) {
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
