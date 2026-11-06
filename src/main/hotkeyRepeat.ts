/**
 * IGNORE REPEAT PRESSES (owner, 2026-11-06; the audit: on Nov 5 four Win+E
 * presses during one slow start opened four windows, and loading them all at
 * once was part of the 626 ms lag that followed). While a hotkey request is
 * opening a window, and for `REPEAT_MS` after that window showed its folder,
 * another press for the same place brings THAT window forward instead of
 * opening another one. A press for a different folder (the folder verb) is
 * its own request.
 */
export const REPEAT_MS = 1000

/** The window a hotkey request opened last, and how far it has got. */
export interface HotkeyOpening {
  /** Its request id: the leader a repeat rides on. */
  id: string
  /** The folder it carries, or null for a plain Win+E. */
  browse: string | null
  /** When the helper was told its folder is on screen (ms), else null. */
  ackedAt: number | null
  /** Its window has gone. */
  closed: boolean
}

/**
 * What a new press does: `follow` the request still opening (answered when it
 * is), `raise` the window that has just shown (answered at once), or null to
 * open a window of its own.
 */
export function repeatOf(open: HotkeyOpening | null, browse: string | null, now: number): 'follow' | 'raise' | null {
  if (!open || open.closed) return null
  if ((open.browse ?? '').toLowerCase() !== (browse ?? '').toLowerCase()) return null
  if (open.ackedAt === null) return 'follow'
  return now - open.ackedAt <= REPEAT_MS ? 'raise' : null
}
