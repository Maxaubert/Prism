/**
 * Coming back to the page (2026-09-13, #118). A phone put down for a while
 * and picked up again used to show a player that would not go on until the
 * page was refreshed (owner: "usually fixes itself on site refresh"). What
 * WebKit does to a backgrounded media element and its MediaSource buffers
 * is not written anywhere Prism can read, so the rule does what the refresh
 * did, and only when the player is visibly the worse for it: after a LONG
 * absence, a player with an error, with no data ready, or that claims to be
 * playing while its clock stands still, is re-attached at its own position.
 * A short absence, or a player that is fine, is left alone - reattaching a
 * working stream is itself a hitch.
 *
 * `returnAction` is the pure decision; `watchReturn` is the wiring, which
 * takes a second look 1.5s after the return for the clock-standing-still
 * case, since that one cannot be read in the moment.
 */
export const LONG_HIDE_MS = 20_000
const CLOCK_CHECK_MS = 1500

export type ReturnAction = 'none' | 'reattach'

export interface PlayerState {
  /** How long the page was hidden. */
  hiddenMs: number
  /** `el.error` is set. */
  error: boolean
  /** `el.readyState`: below 2 there is nothing to show at the position. */
  readyState: number
  /** Not paused, and the clock did not move over the check. Unknown at the
   *  moment of return (`null`); decided by the second look. */
  stuck: boolean | null
}

export function returnAction(s: PlayerState): ReturnAction {
  if (s.hiddenMs < LONG_HIDE_MS) return 'none'
  if (s.error) return 'reattach'
  if (s.readyState < 2) return 'reattach'
  if (s.stuck === true) return 'reattach'
  return 'none'
}

/**
 * Watch the document's visibility on behalf of one player. `reattach` is
 * handed the position and whether it was playing; `log` gets one line per
 * return saying what was seen and what was done. Returns the detach.
 */
export function watchReturn(
  el: HTMLMediaElement,
  reattach: (t: number, wasPlaying: boolean) => void,
  log: (line: string) => void,
  doc: Document = document
): () => void {
  let hiddenAt: number | null = null
  let pending: number | null = null
  const describe = (s: PlayerState): string =>
    `hidden ${(s.hiddenMs / 1000).toFixed(0)}s error=${s.error} ready=${s.readyState} stuck=${s.stuck ?? '?'}`
  const act = (s: PlayerState): void => {
    const action = returnAction(s)
    log(`return ${describe(s)} -> ${action}`)
    if (action === 'reattach') reattach(el.currentTime, !el.paused)
  }
  const onChange = (): void => {
    if (doc.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      if (pending !== null) {
        window.clearTimeout(pending)
        pending = null
      }
      return
    }
    if (hiddenAt === null) return
    const hiddenMs = Date.now() - hiddenAt
    hiddenAt = null
    const now: PlayerState = { hiddenMs, error: !!el.error, readyState: el.readyState, stuck: null }
    if (returnAction(now) === 'reattach' || now.hiddenMs < LONG_HIDE_MS || el.paused) {
      act(now)
      return
    }
    // Playing, and looks fine: let the clock speak before believing it.
    const t0 = el.currentTime
    pending = window.setTimeout(() => {
      pending = null
      act({ ...now, error: !!el.error, readyState: el.readyState, stuck: !el.paused && el.currentTime === t0 })
    }, CLOCK_CHECK_MS)
  }
  doc.addEventListener('visibilitychange', onChange)
  return () => {
    doc.removeEventListener('visibilitychange', onChange)
    if (pending !== null) window.clearTimeout(pending)
  }
}
