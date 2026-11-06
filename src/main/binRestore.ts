import { readFile, readdir, rename, unlink } from 'fs/promises'
import { extname, join, parse } from 'path'
import { exists } from './fsUtil'

/**
 * UNDO'S RESTORE READS THE BIN ITSELF (2026-11-06). Undoing a delete used to
 * start a PowerShell that walked the whole Recycle Bin through the shell
 * (`Shell.Application`, every item of every drive, 1.0 to 2.2 s with ~1,800
 * items) and now and then took 10.4 s: the hotkeys e2e saw the file come back
 * after its 10 s wait (the `restore` op line said `ms: 10391`, `ok: true`).
 *
 * A file Windows bins on a drive lands in `<drive>\$Recycle.Bin\<user SID>\`
 * as two entries: `$R<id><ext>`, the file itself, and `$I<id><ext>`, a few
 * bytes saying where it came from and when. Restoring is moving the `$R` back
 * and dropping its `$I`, which is what Explorer's Restore does. Only the `$I`
 * files with the path's extension and a `$R` beside them are read, so this is
 * a handful of small reads, no process and no shell.
 *
 * Anything it cannot do (a drive with no such folder, the name taken again,
 * a move refused) is left to the caller's shell path, so it never does less
 * than that path did.
 */

/** What an `$I` file says: the path the item was deleted from, and when
 *  (a FILETIME, larger is later). Version 1 (Vista, 7) has a fixed 260-char
 *  path at 24; version 2 (8 and later) a char count at 24 and the path at 28. */
export function parseInfo(buf: Buffer): { path: string; deletedAt: bigint } | null {
  if (buf.length < 24) return null
  const version = buf.readBigInt64LE(0)
  const deletedAt = buf.readBigInt64LE(16)
  let raw: string
  if (version === 1n) {
    if (buf.length < 24 + 520) return null
    raw = buf.toString('utf16le', 24, 24 + 520)
  } else if (version === 2n) {
    if (buf.length < 28) return null
    const chars = buf.readInt32LE(24)
    if (chars <= 0 || buf.length < 28 + chars * 2) return null
    raw = buf.toString('utf16le', 28, 28 + chars * 2)
  } else return null
  const end = raw.indexOf('\0')
  const path = end < 0 ? raw : raw.slice(0, end)
  return path ? { path, deletedAt } : null
}

/** The bins a path's drive keeps, one per user folder this process can read. */
async function binsOf(path: string): Promise<string[]> {
  const top = join(parse(path).root, '$Recycle.Bin')
  const users = await readdir(top).catch(() => [] as string[])
  return users.map((u) => join(top, u))
}

/**
 * Put `path` back from the Recycle Bin: the latest copy binned from exactly
 * there. True when it is back; false when the bin had none this could move
 * (the caller then asks the shell). `bins` is the tests' own folders.
 */
export async function restoreFromBin(path: string, bins?: string[]): Promise<boolean> {
  if (await exists(path)) return false
  const ext = extname(path).toLowerCase()
  const want = path.toLowerCase()
  let best: { dir: string; id: string; deletedAt: bigint } | null = null
  for (const dir of bins ?? (await binsOf(path))) {
    const names = await readdir(dir).catch(() => [] as string[])
    const there = new Set(names.map((n) => n.toLowerCase()))
    for (const n of names) {
      if (!n.startsWith('$I') || extname(n).toLowerCase() !== ext) continue
      const id = n.slice(2)
      if (!there.has(`$r${id}`.toLowerCase())) continue
      const info = parseInfo(await readFile(join(dir, n)).catch(() => Buffer.alloc(0)))
      if (!info || info.path.toLowerCase() !== want) continue
      if (!best || info.deletedAt > best.deletedAt) best = { dir, id, deletedAt: info.deletedAt }
    }
  }
  if (!best) return false
  try {
    await rename(join(best.dir, `$R${best.id}`), path)
  } catch {
    return false
  }
  // Its record goes too, or Explorer's bin would list a ghost.
  await unlink(join(best.dir, `$I${best.id}`)).catch(() => {})
  return true
}
