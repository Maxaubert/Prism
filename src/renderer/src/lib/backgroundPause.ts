/**
 * The rule behind "pause in background", as a pure decision (2026-08-26).
 *
 * Away means another window has the focus, OR Prism is minimised - PotPlayer's
 * "Pause playback when focus lost", which covers VLC's minimised case too,
 * since a minimised window has no focus either.
 *
 * The rule that matters is the second one: only resume what THIS paused. A
 * file you stopped by hand stays stopped when you come back, which is the
 * whole point of having stopped it.
 */

export interface WindowState {
  minimised: boolean
  focused: boolean
}

export function isAway(s: WindowState): boolean {
  return s.minimised || !s.focused
}

export type PauseAction = 'pause' | 'play' | 'none'

/**
 * What to do when the window state changes.
 *
 * `ours` is whether the last pause was this feature's doing; the answer says
 * what it becomes.
 */
export function decide(
  state: WindowState,
  media: { paused: boolean },
  ours: boolean
): { action: PauseAction; ours: boolean } {
  if (isAway(state)) {
    // Already stopped - by the user, or by us a moment ago. Leave it.
    if (media.paused) return { action: 'none', ours }
    return { action: 'pause', ours: true }
  }
  if (ours && media.paused) return { action: 'play', ours: false }
  return { action: 'none', ours: false }
}
