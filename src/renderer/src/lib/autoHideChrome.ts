import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the chrome stays up after the last thing that happened. */
export const CHROME_IDLE = 2600
/** How long it takes to fade out. Kept here rather than in the CSS so the
 *  clock and the transition cannot disagree about when it is gone. */
export const CHROME_FADE = 160

/**
 * Viewer chrome that gets out of the way, and comes back on movement.
 *
 * THIS IS THE VIDEO TRANSPORT'S RULE, extracted so there is one of it. It cost
 * three days of wrong guesses (2026-08-25) and every line of it is load-bearing:
 *
 * HIDING IS A CLOCK, not a cancellable timer. A timer only has to miss one
 * reset to leave the chrome up for ever, and one sticky flag - a menu that
 * closed without saying so, a pointer that entered the bar and never left
 * because the bar unmounted under it - was enough to do exactly that. The clock
 * asks what is TRUE at the moment it fires, so nothing can be left stuck on.
 *
 * ACTIVITY IS HEARD ON THE WINDOW, in the capture phase. Not on the chrome
 * itself: `mouseleave` fires when an element is REMOVED under the pointer,
 * which wakes it the instant it hides. And not with a root-level
 * `onMouseMove`, because Chromium fires `mousemove` on layout change under a
 * STATIONARY cursor, which is another way it wakes itself for ever.
 *
 * `pinned` is asked of the DOM rather than tracked as state, for the same
 * reason: reaching for a control and pausing your hand should not make the
 * thing you are reaching for disappear, and a hover flag that failed to clear
 * is one of the three ways this broke.
 *
 * IT FADES, AND IT STILL UNMOUNTS (2026-09-02). Snapping out was abrupt, but
 * "do not reintroduce an opacity fade in place" is the rule that keeps the
 * fullscreen bug fixed: a layer taken to zero opacity inside a fullscreen
 * element is composited once and never repainted, which is how the controls
 * came up on entering fullscreen and never again. So the fade is a PHASE, not
 * a resting state - `leaving` runs the transition, and the SAME CLOCK takes the
 * element out afterwards. Nothing here is driven by a one-shot timeout or by a
 * transitionend that a backgrounded tab may never deliver, so there is no way
 * to be left mounted and invisible.
 */
export function useAutoHideChrome(
  pinned: () => boolean,
  idle = CHROME_IDLE
): { shown: boolean; leaving: boolean; wake: () => void } {
  const [shown, setShown] = useState(true)
  const [leaving, setLeaving] = useState(false)
  // Zero until the first effect: reading the clock during render is impure.
  const lastWake = useRef(0)
  /** When the fade started, so the clock knows when it is over. */
  const leftAt = useRef(0)
  // Held in a ref so the interval never has to be torn down and rebuilt, which
  // would restart the countdown on every render. Written in an effect rather
  // than during render: a ref touched while rendering is a lint error here, and
  // a tick 60ms away cannot outrun the effect that follows the paint.
  const isPinned = useRef(pinned)
  useEffect(() => {
    isPinned.current = pinned
  }, [pinned])

  const wake = useCallback(() => {
    lastWake.current = Date.now()
    // A wake DURING the fade reverses it: the element is still mounted, so it
    // simply transitions back to opaque rather than flickering out and in.
    setLeaving(false)
    setShown(true)
  }, [])

  useEffect(() => {
    lastWake.current = Date.now()
    // 60ms rather than 250: the fade's end has to be noticed within a frame or
    // two of it finishing, or the element lingers invisible for longer than it
    // took to fade.
    const t = window.setInterval(() => {
      const now = Date.now()
      if (leftAt.current) {
        if (now - leftAt.current >= CHROME_FADE) {
          leftAt.current = 0
          setShown(false)
          setLeaving(false)
        }
        return
      }
      if (now - lastWake.current < idle) return
      if (isPinned.current()) return
      leftAt.current = now
      setLeaving(true)
    }, 60)
    return () => window.clearInterval(t)
  }, [idle])

  // A wake mid-fade has to clear the pending removal too, or the clock takes
  // the element away under a pointer that just asked for it.
  useEffect(() => {
    if (!leaving) leftAt.current = 0
  }, [leaving])

  useEffect(() => {
    const on = (): void => wake()
    window.addEventListener('pointermove', on, { capture: true, passive: true })
    window.addEventListener('keydown', on, true)
    // Entering or leaving fullscreen relays out the whole stage, and the chrome
    // has to be visible on the other side of it.
    document.addEventListener('fullscreenchange', on)
    return () => {
      window.removeEventListener('pointermove', on, true)
      window.removeEventListener('keydown', on, true)
      document.removeEventListener('fullscreenchange', on)
    }
  }, [wake])

  return { shown, leaving, wake }
}

/**
 * The classes that animate it, both ways.
 *
 * The entrance is a KEYFRAME rather than a transition, because a transition
 * needs a previous value and this element has just been mounted - there is
 * nothing to transition from. The exit is a transition, because by then there
 * is. Opacity only: the bars are centred with `-translate-x-1/2`, and animating
 * `transform` would fight it.
 */
export const chromeClass = (leaving: boolean): string =>
  leaving
    ? 'opacity-0 transition-opacity duration-150 ease-in'
    : 'p-chrome-in transition-opacity duration-150'
