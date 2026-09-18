import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderSizes } from '../lib/folderSize'

/** Requests follow listing order, so visible rows are warmed first. The main
 * process shares cached values and calculations with Properties and other tabs. */
export function useFolderSizes(
  paths: string[],
  enabled = true,
  priorityPaths: string[] = []
): FolderSizes {
  const priority = useRef(priorityPaths)
  useEffect(() => {
    priority.current = priorityPaths
  }, [priorityPaths])
  const scanKey = useMemo(() => ({ paths, enabled }), [paths, enabled])
  const [state, setState] = useState<{ key: typeof scanKey; sizes: FolderSizes }>(() => ({
    key: scanKey,
    sizes: {}
  }))
  useEffect(() => {
    let alive = true
    const pending = new Map<string, string>()
    const remaining = new Set(paths)
    if (!enabled) return
    const update = (path: string, result: FolderSizes[string]): void => {
      if (alive)
        setState((previous) => ({
          key: scanKey,
          sizes: { ...(previous.key === scanKey ? previous.sizes : {}), [path]: result }
        }))
    }
    const unsubscribe = window.prism.onFolderSizeProgress(({ requestId, result }) => {
      const path = pending.get(requestId)
      if (path) update(path, result)
    })
    void window.prism
      .folderSizesCached(paths)
      .then((sizes) => {
        if (!alive) return
        setState((previous) => ({
          key: scanKey,
          sizes: { ...sizes, ...(previous.key === scanKey ? previous.sizes : {}) }
        }))
      })
      .catch(() => {})
    const scan = async (): Promise<void> => {
      while (alive && remaining.size) {
        const path =
          priority.current.find((candidate) => remaining.has(candidate)) ??
          remaining.values().next().value!
        remaining.delete(path)
        const id = crypto.randomUUID()
        pending.set(id, path)
        const result = await window.prism.folderSize(path, id).catch(() => null)
        pending.delete(id)
        update(path, result)
      }
    }
    // Bound disk work even when a directory contains thousands of folders.
    void scan()
    void scan()
    return () => {
      alive = false
      unsubscribe()
      for (const id of pending.keys()) window.prism.cancelFolderSize(id)
    }
  }, [paths, enabled, scanKey])
  return state.key === scanKey && enabled ? state.sizes : {}
}
