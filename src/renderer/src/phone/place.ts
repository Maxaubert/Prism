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
 * THERE IS NO ROOT ANY MORE (2026-10-14): the phone browses the whole PC
 * like the Explorer, so a place is any local path, and This PC (`THIS_PC`,
 * '') is the top. A bare URL means "where the PC says this phone left off"
 * (`/api/me`'s `here`), which is what a fresh visit wants. Anything in the
 * URL that is not a local path is dropped rather than refused, and a folder
 * that has gone says so on its own screen.
 */
import { THIS_PC, isLocalPath, parentOf } from './browse'

/** The folder to list, and the file to open in it (null while browsing). */
export type Place = { dir: string; file: string | null }

const DIR = 'at'
const FILE = 'open'

/** The place the URL holds, or `here` (where the PC says this phone was,
 *  null for This PC) when it holds none. */
export function readPlace(search: string, here: string | null): Place {
  const q = new URLSearchParams(search)
  const file = q.get(FILE)
  if (file && isLocalPath(file)) return { dir: parentOf(file) ?? THIS_PC, file }
  const dir = q.get(DIR)
  if (dir && isLocalPath(dir)) return { dir, file: null }
  return { dir: here && isLocalPath(here) ? here : THIS_PC, file: null }
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
 * This PC with nothing open writes no query at all, so the address stays the
 * bare one the QR handed over, and the pairing code stays spent.
 */
export function placeUrl(place: Place): string {
  const q = new URLSearchParams()
  if (place.file) q.set(FILE, place.file)
  else if (place.dir !== THIS_PC) q.set(DIR, place.dir)
  const s = q.toString()
  return s ? `/?${s}` : '/'
}
