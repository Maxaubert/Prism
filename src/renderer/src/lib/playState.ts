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
  /** Paused BY YOU (#491): not a film that reached its end, and not one the
   *  app paused itself when it took it off the screen. */
  held: boolean
}

const marks = new Map<string, Mark>()

const mark = (key: string): Mark => {
  const m = marks.get(key) ?? { paused: false, t: 0, held: false }
  marks.set(key, m)
  return m
}

/** `held` says the pause was yours; a pause the app made passes false. */
export function rememberPaused(key: string, isPaused: boolean, held = isPaused): void {
  if (!key) return
  const m = mark(key)
  m.paused = isPaused
  m.held = isPaused && held
}

/**
 * THE APP'S OWN PAUSE (#491). Leaving a film (the list coming back, the pane
 * shutting) pauses it, and the element's pause event cannot say who asked; a
 * pause made here is remembered as not yours, so the film still starts the
 * next time it is shown. A film that is already paused is left alone, or the
 * entry would still be here to mislabel a real pause later.
 */
const quietly = new WeakSet<HTMLMediaElement>()

export function pauseQuietly(el: HTMLMediaElement): void {
  if (el.paused) return
  quietly.add(el)
  el.pause()
}

/** Was the pause this element just reported the app's own? Reads it once. */
export function wasQuietPause(el: HTMLMediaElement | null): boolean {
  return !!el && quietly.delete(el)
}

/**
 * Did YOU pause this film (#491; owner, 2026-11-08)? A film shown by a step or
 * by the pane opening starts by itself unless this says otherwise. A film that
 * ended or that the app took off the screen is not held.
 */
export function heldPaused(key: string): boolean {
  return marks.get(key)?.held ?? false
}

/**
 * Should the playlist's next file start (2026-08-28, #491)? Yes if this one
 * was playing, or stopped without you stopping it: a film reaching its end
 * fires `pause` just before `ended`, and that pause used to read as yours, so
 * the next film in the playlist landed paused. A file nobody started has no
 * mark and does not hand anything on.
 */
export function carriesOn(key: string): boolean {
  const m = marks.get(key)
  return !!m && !m.held
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
 *  file that has never been seen. A player ALREADY holding the file hears it
 *  too (#139): picking the row of the film on screen, paused or finished, is
 *  the same intent, and there is no element about to appear to read it. */
export function intendToPlay(key: string): void {
  if (!key) return
  const m = mark(key)
  m.paused = false
  m.held = false
  for (const fn of intents.get(key) ?? []) fn()
}

const intents = new Map<string, Set<() => void>>()

/** Hear every pick of `key` while mounted. Returns the unsubscribe. */
export function whenIntended(key: string, fn: () => void): () => void {
  const set = intents.get(key) ?? new Set()
  set.add(fn)
  intents.set(key, set)
  return () => {
    set.delete(fn)
    if (!set.size) intents.delete(key)
  }
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

/** The whole mark, if there is one: what a torn-off tab carries to its new
 *  window (tab tear-off step 3), where `rememberTime`/`rememberPaused` put it
 *  back. Undefined for a file not seen this session. */
export function markOf(key: string): { t: number; paused: boolean } | undefined {
  const m = marks.get(key)
  return m ? { t: m.t, paused: m.paused } : undefined
}

export function forgetPaused(key: string): void {
  marks.delete(key)
}
