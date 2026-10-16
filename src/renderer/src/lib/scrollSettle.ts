/**
 * A SCROLL IS HANDED UP WHEN IT SETTLES (review, 2026-10-16). The Explorer's
 * list used to hand every native scroll event to the tab, which re-rendered
 * the whole App and re-sorted the folder per frame. The list keeps the live
 * position itself and hands it up here, once, after the scrolling stops.
 *
 * `owner` is whoever the position belongs to (the history entry's handler):
 * a scroll for a new owner first hands up the old one's last position, so
 * nothing is lost to a navigation in mid-scroll. Kept apart from React so
 * the timing is testable.
 */
export const SCROLL_SETTLE_MS = 150

export interface ScrollSettle {
  /** The list scrolled to `top`: hand it up once it has stayed there. */
  scrolled: (owner: unknown, top: number, commit: (top: number) => void) => void
  /** Hand up what is pending now (the list is going away). */
  flush: () => void
  /** Drop what is pending (it was handed up some other way). */
  cancel: () => void
}

export function createScrollSettle(
  delay = SCROLL_SETTLE_MS,
  timers: {
    set: (run: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  } = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
): ScrollSettle {
  let pending: { owner: unknown; top: number; commit: (top: number) => void } | null = null
  let timer: unknown = null
  const stop = (): void => {
    if (timer !== null) timers.clear(timer)
    timer = null
  }
  const flush = (): void => {
    stop()
    const was = pending
    pending = null
    was?.commit(was.top)
  }
  return {
    scrolled(owner, top, commit) {
      if (pending && pending.owner !== owner) flush()
      stop()
      pending = { owner, top, commit }
      timer = timers.set(flush, delay)
    },
    flush,
    cancel() {
      stop()
      pending = null
    }
  }
}
