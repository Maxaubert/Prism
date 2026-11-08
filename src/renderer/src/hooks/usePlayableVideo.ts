import { useCallback, useEffect, useState } from 'react'
import { pictureRoute, routeWhy, type PictureRoute } from '../lib/liveRoute'
import { filmLine } from '../lib/filmDiag'

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
 *
 * A film that needed that rescue is remembered for the session (`rescued`):
 * going back to it does not wait out another black start. Everything else
 * about a film is fresh when the file changes: the decision to go live,
 * main's answer for it, the route for the log.
 */

/** Films whose direct start showed nothing, this session (by lower-case
 *  path). A set outside React so a return to the film is live at once. */
const rescued = new Set<string>()

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
  /** Which way this film goes, for the log. */
  route: PictureRoute
  /** E2E seam (`PRISM_E2E_NO_PICTURE`): this film never shows a frame. */
  forcedNoPicture: boolean
  /** The element showed no picture: take the live route for this file.
   *  Once per file; a no-op where the host has no live route. `why` is what
   *  the element did, for the log. */
  goLive: (why: string) => void
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
  const [blindFor, setBlindFor] = useState<string | null>(null)
  // FRESH FOR EACH FILM (2026-11-08): the owner's films shared one player,
  // and a film that had gone live kept its decision (and main's answer) when
  // the tab came back to it, before anything was asked about it. Reset while
  // rendering, as the fit below is, and a film the element already refused
  // is live from the first frame on.
  const [routedFor, setRoutedFor] = useState(path)
  if (routedFor !== path) {
    setRoutedFor(path)
    setLiveFor(rescued.has(path.toLowerCase()) ? path : null)
    setLive(null)
  }
  const goingLive = allowLive && liveFor === path

  useEffect(() => {
    let alive = true
    void window.prism.probeMedia(path).then((probe) => {
      if (!alive) return
      setFps({ path, fps: probe.fps ?? null })
      setBlindFor(probe.noPicture ? path : null)
      const ask = {
        codec: probe.videoCodec,
        profile: probe.videoProfile,
        forceLive: probe.forceLive,
        converting: !!probe.convert,
        canPlay: (mime: string) => document.createElement('video').canPlayType(mime)
      }
      const route = allowLive ? pictureRoute(ask) : 'direct'
      // The route is the probe's call; a film already rescued stays live.
      const toLive = route === 'live' || (allowLive && rescued.has(path.toLowerCase()))
      if (probe.videoCodec) {
        filmLine('route', path, {
          route: toLive ? 'live' : 'direct',
          why: rescued.has(path.toLowerCase()) ? 'rescued' : routeWhy(ask),
          codec: probe.videoCodec,
          profile: probe.videoProfile
        })
      }
      if (toLive) {
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
      if ('error' in r) filmLine('live-open', path, { error: r.error }, false)
      else filmLine('live-open', path, { duration: r.duration })
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

  const goLive = useCallback(
    (why: string) => {
      if (!allowLive) return
      rescued.add(path.toLowerCase())
      filmLine('to-live', path, { why })
      setLiveFor(path)
    },
    [allowLive, path]
  )

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
    route: goingLive ? 'live' : 'direct',
    forcedNoPicture: blindFor === path,
    goLive
  }
}
