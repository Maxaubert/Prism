import { spawn } from 'child_process'
import { holders } from './holders'
import { createHash } from 'crypto'
import { rmSync } from 'fs'
import { mkdir, readdir, rename, rm, stat, utimes } from 'fs/promises'
import { join } from 'path'
import { chromiumCanDemux, needsSidecar, type MediaInfo } from './ffmpeg'

/**
 * Video Chromium cannot show, made showable.
 *
 * Audio gets decoded live (audioSidecar.ts) because PCM has a constant byte
 * rate, which is what makes a live stream seekable. Video has no such
 * constant, so the same trick cannot work: instead the file is converted once,
 * to a real mp4 on disk, and then played like any other file - seeking, speed,
 * subtitles and the audio path all work afterwards because by then it IS an
 * ordinary file.
 *
 * The important half is that most of these need no encoding at all. A .ts,
 * .flv or .vob usually holds H.264 that Chromium could decode perfectly well
 * if only it could open the container, so the streams are COPIED into an mp4 -
 * seconds, not minutes. Only a genuinely undecodable codec (MPEG-2, Xvid, WMV,
 * Theora, ProRes) is re-encoded.
 */

/** What Chromium can decode. Everything else has to be re-encoded. */
const CHROMIUM_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1'])

export function chromiumCanDecodeVideo(codec: string | null | undefined): boolean {
  return !!codec && CHROMIUM_VIDEO.has(codec.toLowerCase())
}

export interface ConvertPlan {
  /** Does this file need converting at all. */
  needed: boolean
  /** The picture can be copied across untouched: only the container was wrong. */
  copyVideo: boolean
  /** The sound can be copied across untouched. */
  copyAudio: boolean
  /** Why, for the progress panel: 'container' is fast, 'codec' is not. */
  reason: 'container' | 'codec' | null
}

/**
 * Whether a file needs converting, and how much work that is.
 *
 * A container Chromium cannot open is the cheap case (copy the streams into an
 * mp4). A codec it cannot decode is the expensive one.
 */
export function planConversion(info: MediaInfo | null, ext: string): ConvertPlan {
  const none: ConvertPlan = { needed: false, copyVideo: false, copyAudio: false, reason: null }
  if (!info) return none
  // Audio-only files are the sidecar's business, not this one.
  if (!info.videoCodec) return none
  const badCodec = !chromiumCanDecodeVideo(info.videoCodec)
  const badBox = !chromiumCanDemux(ext)
  if (!badCodec && !badBox) return none
  return {
    needed: true,
    copyVideo: !badCodec,
    // Copying an audio stream Chromium cannot decode would just move the
    // problem into the new file, so those get re-encoded here rather than
    // left to the sidecar: one pass, one result that simply plays.
    copyAudio: !!info.audio && !needsSidecar(info.audio.codec, '.mp4'),
    reason: badCodec ? 'codec' : 'container'
  }
}

/** The ffmpeg argv for one conversion. */
export function convertArgs(file: string, out: string, plan: ConvertPlan): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-i', file,
    '-map', '0:v:0',
    ...(plan.copyVideo
      ? ['-c:v', 'copy']
      : // libopenh264, since the bundled build is LGPL and has no x264. The
        // quality knob is deliberately modest: this is a viewer, and the
        // alternative on screen is nothing at all.
        ['-c:v', 'libopenh264', '-b:v', '4000k', '-pix_fmt', 'yuv420p']),
    // A file with no audio must not fail the whole conversion, hence the '?'.
    '-map', '0:a:0?',
    ...(plan.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']),
    '-sn', '-dn',
    // faststart puts the index at the front, so the result seeks immediately.
    '-movflags', '+faststart',
    '-f', 'mp4',
    out,
    // Machine-readable progress on stdout: out_time_ms every few frames.
    '-progress', 'pipe:1',
    '-nostats'
  ]
}

/** Percent complete from one chunk of ffmpeg's -progress output. */
export function readProgress(chunk: string, durationSec: number): number | null {
  if (durationSec <= 0) return null
  let pct: number | null = null
  for (const m of chunk.matchAll(/out_time_ms=(\d+)/g)) {
    const secs = Number(m[1]) / 1_000_000
    pct = Math.max(0, Math.min(99, Math.round((secs / durationSec) * 100)))
  }
  if (/progress=end/.test(chunk)) pct = 100
  return pct
}

/** A stable name for the converted copy: same file + same mtime = same result. */
export function cacheName(file: string, mtimeMs: number, size: number): string {
  return createHash('sha256').update(`${file.toLowerCase()}|${mtimeMs}|${size}`).digest('hex').slice(0, 32) + '.mp4'
}

interface Job {
  out: string
  promise: Promise<string>
  kill: () => void
}

const jobs = new Map<string, Job>()

/** Everything converted so far, oldest first. Async, like everything here
 *  that touches the disk while the user works (owner, 2026-10-12, the 3.9 s
 *  tabs.json freeze: main never waits on the disk). */
