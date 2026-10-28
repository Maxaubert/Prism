import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { insideSelf } from './moveOps'

/**
 * Would pasting `src` into `destDir` put a folder inside itself (2026-10-16)?
 *
 * Paste never asked, though the drag-move always did (`insideSelf` in
 * moveOps). A folder pasted into itself or one of its own subfolders copied
 * the copy it was making, level after level (A\A\A...), until the path grew
 * past 32k characters, and left a tree Explorer could barely delete. A cut
 * took the same road: the rename fails with EINVAL and the copy fallback ran.
 */
export function pastesIntoItself(src: string, destDir: string): boolean {
  return insideSelf(src, destDir)
}

/** A share as a percentage, 0 to 100 (0 when there is nothing to share). */
export function pctOf(done: number, of: number): number {
  return of > 0 ? Math.min(100, (done / of) * 100) : 0
}

/**
 * How far a CUT has got when an item could not be renamed (another drive, a
 * lock) and is being copied instead (review, 2026-10-28). A move's other
 * items are renames with no byte count, so the job is counted in items: the
 * ones before this, plus this one's share. It used to divide the whole job's
 * bytes by this item's size, which read 100% from the second such item on.
 */
export function movePct(index: number, count: number, itemDone: number, itemSize: number): number {
  if (count <= 0) return 0
  const share = itemSize > 0 ? Math.min(1, itemDone / itemSize) : 0
  return Math.min(100, ((index + share) / count) * 100)
}

/**
 * The name each pasted item will land under, in order (review, 2026-10-28):
 * each is kept apart from the ones before it as well as from what is on
 * disk, so `A\readme.md` and `B\readme.md` land as `readme.md` and
 * `readme (2).md`, the list's rows have one path each, and the copy writes
 * exactly where its row said.
 */
export async function predictNames(
  names: string[],
  unique: (name: string, taken: ReadonlySet<string>) => Promise<string>
): Promise<string[]> {
  const taken = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const name = await unique(n, taken).catch(() => n)
    taken.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

/** Copy a file or a whole folder, streaming files so the byte count can
 *  tick. fs.cp gives no progress at all, which for a 4GB ISO is minutes
 *  of nothing (owner, 2026-09-03). */
export async function copyCounted(
  src: string,
  target: string,
  tick: (bytes: number) => void
): Promise<void> {
  const st = await stat(src)
  if (st.isDirectory()) {
    // Listed BEFORE the new folder is made (2026-10-16): made first, a target
    // inside `src` showed up in its own listing and was copied into itself.
    // `pastesIntoItself` is the real guard; this keeps one level honest even
    // for a caller that forgot it.
    const names = await readdir(src)
    await mkdir(target)
    for (const e of names) {
      await copyCounted(join(src, e), join(target, e), tick)
    }
    return
  }
  const reader = createReadStream(src)
  reader.on('data', (chunk) => tick(chunk.length))
  await pipeline(reader, createWriteStream(target, { flags: 'wx' }))
}

/**
 * Every file under a path, in bytes, for a paste's progress arithmetic.
 *
 * SIZED AFTER THE ROWS ARE SHOWN (review, 2026-10-28): the paste used to walk
 * every source whole before it said anything, so a big folder showed nothing
 * until the walk ended ("nothing happens and suddenly items just appear").
 * It now runs after the rows are said; `stopped` can end it early. Links and junctions are counted as themselves and never
 * followed (lstat): a junction loop such as `Application Data` cannot keep
 * it walking, and the bar is only a guide.
 */
export async function walkSizes(p: string, stopped: () => boolean = () => false): Promise<number> {
  if (stopped()) return 0
  const st = await lstat(p)
  if (!st.isDirectory()) return st.isSymbolicLink() ? 0 : st.size
  let total = 0
  for (const e of await readdir(p, { withFileTypes: true })) {
    if (stopped()) break
    if (e.isSymbolicLink()) continue
    try {
      total += await walkSizes(join(p, e.name), stopped)
    } catch {
      /* unreadable entries copy as failures later; the bar only guides */
    }
  }
  return total
}
