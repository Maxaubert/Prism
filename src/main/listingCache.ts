import { createHash, randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { fileKind } from '@shared/fileKind'
import type { DirListing, ViewerFile } from '@shared/types'

/**
 * THE LISTING CACHE ON DISK (#271; owner, 2026-10-04: no loading screen "not
 * even if you launch it from a restart of the PC"). After a reboot nothing is
 * in memory and the disk is cold, so the only way the Explorer's first frame
 * has rows is to have written them down last time. One small file per folder
 * (`<sha1 of the lower-cased path>.json`) plus `index.json`, which is all that
 * is held in memory.
 *
 * Owner-approved budget (recommendation 2, 2026-10-04): 200 folders, 2000
 * entries each (a bigger folder keeps its first 2000 names in sorted order and
 * is marked partial), 20 MB in all, evicted least recently used with the hit
 * count as weight. Quick access places are pinned. A cached list may be stale
 * for a moment (recommendation 3): every paint from it is followed by a real
 * read, which corrects it in place.
 *
 * WHAT IS STORED is names, sizes and dates of the folders the user opened, so
 * it is local only (recommendation 1): under the per-user profile, never
 * synced or sent, never for a network or removable drive (the caller's
 * `allowed`), behind Settings > General > Remember folders (on by default,
 * off deletes the folder) and a Clear button. The README says so, where
 * Prism's other privacy statements are.
 *
 * Compact on purpose: entries are stored as names, and paths, extensions and
 * kinds are rebuilt on the way out. MEASURED: about 40 bytes an entry, against
 * about 150 for the listing as the renderer holds it.
 */

export const CACHE_LIMITS = { folders: 200, entries: 2000, bytes: 20 * 1024 * 1024 }

export interface IndexEntry {
  path: string
  key: string
  folderMtimeMs: number
  savedAt: number
  usedAt: number
  hits: number
  bytes: number
  pinned?: boolean
}

export interface CachedListing {
  path: string
  folderMtimeMs: number
  savedAt: number
  partial: boolean
  listing: DirListing
}

interface Stored {
  v: 1
  path: string
  folderMtimeMs: number
  savedAt: number
  partial?: true
  hidden?: number
  folders: string[]
  /** [name, size, mtimeMs] */
  files: Array<[string, number, number]>
}

/** The cache's name for a folder: Windows paths compare without case. */
export const cacheKey = (path: string): string =>
  createHash('sha1')
    .update(path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase())
    .digest('hex')

/** Pure: a complete listing in its stored form, trimmed to `maxEntries`
 *  (folders first, then files, each in the order given: sorted by name). */
export function encodeListing(
  path: string,
  listing: DirListing,
  folderMtimeMs: number,
  savedAt: number,
  maxEntries = CACHE_LIMITS.entries
): Stored {
  const folders = listing.folders.slice(0, maxEntries).map((f) => f.name)
  const room = Math.max(0, maxEntries - folders.length)
  const files = listing.files
    .slice(0, room)
    .map((f): [string, number, number] => [f.name, f.size ?? 0, f.mtimeMs ?? 0])
  const partial = listing.folders.length + listing.files.length > maxEntries
  return {
    v: 1,
    path,
    folderMtimeMs,
    savedAt,
    ...(partial ? { partial: true as const } : {}),
    ...(listing.hidden ? { hidden: listing.hidden } : {}),
    folders,
    files
  }
}

const sep = (path: string): string => (path.endsWith('\\') || path.endsWith('/') ? '' : '\\')

/** Pure: a stored form back into a listing, or null for anything malformed. A
 *  corrupt or foreign file is ignored, never trusted. */
export function decodeListing(text: string, expectPath?: string): CachedListing | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const s = raw as Partial<Stored>
  if (
    !s ||
    s.v !== 1 ||
    typeof s.path !== 'string' ||
    typeof s.folderMtimeMs !== 'number' ||
    typeof s.savedAt !== 'number' ||
    !Array.isArray(s.folders) ||
    !Array.isArray(s.files) ||
    !s.folders.every((n) => typeof n === 'string' && n && !/[\\/]/.test(n)) ||
    !s.files.every(
      (f) =>
        Array.isArray(f) &&
        typeof f[0] === 'string' &&
        f[0] &&
        !/[\\/]/.test(f[0]) &&
        typeof f[1] === 'number' &&
        typeof f[2] === 'number'
    )
  )
    return null
  if (expectPath !== undefined && cacheKey(expectPath) !== cacheKey(s.path)) return null
  const base = s.path + sep(s.path)
  const files: ViewerFile[] = s.files.map(([name, size, mtimeMs]) => {
    const ext = extname(name).toLowerCase()
    return { path: base + name, name, ext, kind: fileKind(ext, name), size, mtimeMs }
  })
  return {
    path: s.path,
    folderMtimeMs: s.folderMtimeMs,
    savedAt: s.savedAt,
    partial: !!s.partial,
    listing: {
      folders: s.folders.map((name) => ({ path: base + name, name })),
      files,
      ...(typeof s.hidden === 'number' && s.hidden > 0 ? { hidden: s.hidden } : {})
    }
  }
}

