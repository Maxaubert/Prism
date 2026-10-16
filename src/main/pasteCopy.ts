import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
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
