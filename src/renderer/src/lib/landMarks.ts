/**
 * WHAT AN ACTION MAKES IS MARKED, EXPLORER'S WAY (#101). A paste, a dropped
 * move or copy, Extract here (the folder it makes), Duplicate, and whatever an
 * undo puts back or a redo makes again: the rows that landed are marked in
 * the Explorer's list, the first under the cursor, and scrolled into view.
 * QUIET (#263): marking previews and plays nothing.
 *
 * One channel. Whoever made the files calls `markLanded` with their paths;
 * the list showing their folder applies it once the listing has every one of
 * them (a disk watcher or a re-list brings them a beat later), or, past
 * `LAND_MARK_MS`, marks what did arrive and lets the rest go. A newer request
 * replaces an older one. Module state, the same shape as the jobs store.
 */
import { parentDir, pathKey } from '@shared/path'
import { createStore } from './store'

export interface LandRequest {
  seq: number
  /** The folder the paths landed in: the first path's. */
  dir: string
  paths: string[]
  /** When it was asked, for the deadline. */
  at: number
}

/** How long a request waits for its rows before it marks what it has. */
export const LAND_MARK_MS = 8000

const store = createStore<LandRequest | null>(null)
let seq = 0

/** Mark these in the list showing their folder. Paths outside the first
 *  one's folder are left out: the list shows one folder at a time. */
export function markLanded(paths: readonly string[]): void {
  const list = paths.filter(Boolean)
  if (!list.length) return
  const dir = parentDir(list[0])
  const here = list.filter((p) => pathKey(parentDir(p)) === pathKey(dir))
  seq += 1
  store.set({ seq, dir, paths: here, at: Date.now() })
}

/** The request now, or null. */
export const landRequest = store.get
/** The hook: the list renders again when a request comes or goes. */
export const useLandRequest = store.use

/** The request is done (or, with no seq, every request is). */
export function clearLanded(done?: number): void {
  const now = store.get()
  if (!now || (done !== undefined && now.seq !== done)) return
  store.set(null)
}

export type LandingPlan =
  | { apply: true; select: string[]; primary: string }
  /** `expired`: nothing arrived in time, so the request should go. */
  | { apply: false; expired: boolean }

/**
 * What the list showing `directory` does with `req` (pure). `listed` says
 * whether a path has its REAL row (a paste's progress row does not count).
 */
export function planLanding(
  req: LandRequest,
  directory: string,
  listed: (path: string) => boolean,
  now: number
): LandingPlan {
  const late = now - req.at >= LAND_MARK_MS
  // Another folder on screen: not this list's, and gone once it is late, so
  // a later walk into the folder marks nothing out of the blue.
  if (pathKey(directory) !== pathKey(req.dir)) return { apply: false, expired: late }
  const there = req.paths.filter(listed)
  if (there.length < req.paths.length && !late) return { apply: false, expired: false }
  if (!there.length) return { apply: false, expired: true }
  return { apply: true, select: there, primary: there[0] }
}
