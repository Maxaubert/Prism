import { useLayoutEffect, useRef, type RefObject } from 'react'
import { pauseQuietly, wasPlaying } from '../lib/playState'

/**
 * A FILM BEHIND A SHUT PREVIEW STAYS SHUT (owner, 2026-11-09: "if i close the
 * preview it pasuses then it plays jsut the aduio"). The player behind the
 * Explorer's list is kept mounted, or is mounted fresh when the preview
 * window goes, and nothing about that may make a sound: a pause landed before
 * the film started (its autoplay still pending, so there was nothing to
 * pause), or a start that came later, used to carry on with no picture. So
 * while the film is shut: paused now, and paused again if anything starts it.
 * When it comes back it starts if it is meant to (a pick, the pane opening),
 * and a film you paused yourself has no such intent (`wasPlaying`).
 */
export function useShutFilm(ref: RefObject<HTMLVideoElement | null>, shut: boolean, url: string): void {
  const wasShut = useRef(shut)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!shut) {
      if (wasShut.current && el.paused && wasPlaying(url)) void el.play().catch(() => undefined)
      wasShut.current = false
      return
    }
    wasShut.current = true
    pauseQuietly(el)
    const hold = (): void => pauseQuietly(el)
    el.addEventListener('play', hold)
    el.addEventListener('playing', hold)
    return () => {
      el.removeEventListener('play', hold)
      el.removeEventListener('playing', hold)
    }
  }, [ref, shut, url])
}
