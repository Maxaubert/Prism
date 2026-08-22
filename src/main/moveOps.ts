import { cpSync, existsSync, renameSync, rmSync, statSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import { uniqueName } from './fileOps'

// Moving files and folders between real folders - the "move" verb CLAUDE.md
// reserved, decided 2026-08-22 and reachable only by dragging. Deliberately
// free of electron imports so it can be unit-tested; binning what an overwrite
// replaces is passed in, exactly as renameFile does it.

export type MoveClash = { path: string; name: string }
export type MoveResult = {
  moved: string[]
  /** Names already taken at the destination; with onClash 'ask' nothing moved. */
  clashes: MoveClash[]
  /** Paths that could not be moved at all (gone, locked, into themselves). */
  failed: string[]
}

const lower = (p: string): string => resolve(p).toLowerCase()

/** True when `dest` is `src` itself or lives inside it: moving a folder into
 *  its own subtree would eat it, and the OS error for it is inscrutable. */
export function insideSelf(src: string, dest: string): boolean {
  const s = lower(src)
  const d = lower(dest)
  return d === s || d.startsWith(s.endsWith(sep) ? s : s + sep)
}

/** One move, rename first: `renameSync` is atomic on the same volume, and only
 *  a cross-volume move needs the copy-then-remove fallback. */
function moveOne(src: string, target: string): void {
  try {
    renameSync(src, target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    cpSync(src, target, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
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
  const out: MoveResult = { moved: [], clashes: [], failed: [] }
  if (!existsSync(destDir) || !statSync(destDir).isDirectory()) {
    return { moved: [], clashes: [], failed: [...paths] }
  }
  const usable: string[] = []
  for (const p of paths) {
    // Already there, gone, or a folder swallowing itself: nothing to do.
    if (!existsSync(p) || insideSelf(p, destDir) || lower(dirname(p)) === lower(destDir)) {
      if (!existsSync(p) || insideSelf(p, destDir)) out.failed.push(p)
      continue
    }
    usable.push(p)
  }
  for (const p of usable) {
    const name = basename(p)
    if (existsSync(join(destDir, name))) out.clashes.push({ path: p, name })
  }
  if (onClash === 'ask' && out.clashes.length) return out

  for (const p of usable) {
    const name = basename(p)
    let target = join(destDir, name)
    try {
      if (existsSync(target)) {
        if (onClash === 'keep-both') target = join(destDir, uniqueName(destDir, name))
        else await trash(target)
      }
      moveOne(p, target)
      out.moved.push(target)
    } catch {
      out.failed.push(p)
    }
  }
  return out
}
