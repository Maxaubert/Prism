/**
 * Thumbnails: the phone's grid (2026-09-13, #135) and, since the zoom grid
 * (2026-11-09), the Explorer's tiles.
 *
 * A grid of names is a list that saves scrolling; a grid of PICTURES is what
 * a phone's photo app is, and the owner asked for the second. The bundled
 * ffmpeg renders a 320px JPEG per file - the photo itself (HEIC, RAW and the
 * ffmpeg-decoded formats included, since that is the decoder they go through
 * anyway), a frame a few seconds into a video - cached under userData by
 * path, size and modified time, evicted oldest-first past a ceiling.
 *
 * Bounded on purpose: at most FOUR ffmpegs at a time, because a folder of
 * three hundred photos would otherwise start three hundred processes into
 * the same pool a playing film reads through (the performance rules). Asks
 * for one key in flight share one process. A thumbnail ffmpeg lives well
 * under a second, so a move racing one is inside the renderer's own retry
 * window; `register` is where the holders of #133 hook in once they land.
 * Pure parts - the argv, the key - are exported and tested; the class owns
 * the processes.
 *
 * A picture that can be clear (a PNG, a GIF, a WebP...) is a WebP WITH its
 * alpha instead (#477, owner 2026-11-01: a checkerboard behind the clear
 * parts, drawn by the tile). Its key ends `.webp`, so the black JPEGs cached
 * before are never served again; photos keep the keys they had.
 *
 * THE DESKTOP'S PART (Stage 2 of the zoom grid) is `lookup` and `makeFor`,
 * called by thumbQueue.ts. The phone's `get` keeps its argv, its keys and its
 * behaviour to the byte (no timeout, no remembered failures, the frame the
 * film has at 3 s). What the desktop adds, each measured in docs/features.md:
 * a second size (640), a keyframe seek and two decode threads for a film, a
 * second tone-mapped pass for an HDR film, a 15 s timeout, failures
 * remembered in memory, the HEIC and camera-raw routes, and a cancel.
 */
import { execFile } from './spawnWorker'
import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { extname, join } from 'path'
import { thumbKeepsAlpha } from '@shared/thumbAlpha'
import { fileKind } from '@shared/fileKind'
import type { ThumbTier } from '@shared/thumbTypes'
import { createLru } from './lru'
import { isHdr } from './phone/decide'
import { isRaw } from './rawPreview'

export type { ThumbTier } from '@shared/thumbTypes'

export const THUMB_WIDTH = 320
/** The tallest picture a WebP can hold (a JPEG holds 65535). */
export const WEBP_MAX_PX = 16383
/** A frame this far into a video: past the black leader most films open on. */
export const VIDEO_SEEK_S = 3
/** 640px frames are about four times a 320 one, so the cache grew with them
 *  (200 MB would hold a few thousand tiles). Not configurable. */
export const CACHE_MAX_BYTES = 500 * 1024 * 1024
/** An eviction trims to this, so the next one is a long way off. */
export const CACHE_TRIM_BYTES = 450 * 1024 * 1024
/** A desktop ffmpeg that has not finished by now is a hung file (a network
 *  share gone quiet) and is killed, so it cannot hold one of the four slots. */
export const THUMB_TIMEOUT_MS = 15000
/** A hit is touched so eviction keeps what is used, but not more than once a
 *  day, so a screenful of hits is not 200 `utimes` calls. */
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000
/** A broken file is remembered this many keys deep, in memory only. */
const FAILED_KEYS = 5000
/** A `.part` older than this belongs to a run that died. */
const PART_STALE_MS = 60_000
/** Stats an eviction scan has in flight at once. */
const SCAN_AT_ONCE = 16
const AT_ONCE = 4

export type ThumbKind = 'image' | 'video'

// The page picks its tier with the same rule, so it lives in the shared types.
export { tierFor } from '@shared/thumbTypes'

