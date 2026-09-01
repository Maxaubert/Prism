/**
 * When the open text file is rewritten by something that is not Prism
 * (2026-08-31).
 *
 * The folder watcher landed first and only refreshed the TREE, so an agent in
 * Prism's own terminal could rewrite the file you had open and the editor
 * would go on showing a frozen copy - whose `saved.current.text` was now a
 * lie, so one Ctrl+S wrote the stale version back over the agent's work. That
 * is the bug this exists to close.
 *
 * The signal is weaker than it looks. `DirChange` carries `{ root, dirs }`
 * and never a file name, and Prism's OWN save produces one too: `ownWrite`
 * mutes the directory, but `flush` DEFERS a muted directory rather than
 * dropping it, so the event arrives a second and a half later regardless. So
 * "the folder changed" can never mean "someone else changed my file". The
 * only honest test is the file's own stamp, which is why `stampChanged` is
 * the correctness condition and not an optimisation.
 *
 * Pure: the decision is here, the reading and the dispatching are not.
 */

export interface Stamp {
  mtimeMs: number
  size: number
}

/** The folder part of a Windows or POSIX path, lowercased for comparison. */
function dirKey(path: string): string {
  const at = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return (at < 0 ? path : path.slice(0, at)).toLowerCase()
}

/**
 * Could this watcher event be about the file at `path`?
 *
 * `dirs` are directories, never file names, and a nameless Windows event
 * reports the root itself - so the root counts as a hit for anything under
 * it. Compared case-insensitively: these paths are the watcher's casing
 * joined with whatever ReadDirectoryChangesW reported, not the app's.
 */
export function touchesFile(path: string, change: { root: string; dirs: readonly string[] }): boolean {
  if (!path) return false
  const own = dirKey(path)
  const root = change.root.toLowerCase()
  if (own === root || own.startsWith(`${root}\\`) || own.startsWith(`${root}/`)) {
    if (change.dirs.some((d) => d.toLowerCase() === root)) return true
  }
  return change.dirs.some((d) => d.toLowerCase() === own)
}

/** Has the file actually moved on disk since we last looked? */
export function stampChanged(before: Stamp | null, after: Stamp | null): boolean {
  // A file that has momentarily vanished (a git checkout, an agent writing by
  // rename-into-place) is not a change to act on: it is a change to wait out.
  // Acting on it would mean reading nothing and calling that the new contents.
  if (!after) return false
  if (!before) return false
  return before.mtimeMs !== after.mtimeMs || before.size !== after.size
}

export type ReloadAction = 'ignore' | 'swap' | 'ask'

/**
 * What to do about a file that has changed underneath the editor.
 *
 * Clean means the editor is showing exactly what was on disk, so taking the
 * new version costs nothing and asking would be noise. Dirty is a genuine
 * fork with no third answer: Prism has no diff and no merge, so it is keep
 * mine or take theirs, and only the user can pick.
 *
 * `asking` is the loop guard. An agent in a build loop rewrites the file
 * every quiet window, and a dialog that re-raises itself every second is
 * worse than the frozen copy it replaced: one outstanding question per file.
 */
export function reloadAction(opts: {
  changed: boolean
  dirty: boolean
  asking: boolean
  /** Fullscreen renders dialogs outside the fullscreen element, where nobody
   *  can see them. A silent swap of a clean file is a read and stays allowed;
   *  the question waits for the way out. */
  fullscreen: boolean
}): ReloadAction {
  if (!opts.changed) return 'ignore'
  if (!opts.dirty) return 'swap'
  if (opts.asking || opts.fullscreen) return 'ignore'
  return 'ask'
}
