import { createHash, randomUUID } from 'crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import type { FolderSizeResult } from '@shared/folderSize'
import { folderSize } from './folderSize'

type IndexedSizes = (
  paths: readonly string[],
  signal?: AbortSignal
) => Promise<Map<string, { bytes: number }> | null>

interface Options {
  directory: string
  indexedSizes?: IndexedSizes
  scan?: typeof folderSize
  now?: () => number
  maxAgeMs?: number
  maxEntries?: number
}

interface RecordEntry {
  version: 1
  path: string
  generation: string
  size: FolderSizeResult
}

interface Calculation {
  controller: AbortController
  consumers: number
  generation: string
  promise: Promise<FolderSizeResult | null>
}

interface InvalidationSnapshot {
  global: string
  globalAt?: number
  markers: { path: string; id: string; at: number }[]
}

function key(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function intersects(target: string, changed: string): boolean {
  return (
    target === changed ||
    target.startsWith(changed.endsWith(sep) ? changed : changed + sep) ||
    changed.startsWith(target.endsWith(sep) ? target : target + sep)
  )
}

function validSize(value: unknown): value is FolderSizeResult {
  if (!value || typeof value !== 'object') return false
  const size = value as FolderSizeResult
  return (
    ['bytes', 'files', 'folders', 'unreadable', 'skippedLinks'].every((field) => {
      const number = size[field as keyof FolderSizeResult]
      return typeof number === 'number' && Number.isFinite(number) && number >= 0
    }) &&
    typeof size.truncated === 'boolean' &&
    typeof size.measuredAt === 'number' &&
    Number.isFinite(size.measuredAt)
  )
}

/** Callers authorize every requested root. This cache never grants access.
 * Per-path atomic files let separate Prism windows share results without
 * replacing one another's cache entries. Cancellation belongs to a consumer. */
export class FolderSizeCache {
  private readonly calculations = new Map<string, Calculation>()
  private readonly prefetches = new Map<string, Promise<void>>()
  private readonly prioritizePrefetch = new Map<string, () => void>()
  private readonly scan: typeof folderSize
  private readonly now: () => number
  private readonly maxAgeMs: number
  private pruning: Promise<void> | null = null
  private writesSincePrune = 0
  private readingInvalidations: Promise<InvalidationSnapshot> | null = null
  private indexedQueries = 0
  private readonly indexedWaiters = new Set<() => void>()

  constructor(private readonly options: Options) {
    this.scan = options.scan ?? folderSize
    this.now = options.now ?? Date.now
    this.maxAgeMs = options.maxAgeMs ?? 60_000
  }

  private filename(path: string): string {
    return join(
      this.options.directory,
      createHash('sha256').update(key(path)).digest('hex') + '.json'
    )
  }

  private invalidations(): Promise<InvalidationSnapshot> {
    if (this.readingInvalidations) return this.readingInvalidations
    const markerDirectory = join(this.options.directory, 'invalidations')
    const read = (async () => {
      const names = await readdir(markerDirectory).catch(() => [])
      const markers = await Promise.all(
        names
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => {
            try {
              const marker = JSON.parse(await readFile(join(markerDirectory, name), 'utf8')) as {
                path: string
                id: string
                at: number
              }
              return typeof marker.path === 'string' &&
                typeof marker.id === 'string' &&
                typeof marker.at === 'number'
                ? marker
                : null
            } catch {
              return null
            }
          })
      )
      const global = await readFile(join(this.options.directory, 'generation'), 'utf8').catch(
        () => ''
      )
      let globalAt: number | undefined
      try {
        const marker = JSON.parse(global) as { at?: number }
        if (typeof marker.at === 'number' && Number.isFinite(marker.at)) globalAt = marker.at
      } catch {
        // Older caches used a plain UUID for the overflow generation.
      }
      return {
        global,
        globalAt,
        markers: markers.filter(
          (marker): marker is { path: string; id: string; at: number } => marker !== null
        )
      }
    })().finally(() => {
      if (this.readingInvalidations === read) this.readingInvalidations = null
    })
    this.readingInvalidations = read
    return read
  }

  private async generation(path: string): Promise<string> {
    const snapshot = await this.invalidations()
    const target = key(path)
    const markers = snapshot.markers
      .filter(({ path: changed }) => intersects(target, changed))
      .map(({ id }) => id)
      .sort()
    return [snapshot.global, ...markers].join(':')
  }

  private async indexIsSettling(path: string): Promise<boolean> {
    const target = key(path)
    const snapshot = await this.invalidations()
    if (snapshot.globalAt !== undefined && this.now() - snapshot.globalAt < 5000) return true
    // Index notifications can lag a successful rename/write. Verify recent
    // edits on disk rather than saving the pre-edit index answer as fresh.
    return snapshot.markers.some(
      (marker) => intersects(target, marker.path) && this.now() - marker.at < 5000
    )
  }

  private async indexedSizes(
    paths: readonly string[],
    signal?: AbortSignal
  ): Promise<Map<string, { bytes: number }> | null> {
    if (!this.options.indexedSizes) return null
    while (this.indexedQueries >= 2 && !signal?.aborted) {
      await new Promise<void>((resolveWait) => {
        const wake = (): void => {
          this.indexedWaiters.delete(wake)
          signal?.removeEventListener('abort', wake)
          resolveWait()
        }
        this.indexedWaiters.add(wake)
        signal?.addEventListener('abort', wake, { once: true })
      })
    }
    if (signal?.aborted) return null
    this.indexedQueries++
    try {
      return await this.options.indexedSizes(paths, signal).catch(() => null)
    } finally {
      this.indexedQueries--
      for (const wake of [...this.indexedWaiters]) wake()
    }
  }

  private async atomicWrite(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, value, 'utf8')
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  private async safeRoot(path: string): Promise<boolean> {
    if (!isAbsolute(path)) return false
    try {
      const info = await lstat(path)
      return info.isDirectory() && !info.isSymbolicLink() && key(await realpath(path)) === key(path)
    } catch {
      return false
    }
  }

  private async read(path: string, generation: string): Promise<FolderSizeResult | null> {
    try {
      const entry = JSON.parse(await readFile(this.filename(path), 'utf8')) as RecordEntry
      if (entry.version !== 1 || entry.path !== key(path) || !validSize(entry.size)) return null
      return {
        ...entry.size,
        stale:
          entry.generation !== generation ||
          this.now() - entry.size.measuredAt! >= this.maxAgeMs ||
          entry.size.measuredAt! > this.now()
      }
    } catch {
      return null
    }
  }

  private async save(path: string, size: FolderSizeResult, generation: string): Promise<void> {
    if ((await this.generation(path)) !== generation) return
    await this.atomicWrite(
      this.filename(path),
      JSON.stringify({ version: 1, path: key(path), generation, size } satisfies RecordEntry)
    ).catch(() => {})
    this.writesSincePrune++
    if (this.writesSincePrune >= Math.min(32, this.options.maxEntries ?? 2048)) {
      await this.prune()
    }
  }

  private async prune(): Promise<void> {
    if (this.pruning) return this.pruning
    this.writesSincePrune = 0
    this.pruning = (async () => {
      const names = await readdir(this.options.directory).catch(() => [])
      const entries = await Promise.all(
        names
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => {
            const path = join(this.options.directory, name)
            return { path, time: (await stat(path).catch(() => null))?.mtimeMs ?? 0 }
          })
      )
      entries.sort((a, b) => b.time - a.time)
      await Promise.all(
        entries
          .slice(this.options.maxEntries ?? 2048)
          .map(({ path }) => rm(path, { force: true }).catch(() => {}))
      )
    })().finally(() => {
      this.pruning = null
    })
    return this.pruning
  }

  /** Invalidate after filesystem mutations, including writes beneath a root.
   * Shared path markers also invalidate ancestors in other Prism processes.
   * Old snapshots remain available while the next request refreshes them. */
  async invalidate(paths: readonly string[]): Promise<void> {
    if (!paths.length) return
    const directory = join(this.options.directory, 'invalidations')
    await Promise.all(
      [...new Set(paths.filter(isAbsolute).map(key))].map((path) =>
        this.atomicWrite(
          join(directory, createHash('sha256').update(path).digest('hex') + '.json'),
          JSON.stringify({ path, id: randomUUID(), at: this.now() })
        )
      )
    )
    this.readingInvalidations = null
    const names = await readdir(directory).catch(() => [])
    if (names.length > 128) {
      // Rare mutation bursts fall back to one global invalidation before
      // dropping old markers, so a bounded journal never revives stale data.
      await this.atomicWrite(
        join(this.options.directory, 'generation'),
        JSON.stringify({ id: randomUUID(), at: this.now() })
      )
      const entries = await Promise.all(
        names
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => {
            const path = join(directory, name)
            return { path, time: (await stat(path).catch(() => null))?.mtimeMs ?? 0 }
          })
      )
      entries.sort((a, b) => b.time - a.time)
      await Promise.all(
        entries.slice(64).map(({ path }) => rm(path, { force: true }).catch(() => {}))
      )
      this.readingInvalidations = null
    }
  }

  async readCached(paths: readonly string[]): Promise<Record<string, FolderSizeResult>> {
    const result: Record<string, FolderSizeResult> = {}
    for (let offset = 0; offset < paths.length; offset += 16) {
      await Promise.all(
        paths.slice(offset, offset + 16).map(async (path) => {
          if (!(await this.safeRoot(path))) return
          const cached = await this.read(path, await this.generation(path))
          if (cached) result[path] = cached
        })
      )
    }
    return result
  }

  private async prefetchChunk(paths: string[], signal?: AbortSignal): Promise<void> {
    const generations = new Map<string, string>()
    const ready: string[] = []
    for (let offset = 0; offset < paths.length; offset += 16) {
      if (signal?.aborted) return
      await Promise.all(
        paths.slice(offset, offset + 16).map(async (path) => {
          generations.set(path, await this.generation(path))
          if (!(await this.indexIsSettling(path))) ready.push(path)
        })
      )
    }
    if (!ready.length) return
    const sizes = await this.indexedSizes(ready, signal)
    if (!sizes || signal?.aborted) return
    const normalizedSizes = new Map([...sizes].map(([path, total]) => [key(path), total]))
    for (let offset = 0; offset < paths.length; offset += 16) {
      await Promise.all(
        paths.slice(offset, offset + 16).map(async (path) => {
          const total = normalizedSizes.get(path)
          if (!total || !Number.isFinite(total.bytes) || total.bytes < 0) return
          if (!(await this.safeRoot(path)) || signal?.aborted) return
          await this.save(path, this.indexedResult(total.bytes), generations.get(path)!)
        })
      )
    }
  }

  /** Each small batch becomes usable independently. Visible-row requests move
   * their queued batch forward, with at most two indexed lookups in flight. */
  prefetchIndexed(paths: readonly string[], signal?: AbortSignal): Promise<void> {
    if (!this.options.indexedSizes || signal?.aborted) return Promise.resolve()
    const unique = [...new Set(paths.filter(isAbsolute).map(key))]
    const missing = unique.filter((path) => !this.prefetches.has(path))
    const queue: { paths: string[]; done: () => void; promise: Promise<void> }[] = []
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batchPaths = missing.slice(offset, offset + 32)
      let done!: () => void
      const promise = new Promise<void>((resolveDone) => {
        done = resolveDone
      })
      const batch = { paths: batchPaths, done, promise }
      queue.push(batch)
      const prioritize = (): void => {
        const index = queue.indexOf(batch)
        if (index > 0) queue.unshift(...queue.splice(index, 1))
      }
      for (const path of batchPaths) {
        this.prefetches.set(path, promise)
        this.prioritizePrefetch.set(path, prioritize)
      }
    }
    const all = unique.map((path) => this.prefetches.get(path)!)
    const work = async (): Promise<void> => {
      let batch: (typeof queue)[number] | undefined
      while ((batch = queue.shift())) {
        try {
          if (!signal?.aborted) await this.prefetchChunk(batch.paths, signal)
        } catch {
          /* Cache warming never prevents the filesystem fallback. */
        } finally {
          for (const path of batch.paths) {
            if (this.prefetches.get(path) === batch.promise) {
              this.prefetches.delete(path)
              this.prioritizePrefetch.delete(path)
            }
          }
          batch.done()
        }
      }
    }
    void work()
    void work()
    return Promise.all(all).then(() => {})
  }

  private indexedResult(bytes: number): FolderSizeResult {
    return {
      bytes,
      files: 0,
      folders: 0,
      unreadable: 0,
      skippedLinks: 0,
      truncated: false,
      source: 'index',
      countsKnown: false,
      measuredAt: this.now(),
      stale: false
    }
  }

  async get(
    path: string,
    signal: AbortSignal,
    onCached?: (size: FolderSizeResult) => void
  ): Promise<FolderSizeResult | null> {
    if (signal.aborted || !(await this.safeRoot(path))) return null
    const generation = await this.generation(path)
    const cached = await this.read(path, generation)
    if (signal.aborted) return null
    if (cached) {
      onCached?.(cached)
      if (!cached.stale) return cached
    }
    const normalized = key(path)
    const prefetch = this.prefetches.get(normalized)
    if (prefetch) {
      this.prioritizePrefetch.get(normalized)?.()
      await prefetch
      if (signal.aborted) return null
      const warmed = await this.read(path, await this.generation(path))
      if (warmed && !warmed.stale) return warmed
    }
    let calculation = this.calculations.get(normalized)
    if (
      !calculation ||
      calculation.controller.signal.aborted ||
      calculation.generation !== generation
    ) {
      const controller = new AbortController()
      const created: Calculation = {
        controller,
        consumers: 0,
        generation,
        promise: Promise.resolve(null)
      }
      created.promise = (async () => {
        const indexed =
          prefetch || (await this.indexIsSettling(path))
            ? null
            : await this.indexedSizes([path], controller.signal)
        const indexedSize =
          indexed && [...indexed].find(([candidate]) => key(candidate) === normalized)?.[1]
        const result =
          indexedSize && Number.isFinite(indexedSize.bytes) && indexedSize.bytes >= 0
            ? this.indexedResult(indexedSize.bytes)
            : await this.scan(path, controller.signal).then((size) =>
                size
                  ? { ...size, source: 'filesystem' as const, measuredAt: this.now(), stale: false }
                  : null
              )
        if (!result || controller.signal.aborted || !(await this.safeRoot(path))) return null
        if ((await this.generation(path)) !== generation) return { ...result, stale: true }
        await this.save(path, result, generation)
        return (await this.generation(path)) === generation ? result : { ...result, stale: true }
      })()
        .catch(() => null)
        .finally(() => {
          if (this.calculations.get(normalized) === created) this.calculations.delete(normalized)
        })
      calculation = created
      this.calculations.set(normalized, created)
    }
    calculation.consumers++
    const shared = calculation
    return new Promise((resolveResult) => {
      let finished = false
      const finish = (result: FolderSizeResult | null): void => {
        if (finished) return
        finished = true
        signal.removeEventListener('abort', abort)
        shared.consumers--
        if (shared.consumers === 0) shared.controller.abort()
        resolveResult(result)
      }
      const abort = (): void => finish(null)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else
        void shared.promise.then((result) =>
          finish(result ?? (cached ? { ...cached, stale: true } : null))
        )
    })
  }
}
