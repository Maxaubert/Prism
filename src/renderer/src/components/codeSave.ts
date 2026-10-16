// The editor's save, the two decisions it makes around its awaits (2026-10-16).
// Pure, so they can be held by a test; CodeView does the writing.

/**
 * Where Ctrl+S may write, or null.
 *
 * The view outlives the file: for the moment between a new `path` and its read
 * landing, the editor still holds the OLD file's text and `saved` still names
 * the old file. save() checked only that `saved` existed, so a Ctrl+S in that
 * moment wrote file A's text over file B. A save now needs the editor to be
 * showing this path AND the remembered disk text to be this path's, and it
 * writes to the path that text came from.
 */
export function saveTarget(
  path: string,
  loadedPath: string | null,
  saved: { path: string } | null
): string | null {
  if (!saved || loadedPath !== path || saved.path !== path) return null
  return saved.path
}

/** What a save that landed leaves behind. */
export type SaveLanding =
  /** Still on the saved file: report the buffer, null when it is clean. */
  | { here: true; buffer: string | null }
  /** The user moved on while it saved: clear App's held buffer for the saved
   *  file only when that buffer is exactly what was written. */
  | { here: false; clear: boolean }

/**
 * After the write and the stat, the editor may hold more typing, or another
 * file. It used to report "clean" regardless, through `pathRef`, which by then
 * could name file B: B's unsaved edits were dropped, and characters typed
 * during a slow save went untracked, so closing never asked about them.
 */
export function landSave(
  saved: string,
  current: string,
  written: string,
  doc: () => string,
  pending: () => string | undefined
): SaveLanding {
  if (current !== saved) return { here: false, clear: pending() === written }
  const now = doc()
  return { here: true, buffer: now === written ? null : now }
}
