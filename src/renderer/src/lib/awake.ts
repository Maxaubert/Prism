/**
 * Who is playing, so the screen can be kept awake while anyone is.
 *
 * A film is the one thing a computer does that involves no input for two
 * hours, so Windows dims and locks the screen in the middle of it. Main holds
 * the actual power-save block; this decides WHEN, and it has to count rather
 * than toggle, because the media deck keeps up to four players mounted at once
 * (2026-08-27) and a background tab pausing must not unblock the film you are
 * watching in front of it.
 *
 * Pure except for the one send, which is injected so it can be tested.
 */

const playing = new Set<string>()
let last: boolean | null = null

type Send = (on: boolean) => void

let send: Send = (on) => window.prism?.setAwake?.(on)

/** Tests replace the sink; nothing else should. */
export function _setAwakeSink(fn: Send): void {
  send = fn
  last = null
}

/** Report one player's state. Main hears only about CHANGES to the answer. */
export function reportPlaying(key: string, isPlaying: boolean): void {
  if (!key) return
  if (isPlaying) playing.add(key)
  else playing.delete(key)
  const want = playing.size > 0
  if (want === last) return
  last = want
  send(want)
}

/** A player going away is a player that is not playing. */
export function forgetPlayer(key: string): void {
  reportPlaying(key, false)
}

/** Test seam: how many players currently claim to be playing. */
export function _playingCount(): number {
  return playing.size
}

export function _reset(): void {
  playing.clear()
  last = null
}
