import { useEffect, useState } from 'react'

/**
 * Peaks for the waveform transport styles, asked of MAIN (2026-08-26).
 *
 * This used to fetch the media file into the page and decodeAudioData the
 * whole thing: on a 2GB film the renderer went to 7.4GB and then threw, since
 * Web Audio cannot open an MKV at all. ffmpeg is bundled, it streams, and it
 * hands back 160 numbers.
 *
 * The result is tagged with its path so a stale track's peaks are never shown
 * against a new one.
 */
export function useWaveform(path: string, enabled: boolean): number[] {
  const [loaded, setLoaded] = useState<{ path: string; peaks: number[] }>({ path: '', peaks: [] })
  useEffect(() => {
    if (!enabled || !path) return
    let cancelled = false
    window.prism.mediaPeaks(path).then(
      (peaks) => {
        if (!cancelled && peaks?.length) setLoaded({ path, peaks })
      },
      () => {
        /* no ffmpeg, or nothing to read: the fallback shape shows */
      }
    )
    return () => {
      cancelled = true
    }
  }, [path, enabled])
  return enabled && loaded.path === path ? loaded.peaks : []
}
