/**
 * WHERE THE PHONE IS, IN ITS OWN URL (2026-09-08, #107, owner: "when i
 * refresh a page it should reload me on that file, so if im in a subfolder and
 * reload i should be there, or a movie i should be on the movie").
 *
 * A phone reloads for reasons nobody chose: the tab is dropped in the
 * background, the Wi-Fi drops, the screen is locked long enough. Until this,
 * every one of those landed back at the paired root with nothing open, which
 * on a film four folders down is the whole walk again.
 *
 * ONE PLACE, NEVER TWO: either the folder being browsed (`at`) or the file
 * being viewed (`open`), and the folder of an open file is the one HOLDING it.
 * Writing both would put a folder in the URL that reading it back can never
 * use, which is how a URL starts lying about where you are.
 *
 * A PLACE BELONGS TO A ROOT, and the phone's root moves now that it can switch
 * tabs (#107) - so the place is checked against the root the phone is on NOW
 * and dropped when it is outside, back to the root rather than to an error.
 * The same fallback covers a file that has been deleted and a folder that has
 * been renamed: neither is a screen anybody wants to meet after a reload.
 */
import { insideRoot, parentOf, samePath } from './browse'

/** The folder to list, and the file to open in it (null while browsing). */
export type Place = { dir: string; file: string | null }

const DIR = 'at'
const FILE = 'open'

/** The place the URL holds, always valid for `root`. */
export function readPlace(search: string, root: string): Place {
  const q = new URLSearchParams(search)
  const file = q.get(FILE)
  if (file && insideRoot(root, file)) return { dir: parentOf(root, file) ?? root, file }
  const dir = q.get(DIR)
  if (dir && insideRoot(root, dir)) return { dir, file: null }
  return { dir: root, file: null }
}

/**
 * The URL for a place: what `history.replaceState` is given as the place
 * changes. REPLACE rather than push, deliberately. Pushing an entry per tap
 * turns walking into a folder and opening a file into a stack that the
 * phone's own back button pops one step at a time, so a mis-tap costs several
 * presses to undo and leaving the page takes as many again. What the owner
 * asked for is a RELOAD that lands where they were, and replaceState is
 * exactly that and nothing more.
 *
 * The root with nothing open writes no query at all, so the address stays the
 * bare one the QR handed over, and the pairing code stays spent.
 */
export function placeUrl(root: string, place: Place): string {
  const q = new URLSearchParams()
  if (place.file) q.set(FILE, place.file)
  else if (!samePath(place.dir, root)) q.set(DIR, place.dir)
  const s = q.toString()
  return s ? `/?${s}` : '/'
}
