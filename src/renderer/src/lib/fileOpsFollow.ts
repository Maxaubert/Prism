/**
 * Has the user moved on since a slow rename or delete began (2026-10-16)?
 *
 * `start` is the file on screen when it began, `now` the one on screen when it
 * finished. Nothing on screen now is NOT moving on: a delete steps every tab
 * off the file it bins first (`releaseFiles`), so the viewer is empty by
 * design. Another file is: re-opening the old one then yanked the viewer back
 * to it.
 */
export function movedOn(start: string | undefined, now: string | undefined): boolean {
  return now !== undefined && now !== start
}
