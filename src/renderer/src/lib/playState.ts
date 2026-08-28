/**
 * What a file was DOING when you last looked away - paused or not, and where it
 * had got to - for this session only (2026-08-26).
 *
 * Opening Settings, or any other tab, unmounts the viewer: a tab renders only
 * while it is the one in front. The player came back as a fresh `<video
 * autoplay>` at time 0, so a film you had deliberately paused started playing
 * again the moment you closed Settings, and a film you were watching restarted
 * from the beginning (2026-08-27). The persisted resume-position could not
 * cover it: that one is for films only, and only saves every few seconds, so
 * looking away in the first moments of anything lost your place entirely.
 *
 * Deliberately NOT persisted: a file opened fresh tomorrow should play, from
 * its own beginning if it is short, which is what opening a file means. This
 * only remembers what you were doing a moment ago.
 */
interface Mark {
  paused: boolean
  t: number
}

const marks = new Map<string, Mark>()

const mark = (key: string): Mark => {
  const m = marks.get(key) ?? { paused: false, t: 0 }
  marks.set(key, m)
  return m
}

export function rememberPaused(key: string, isPaused: boolean): void {
  if (!key) return
  mark(key).paused = isPaused
}

/** Was this file paused when its player last went away? */
export function wasPaused(key: string): boolean {
  return marks.get(key)?.paused ?? false
}

/**
 * Should this file start PLAYING when its element appears (2026-08-28, owner
 * decision)? Only if it was already playing a moment ago - a file Prism has
 * just opened waits for you to press play.
 *
 * The difference from `!wasPaused` is the file nobody has played yet: that one
 * has no mark at all, and used to fall through to "not paused, so autoplay".
 * Opening a folder of films, or restoring a window full of tabs, then started
 * every one of them at once.
 */
export function wasPlaying(key: string): boolean {
  const m = marks.get(key)
  return !!m && !m.paused
}

/** "Play this one when it arrives": the playlist's own intent, recorded for a
 *  file that has never been seen. */
export function intendToPlay(key: string): void {
  if (!key) return
  mark(key).paused = false
}

/** Where it had got to, whatever its length. */
export function rememberTime(key: string, t: number): void {
  if (!key || !Number.isFinite(t) || t < 0) return
  mark(key).t = t
}

/** 0 when this file has not been seen this session. */
export function sessionTime(key: string): number {
  return marks.get(key)?.t ?? 0
}

export function forgetPaused(key: string): void {
  marks.delete(key)
}
