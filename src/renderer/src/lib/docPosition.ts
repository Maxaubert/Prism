/**
 * Where you had got to in a document.
 *
 * A 10-minute film reopens where you left it and a 400-page PDF did not,
 * which is backwards (2026-08-30): the film is the thing you can find your
 * place in by scrubbing, and the document is the one where losing it costs
 * you a hunt through 400 pages.
 *
 * Two stores, for the same reason lib/playState has two:
 *
 * SESSION. Leaving a tab unmounts the viewer, so coming back has to land
 * where you were even for a document you opened ten seconds ago. Kept in
 * memory, dies with the window, and WINS over the stored value.
 *
 * PERSISTED. Reopening the file tomorrow. Only for documents long enough to
 * be worth it: a one-screen README that reopens two lines down reads as a
 * bug, and there is nothing to be gained by remembering it. That threshold is
 * an explicit number here rather than a truthiness check, so it can be argued
 * with (see MIN_WORTH_SAVING).
 *
 * A position at the very end is CLEARED rather than saved, the same rule the
 * player's last-minute has: a document you read to the bottom should open at
 * the top next time, not at its own last line.
 */

const PREFIX = 'prism.docpos.'

/**
 * Below this there is nothing worth remembering.
 *
 * For a scroller it is pixels of scrollable overflow (about four screens on a
 * typical window); for a PDF, PAGES. Both are "long enough that finding your
 * place again is real work".
 */
export const MIN_WORTH_SAVING = 3000
export const MIN_PAGES_WORTH_SAVING = 5

/** How near the end counts as finished, in pixels or pages. */
const END_PAD = 40
const END_PAD_PAGES = 1

const session = new Map<string, number>()

const ok = (key: string, value: number): boolean =>
  !!key && Number.isFinite(value) && value >= 0

/** The session's position, which outranks anything on disk. 0 when unseen. */
export function sessionDocPos(key: string): number {
  return session.get(key) ?? 0
}

export function rememberDocPos(key: string, value: number): void {
  if (!ok(key, value)) return
  session.set(key, value)
}

export function forgetDocPos(key: string): void {
  session.delete(key)
}

/** What was saved last time, or 0. Garbage reads as 0 rather than throwing. */
export function storedDocPos(key: string): number {
  if (!key) return 0
  try {
    const raw = localStorage.getItem(PREFIX + key)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function clearDocPos(key: string): void {
  if (!key) return
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* private mode, or storage full: losing a position is not worth a throw */
  }
}

/**
 * Persist, if this document is long enough and you are not at the end of it.
 *
 * `total` is the scrollable height, or the page count. Passing 0 for it means
 * "not known yet", which is never worth saving against.
 */
export function saveDocPos(key: string, value: number, total: number, pages = false): void {
  if (!ok(key, value)) return
  const min = pages ? MIN_PAGES_WORTH_SAVING : MIN_WORTH_SAVING
  const pad = pages ? END_PAD_PAGES : END_PAD
  if (!Number.isFinite(total) || total < min) return
  if (value <= 0 || value >= total - pad) {
    clearDocPos(key)
    return
  }
  try {
    localStorage.setItem(PREFIX + key, String(Math.round(value)))
  } catch {
    /* storage full: the position is a convenience, not the work */
  }
}

/** Where to open this document: the session first, then what was saved. */
export function openDocAt(key: string): number {
  return sessionDocPos(key) || storedDocPos(key)
}
