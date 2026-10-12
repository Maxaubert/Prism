import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * THE PREVIEW PANE SLIDES, AS THE PLACES PANEL DOES (#207; owner, 2026-09-23:
 * "the same way you made an animation for the sidebar in explorer, do the same
 * for the preview window").
 *
 * Harder than the places panel, because the pane's grid column only EXISTS
 * while it is open (a two-column grid cannot tween into a three-column one) and
 * the viewer is a separate box App lays over the slot. So a slide is phases:
 * - opening: the column appears at 0px once the file is on screen, and one
 *   frame later goes to its width with the transition on;
 * - closing: the pane stays laid out (`out`) while its width goes to 0, and
 *   only then leaves.
 * Only a toggle starts one: a tab switch, a drag of its edge or a resize lands
 * at once. Opening waits for the file (the pane shows only once it is loaded)
 * and gives up after 1.5s, so a toggle over a folder leaves nothing armed.
 */
type Phase = null | 'open-start' | 'open' | 'close'

export const PREVIEW_SLIDE_MS = 180

export interface PreviewSlide {
  /** Lay the pane out: open, or still sliding shut. */
  out: boolean
  /** Give the pane its width (false at the first frame of an opening). */
  widthShown: boolean
  /** The transition is on. */
  sliding: boolean
  /** Call as the toggle happens, with whether the pane is closing. */
  start: (closing: boolean) => void
}

export function usePreviewSlide(
  shown: boolean,
  box: RefObject<HTMLElement | null>
): PreviewSlide {
  const [phase, setPhase] = useState<Phase>(null)
  // The pane's contents keep their open width while it slides (the places
  // panel's rule), so a picture, a PDF or a film does not refit every frame.
  // Read while it stands still, into a variable the CSS uses mid-slide only.
  useLayoutEffect(() => {
    if (!shown || phase) return
    const width = box.current?.offsetWidth
    if (width) box.current?.style.setProperty('--browse-preview-frozen', `${width}px`)
  })
  const timer = useRef<number | undefined>(undefined)
  const endIn = useCallback((ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPhase(null), ms)
  }, [])
  const start = useCallback(
    (closing: boolean) => {
      setPhase(closing ? 'close' : 'open-start')
      endIn(closing ? PREVIEW_SLIDE_MS + 60 : 1500)
    },
    [endIn]
  )
  useEffect(() => {
    if (phase !== 'open-start' || !shown) return
    const frame = requestAnimationFrame(() => {
      setPhase('open')
      endIn(PREVIEW_SLIDE_MS + 60)
    })
    return () => cancelAnimationFrame(frame)
  }, [phase, shown, endIn])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    out: shown || phase === 'close',
    widthShown: shown && phase !== 'open-start',
    sliding: phase === 'open' || phase === 'close',
    start
  }
}
