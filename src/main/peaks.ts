import { spawn } from 'child_process'
import { holders } from './holders'
import { stat } from 'fs/promises'
import { createLru } from './lru'

/**
 * The waveform transport's amplitude envelope, computed HERE rather than in the
 * renderer (2026-08-26).
 *
 * It used to be `fetch(url) -> arrayBuffer() -> decodeAudioData()` in the page:
 * the whole file into memory, then the whole thing decoded to PCM. Measured on
 * a 2GB film, the renderer went 180MB -> 7.4GB before the decode threw (Web
 * Audio cannot open an MKV, so the cost bought nothing at all) - and on a long
 * audiobook it does not throw, which is worse.
 *
 * ffmpeg is already bundled and can do it in one pass: decode the first audio
 * track to mono 8kHz, and keep nothing but the running maximum per bucket. The
 * stream is read and dropped chunk by chunk, so a two-hour film costs the same
 * few hundred bytes as a three-minute song.
 */

/** How many bars the transport draws. */
export const BUCKETS = 160
/** Mono, 8kHz: an envelope needs no more, and it keeps the stream small. */
export const PEAKS_RATE = 8000

export interface PeakJob {
  path: string
  duration: number
}

/** ffmpeg's argv: first audio track, mono, 8kHz, raw little-endian 16-bit. */
export function peaksArgs(file: string): string[] {
  return [
    '-v', 'error',
    '-i', file,
    '-map', '0:a:0?',
    '-ac', '1',
    '-ar', String(PEAKS_RATE),
    '-f', 's16le',
    '-'
  ]
}

/**
 * Fold raw s16le samples into `buckets` running maxima.
 *
 * Pure, and stateful only in the accumulator it is given, so the caller can
 * hand it one chunk at a time and hold nothing else.
 */
export function foldChunk(
  chunk: Buffer,
  acc: { peaks: number[]; samples: number; perBucket: number; odd: number | null }
): void {
  let i = 0
  // A chunk can split a sample down the middle; the stray byte waits here.
  if (acc.odd !== null && chunk.length > 0) {
    const v = Math.abs(((acc.odd | (chunk[0] << 8)) << 16) >> 16) / 32768
    const b = Math.min(acc.peaks.length - 1, Math.floor(acc.samples / acc.perBucket))
    if (v > acc.peaks[b]) acc.peaks[b] = v
    acc.samples += 1
    acc.odd = null
    i = 1
  }
  for (; i + 1 < chunk.length; i += 2) {
    const v = Math.abs(chunk.readInt16LE(i)) / 32768
    const b = Math.min(acc.peaks.length - 1, Math.floor(acc.samples / acc.perBucket))
    if (v > acc.peaks[b]) acc.peaks[b] = v
    acc.samples += 1
  }
  acc.odd = i < chunk.length ? chunk[i] : null
}

/** Lift the quiet passages so they still show, then normalise to 0-1. */
export function normalise(peaks: readonly number[]): number[] {
  const max = Math.max(1e-6, ...peaks)
  return peaks.map((p) => Math.pow(p / max, 0.7))
}

/** Keyed by path + mtime + size: the same file answers instantly next time. */
// Oldest first, never touched on a hit: this is a viewer, not a library.
const cache = createLru<string, number[]>(40)

/** Async (owner, 2026-10-12, main never waits on the disk): this ran on every
 *  audio or video opened, twice on a miss. */
async function key(file: string): Promise<string> {
  try {
    const st = await stat(file)
    return `${file}|${st.mtimeMs}|${st.size}`
  } catch {
    return file
  }
}

/**
 * The envelope for `file`, or null when it has no audio ffmpeg can read.
 *
 * `duration` decides the bucket width; without it the stream would have to be
 * held to know how long it was, which is the whole thing this avoids.
 */
/**
 * One job per file at a time, ONE decode at a time, and a way to stop one
 * (review, 2026-10-16).
 *
 * Every miss used to spawn its own ffmpeg reading the whole file, and nothing
 * killed it: the renderer's cleanup only set a local flag. Arrowing through
 * big films with the Wave transport stacked whole-file decodes that fought
 * playback for the disk. Now a second ask for the same file joins the first,
 * the decodes queue behind one another, and `cancelPeaks` stops a job once
 * the last viewer that asked for it has gone.
 */
