/**
 * Whether a remembered place is worth going back to (2026-09-13, #118).
 *
 * The rule is the players' own since 2026-08-24 and is only lifted out here
 * so it can be tested and shared: media longer than ten minutes reopens
 * where you left it, anything shorter never does (a five-second clip starts
 * at the start), and a place inside the last seconds counts as watched, so a
 * film never reopens into its own credits. Pure.
 */
export const RESUME_MIN_DURATION = 600 // seconds (10 minutes)
export const RESUME_END_PAD = 5 // neither resume nor save within this many seconds of the end
export const RESUME_SAVE_STEP = 5 // save at most once per this many seconds of movement

/** Where to seek on open, or null for "start at the start". */
export function resumeAt(stored: number | null | undefined, duration: number): number | null {
  if (stored === null || stored === undefined || !Number.isFinite(stored) || stored <= 0) return null
  if (!Number.isFinite(duration) || duration <= RESUME_MIN_DURATION) return null
  if (stored >= duration - RESUME_END_PAD) return null
  return stored
}

/** What to write for a position, or null for "forget it": short media is
 *  never written, and the last seconds clear what was there. `undefined`
 *  means write nothing at all this time. */
export function positionToSave(t: number, duration: number): number | null | undefined {
  if (!Number.isFinite(duration) || duration <= RESUME_MIN_DURATION) return undefined
  if (t > duration - RESUME_END_PAD) return null
  return Math.floor(t)
}
