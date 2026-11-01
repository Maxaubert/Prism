/**
 * Thumbnails for the phone's grid (2026-09-13, #135), made on the PC once.
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
 */
import { execFile } from './spawnWorker'
import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { exists } from './fsUtil'
import { thumbKeepsAlpha } from '@shared/thumbAlpha'

export const THUMB_WIDTH = 320
/** A frame this far into a video: past the black leader most films open on. */
export const VIDEO_SEEK_S = 3
export const CACHE_MAX_BYTES = 200 * 1024 * 1024
/** An eviction trims to this, so the next one is a long way off. */
export const CACHE_TRIM_BYTES = 180 * 1024 * 1024
/** Stats an eviction scan has in flight at once. */
const SCAN_AT_ONCE = 16
const AT_ONCE = 4

export type ThumbKind = 'image' | 'video'

/** `<sha1 of path|size|mtime>.jpg`: a file changed on disk is a new key.
 *  `.webp` for a picture that can be clear (#477). */
export function thumbKey(path: string, size: number, mtimeMs: number): string {
  const hash = createHash('sha1').update(`${path.toLowerCase()}|${size}|${Math.floor(mtimeMs)}`).digest('hex')
  return hash + (thumbKeepsAlpha(path) ? '.webp' : '.jpg')
}

/** A whole thumbnail in the cache folder, either kind; `.part` is not. */
export function isThumbFile(name: string): boolean {
  return name.endsWith('.jpg') || name.endsWith('.webp')
}

/** ffmpeg argv for one 320px JPEG of `file` at `out`. A video seeks first;
 *  `seek` 0 is the very first frame, the fallback for a clip shorter than
 *  the seek. `-frames:v 1` and a plain JPEG at quality 5 keep it small.
 *  A picture that can be clear is a lossy WebP that keeps its alpha (#477):
 *  libwebp takes the decoder's RGBA as it is, measured 2026-11-01 (a clear
 *  corner stays alpha 0, where the JPEG made it black). */
export function thumbArgs(file: string, kind: ThumbKind, out: string, seek = VIDEO_SEEK_S): string[] {
  const alpha = kind === 'image' && thumbKeepsAlpha(file)
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    ...(kind === 'video' && seek > 0 ? ['-ss', String(seek)] : []),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMB_WIDTH}:-2`,
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

export class Thumbs {
  private readonly budget = new CacheBudget(CACHE_MAX_BYTES)
  private readonly inFlight = new Map<string, Promise<string | null>>()
  private running = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly ffmpeg: string,
    private readonly dir: string,
    /** Told of every ffmpeg and the file it reads, for whoever tracks them. */
    private readonly register: (child: { kill(): unknown; once(event: 'close', fn: () => void): unknown }, file: string) => void = () => undefined
  ) {}

  /** The thumbnail's path (a JPEG, or a WebP for a picture that can be
   *  clear), or null when the file cannot be thumbnailed. */
  async get(file: string, kind: ThumbKind): Promise<string | null> {
    let st: { size: number; mtimeMs: number }
    try {
      st = await fsp.stat(file)
    } catch {
      return null
    }
    const out = join(this.dir, thumbKey(file, st.size, st.mtimeMs))
    if (await exists(out)) {
      // A hit is touched, so eviction takes cold entries and not this one.
      const now = new Date()
      await fsp.utimes(out, now, now).catch(() => undefined)
      return out
    }
    const held = this.inFlight.get(out)
    if (held) return held
    const job = this.make(file, kind, out).finally(() => this.inFlight.delete(out))
    this.inFlight.set(out, job)
    return job
  }

  private async make(file: string, kind: ThumbKind, out: string): Promise<string | null> {
    await this.slot()
    try {
      await fsp.mkdir(this.dir, { recursive: true })
      const tmp = `${out}.part`
      let ok = await this.run(thumbArgs(file, kind, tmp))
      // A video shorter than the seek gives no frame at all: take the first.
      if (!ok && kind === 'video') ok = await this.run(thumbArgs(file, kind, tmp, 0))
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

  /** One ffmpeg, true when it left a non-empty file. */
  private run(args: string[]): Promise<boolean> {
    const file = args[args.indexOf('-i') + 1]
    const out = args[args.length - 1]
    return new Promise((resolve) => {
      const closed: (() => void)[] = []
      const child = execFile(this.ffmpeg, args, { windowsHide: true, maxBuffer: 4 << 20 }, (err) => {
        for (const fn of closed) fn()
        if (err) return resolve(false)
        void fsp
          .stat(out)
          .then((s) => resolve(s.size > 0))
          .catch(() => resolve(false))
      })
      this.register({ kill: child.kill, once: (_event, fn) => void closed.push(fn) }, file)
    })
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
