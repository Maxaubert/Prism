/**
 * Whether a file was PAUSED when you last looked away, for this session only
 * (2026-08-26).
 *
 * Opening Settings, or any other tab, unmounts the viewer - a tab renders only
 * while it is the one in front. The player came back as a fresh `<video
 * autoplay>`, so a film you had deliberately paused started playing again the
 * moment you closed Settings.
 *
 * Deliberately NOT persisted: a file opened fresh tomorrow should play, which
 * is what opening a file means. This only remembers what you were doing a
 * moment ago.
 */
const paused = new Set<string>()

export function rememberPaused(key: string, isPaused: boolean): void {
  if (!key) return
  if (isPaused) paused.add(key)
  else paused.delete(key)
}

/** Was this file paused when its player last went away? */
export function wasPaused(key: string): boolean {
  return paused.has(key)
}

export function forgetPaused(key: string): void {
  paused.delete(key)
}
