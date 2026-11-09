/**
 * thumbs:want, thumbs:ready and thumbs:cancel without Electron (Stage 2 of
 * the zoom grid, 2026-11-09). ipc/thumbs.ts is the thin glue to `ipcMain`;
 * what must be right lives here so a test can hold it:
 *
 * - THE WALL. A path is thumbnailed only if it passes `readable` (the root
 *   wall) AND `owns(tab, path)` (a direct entry of a folder THIS tab visited,
 *   the guard the file operations use). Anything else is ignored silently, so
 *   a compromised renderer cannot make main read, or thumbnail, a file the
 *   Explorer did not list for it.
 * - Only photos and films get a picture (`thumbKindOf`). SVG is drawn by the
 *   page from the file itself; PDF, audio, archives, text keep their icon.
 * - Cache hits and remembered failures are answered at once (`ready`), with at
 *   most 8 probes in flight; the rest are queued (thumbQueue.ts).
 * - What main makes goes back as `fsmedia://thumb/<key>` URLs, batched every
 *   50 ms per window and generation. The page never gets a path.
 * - A newer ask from a tab that lands while an older one is still probing
 *   queues only the newer.
 */
import { extOf } from '@shared/path'
import { fileKind } from '@shared/fileKind'
import type { ThumbKind, ThumbLookup } from './thumbs'
import type { ThumbTier, ThumbsReady, ThumbsWantReply } from '@shared/thumbTypes'
import { ThumbQueue, desktopShare } from './thumbQueue'

/** The most files one ask may name: about two screens of tiles. */
export const WANT_MAX = 400
/** Cache probes (a stat of the source and of the cache file) in flight at once. */
const PROBES_AT_ONCE = 8
const BATCH_MS = 50

export interface ThumbsLike {
  lookup(file: string, kind: ThumbKind, tier: ThumbTier): Promise<ThumbLookup>
  makeFor(file: string, kind: ThumbKind, tier: ThumbTier, signal?: AbortSignal): Promise<string | null>
}

/** A window the answers go back to. */
export interface Sink {
  id: number
  alive(): boolean
  send(msg: ThumbsReady): void
}

export interface EndpointDeps {
  thumbs: ThumbsLike
  readable: (path: string) => boolean
  owns: (tab: string, path: string) => boolean
  /** Logical cores; a machine of 4 or fewer gives the desktop one ffmpeg. */
  cores: () => number
  /** Resolve these paths off main's thread before the sync guards read them
   *  (dirList.ts `warmCanonical`). */
  warm?: (paths: string[]) => Promise<void>
}

const dirnameOf = (p: string): string => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'), 0))

/** What gets a picture: a photo or a film, never an SVG (the page draws it). */
export function thumbKindOf(path: string): ThumbKind | null {
  const ext = extOf(path)
  if (ext === '.svg' || ext === '.svgz') return null
  const kind = fileKind(ext)
  return kind === 'image' || kind === 'video' ? kind : null
}

const nameOf = (file: string): string => file.slice(Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')) + 1)
const urlOf = (file: string): string => `fsmedia://thumb/${nameOf(file)}`

/** `fn` over `items`, at most `limit` at once, results in order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return out
}

interface Ask {
  path: string
  tier: ThumbTier
  kind: ThumbKind
}

function parse(tab: unknown, gen: unknown, items: unknown): { tab: string; gen: number; asks: Ask[] } | null {
  if (typeof tab !== 'string' || !tab || tab.length > 200) return null
  if (typeof gen !== 'number' || !Number.isFinite(gen)) return null
  if (!Array.isArray(items)) return null
  const asks: Ask[] = []
  for (const it of items.slice(0, WANT_MAX * 2) as unknown[]) {
    if (!it || typeof it !== 'object') continue
    const { path, tier } = it as { path?: unknown; tier?: unknown }
    if (typeof path !== 'string' || !path || path.length > 4096) continue
    if (tier !== 320 && tier !== 640) continue
    const kind = thumbKindOf(path)
    if (kind) asks.push({ path, tier, kind })
    if (asks.length >= WANT_MAX) break
  }
  return { tab, gen, asks }
}

export function createThumbsEndpoint(deps: EndpointDeps) {
  const films = new Set<number>()
  const latest = new Map<string, number>()
  const sinks = new Map<string, Sink>()
  /** Waiting to go out: sink id -> gen -> results. */
  const batch = new Map<number, { sink: Sink; gens: Map<number, ThumbsReady['results']> }>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    for (const { sink, gens } of batch.values()) {
      if (!sink.alive()) continue
      for (const [gen, results] of gens) sink.send({ gen, results })
    }
    batch.clear()
  }

  const queue = new ThumbQueue({
    make: (path, tier, signal) => {
      const kind = thumbKindOf(path)
      return kind ? deps.thumbs.makeFor(path, kind, tier, signal) : Promise.resolve(null)
    },
    share: () => desktopShare({ cores: deps.cores(), filmPlaying: films.size > 0 }),
    settled: (tab, gen, path, _tier, file) => {
      const sink = sinks.get(tab)
      if (!sink || !sink.alive()) return
      let entry = batch.get(sink.id)
      if (!entry) batch.set(sink.id, (entry = { sink, gens: new Map() }))
      const results = entry.gens.get(gen) ?? []
      results.push({ path, url: file ? urlOf(file) : null })
      entry.gens.set(gen, results)
      timer ??= setTimeout(flush, BATCH_MS)
    }
  })

  return {
    /** The page asks for these tiles. Returns the hits at once; the rest come by `thumbs:ready`. */
    async want(sink: Sink, tab: unknown, gen: unknown, items: unknown): Promise<ThumbsWantReply> {
      const ask = parse(tab, gen, items)
      if (!ask) return { ready: {} }
      if (ask.gen < (latest.get(ask.tab) ?? -Infinity)) return { ready: {} }
      latest.set(ask.tab, ask.gen)
      sinks.set(ask.tab, sink)
      // The wall: silently drop what this tab was not shown. The paths are
      // resolved off main's thread first (as the media protocol does), so the
      // guards below answer from the memo and touch no disk on main.
      await deps.warm?.(ask.asks.flatMap((a) => [a.path, dirnameOf(a.path)]))
      const allowed = ask.asks.filter((a) => deps.readable(a.path) && deps.owns(ask.tab, a.path))
      const ready: Record<string, string | null> = {}
      const misses: Ask[] = []
      const found = await mapLimit(allowed, PROBES_AT_ONCE, (a) => deps.thumbs.lookup(a.path, a.kind, a.tier))
      allowed.forEach((a, i) => {
        const hit = found[i]
        if (!hit) misses.push(a)
        else ready[a.path] = 'file' in hit ? urlOf(hit.file) : null
      })
      // A newer ask landed while these were probing: only the newer is queued.
      if (latest.get(ask.tab) === ask.gen) queue.want(ask.tab, ask.gen, misses)
      return { ready }
    },

    /** The tab closed, changed folder, was held or left the front. */
    cancel(tab: unknown): void {
      if (typeof tab !== 'string') return
      latest.delete(tab)
      sinks.delete(tab)
      queue.cancel(tab)
    },

    /** A window's film started or stopped playing: the desktop's share drops to 1 while any plays. */
    film(senderId: number, playing: boolean): void {
      if (playing) films.add(senderId)
      else films.delete(senderId)
      queue.poke()
    },

    /** A window went away. */
    forgetSender(senderId: number): void {
      films.delete(senderId)
      queue.poke()
    },

    stats: () => queue.stats()
  }
}

export type ThumbsEndpoint = ReturnType<typeof createThumbsEndpoint>
