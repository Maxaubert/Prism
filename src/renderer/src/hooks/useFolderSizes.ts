import { useEffect, useMemo, useState } from 'react'
import type { FolderSizes } from '../lib/folderSize'

/** Each listing owns its scan. Refreshing or leaving it cancels outstanding work. */
export function useFolderSizes(paths: string[], enabled = true): FolderSizes {
  const scanKey = useMemo(() => ({ paths, enabled }), [paths, enabled])
  const [state, setState] = useState<{ key: typeof scanKey; sizes: FolderSizes }>(() => ({
    key: scanKey,
    sizes: {}
  }))
  useEffect(() => {
    let alive = true
    const pending = new Set<string>()
    let next = 0
    if (!enabled) return
    const scan = async (): Promise<void> => {
      while (alive && next < paths.length) {
        const path = paths[next++]
        const id = crypto.randomUUID()
        pending.add(id)
        const result = await window.prism.folderSize(path, id).catch(() => null)
        pending.delete(id)
        if (alive)
          setState((previous) => ({
            key: scanKey,
            sizes: { ...(previous.key === scanKey ? previous.sizes : {}), [path]: result }
          }))
      }
    }
    // Bound disk work even when a directory contains thousands of folders.
    void scan()
    void scan()
    return () => {
      alive = false
      for (const id of pending) window.prism.cancelFolderSize(id)
    }
  }, [paths, enabled, scanKey])
  return state.key === scanKey && enabled ? state.sizes : {}
}
