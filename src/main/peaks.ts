import { spawn } from 'child_process'
import { statSync } from 'fs'

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
const cache = new Map<string, number[]>()
const MAX_CACHED = 40

function key(file: string): string {
  try {
    const st = statSync(file)
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
export function loadPeaks(ffmpeg: string, file: string, duration: number): Promise<number[] | null> {
  const k = key(file)
  const hit = cache.get(k)
  if (hit) return Promise.resolve(hit)
  if (!Number.isFinite(duration) || duration <= 0) return Promise.resolve(null)

  return new Promise((resolve) => {
    const acc = {
      peaks: new Array<number>(BUCKETS).fill(0),
      samples: 0,
      perBucket: Math.max(1, Math.floor((duration * PEAKS_RATE) / BUCKETS)),
      odd: null as number | null
    }
    const proc = spawn(ffmpeg, peaksArgs(file), { windowsHide: true })
    // A file with no audio, or one ffmpeg cannot open, simply produces nothing.
    let any = false
    proc.stdout.on('data', (chunk: Buffer) => {
      any = true
      foldChunk(chunk, acc)
    })
    proc.stderr.resume()
    const done = (): void => {
      if (!any) return resolve(null)
      const out = normalise(acc.peaks)
      cache.set(k, out)
      // Oldest first: this is a viewer, not a library.
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string)
      resolve(out)
    }
    proc.on('error', () => resolve(null))
    proc.on('close', done)
  })
}

/** The answer if it is already known, without spawning or probing anything. */
export function cachedPeaks(file: string): number[] | null {
  return cache.get(key(file)) ?? null
}

export function clearPeaksCache(): void {
  cache.clear()
}
