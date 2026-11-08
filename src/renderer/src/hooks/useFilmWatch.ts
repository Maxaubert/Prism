import { useEffect, type RefObject } from 'react'
import { blackCheck, pictureCheck } from '../lib/liveRoute'
import { filmLine } from '../lib/filmDiag'

/** Mean brightness of the frame on a tiny canvas, null when it cannot be read. */
function frameLit(el: HTMLVideoElement): number | null {
  try {
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(el, 0, 0, 16, 16)
    const d = g.getImageData(0, 0, 16, 16).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
    return sum / (d.length / 4) / 3
  } catch {
    return null
  }
}

/**
 * WATCH EACH FILM UNTIL IT SHOWS A PICTURE (owner, 2026-11-08: "the rest just
 * shows a black screen and wont start"). The element will not always say: a
 * film can sit with no frame and no error for as long as it likes. So every
 * film gets its own clock from the moment it is handed over, and a direct
 * start that has not given a picture when it runs out takes the live route
 * (lib/liveRoute `pictureCheck`). HEVC, which goes through the platform's
 * decoder, is also checked for the picture that arrives black (`blackCheck`).
 *
 * The line for each film says what happened (lib/filmDiag): the first frame,
 * a timeout, an element error. Two readings a second at most, and it stops
 * for good once there is a picture.
 */
export function useFilmWatch(
  ref: RefObject<HTMLVideoElement | null>,
  o: {
    path: string
    url: string
    /** Has a picture to show and is watched here (not the phone). */
    film: boolean
    route: 'direct' | 'live'
    /** A direct start that may still be handed to the live route. */
    canRescue: boolean
    /** Decoded by the platform, so the picture can come out black. */
    platform: boolean
    /** E2E seam (`PRISM_E2E_NO_PICTURE`): this film never shows a frame. */
    forcedNoPicture: boolean
    onRescue: (why: string) => void
  }
): void {
  const { path, url, film, route, canRescue, platform, forcedNoPicture, onRescue } = o
  useEffect(() => {
    const el = ref.current
    if (!el || !film) return
    const t0 = performance.now()
    let saidFrame = false
    let saidNone = false
    let hits = 0
    let settled = false
    const stop = (): void => window.clearInterval(timer)
    const timer = window.setInterval(() => {
      const width = forcedNoPicture ? 0 : el.videoWidth
      const ms = Math.round(performance.now() - t0)
      const check = pictureCheck({ elapsedMs: ms, readyState: el.readyState, videoWidth: width })
      if (check === 'picture' && !saidFrame) {
        saidFrame = true
        filmLine('first-frame', path, { ms, route, w: el.videoWidth, h: el.videoHeight })
      }
      if (check === 'no-picture') {
        if (!saidNone) {
          saidNone = true
          filmLine('no-picture', path, { ms, route, ready: el.readyState, net: el.networkState, paused: el.paused }, false)
        }
        if (canRescue) {
          stop()
          onRescue('no-picture')
        }
        return
      }
      if (check !== 'picture') return
      if (!platform || !canRescue || settled) {
        stop()
        return
      }
      const q = el.getVideoPlaybackQuality?.()
      const now = blackCheck({
        platform,
        playing: !el.paused,
        t: el.currentTime,
        frames: q?.totalVideoFrames ?? 0,
        lit: frameLit(el),
        hits
      })
      hits = now.hits
      if (now.verdict === 'lit') settled = true
      if (now.verdict === 'black') {
        stop()
        filmLine('black', path, { ms, route }, false)
        onRescue('black-picture')
      }
    }, 500)
    const onError = (): void => {
      const e = el.error
      filmLine('error', path, { code: e?.code, message: e?.message, route }, false)
    }
    el.addEventListener('error', onError)
    return () => {
      stop()
      el.removeEventListener('error', onError)
    }
  }, [ref, path, url, film, route, canRescue, platform, forcedNoPicture, onRescue])
}