/** `<sha1 of path|size|mtime>.jpg`: a file changed on disk is a new key.
 *  `.webp` for a picture that can be clear (#477). The 640 tier adds `|640`
 *  to what is hashed; a 320 key is the one it always was. What the desktop
 *  makes differently from the phone adds `|k`, so neither ever serves the
 *  other's picture: a film's frame (a keyframe seek, so not always the frame
 *  the phone shows), and a HEIC or a camera raw (the desktop's come through
 *  the viewer's decoders, the phone's straight through ffmpeg; review of the
 *  zoom grid, 2026-11-10: the phone's thumbnails stay as they were). */
export function thumbKey(path: string, size: number, mtimeMs: number, tier: ThumbTier = 320, desktop = false): string {
  const film = desktop && (fileKind(extname(path)) === 'video' || isHeifName(path) || isRaw(path))
  const hash = createHash('sha1')
    .update(`${path.toLowerCase()}|${size}|${Math.floor(mtimeMs)}${tier === 640 ? '|640' : ''}${film ? '|k' : ''}`)
    .digest('hex')
  return hash + (thumbKeepsAlpha(path) ? '.webp' : '.jpg')
}

/** A whole thumbnail in the cache folder, either kind; `.part` is not. */
export function isThumbFile(name: string): boolean {
  return name.endsWith('.jpg') || name.endsWith('.webp')
}

/** The CPU tone-map the phone's HLS uses (phone/hls.ts), for an HDR frame. */
const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

export interface ThumbHow {
  /** Made for the desktop: a film seeks to the nearest keyframe on two
   *  decode threads, and ffmpeg's own report of its input is kept. */
  desktop?: boolean
  /** Tone-map first (an HDR film), after scaling so the float work is on a small frame. */
  tonemap?: boolean
  /** Read this file instead of `file` (a decoded copy of a HEIC or a raw's
   *  preview); `file` still decides the output format. */
  source?: string
}

const isHeifName = (p: string): boolean => /\.(heic|heif)$/i.test(p)

/** ffmpeg argv for one `width`px JPEG of `file` at `out`. A video seeks first;
 *  `seek` 0 is the very first frame, the fallback for a clip shorter than
 *  the seek. `-frames:v 1` and a plain JPEG at quality 5 keep it small.
 *  A picture that can be clear is a lossy WebP that keeps its alpha (#477):
 *  libwebp takes the decoder's RGBA as it is, measured 2026-11-01 (a clear
 *  corner stays alpha 0, where the JPEG made it black). WebP is chosen from
 *  the extension alone, as `thumbKey` does, so a `.webp` key never holds a
 *  JPEG. A WebP is at most 16383px tall, and at 320px wide a strip over ~51
 *  times taller than wide passes that (a 40x4000 PNG is 320x32000, measured:
 *  libwebp refused it), so its top 16383px are kept.
 *
 *  The desktop's film: `-noaccurate_seek` takes the keyframe at or before the
 *  seek point and decodes that one frame, where an accurate seek decodes every
 *  frame from the keyframe up to second 3 (dozens, on a 4K HEVC iPhone film);
 *  `-threads 2` keeps one 4K frame from taking the machine. The log is `info`
 *  for a film and a HEIC, because the input stream line is how an HDR film and
 *  a tiled HEIC are told, with no ffprobe process. */
export function thumbArgs(
  file: string,
  kind: ThumbKind,
  out: string,
  seek = VIDEO_SEEK_S,
  width = THUMB_WIDTH,
  how: ThumbHow = {}
): string[] {
  const alpha = thumbKeepsAlpha(file)
  const fast = !!how.desktop && kind === 'video'
  const info = fast || (!!how.desktop && isHeifName(file))
  const scale = alpha ? `scale=${width}:-2,crop=iw:'min(ih,${WEBP_MAX_PX})':0:0` : `scale=${width}:-2`
  return [
    '-hide_banner',
    '-loglevel',
    info ? 'info' : 'error',
    ...(info ? ['-nostats'] : []),
    '-nostdin',
    '-y',
    ...(kind === 'video' && seek > 0 ? ['-ss', String(seek), ...(fast ? ['-noaccurate_seek'] : [])] : []),
    ...(fast ? ['-threads', '2'] : []),
    '-i',
    how.source ?? file,
    '-frames:v',
    '1',
    '-vf',
    how.tonemap ? `${scale},${TONEMAP}` : scale,
    ...(alpha ? ['-c:v', 'libwebp', '-quality', '80'] : ['-q:v', '5']),
    // The muxer is NAMED, not read off the extension: the file is written
    // as `<key>.jpg.part` and renamed into place when whole, and ffmpeg
    // given a `.part` alone refuses for want of a format (measured: every
    // tile blank, the route 404 on a png it can decode).
    '-f',
    alpha ? 'webp' : 'image2',
    out
  ]
}

