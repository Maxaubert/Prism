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
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'

export const THUMB_WIDTH = 320
/** A frame this far into a video: past the black leader most films open on. */
export const VIDEO_SEEK_S = 3
export const CACHE_MAX_BYTES = 200 * 1024 * 1024
const AT_ONCE = 4

export type ThumbKind = 'image' | 'video'

/** `<sha1 of path|size|mtime>.jpg`: a file changed on disk is a new key. */
export function thumbKey(path: string, size: number, mtimeMs: number): string {
  return createHash('sha1').update(`${path.toLowerCase()}|${size}|${Math.floor(mtimeMs)}`).digest('hex') + '.jpg'
}

/** ffmpeg argv for one 320px JPEG of `file` at `out`. A video seeks first;
 *  `seek` 0 is the very first frame, the fallback for a clip shorter than
 *  the seek. `-frames:v 1` and a plain JPEG at quality 5 keep it small. */
export function thumbArgs(file: string, kind: ThumbKind, out: string, seek = VIDEO_SEEK_S): string[] {
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
    '-q:v',
    '5',
    // The muxer is NAMED, not read off the extension: the file is written
    // as `<key>.jpg.part` and renamed into place when whole, and ffmpeg
    // given a `.part` alone refuses for want of a format (measured: every
    // tile blank, the route 404 on a png it can decode).
    '-f',
    'image2',
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

export class Thumbs {
  private readonly inFlight = new Map<string, Promise<string | null>>()
  private running = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly ffmpeg: string,
    private readonly dir: string,
    /** Told of every ffmpeg and the file it reads, for whoever tracks them. */
    private readonly register: (child: { kill(): unknown; once(event: 'close', fn: () => void): unknown }, file: string) => void = () => undefined
  ) {}

  /** The JPEG's path, or null when the file cannot be thumbnailed. */
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
      void this.evict()
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
      const child = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
      this.register(child, file)
      child.on('error', () => resolve(false))
      child.on('close', (code) => {
        if (code !== 0) return resolve(false)
        void fsp
          .stat(out)
          .then((s) => resolve(s.size > 0))
          .catch(() => resolve(false))
      })
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
    try {
      const names = await fsp.readdir(this.dir)
      const entries = await Promise.all(
        names
          .filter((n) => n.endsWith('.jpg'))
          .map(async (name) => {
            const s = await fsp.stat(join(this.dir, name))
            return { name, size: s.size, mtimeMs: s.mtimeMs }
          })
      )
      for (const name of toEvict(entries, CACHE_MAX_BYTES)) await fsp.rm(join(this.dir, name), { force: true })
    } catch {
      /* a cache that cannot be tidied is still a cache */
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}
