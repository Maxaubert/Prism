/**
 * WHEN A DRAG IS IN FLIGHT OVER THIS WINDOW (the tab strip stops being a
 * title-bar drag area while one is). It starts on dragstart or dragenter and
 * ends on dragend or drop. A drag that comes from OUTSIDE (Windows Explorer)
 * and leaves, or is cancelled with Esc, fires neither of those here, because
 * dragend fires only on the source: so it also ends when the drag leaves the
 * window (a dragleave that goes to no element), as the window's own drop ring
 * does (audit #45). Returns the remover.
 */
const CAP = { capture: true }

export function watchDragInFlight(
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  on: () => void,
  off: () => void
): () => void {
  const left = (e: Event): void => {
    if (!(e as DragEvent).relatedTarget) off()
  }
  const starts = ['dragstart', 'dragenter']
  const ends = ['dragend', 'drop']
  for (const t of starts) win.addEventListener(t, on, CAP)
  for (const t of ends) win.addEventListener(t, off, CAP)
  win.addEventListener('dragleave', left, CAP)
  return () => {
    for (const t of starts) win.removeEventListener(t, on, CAP)
    for (const t of ends) win.removeEventListener(t, off, CAP)
    win.removeEventListener('dragleave', left, CAP)
  }
}