/** What ffmpeg printed about its INPUT: everything before its `Output #`
 *  block, which repeats the colour tags of the picture it writes. */
function inputReport(stderr: string): string {
  return stderr.split(/^Output #/m)[0] ?? ''
}

/** Is the input film HDR (HLG or PQ)? Read off the input stream line
 *  ("yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)"), so a probe is no extra process. */
export function inputIsHdr(stderr: string): boolean {
  for (const line of inputReport(stderr).split('\n')) {
    if (!/Stream #\d+:\d+.*: Video:/.test(line)) continue
    if (line.split(/[\s,/()[\]]+/).some(isHdr)) return true
  }
  return false
}

/** Would ffmpeg's picture of this HEIC be one TILE and not the photo? An
 *  iPhone stores a photo as a grid of 512px tiles; a build that does not join
 *  the grid shows the first tile (a square, 512 or so), and one that joins it
 *  says "Stream group ... Tile Grid". Either way the decoder is used instead.
 *  A plain square HEIC of exactly those sizes takes the slower route, which is
 *  still right. NOT measured on a real iPhone file (none was available); see
 *  docs/features.md. */
export function inputNeedsHeifDecoder(stderr: string): boolean {
  const head = inputReport(stderr)
  if (/Stream group #|Tile Grid/i.test(head)) return true
  const video = head.split('\n').find((l) => /Stream #\d+:\d+.*: Video:/.test(l))
  const dims = video ? /(\d{2,5})x(\d{2,5})/.exec(video.replace(/0x[0-9a-f]+/gi, '')) : null
  if (!dims) return false
  const [w, h] = [Number(dims[1]), Number(dims[2])]
  return w === h && (w === 256 || w === 512 || w === 1024)
}

/** Oldest first past the ceiling. Pure over the listing it is given. */
export function toEvict(
  entries: ReadonlyArray<{ name: string; size: number; mtimeMs: number }>,
  maxBytes: number
): string[] {
  let total = entries.reduce((n, e) => n + e.size, 0)
  if (total <= maxBytes) return []
  const out: string[] = []
  for (const e of [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break
    out.push(e.name)
    total -= e.size
  }
  return out
}

/**
 * The cache's size, kept in memory (2026-10-16). Every new thumbnail used to
 * readdir the cache and stat every JPEG in it (thousands in a warm 200 MB
 * cache), all at once and up to four scans overlapping, which flooded the
 * libuv pool a playing film reads through while a phone browsed a new folder.
 * Now a scan runs once to learn the total, then only when the running total
 * passes the ceiling, and never two at a time. A thumbnail landing mid-scan
 * may be missed by that scan's count; the next scan puts it right.
 */
export class CacheBudget {
  private total: number | null = null
  private scanning = false

  constructor(private readonly max: number) {}

  /** A new entry of `bytes`: true when a scan should start now. */
  add(bytes: number): boolean {
    if (this.total !== null) this.total += bytes
    if (this.scanning || (this.total !== null && this.total <= this.max)) return false
    this.scanning = true
    return true
  }

  /** A scan finished, with what the cache holds now (null: unknown). */
  settled(total: number | null): void {
    this.scanning = false
    this.total = total
  }
}

/** What the decoders main already has can hand Thumbs (heicClient.ts, rawPreview.ts). */
export interface ThumbsDeps {
  /** A HEIC as a whole-photo JPEG (the worker that joins an iPhone's tiles). */
  heic?: (file: string, mtimeMs: number) => Promise<Buffer>
  /** A camera raw's embedded JPEG; rejects when there is none. */
  raw?: (file: string, mtimeMs: number) => Promise<Buffer>
  /** For the e2e and tests: the desktop timeout. */
  timeoutMs?: number
}

export type ThumbLookup = { file: string } | { failed: true } | null

interface Job {
  desktop: boolean
  tier: ThumbTier
  mtimeMs: number
  signal?: AbortSignal
  /** The holders killed its ffmpeg for a move or a delete: that says nothing
   *  about the file, so the failure is not remembered. */
  released?: boolean
}

interface Ran {
  ok: boolean
  stderr: string
}

export class Thumbs {
  private readonly budget = new CacheBudget(CACHE_MAX_BYTES)
  private readonly inFlight = new Map<string, Promise<string | null>>()
  /** Jobs in flight that a tab can cancel: a phone sharing one that was
   *  cancelled under it makes its own (it never asked for a cancel). */
  private readonly cancellable = new WeakSet<Promise<string | null>>()
  /** Keys the desktop could not make (corrupt, unsupported, timed out), for
   *  this run only. A changed file is a new key, so it is tried again. */
  private readonly failed = createLru<string, true>(FAILED_KEYS)
  private running = 0
  private readonly queue: Array<() => void> = []
  private runs = 0
  private procs = 0
  private peak = 0
  /** Cache-folder scans (evict) started: the e2e proves it is not one per tile. */
  private scans = 0

  constructor(
    private readonly ffmpeg: string,
    private readonly dir: string,
    /** Told of every ffmpeg and the file it reads, for whoever tracks them. */
    private readonly register: (child: { kill(): unknown; once(event: 'close', fn: () => void): unknown }, file: string) => void = () => undefined,
    private readonly deps: ThumbsDeps = {}
  ) {}

  /** For the e2e: ffmpeg processes started, at once now, and the most at once. */
  stats(): { runs: number; running: number; peak: number; scans: number } {
    return { runs: this.runs, running: this.procs, peak: this.peak, scans: this.scans }
  }

  /** The thumbnail's path (a JPEG, or a WebP for a picture that can be
   *  clear), or null when the file cannot be thumbnailed. The phone's way. */
  async get(file: string, kind: ThumbKind): Promise<string | null> {
    return this.fetch(file, kind, 320, false)
  }

  /** The desktop's way: the asked tier, a cancel, failures remembered. */
  async makeFor(file: string, kind: ThumbKind, tier: ThumbTier, signal?: AbortSignal): Promise<string | null> {
    return this.fetch(file, kind, tier, true, signal)
  }

  /** What is already known about a tile, with no ffmpeg: its cached file,
   *  `{ failed }` for a file that failed before, or null (make it). */
  async lookup(file: string, _kind: ThumbKind, tier: ThumbTier): Promise<ThumbLookup> {
    let st: { size: number; mtimeMs: number }
    try {
      st = await fsp.stat(file)
    } catch {
      return null
    }
    const out = join(this.dir, thumbKey(file, st.size, st.mtimeMs, tier, true))
    if (await this.hit(out)) return { file: out }
    return this.failed.peek(out) ? { failed: true } : null
  }

  /** A file in the cache, touched when it has not been for a day. */
  private async hit(out: string): Promise<boolean> {
    let st: { mtimeMs: number }
    try {
      st = await fsp.stat(out)
    } catch {
      return false
    }
    // A hit is touched, so eviction takes cold entries and not this one.
    if (Date.now() - st.mtimeMs > TOUCH_AFTER_MS) {
      const now = new Date()
      await fsp.utimes(out, now, now).catch(() => undefined)
    }
    return true
  }

  private async fetch(file: string, kind: ThumbKind, tier: ThumbTier, desktop: boolean, signal?: AbortSignal): Promise<string | null> {
    let st: { size: number; mtimeMs: number }
    try {
      st = await fsp.stat(file)
    } catch {
      return null
    }
    const out = join(this.dir, thumbKey(file, st.size, st.mtimeMs, tier, desktop))
    if (await this.hit(out)) return out
    if (desktop && this.failed.get(out)) return null
    const held = this.inFlight.get(out)
    if (held) {
      if (desktop || !this.cancellable.has(held)) return held
      const shared = await held
      return shared ?? this.fetch(file, kind, tier, desktop, signal)
    }
    const how: Job = { desktop, tier, mtimeMs: st.mtimeMs, signal }
    const job = this.make(file, kind, out, how)
      .then((made) => {
        // A cancelled run, or one the holders killed, says nothing about the
        // file; a failed one is remembered.
        if (!made && desktop && !signal?.aborted && !how.released) this.failed.set(out, true)
        return made
      })
      .finally(() => this.inFlight.delete(out))
    this.inFlight.set(out, job)
    if (signal) this.cancellable.add(job)
    return job
  }

  private async make(file: string, kind: ThumbKind, out: string, job: Job): Promise<string | null> {
    await this.slot()
    try {
      if (job.signal?.aborted) return null
      await fsp.mkdir(this.dir, { recursive: true })
      const tmp = `${out}.part`
      let ok: boolean
      if (job.desktop) {
        ok = await this.frame(file, kind, tmp, job)
      } else {
        ok = (await this.run(thumbArgs(file, kind, tmp), job)).ok
        // A video shorter than the seek gives no frame at all: take the first.
        if (!ok && kind === 'video') ok = (await this.run(thumbArgs(file, kind, tmp, 0), job)).ok
      }
      if (!ok) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined)
        return null
      }
      await fsp.rename(tmp, out)
      const size = await fsp.stat(out).then((s) => s.size).catch(() => 0)
      if (this.budget.add(size)) void this.evict()
      return out
    } catch {
      return null
    } finally {
      this.free()
    }
  }

  /** The desktop's frame of one file, written to `tmp`. */
  private async frame(file: string, kind: ThumbKind, tmp: string, job: Job): Promise<boolean> {
    const how: ThumbHow = { desktop: true }
    const width = job.tier
    if (kind === 'video') {
      let seek = VIDEO_SEEK_S
      let r = await this.run(thumbArgs(file, kind, tmp, seek, width, how), job)
      // A clip shorter than the seek gives no frame: the first one.
      if (!r.ok) {
        seek = 0
        r = await this.run(thumbArgs(file, kind, tmp, seek, width, how), job)
      }
      if (!r.ok) return false
      if (!inputIsHdr(r.stderr)) return true
      // HDR (HLG or PQ) looks flat and dark when only scaled: tone-map in a
      // second pass, written aside so a failure keeps the plain frame.
      const aside = `${tmp.replace(/\.part$/, '')}.tm.part`
      const second = await this.run(thumbArgs(file, kind, aside, seek, width, { ...how, tonemap: true }), job)
      if (second.ok) await fsp.rename(aside, tmp).catch(() => undefined)
      else await fsp.rm(aside, { force: true }).catch(() => undefined)
      return true
    }
    if (isRaw(file) && this.deps.raw) {
      try {
        if (await this.viaSource(await this.deps.raw(file, job.mtimeMs), file, kind, tmp, job)) return true
      } catch {
        /* no preview inside it: ffmpeg on the raw itself, below */
      }
    }
    const r = await this.run(thumbArgs(file, kind, tmp, VIDEO_SEEK_S, width, how), job)
    if (isHeifName(file) && this.deps.heic && (!r.ok || inputNeedsHeifDecoder(r.stderr))) {
      try {
        return await this.viaSource(await this.deps.heic(file, job.mtimeMs), file, kind, tmp, job)
      } catch {
        return r.ok
      }
    }
    return r.ok
  }

  /** Scale a picture main decoded (a HEIC's JPEG, a raw's preview), handed to
   *  ffmpeg as a file next to the thumbnail, gone after. */
  private async viaSource(bytes: Buffer, file: string, kind: ThumbKind, tmp: string, job: Job): Promise<boolean> {
    const source = `${tmp.replace(/\.part$/, '')}.src.part`
    try {
      await fsp.writeFile(source, bytes)
      return (await this.run(thumbArgs(file, kind, tmp, VIDEO_SEEK_S, job.tier, { desktop: true, source }), job)).ok
    } finally {
      await fsp.rm(source, { force: true }).catch(() => undefined)
    }
  }

  /** One ffmpeg: whether it left a non-empty file, and what it said. The
   *  desktop's has a timeout and a cancel; the phone's has neither. */
  private run(args: string[], job: Job): Promise<Ran> {
    const file = args[args.indexOf('-i') + 1]
    const out = args[args.length - 1]
    this.runs += 1
    this.procs += 1
    this.peak = Math.max(this.peak, this.procs)
    return new Promise((resolve) => {
      const closed: (() => void)[] = []
      const child = execFile(
        this.ffmpeg,
        args,
        {
          windowsHide: true,
          maxBuffer: 4 << 20,
          ...(job.desktop ? { timeout: this.deps.timeoutMs ?? THUMB_TIMEOUT_MS, signal: job.signal } : {})
        },
        (err, _stdout, stderr) => {
          this.procs -= 1
          for (const fn of closed) fn()
          if (err) return resolve({ ok: false, stderr })
          void fsp
            .stat(out)
            .then((s) => resolve({ ok: s.size > 0, stderr }))
            .catch(() => resolve({ ok: false, stderr }))
        }
      )
      const kill = (): void => {
        job.released = true
        child.kill()
      }
      this.register({ kill, once: (_event, fn) => void closed.push(fn) }, file)
    })
  }

  /** Half-written files left by a run that died (a crash, a kill): removed
   *  once at startup, off the startup path. One touched in the last minute
   *  may be a run in progress and stays. */
  async sweepParts(): Promise<void> {
    try {
      const now = Date.now()
      for (const name of await fsp.readdir(this.dir)) {
        if (!name.endsWith('.part')) continue
        const p = join(this.dir, name)
        const st = await fsp.stat(p).catch(() => null)
        if (st && now - st.mtimeMs > PART_STALE_MS) await fsp.rm(p, { force: true }).catch(() => undefined)
      }
    } catch {
      /* no cache folder yet: nothing to sweep */
    }
  }

  private slot(): Promise<void> {
    if (this.running < AT_ONCE) {
      this.running += 1
      return Promise.resolve()
    }
    return new Promise((r) =>
      this.queue.push(() => {
        this.running += 1
        r()
      })
    )
  }

  private free(): void {
    this.running -= 1
    this.queue.shift()?.()
  }

  private async evict(): Promise<void> {
    this.scans += 1
    let total: number | null = null
    try {
      const names = (await fsp.readdir(this.dir)).filter(isThumbFile)
      const entries: Array<{ name: string; size: number; mtimeMs: number }> = []
      for (let i = 0; i < names.length; i += SCAN_AT_ONCE) {
        const batch = await Promise.all(
          names.slice(i, i + SCAN_AT_ONCE).map(async (name) => {
            const s = await fsp.stat(join(this.dir, name)).catch(() => null)
            return s ? { name, size: s.size, mtimeMs: s.mtimeMs } : null
          })
        )
        for (const e of batch) if (e) entries.push(e)
      }
      let held = entries.reduce((n, e) => n + e.size, 0)
      if (held > CACHE_MAX_BYTES) {
        const gone = new Set(toEvict(entries, CACHE_TRIM_BYTES))
        for (const e of entries) {
          if (!gone.has(e.name)) continue
          await fsp.rm(join(this.dir, e.name), { force: true })
          held -= e.size
        }
      }
      total = held
    } catch {
      /* a cache that cannot be tidied is still a cache */
    } finally {
      this.budget.settled(total)
    }
  }
}
