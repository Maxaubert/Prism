import { readFile as fsReadFile, readdir } from 'fs/promises'
import { extname, join } from 'path'
import { fileKind } from '../shared/fileKind'
import { byName } from '../shared/path'
import type { DirEntry, DirListing, FileKind, ViewerFile } from '../shared/types'
import { parseInfo } from './binRestore'

/**
 * THE BIN, READ DIRECTLY (Recycle Bin feature, D1 and D3). One `readdir` per
 * bin folder says which `$R` entries are files and which folders; the small
 * `$I` records (where from, when, how big) are read 64 at a time. No process,
 * no shell namespace, no `*Sync`: main's loop is never held longer than one
 * batch. A `$I` never changes once written, so a warm cache keeps every
 * parsed record by folder and name and a re-read only reads the new ones.
 */

/** One binned item, as the bin view shows it. `path` is the `$R` entry in the bin. */
export interface BinRow {
  /** The `$R<id><ext>` entry (what Restore moves and Delete removes). */
  path: string
  /** The bin folder it lives in. */
  dir: string
  /** `<id><ext>`, the part after `$R`/`$I`. */
  id: string
  /** The original name. */
  name: string
  /** The original folder. */
  from: string
  /** When it was deleted, in ms since the epoch. */
  deleted: number
  /** Size in bytes, as Windows wrote it in the record (not a walk). */
  size: number
  folder: boolean
  /** From the ORIGINAL name's extension; a folder is 'other' (see `folder`). */
  kind: FileKind
}

export interface BinRead {
  rows: BinRow[]
  /** Records that could not be parsed (unknown version, short): one diag line, never a broken row. */
  skipped: number
}

type Parsed = { from: string; name: string; deleted: number; size: number } | 'bad'

const BATCH = 64
// FILETIME (100 ns since 1601) to Unix ms.
const EPOCH_DELTA_MS = 11644473600000n

export function createBinReader(readFile: (path: string) => Promise<Buffer> = fsReadFile): {
  read(dirs: readonly string[]): Promise<BinRead>
  clear(): void
} {
  const cache = new Map<string, Parsed>()

  async function readDir(dir: string): Promise<{ rows: BinRow[]; skipped: number }> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return { rows: [], skipped: 0 }
    const byLower = new Map<string, (typeof entries)[number]>()
    for (const e of entries) byLower.set(e.name.toLowerCase(), e)
    // Pairs only: an orphan half is hidden by Explorer too. A link or
    // junction is not a binned file (moveBack refuses it as well).
    const pairs: { id: string; folder: boolean }[] = []
    for (const e of entries) {
      if (!e.name.startsWith('$I')) continue
      const id = e.name.slice(2)
      const r = byLower.get(`$r${id}`.toLowerCase())
      if (!r || r.isSymbolicLink()) continue
      pairs.push({ id, folder: r.isDirectory() })
    }
    const live = new Set<string>()
    const fresh: string[] = []
    for (const p of pairs) {
      const key = `${dir}|$I${p.id}`
      live.add(key)
      if (!cache.has(key)) fresh.push(p.id)
    }
    // Forget what left the bin since the last read.
    const prefix = `${dir}|`
    for (const key of cache.keys()) if (key.startsWith(prefix) && !live.has(key)) cache.delete(key)

    for (let i = 0; i < fresh.length; i += BATCH) {
      await Promise.all(
        fresh.slice(i, i + BATCH).map(async (id) => {
          const buf = await readFile(join(dir, `$I${id}`)).catch(() => Buffer.alloc(0))
          const info = parseInfo(buf)
          if (!info) return void cache.set(`${dir}|$I${id}`, 'bad')
          const original = info.path
          const cut = Math.max(original.lastIndexOf('\\'), original.lastIndexOf('/'))
          cache.set(`${dir}|$I${id}`, {
            name: cut < 0 ? original : original.slice(cut + 1),
            from: cut < 0 ? '' : original.slice(0, cut),
            deleted: Number(info.deletedAt / 10000n - EPOCH_DELTA_MS),
            size: Number(info.size)
          })
        })
      )
    }

    const rows: BinRow[] = []
    let skipped = 0
    for (const p of pairs) {
      const got = cache.get(`${dir}|$I${p.id}`)
      if (!got || got === 'bad') {
        skipped++
        continue
      }
      rows.push({
        path: join(dir, `$R${p.id}`),
        dir,
        id: p.id,
        name: got.name,
        from: got.from,
        deleted: got.deleted,
        size: got.size,
        folder: p.folder,
        kind: p.folder ? 'other' : fileKind(extname(got.name), got.name)
      })
    }
    return { rows, skipped }
  }

  return {
    async read(dirs) {
      const parts = await Promise.all(dirs.map(readDir))
      return { rows: parts.flatMap((p) => p.rows), skipped: parts.reduce((n, p) => n + p.skipped, 0) }
    },
    clear: () => cache.clear()
  }
}

/** The one reader main shares, so its warm cache survives between views. */
export const binReader = createBinReader()

/**
 * THE BIN AS A LISTING (stage 2): the rows as the Explorer's `DirListing`,
 * flagged `bin`, with the original name as the row's name and `binned` saying
 * where it came from and when. Complete at once (a `$I` carries the size and
 * the date, so there is no details run); a row's Modified is its deleted time.
 * Files and folders are split by what the `$R` is on disk. Every kind is a
 * row, a kind Prism cannot show included: it can still be restored or deleted.
 */
export async function binListing(
  dirs: readonly string[],
  reader: Pick<ReturnType<typeof createBinReader>, 'read'> = binReader
): Promise<{ listing: DirListing; skipped: number }> {
  const { rows, skipped } = await reader.read(dirs)
  const folders: DirEntry[] = []
  const files: ViewerFile[] = []
  for (const r of rows) {
    const binned = { from: r.from, at: r.deleted }
    if (r.folder) folders.push({ path: r.path, name: r.name, mtimeMs: r.deleted, size: r.size, binned })
    else {
      const ext = extname(r.name).toLowerCase()
      files.push({ path: r.path, name: r.name, ext, kind: r.kind, size: r.size, mtimeMs: r.deleted, binned })
    }
  }
  return { listing: { folders: folders.sort(byName), files: files.sort(byName), bin: true }, skipped }
}

