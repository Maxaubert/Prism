import { useEffect, useRef, type RefObject } from 'react'
import { onOverlayScrollbar } from '../lib/overlayScroll'
import { listenOn, ownWindow, viewerWindows, type OwnWindow } from '../lib/ownWindow'

/**
 * Binds a popover's way out on the windows it can be dismissed from (audit #43): its OWN window (the preview
 * window draws the viewer into another document, whose keys and presses never reach this page's `window`) and
 * this page's. The window losing focus is its own window's alone. Returns the undo.
 */
export function bindDismiss(
  box: RefObject<HTMLElement | null>,
  shut: () => void,
  onEscape: () => void,
  resize: boolean
): () => void {
  const own: OwnWindow = ownWindow(box.current)
  const wins = viewerWindows(own)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onEscape()
  }
  const onDown = (e: PointerEvent): void => {
    // A press on the overlay scrollbar is the popover's own scrolling.
    if (!box.current?.contains(e.target as Node) && !onOverlayScrollbar(e.target)) shut()
  }
  const undo = [
    listenOn(wins, 'keydown', onKey, true),
    listenOn(wins, 'pointerdown', onDown, true),
    listenOn([own], 'blur', shut),
    ...(resize ? [listenOn([own], 'resize', shut)] : [])
  ]
  return () => undo.forEach((u) => u())
}
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
    return bindDismiss(box, shut, () => (latest.current.opts.onEscape ?? shut)(), resize)
  }, [open, box, resize])
}
