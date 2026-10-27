import { useEffect, useRef, type RefObject } from 'react'

/**
 * A popover's way out (PlayerMenu): while `open`, a press outside
 * `box`, the window losing focus, or Escape closes it. Capture phase, so the
 * press and the key land before whatever is under them; Escape is stopped
 * here, so the app does not also take it as "close the window".
 *
 * `onEscape` replaces the plain close on Escape (PlayerMenu climbs a level
 * first); `resize` also closes on a window resize, for a menu placed in
 * window coordinates. The callbacks are read from a ref, so an inline arrow
 * does not re-register the listeners on every render.
 */
export function useDismiss(
  open: boolean,
  box: RefObject<HTMLElement | null>,
  close: () => void,
  opts: { onEscape?: () => void; resize?: boolean } = {}
): void {
  const latest = useRef({ close, opts })
  useEffect(() => {
    latest.current = { close, opts }
  })

  const resize = !!opts.resize
  useEffect(() => {
    if (!open) return
    const shut = (): void => latest.current.close()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      const escape = latest.current.opts.onEscape
      if (escape) escape()
      else shut()
    }
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) shut()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', shut)
    if (resize) window.addEventListener('resize', shut)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', shut)
      if (resize) window.removeEventListener('resize', shut)
    }
  }, [open, box, resize])
}
