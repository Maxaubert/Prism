import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the chrome stays up after the last thing that happened. */
export const CHROME_IDLE = 2600

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
 * WHAT THE CALLER STILL OWES: the chrome must MOUNT AND UNMOUNT on `shown`, not
 * fade to `opacity: 0`. A layer taken to zero opacity inside a fullscreen
 * element is composited once and never repainted, which is how the controls
 * came up on entering fullscreen and never again.
 */
export function useAutoHideChrome(pinned: () => boolean, idle = CHROME_IDLE): {
  shown: boolean
  wake: () => void
} {
  const [shown, setShown] = useState(true)
  // Zero until the first effect: reading the clock during render is impure.
  const lastWake = useRef(0)
  // Held in a ref so the interval never has to be torn down and rebuilt, which
  // would restart the countdown on every render. Written in an effect rather
  // than during render: a ref touched while rendering is a lint error here, and
  // a tick 250ms away cannot outrun the effect that follows the paint.
  const isPinned = useRef(pinned)
  useEffect(() => {
    isPinned.current = pinned
  }, [pinned])

  const wake = useCallback(() => {
    lastWake.current = Date.now()
    setShown(true)
  }, [])

  useEffect(() => {
    lastWake.current = Date.now()
    const t = window.setInterval(() => {
      if (Date.now() - lastWake.current < idle) return
      if (isPinned.current()) return
      setShown(false)
    }, 250)
    return () => window.clearInterval(t)
  }, [idle])

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

  return { shown, wake }
}
