import type { MediaInfo } from './ffmpeg'

/**
 * One probe per file, kept for as long as the file has not changed: the
 * audio player, the video player, the no-picture note, the conversion, the
 * waveform and the phone's /api/play all ask.
 *
 * It holds the PROMISE, not the answer (review, 2026-10-16): it used to store
 * the answer only once ffprobe had finished, so the video player and the
 * sidecar audio asking at the same mount each spawned their own ffprobe, and
 * the conversion and the peaks probed a third time outside the cache. A
 * second caller now joins the probe already running.
 */
export function createProbeCache(
  probe: (p: string) => Promise<MediaInfo | null>,
  mtimeOf: (p: string) => Promise<number>,
  max = 40
): (p: string) => Promise<MediaInfo | null> {
  const cache = new Map<string, Promise<MediaInfo | null>>()
  return async (p) => {
    let key: string
    try {
      key = `${p}|${await mtimeOf(p)}`
    } catch {
      return null
    }
    let info = cache.get(key)
    if (!info) {
      info = probe(p)
      if (cache.size > max) cache.clear()
      cache.set(key, info)
      // A probe that threw is not an answer to keep: the next ask tries again.
      const mine = info
      info.catch(() => {
        if (cache.get(key) === mine) cache.delete(key)
      })
    }
    return info
  }
}