interface PeakRun {
  file: string
  waiters: number
  cancelled: boolean
  kill: (() => void) | null
  promise: Promise<number[] | null>
}

const inflight = new Map<string, PeakRun>()
let busy = false
const queue: Array<() => void> = []

function acquire(): Promise<void> {
  if (!busy) {
    busy = true
    return Promise.resolve()
  }
  return new Promise((resolve) => queue.push(resolve))
}

function release(): void {
  const next = queue.shift()
  if (next) next()
  else busy = false
}

/** A viewer of `file` walked away: its job stops once nobody else waits. */
export function cancelPeaks(file: string): void {
  const run = inflight.get(file)
  if (!run) return
  run.waiters -= 1
  if (run.waiters > 0) return
  run.cancelled = true
  run.kill?.()
  inflight.delete(file)
}

/**
 * `duration` may be a function, asked only once this job's turn has come and
 * it has not been cancelled: the caller's probe then waits in the same queue
 * and a cancel during it is not lost.
 *
 * The ask is registered SYNCHRONOUSLY, keyed by path, before the first await
 * (the stat for the cache key): a cancel that arrives while that stat runs
 * then finds the job and stops it, where keying by the stat's answer let it
 * slip past and left a whole-file decode at the head of the one-at-a-time
 * queue, for nobody.
 */
export function loadPeaks(
  ffmpeg: string,
  file: string,
  duration: number | (() => Promise<number>)
): Promise<number[] | null> {
  const running = inflight.get(file)
  if (running) {
    running.waiters += 1
    return running.promise
  }
  const run: PeakRun = { file, waiters: 1, cancelled: false, kill: null, promise: Promise.resolve(null) }
  run.promise = (async (): Promise<number[] | null> => {
    try {
      const k = await key(file)
      // A known answer never waits behind another file's decode.
      const hit = cache.peek(k)
      if (hit) return hit
      if (run.cancelled) return null
      if (typeof duration === 'number' && (!Number.isFinite(duration) || duration <= 0)) return null
      await acquire()
      try {
        if (run.cancelled) return null
        const secs = typeof duration === 'number' ? duration : await duration()
        if (run.cancelled || !Number.isFinite(secs) || secs <= 0) return null
        return await decode(ffmpeg, file, secs, k, run)
      } finally {
        release()
      }
    } finally {
      if (inflight.get(file) === run) inflight.delete(file)
    }
  })()
  inflight.set(file, run)
  return run.promise
}

function decode(
  ffmpeg: string,
  file: string,
  duration: number,
  k: string,
  run: PeakRun
): Promise<number[] | null> {
  return new Promise((resolve) => {
    const acc = {
      peaks: new Array<number>(BUCKETS).fill(0),
      samples: 0,
      perBucket: Math.max(1, Math.floor((duration * PEAKS_RATE) / BUCKETS)),
      odd: null as number | null
    }
    const proc = spawn(ffmpeg, peaksArgs(file), { windowsHide: true })
    run.kill = () => proc.kill()
    holders.add(proc, file) // a move of the file kills this first (#127)
    // A file with no audio, or one ffmpeg cannot open, simply produces nothing.
    let any = false
    proc.stdout.on('data', (chunk: Buffer) => {
      any = true
      foldChunk(chunk, acc)
    })
    proc.stderr.resume()
    const done = (): void => {
      // A killed job's half-envelope is not the file's: never cached.
      if (!any || run.cancelled) return resolve(null)
      const out = normalise(acc.peaks)
      cache.set(k, out)
      resolve(out)
    }
    proc.on('error', () => resolve(null))
    proc.on('close', done)
  })
}

/** The answer if it is already known, without spawning or probing anything
 *  (one stat, for the key). A Promise: a caller must await it, since the
 *  Promise itself is always truthy. */
export async function cachedPeaks(file: string): Promise<number[] | null> {
  return cache.peek(await key(file)) ?? null
}
