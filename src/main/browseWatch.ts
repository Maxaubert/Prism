import { realpathSync, watch, type FSWatcher } from 'fs'
import type { DirChange } from '@shared/types'

interface BrowseWatch {
  path: string
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
  firstChange: number
}

const watches = new Map<string, BrowseWatch>()

export function closeBrowseWatch(tabId: string): void {
  const current = watches.get(tabId)
  if (!current) return
  watches.delete(tabId)
  if (current.timer) clearTimeout(current.timer)
  current.watcher.close()
}

/** Call only after checking the tab owns this exact directory. Watching a
 * drive root is deliberately nonrecursive, and nothing filters hidden files. */
export function setBrowseWatch(
  tabId: string,
  path: string,
  emit: (change: DirChange) => void,
  /** A place inside an archive (#300): watch the container's folder, hear
   *  only the container file (`only`, its name), and report the place. */
  inside?: { only: string; report: string }
): boolean {
  const key = inside ? `${path}\0${inside.report}` : path
  if (watches.get(tabId)?.path === key) return true
  closeBrowseWatch(tabId)
  try {
    // libuv's Windows watcher compares native long paths internally; passing
    // an 8.3 alias can trip its directory-prefix assertion on a file event.
    // Keep the requested path for ownership and renderer events only.
    const nativePath = realpathSync.native(path)
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
  for (const id of watches.keys()) closeBrowseWatch(id)
}