/** How much an entry is worth keeping: when it was last used, plus an hour per
 *  hit up to a day, so a folder opened every day outlives one opened once. */
const worth = (e: IndexEntry): number => e.usedAt + Math.min(e.hits, 24) * 3_600_000

/** Pure: the keys to drop so the index fits the budget. Pinned entries go
 *  last, and only if they alone are over it. */
export function evictionOrder(
  entries: readonly IndexEntry[],
  maxFolders = CACHE_LIMITS.folders,
  maxBytes = CACHE_LIMITS.bytes
): string[] {
  const ranked = [...entries].sort(
    (a, b) => Number(!!a.pinned) - Number(!!b.pinned) || worth(a) - worth(b)
  )
  let count = entries.length
  let bytes = entries.reduce((sum, e) => sum + e.bytes, 0)
  const drop: string[] = []
  for (const e of ranked) {
    if (count <= maxFolders && bytes <= maxBytes) break
    drop.push(e.key)
    count -= 1
    bytes -= e.bytes
  }
  return drop
}

function validEntry(e: unknown): e is IndexEntry {
  const x = e as IndexEntry
  return (
    !!x &&
    typeof x.path === 'string' &&
    typeof x.key === 'string' &&
    /^[0-9a-f]{40}$/.test(x.key) &&
    typeof x.folderMtimeMs === 'number' &&
    typeof x.savedAt === 'number' &&
    typeof x.usedAt === 'number' &&
    typeof x.hits === 'number' &&
    typeof x.bytes === 'number'
  )
}

export interface ListingCacheOptions {
  directory: string
  /** May this folder be stored at all: local fixed drives only. */
  allowed?: (path: string) => boolean
  /** A second Explorer window reads, and only the main window's process
   *  writes, so two processes never race over one index. */
  readOnly?: boolean
  maxFolders?: number
  maxEntries?: number
  maxBytes?: number
  now?: () => number
  indexDelayMs?: number
}

