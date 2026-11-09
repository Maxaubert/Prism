import { useEffect, useRef, type RefObject } from 'react'
import { heldPaused, wasPlaying } from '../lib/playState'
import { autostartCheck } from '../lib/liveRoute'
import { filmLine } from '../lib/filmDiag'
import { ownDocument } from '../lib/ownWindow'

const TICK_MS = 1000

/**
 * DID THE FILM THAT WAS MEANT TO START, START (#491; owner, 2026-11-08:
 * "video dont always autopaly at least not in preview")? One `autostart` line
 * per film that was meant to start by itself, whichever route it took: the
 * first `playing` says so, and a film still paused after the bounded wait (the
 * clock counts only time on screen, so a rescue to the live route is inside it)
 * says that instead, as a problem line `npm run diag` lists.
 *
 * Only for a film that was meant to: a restored tab's film, sitting paused on
 * purpose, says nothing. And a film you paused yourself in that time has made
 * its own decision, which is not a failure to start.
 */
export function useFilmAutostart(
  ref: RefObject<HTMLVideoElement | null>,
  o: {
    path: string
    url: string
    /** Has a picture to show and is watched here (not the phone). */
    film: boolean
    route: 'direct' | 'live'
  }
): void {
  const { path, url, film, route } = o
  // The route can change under the watch (a rescue); the line says the last.
  const routeNow = useRef(route)
  useEffect(() => {
    routeNow.current = route
  }, [route])
  useEffect(() => {
    const el = ref.current
    if (!el || !film || !wasPlaying(url)) return
    const t0 = performance.now()
    let watched = 0
    let said = false
    const say = (started: boolean, extra: Record<string, unknown> = {}): void => {
      said = true
      stop()
      filmLine(
        'autostart',
        path,
        { started, route: routeNow.current, ms: Math.round(performance.now() - t0), ...extra },
        started
      )
    }
    const onPlaying = (): void => {
      if (!said) say(true)
    }
    const stop = (): void => {
      window.clearInterval(timer)
      el.removeEventListener('playing', onPlaying)
    }
    const timer = window.setInterval(() => {
      if (ownDocument(el).hidden || !el.checkVisibility({ visibilityProperty: true })) return
      watched += TICK_MS
      const check = autostartCheck({ paused: el.paused, held: heldPaused(url), elapsedMs: watched })
      if (check === 'held') stop()
      else if (check === 'started') say(true)
      else if (check === 'failed') say(false, { ready: el.readyState, net: el.networkState })
    }, TICK_MS)
    el.addEventListener('playing', onPlaying)
    // Already running: a direct start can beat the probe that sets `film`.
    if (!el.paused) say(true)
    return stop
  }, [ref, path, url, film])
}
