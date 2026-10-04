import { createHash, randomUUID } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'fs'
import { mkdir, readdir, rename, rm, writeFile } from 'fs/promises'
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
 * WHAT IS STORED is names, sizes and dates of the folders the user OPENED,
 * never a folder only read ahead (those stay in the page's memory; review of
 * #271: a day of hovering would otherwise push out the folders a cold launch
 * needs, and put names in %APPDATA% the user never looked at), so it is
 * local only (recommendation 1): under the per-user profile, never
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
  /** The folders' modified times, in `folders`' order (#285). Optional, so a
   *  cache written before it still reads: its folders are simply undated. */
  folderTimes?: number[]
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
  const kept = listing.folders.slice(0, maxEntries)
  const folders = kept.map((f) => f.name)
  const folderTimes = kept.every((f) => typeof f.mtimeMs === 'number')
    ? kept.map((f) => f.mtimeMs as number)
    : null
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
    ...(folderTimes && folderTimes.length ? { folderTimes } : {}),
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
  // Dates that do not line up with the names are dropped, never guessed.
  const times =
    Array.isArray(s.folderTimes) &&
    s.folderTimes.length === s.folders.length &&
    s.folderTimes.every((t) => typeof t === 'number' && Number.isFinite(t))
      ? s.folderTimes
      : null
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
      folders: s.folders.map((name, i) => {
        const t = times?.[i]
        return t === undefined ? { path: base + name, name } : { path: base + name, name, mtimeMs: t }
      }),
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
  /** Listing writes in flight, which the start-up sweep leaves alone. */
  let pendingWrites = 0
  const writing = new Set<string>()

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
      // Files the index does not name (review of #271): a kill inside the
      // index's 500 ms delay leaves a listing written and never indexed, and
      // a crash mid-write a `.tmp`. Neither would ever be read or evicted, so
      // they would sit outside the 20 MB budget with their file names until a
      // Clear. Swept off the start-up path, after the index is in memory.
      if (!readOnly) void this.sweep()
    },
    /** Delete every file in the folder that the index does not name. */
    async sweep(): Promise<number> {
      let names: string[]
      try {
        names = await readdir(directory)
      } catch {
        return 0
      }
      const mine = epoch
      let removed = 0
      for (const name of names) {
        if (name === 'index.json') continue
        const m = /^([0-9a-f]{40})\.json$/.exec(name)
        if (m && index.has(m[1])) continue
        // A Clear or a put meanwhile owns the folder now.
        if (mine !== epoch) break
        // A put's own temporary is renamed into place by that put.
        if (name.endsWith('.tmp') && pendingWrites > 0) continue
        if (m && writing.has(m[1])) continue
        await rm(join(directory, name), { force: true })
          .then(() => {
            removed += 1
          })
          .catch(() => {})
      }
      return removed
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
    /** The folder is gone or cannot be read: what was kept of it goes too
     *  (review of #271), so its names do not wait for eviction. */
    drop(path: string): void {
      const key = cacheKey(path)
      if (!index.has(key)) return
      forget(key)
      scheduleIndex()
    },
    /** Bumped by every clear: a write that began before one must not land. */
    get generation(): number {
      return epoch
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
    put(path: string, listing: DirListing, folderMtimeMs: number, since?: number): void {
      if (readOnly || !enabled || listing.unreadable || listing.complete === false) return
      // A details run that started before a Clear must not write the folder
      // back a moment after the button says "Cleared" (review of #271).
      if (since !== undefined && since !== epoch) return
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
        pendingWrites += 1
        writing.add(key)
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
            pendingWrites -= 1
            writing.delete(key)
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
    /** Delete every stored listing. Safe at any time. True when nothing is
     *  left on disk; a file Windows holds open (a virus scan, a backup) stays
     *  and goes in the next start's sweep, since no index names it any more. */
    clear(): boolean {
      epoch += 1
      index.clear()
      if (indexTimer) clearTimeout(indexTimer)
      indexTimer = null
      if (readOnly) return true
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
        return true
      } catch {
        // One locked file fails the whole folder: delete the rest one by one.
        let left = 0
        try {
          for (const name of readdirSync(directory))
            try {
              rmSync(join(directory, name), { force: true })
            } catch {
              left += 1
            }
        } catch {
          return false
        }
        return left === 0
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
