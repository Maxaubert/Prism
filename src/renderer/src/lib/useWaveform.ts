import { useEffect, useState } from 'react'
import { loadPeaks } from './audio'

// Peaks for the waveform transport styles, loaded from the file only when a
// waveform style is actually showing (so the extra decode isn't paid otherwise).
// The result is tagged with its url so a stale track's peaks are never returned
// while a new one loads (and the effect never setStates synchronously).
export function useWaveform(url: string, enabled: boolean): number[] {
  const [loaded, setLoaded] = useState<{ url: string; peaks: number[] }>({ url: '', peaks: [] })
  useEffect(() => {
    if (!enabled || !url) return
    let cancelled = false
    loadPeaks(url).then(
      (peaks) => {
        if (!cancelled) setLoaded({ url, peaks })
      },
      () => {
        /* undecodable (e.g. some video containers); the fallback shape shows */
      }
    )
    return () => {
      cancelled = true
    }
  }, [url, enabled])
  return enabled && loaded.url === url ? loaded.peaks : []
}
