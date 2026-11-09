import { useEffect, type RefObject } from 'react'
import { blackCheck, pictureCheck } from '../lib/liveRoute'
import { filmLine } from '../lib/filmDiag'
import { ownDocument } from '../lib/ownWindow'

const TICK_MS = 500

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
 * The clock runs only while the film is on screen (a tab behind this one, a
 * kept player under the list and a hidden window prove nothing), and a film
 * that has shown a picture is never asked again: a seek is not a failure.
 *
 * The line for each film says what happened (lib/filmDiag): the first frame,
 * a timeout, an element error. Two readings a second at most; the frame is
 * only read while the film plays, and the watch ends with the first lit one.
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
    let watched = 0
    let seen = false
    let saidNone = false
    let hits = 0
    let lastT = -1
    const stop = (): void => window.clearInterval(timer)
    const timer = window.setInterval(() => {
      if (ownDocument(el).hidden || !el.checkVisibility({ visibilityProperty: true })) return
      watched += TICK_MS
      const width = forcedNoPicture ? 0 : el.videoWidth
      const ms = Math.round(performance.now() - t0)
      const check = pictureCheck({ elapsedMs: watched, readyState: el.readyState, videoWidth: width, networkState: el.networkState, seen })
      if (check === 'picture' && !seen) {
        seen = true
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
      if (!platform || !canRescue) {
        stop()
        return
      }
      // A reading is of a film really moving: not paused, not mid-seek.
      if (el.paused || el.seeking || el.currentTime === lastT) return
      lastT = el.currentTime
      const q = el.getVideoPlaybackQuality?.()
      const now = blackCheck({
        platform,
        playing: true,
        t: el.currentTime,
        frames: q?.totalVideoFrames ?? 0,
        lit: frameLit(el),
        hits,
        duration: el.duration
      })
      hits = now.hits
      if (now.verdict === 'lit') stop()
      if (now.verdict === 'black') {
        stop()
        filmLine('black', path, { ms, route }, false)
        onRescue('black-picture')
      }
    }, TICK_MS)
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
