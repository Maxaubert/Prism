// The drop scan off the main thread (audit #61).
//
// The decoded track is mixed to mono and decimated to a low rate in slices on the
// calling thread (a cheap block mean, with a pause between slices), so the AudioBuffer
// can be dropped right after. The small result is transferred to a module Worker that
// runs the envelope scan. Without Worker (unit tests), the same scan runs in place.
import { analyzeDrops, type PcmSource } from './drops'

/** The rate the scan runs at. Drops live in the sub-bass and the loudness envelope, both far
 *  below this, so the hop-sized RMS the scan takes is the same to the eye. */
export const SCAN_RATE = 2000

/** Source frames read per slice before the caller's pause. */
const DECIMATE_SLICE = 1 << 20

/** Mono, block-averaged copy of a track at about SCAN_RATE. Slices with a pause between. */
export async function decimateMono(
  buffer: PcmSource,
  signal?: AbortSignal,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0))
): Promise<PcmSource | null> {
  const k = Math.max(1, Math.floor(buffer.sampleRate / SCAN_RATE))
  const ch = buffer.numberOfChannels
  const out = new Float32Array(Math.floor(buffer.length / k))
  const data: Float32Array[] = []
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c))
  const perSlice = Math.max(1, Math.floor(DECIMATE_SLICE / k))
  for (let o0 = 0; o0 < out.length; o0 += perSlice) {
    if (signal?.aborted) return null
    const o1 = Math.min(out.length, o0 + perSlice)
    for (let o = o0; o < o1; o++) {
      let v = 0
      const s = o * k
      for (let i = 0; i < k; i++) for (let c = 0; c < ch; c++) v += data[c][s + i]
      out[o] = v / (k * ch)
    }
    await pause()
  }
  return {
    sampleRate: buffer.sampleRate / k,
    length: out.length,
    numberOfChannels: 1,
    getChannelData: () => out
  }
}

/** Drop times in seconds for a decoded track, without holding the main thread or the buffer. */
export async function analyzeDropsOffMain(
  buffer: PcmSource,
  target = 12,
  signal?: AbortSignal,
  pause?: () => Promise<void>
): Promise<number[]> {
  if (buffer.length === 0) return []
  const mono = await decimateMono(buffer, signal, pause)
  if (!mono || signal?.aborted) return []
  if (typeof Worker === 'undefined') return analyzeDrops(mono, target)
  // A separate function, so this frame (and with it the AudioBuffer) ends here.
  return scanInWorker(mono, target, signal)
}

/** Runs the scan in a module Worker. If the worker cannot start or fails, the small
 *  mono copy is scanned in place instead (a few ms at SCAN_RATE), so drops never
 *  vanish silently. The worker gets its own transferred copy. */
function scanInWorker(mono: PcmSource, target: number, signal?: AbortSignal): Promise<number[]> {
  const inPlace = (): number[] => (signal?.aborted ? [] : analyzeDrops(mono, target))
  let worker: Worker
  try {
    worker = new Worker(new URL('./dropsWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve(inPlace())
  }
  const samples = mono.getChannelData(0).slice()
  return new Promise<number[]>((resolve) => {
    let settled = false
    const done = (times: () => number[]): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      resolve(times())
    }
    const onAbort = (): void => done(() => [])
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (e: MessageEvent<number[]>): void => done(() => e.data)
    worker.onerror = (e): void => {
      e.preventDefault()
      done(inPlace)
    }
    worker.onmessageerror = (): void => done(inPlace)
    worker.postMessage({ samples, sampleRate: mono.sampleRate, target }, [samples.buffer])
  })
}
