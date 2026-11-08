import { useCallback, useEffect, useState } from 'react'
import { pictureRoute } from '../lib/liveRoute'

/**
 * The url the video element should actually play.
 *
 * Most files: the one it was given. The rest - MPEG-2, Xvid, WMV, Theora,
 * ProRes, and anything in a container Chromium cannot open - are converted
 * once by main and played from the copy, which is an ordinary mp4 and behaves
 * like one. See src/main/videoConvert.ts for why this is a conversion rather
 * than the live decode the audio side gets.
 *
 * And a picture THIS PC cannot decode (2026-11-08, the owner's iPhone HEVC
 * .mov films on a PC without HEVC): a live HLS transcode, started at once and
 * seekable anywhere (lib/liveRoute.ts, main's liveVideo.ts). `live` says the
 * src is then a playlist, which the player feeds through hls.js. The
 * transcode stops when the file changes or the player goes.
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
  /** The src is a live transcode's HLS playlist (or is about to be). */
  live: boolean
  /** The element showed no picture: take the live route for this file.
   *  Once per file; a no-op where the host has no live route. */
  goLive: () => void
}

export function usePlayableVideo(path: string, url: string, allowLive = true): Playable {
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
  /** The file that goes live, decided by the probe or by the element. */
  const [liveFor, setLiveFor] = useState<string | null>(null)
  const [live, setLive] = useState<{ path: string; url?: string; error?: string } | null>(null)
  const goingLive = allowLive && liveFor === path

  useEffect(() => {
    let alive = true
    void window.prism.probeMedia(path).then((probe) => {
      if (!alive) return
      setFps({ path, fps: probe.fps ?? null })
      const route = allowLive
        ? pictureRoute({
            codec: probe.videoCodec,
            profile: probe.videoProfile,
            forceLive: probe.forceLive,
            converting: !!probe.convert,
            canPlay: (mime) => document.createElement('video').canPlayType(mime)
          })
        : 'direct'
      if (route === 'live') {
        setLiveFor(path)
        return
      }
      if (!probe.convert) return
      setState({ path, converting: true, pct: null, quick: probe.convert.quick, error: null })
      void window.prism.convertVideo(path).then((r) => {
        if (!alive) return
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
      alive = false
      // Arrowing past a WMV used to leave a whole film re-encoding behind the
      // viewer, for nobody (2026-08-28). Cancelling a conversion that already
      // finished is a no-op, so this is safe to say every time.
      window.prism.cancelConvert(path)
    }
  }, [path, allowLive])

  // The live transcode, for as long as this file is the one on screen: its
  // cleanup is the stop, so arrowing on, closing the tab or the preview, or
  // the window going all end the ffmpeg behind it.
  useEffect(() => {
    if (!goingLive) return
    let alive = true
    void window.prism.liveVideo(path).then((r) => {
      if (!alive) return
      setLive('url' in r ? { path, url: r.url } : { path, error: r.error })
    })
    return () => {
      alive = false
      window.prism.stopLive(path)
    }
  }, [path, goingLive])

  // Progress arrives as events, since a conversion can take minutes.
  useEffect(() => {
    return window.prism.onConvertProgress((m) => {
      if (m.path !== path) return
      setState((prev) => (prev && prev.path === path && prev.converting ? { ...prev, pct: m.pct } : prev))
    })
  }, [path])

  const goLive = useCallback(() => {
    if (allowLive) setLiveFor(path)
  }, [allowLive, path])

  const liveNow = goingLive && live?.path === path ? live : null
  return {
    src: goingLive ? (liveNow?.url ?? '') : mine?.converting ? '' : (mine?.src ?? url),
    converting: !goingLive && !!mine?.converting,
    pct: mine?.pct ?? null,
    quick: !!mine?.quick,
    error: goingLive ? (liveNow?.error ?? null) : (mine?.error ?? null),
    converted: !goingLive && !!mine?.src,
    fps: fps?.path === path ? fps.fps : null,
    live: goingLive,
    goLive
  }
}
