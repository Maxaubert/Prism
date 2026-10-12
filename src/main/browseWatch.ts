import { realpath, watch, type FSWatcher } from 'fs'
import type { DirChange } from '@shared/types'

interface BrowseWatch {
  path: string
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
  firstChange: number
}

const watches = new Map<string, BrowseWatch>()

/** Each tab's newest watch ask (a global sequence, so a closed tab's stale ask
 *  never matches a fresh one): an ask still waiting on its native path must
 *  not land over a newer ask or a close. */
const turns = new Map<string, number>()
let turnSeq = 0

/** fs/promises has no realpath.native; the callback one is off main too. */
function nativeRealpath(path: string): Promise<string> {
  return new Promise((done, fail) => realpath.native(path, (err, out) => (err ? fail(err) : done(out))))
}

/** The tab's watcher, compared before and after a `browse:watch` call so its
 *  crumb is written only when a watcher was actually set up (#322). */
export function browseWatcherOf(tabId: string): FSWatcher | undefined {
  return watches.get(tabId)?.watcher
}

export function closeBrowseWatch(tabId: string): void {
  turns.delete(tabId)
  const current = watches.get(tabId)
  if (!current) return
  watches.delete(tabId)
  if (current.timer) clearTimeout(current.timer)
  current.watcher.close()
}

/** Call only after checking the tab owns this exact directory. Watching a
 * drive root is deliberately nonrecursive, and nothing filters hidden files. */
export async function setBrowseWatch(
  tabId: string,
  path: string,
  emit: (change: DirChange) => void,
  /** A place inside an archive (#300): watch the container's folder, hear
   *  only the container file (`only`, its name), and report the place. */
  inside?: { only: string; report: string }
): Promise<boolean> {
  const key = inside ? `${path}\0${inside.report}` : path
  if (watches.get(tabId)?.path === key) {
    turns.set(tabId, ++turnSeq) // this ask is the newest; an older one waiting stands down
    return true
  }
  closeBrowseWatch(tabId)
  const turn = ++turnSeq
  turns.set(tabId, turn)
  try {
    // libuv's Windows watcher compares native long paths internally; passing
    // an 8.3 alias can trip its directory-prefix assertion on a file event.
    // Keep the requested path for ownership and renderer events only. The
    // lookup is awaited (owner, 2026-10-12: main never waits on the disk).
    const nativePath = await nativeRealpath(path)
    if (turns.get(tabId) !== turn) return true // a newer ask or a close decides
    const watcher = watch(nativePath, { recursive: false, persistent: false }, (_event, name) => {
      if (inside && (!name || String(name).toLowerCase() !== inside.only.toLowerCase())) return
      const current = watches.get(tabId)
      if (!current || current.watcher !== watcher) return
      const now = Date.now()
      if (!current.firstChange) current.firstChange = now
      if (current.timer) clearTimeout(current.timer)
      // A continuously written file still updates the list at least once
      // a second. Ordinary bursts settle before the one refresh is emitted.
      const delay = Math.max(0, Math.min(200, 1000 - (now - current.firstChange)))
      current.timer = setTimeout(() => {
        current.timer = null
        current.firstChange = 0
        const at = inside ? inside.report : path
        if (watches.get(tabId) === current) emit({ root: at, dirs: [at] })
      }, delay)
    })
    const current: BrowseWatch = { path: key, watcher, timer: null, firstChange: 0 }
    watches.set(tabId, current)
    watcher.on('error', () => {
      if (watches.get(tabId) !== current) return
      closeBrowseWatch(tabId)
      const at = inside ? inside.report : path
      emit({ root: at, dirs: [at] })
    })
    return true
  } catch {
    return false
  }
}

export function closeAllBrowseWatches(): void {
  turns.clear()
  for (const id of watches.keys()) closeBrowseWatch(id)
}