export function createListingCache(options: ListingCacheOptions) {
  const {
    directory,
    allowed = () => true,
    readOnly = false,
    maxFolders = CACHE_LIMITS.folders,
    maxEntries = CACHE_LIMITS.entries,
    maxBytes = CACHE_LIMITS.bytes,
    now = Date.now,
    indexDelayMs = 500
  } = options
  const indexPath = join(directory, 'index.json')
  const index = new Map<string, IndexEntry>()
  const pinnedKeys = new Set<string>()
  let enabled = true
  let indexTimer: NodeJS.Timeout | null = null
  /** Bumped by clear(): a write that started before it must not resurrect. */
  let epoch = 0

  const fileOf = (key: string): string => join(directory, `${key}.json`)

  const writeIndexSync = (): void => {
    if (readOnly || !enabled) return
    try {
      mkdirSync(directory, { recursive: true })
      const tmp = `${indexPath}.${randomUUID()}.tmp`
      writeFileSync(tmp, JSON.stringify({ v: 1, entries: [...index.values()] }), 'utf8')
      renameSync(tmp, indexPath)
    } catch {
      /* a cache that cannot be written is a cache that is not there */
    }
  }
  const scheduleIndex = (): void => {
    if (readOnly || indexTimer) return
    indexTimer = setTimeout(() => {
      indexTimer = null
      writeIndexSync()
    }, indexDelayMs)
    indexTimer.unref?.()
  }
  const forget = (key: string): void => {
    index.delete(key)
    if (!readOnly) rm(fileOf(key), { force: true }).catch(() => {})
  }

  return {
    /** Read the index (synchronous, a few KB): the start-up path needs it
     *  before the window's first restore. A missing or corrupt index is an
     *  empty cache. */
    load(): void {
      index.clear()
      try {
        const raw = JSON.parse(readFileSync(indexPath, 'utf8')) as { v?: number; entries?: unknown[] }
        if (raw?.v === 1 && Array.isArray(raw.entries))
          for (const e of raw.entries) if (validEntry(e)) index.set(e.key, e)
      } catch {
        /* first run, or a damaged file: start empty */
      }
    },
    setEnabled(on: boolean): void {
      if (enabled === on) return
      enabled = on
      if (!on) this.clear()
    },
    get enabled(): boolean {
      return enabled
    },
    has(path: string): boolean {
      return enabled && index.has(cacheKey(path))
    },
    /** One folder's stored listing, synchronously (a file of tens of KB). */
    read(path: string): CachedListing | null {
      if (!enabled) return null
      const key = cacheKey(path)
      const entry = index.get(key)
      if (!entry) return null
      let text: string
      try {
        text = readFileSync(fileOf(key), 'utf8')
      } catch {
        forget(key)
        scheduleIndex()
        return null
      }
      const cached = decodeListing(text, path)
      if (!cached) {
        forget(key)
        scheduleIndex()
        return null
      }
      entry.hits += 1
      entry.usedAt = now()
      scheduleIndex()
      return cached
    },
    /** Keep a COMPLETE listing (sizes and dates known). Written atomically, a
     *  temporary file renamed over the old one, so a crash mid-write leaves
     *  the previous copy or none, never half of one. */
    put(path: string, listing: DirListing, folderMtimeMs: number): void {
      if (readOnly || !enabled || listing.unreadable || listing.complete === false) return
      if (!allowed(path)) return
      const key = cacheKey(path)
      const savedAt = now()
      const text = JSON.stringify(encodeListing(path, listing, folderMtimeMs, savedAt, maxEntries))
      const old = index.get(key)
      index.set(key, {
        path,
        key,
        folderMtimeMs,
        savedAt,
        usedAt: savedAt,
        hits: (old?.hits ?? 0) + 1,
        bytes: Buffer.byteLength(text),
        ...(old?.pinned || pinnedKeys.has(key) ? { pinned: true } : {})
      })
      for (const drop of evictionOrder([...index.values()], maxFolders, maxBytes)) forget(drop)
      if (index.has(key)) {
        const mine = epoch
        const target = fileOf(key)
        const tmp = `${target}.${randomUUID()}.tmp`
        void (async () => {
          try {
            await mkdir(directory, { recursive: true })
            if (mine !== epoch) return
            await writeFile(tmp, text, 'utf8')
            if (mine !== epoch || !index.has(key)) return
            await rename(tmp, target)
          } catch {
            index.delete(key)
          } finally {
            await rm(tmp, { force: true }).catch(() => {})
          }
        })()
      }
      scheduleIndex()
    },
    /** Quick access and the common places: never the first to go. */
    pin(paths: readonly string[]): void {
      for (const path of paths) {
        const key = cacheKey(path)
        pinnedKeys.add(key)
        const entry = index.get(key)
        if (entry) entry.pinned = true
      }
      scheduleIndex()
    },
    /** Delete every stored listing. Safe at any time. */
    clear(): void {
      epoch += 1
      index.clear()
      if (indexTimer) clearTimeout(indexTimer)
      indexTimer = null
      if (readOnly) return
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch {
        /* a locked file goes at the next clear */
      }
    },
    /** Write the index now (quit). */
    flush(): void {
      if (indexTimer) clearTimeout(indexTimer)
      indexTimer = null
      writeIndexSync()
    },
    /** For tests and the e2e: what is held. */
    entries(): IndexEntry[] {
      return [...index.values()]
    }
  }
}

export type ListingCache = ReturnType<typeof createListingCache>
