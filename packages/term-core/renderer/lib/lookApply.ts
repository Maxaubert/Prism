/**
 * WHAT A LOOK CHANGE REALLY CHANGES, per session (perf review 2026-10-16).
 *
 * The panel restyles every shell whenever the Terminal settings change, the
 * host's style changes or its window colours do. That fires once per input
 * event while a colour picker or the see-through slider is dragged, and many
 * of those changes (an agent's working colour, the acrylic level) leave the
 * terminal's theme or its link ink exactly as they were. Each restyle used to
 * assign the theme (xterm recomputes its colours and redraws the screen) and
 * start every tab's link painting over: every decoration in 10,000 lines of
 * scrollback disposed and the backlog begun again, in every tab, per event.
 * Now only what differs is done, and the link repaints of one frame are one.
 */

/** What a session was last given. */
export interface LookSeen {
  theme?: string
  ink?: string
}

/** Whether `value` differs from what `seen` holds for `what`; `seen` then
 *  holds `value`. */
export function lookChanged(seen: LookSeen, what: keyof LookSeen, value: string): boolean {
  if (seen[what] === value) return false
  seen[what] = value
  return true
}

/** `fn` at most once per frame, however often the result is called within
 *  it. `frame` is requestAnimationFrame in the page. */
export function oncePerFrame(fn: () => void, frame: (cb: () => void) => unknown): () => void {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    frame(() => {
      queued = false
      fn()
    })
  }
}
