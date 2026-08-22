import { useEffect, useState } from 'react'

// The system's own icon for a file type, cached per extension: what Windows
// would draw for it in Explorer, which is the user's association (WinRAR,
// 7-Zip...). One IPC round-trip per extension per session; every row after
// that answers from the cache synchronously.

const cache = new Map<string, string | null>()
const waiting = new Map<string, Array<() => void>>()

const extOf = (path: string): string => /\.[^.\\/]+$/.exec(path)?.[0]?.toLowerCase() ?? ''

/** The association icon for `path`'s extension, or null while unknown.
 *  Pass null to opt out (renders nothing, fetches nothing). */
export function useSysIcon(path: string | null): string | null {
  const ext = path ? extOf(path) : ''
  // The value is always read from the cache at render time; this state is
  // only the wake-up call for an icon arriving asynchronously.
  const [, bump] = useState(0)
  useEffect(() => {
    if (!path || !ext || cache.has(ext)) return
    let live = true
    const wake = (): void => {
      if (live) bump((n) => n + 1)
    }
    // One fetch per extension even when a whole folder of zips mounts at once.
    const queue = waiting.get(ext)
    if (queue) {
      queue.push(wake)
    } else {
      waiting.set(ext, [wake])
      void window.prism.iconForExt(path).then((u) => {
        cache.set(ext, u)
        for (const cb of waiting.get(ext) ?? []) cb()
        waiting.delete(ext)
      })
    }
    return () => {
      live = false
    }
  }, [path, ext])
  return ext ? (cache.get(ext) ?? null) : null
}
