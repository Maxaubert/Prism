import { mkdir, readdir, rename, stat, unlink, writeFile } from './userFs'
import { randomBytes } from 'crypto'
import { extname, join, parse } from 'path'
import { exists } from './fsUtil'
import { seamBinDirs } from './binRoots'

/**
 * "MOVE TO THE RECYCLE BIN", in one place (Recycle Bin feature, D22). Prism's
 * own deletes, the Replace of a clash and undo all go through here. In life it
 * is `shell.trashItem`; under the e2e seam (`PRISM_E2E_BIN_DIRS`, `--e2e`
 * only) it writes the same `$I`/`$R` pair into the fake bin, so a scenario that
 * deletes through the UI can never put anything into, or take anything out of,
 * the owner's real bin. Electron-free: the real call is handed in.
 */

/** Total bytes under a folder, as Windows 10 writes it into a folder's `$I`. */
async function treeSize(path: string): Promise<number> {
  const st = await stat(path)
  if (!st.isDirectory()) return st.size
  let sum = 0
  for (const name of await readdir(path)) sum += await treeSize(join(path, name)).catch(() => 0)
  return sum
}

/** A v2 `$I`: version 2, size, FILETIME, char count (with the NUL), the path. */
function recordFor(path: string, size: number): Buffer {
  const head = Buffer.alloc(28)
  head.writeBigInt64LE(2n, 0)
  head.writeBigInt64LE(BigInt(size), 8)
  head.writeBigInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n, 16)
  head.writeInt32LE(path.length + 1, 24)
  return Buffer.concat([head, Buffer.from(`${path}\0`, 'utf16le')])
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function newId(): string {
  return Array.from(randomBytes(6), (b) => ID_CHARS[b % ID_CHARS.length]).join('')
}

/** Move `path` into one of `dirs` (the one on its drive, else the first). */
export async function trashInto(dirs: readonly string[], path: string): Promise<void> {
  const root = parse(path).root.toLowerCase()
  const dir = dirs.find((d) => parse(d).root.toLowerCase() === root) ?? dirs[0]
  // No bin folder is an error, never a delete: nothing here may destroy a file.
  if (!dir) throw new Error('no Recycle Bin folder')
  await mkdir(dir, { recursive: true })
  const ext = extname(path)
  let id = newId()
  while (await exists(join(dir, `$R${id}${ext}`))) id = newId()
  const info = join(dir, `$I${id}${ext}`)
  await writeFile(info, recordFor(path, await treeSize(path).catch(() => 0)))
  try {
    await rename(path, join(dir, `$R${id}${ext}`))
  } catch (e) {
    await unlink(info).catch(() => {})
    throw e
  }
}

/** The bin call: the seam's fake bin under `--e2e`, else the real `trash`. */
export async function trashItem(path: string, real: (p: string) => Promise<void>): Promise<void> {
  const seam = seamBinDirs()
  if (seam) return trashInto(seam, path)
  return real(path)
}