async function cached(dir: string): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.mp4'))
    const files = await Promise.all(
      names.map(async (n) => {
        const p = join(dir, n)
        const st = await stat(p)
        return { path: p, mtimeMs: st.mtimeMs, size: st.size }
      })
    )
    return files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  } catch {
    return []
  }
}

/** Keep the converted-video folder under a ceiling, dropping the oldest. */
export async function evictCache(dir: string, maxBytes: number): Promise<void> {
  const files = await cached(dir)
  let total = files.reduce((n, f) => n + f.size, 0)
  for (const f of files) {
    if (total <= maxBytes) return
    try {
      await rm(f.path, { force: true })
      total -= f.size
    } catch {
      /* in use; the next pass will get it */
    }
  }
}

const CACHE_MAX = 6 * 1024 * 1024 * 1024 // 6 GB of converted video, then evict

export interface ConvertHandle {
  /** Where the playable copy will be. */
  out: string
  /** Resolves with `out` when it is really there. */
  done: Promise<string>
}

/**
 * Convert a file to something the player can open, or hand back the copy made
 * last time. Two callers asking for the same file share one conversion.
 *
 * Async (owner, 2026-10-12): the cache check is a mkdir and two stats on
 * every open of such a film, and the source can sit on a slow or network
 * disk. Nothing is awaited between the `jobs` lookup and the `jobs.set`, so
 * two callers still share one conversion.
 */
export async function convertVideo(
  ffmpeg: string,
  file: string,
  dir: string,
  plan: ConvertPlan,
  durationSec: number,
  onProgress: (pct: number) => void
): Promise<ConvertHandle> {
  await mkdir(dir, { recursive: true })
  const st = await stat(file)
  const out = join(dir, cacheName(file, st.mtimeMs, st.size))

  const have = await stat(out).catch(() => null)
  if (have && have.size > 0) {
    // Touch it, so the cache evicts genuinely cold entries and not this one:
    // eviction reads mtime oldest-first, so without this the film you rewatch
    // every week is exactly the one that goes (2026-08-28). Not awaited: a
    // touch is an optimisation, never a reason to fail or delay the open.
    const now = new Date()
    void utimes(out, now, now).catch(() => {})
    return { out, done: Promise.resolve(out) }
  }
  const running = jobs.get(out)
  if (running) return { out, done: running.promise }

  const partial = out + '.part'
  let child: ReturnType<typeof spawn> | null = null
  const promise = new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, convertArgs(file, partial, plan), { windowsHide: true })
    child = proc
    holders.add(proc, file) // a move of the source kills the conversion first (#127)
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      const pct = readProgress(chunk, durationSec)
      if (pct !== null) onProgress(pct)
    })
    let err = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      err = (err + d).slice(-800)
    })
    proc.on('error', () => reject(new Error('ffmpeg could not start')))
    proc.on('close', (code) => {
      // The job stays listed until its `.part` is renamed or removed: an open
      // of the same film meanwhile joins it, where a fresh ffmpeg writing the
      // same `.part` would race this rename or removal (review, 2026-10-12).
      const finished = (): void => {
        if (jobs.get(out)?.promise === promise) jobs.delete(out)
      }
      void (async (): Promise<void> => {
        const made = code === 0 ? await stat(partial).catch(() => null) : null
        if (made && made.size > 0) {
          try {
            // Rename only on success: a half-written file must never look like
            // a finished one to the next open.
            await rm(out, { force: true })
            await rename(partial, out)
          } catch {
            finished()
            reject(new Error('could not finish the converted file'))
            return
          }
          finished()
          void evictCache(dir, CACHE_MAX)
          resolve(out)
        } else {
          // A failure is swallowed: an EBUSY here used to throw out of the
          // callback before the reject below was reached.
          await rm(partial, { force: true }).catch(() => {})
          finished()
          reject(new Error(err.trim().split('\n').pop() ?? 'conversion failed'))
        }
      })()
    })
  })
  jobs.set(out, { out, promise, kill: () => child?.kill() })
  return { out, done: promise }
}

/** Stop a conversion nobody is waiting for any more. */
export function cancelConversion(out: string): void {
  const job = jobs.get(out)
  if (!job) return
  job.kill()
  jobs.delete(out)
  // kill() is TerminateProcess on Windows and returns before ffmpeg's handles
  // are released, so removing the partial file can fail with EBUSY
  // (2026-08-28): try, then once more later, then leave it for the sweep.
  // Async, so a multi-GB partial is never deleted on main's thread (owner,
  // 2026-10-12).
  rm(out + '.part', { force: true }).catch(() => {
    setTimeout(() => {
      void rm(out + '.part', { force: true }).catch(() => {
        /* the next conversion of this file overwrites it anyway */
      })
    }, 2000).unref?.()
  })
}

/** Every conversion still running: quitting kills them. */
export function cancelAllConversions(): void {
  for (const job of jobs.values()) {
    job.kill()
    try {
      // sync-ok: quit; will-quit cannot await, and the process is going
      rmSync(job.out + '.part', { force: true })
    } catch {
      /* EBUSY right after kill(): the next conversion of this file overwrites it */
    }
  }
  jobs.clear()
}
