import { useEffect, useState } from 'react'

/**
 * The url the video element should actually play.
 *
 * Most files: the one it was given. The rest - MPEG-2, Xvid, WMV, Theora,
 * ProRes, and anything in a container Chromium cannot open - are converted
 * once by main and played from the copy, which is an ordinary mp4 and behaves
 * like one. See src/main/videoConvert.ts for why this is a conversion rather
 * than the live decode the audio side gets.
 */

export interface Playable {
  /** What to put in the <video>. Empty while a conversion is running. */
  src: string
  converting: boolean
  /** 0-100, or null when the file's length is unknown. */
  pct: number | null
  /** Fast (streams copied) or slow (picture re-encoded). */
  quick: boolean
  error: string | null
  /** True once this is the converted copy rather than the original file. */
  converted: boolean
  /** Frames per second, when the file says. Null until the probe answers, and
   *  for a file with no video stream. Frame stepping steps by this. */
  fps: number | null
}

export function usePlayableVideo(path: string, url: string): Playable {
  const [state, setState] = useState<{
    path: string
    src?: string
    converting: boolean
    pct: number | null
    quick: boolean
    error: string | null
  } | null>(null)
  const mine = state?.path === path ? state : null
  // Kept apart from the conversion state, which only exists for the files that
  // need converting: every file has a frame rate worth knowing.
  const [fps, setFps] = useState<{ path: string; fps: number | null } | null>(null)

  useEffect(() => {
    let live = true
    void window.prism.probeMedia(path).then((probe) => {
      if (!live) return
      setFps({ path, fps: probe.fps ?? null })
      if (!probe.convert) return
      setState({ path, converting: true, pct: null, quick: probe.convert.quick, error: null })
      void window.prism.convertVideo(path).then((r) => {
        if (!live) return
        setState((prev) => ({
          path,
          src: r.url,
          converting: false,
          pct: null,
          quick: prev?.quick ?? false,
          error: r.error ?? null
        }))
      })
    })
    return () => {
      live = false
      // Arrowing past a WMV used to leave a whole film re-encoding behind the
      // viewer, for nobody (2026-08-28). Cancelling a conversion that already
      // finished is a no-op, so this is safe to say every time.
      window.prism.cancelConvert(path)
    }
  }, [path])

  // Progress arrives as events, since a conversion can take minutes.
  useEffect(() => {
    return window.prism.onConvertProgress((m) => {
      if (m.path !== path) return
      setState((prev) => (prev && prev.path === path && prev.converting ? { ...prev, pct: m.pct } : prev))
    })
  }, [path])

  return {
    src: mine?.converting ? '' : (mine?.src ?? url),
    converting: !!mine?.converting,
    pct: mine?.pct ?? null,
    quick: !!mine?.quick,
    error: mine?.error ?? null,
    converted: !!mine?.src,
    fps: fps?.path === path ? fps.fps : null
  }
}
