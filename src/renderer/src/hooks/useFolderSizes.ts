import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderSizeResult } from '@shared/folderSize'
import type { FolderSizes } from '../lib/folderSize'

type FolderSizeApi = Pick<
  Window['prism'],
  'folderSize' | 'folderSizesCached' | 'onFolderSizeProgress' | 'cancelFolderSize'
>

/** A viewport owns requests, while completed values survive scrolling. Kept
 * separate from React so asynchronous cancellation and batching are testable. */
export function createVisibleFolderSizes(
  paths: readonly string[],
  api: FolderSizeApi,
  publish: (updates: FolderSizes) => void
): { setVisible: (paths: readonly string[]) => void; dispose: () => void } {
  const allowed = new Set(paths)
  const known: FolderSizes = {}
  const complete = new Set<string>()
  const pending = new Map<string, string>()
  let visible: string[] = []
  let alive = true
  let dirty: FolderSizes = {}
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = (path: string, result: FolderSizeResult | null): void => {
    known[path] = result
    dirty[path] = result
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      const updates = dirty
      dirty = {}
      if (alive) publish(updates)
    }, 16)
  }

  const pump = (): void => {
    if (!alive) return
    while (pending.size < 2) {
      const path = visible.find(
        (candidate) => !complete.has(candidate) && ![...pending.values()].includes(candidate)
      )
      if (!path) return
      const id = crypto.randomUUID()
      pending.set(id, path)
      void api
        .folderSize(path, id)
        .catch(() => null)
        .then((result) => {
          // A removed request may still finish after cancellation. Its result
          // cannot overwrite a new request when the row re-enters the viewport.
          if (!alive || pending.get(id) !== path) return
          pending.delete(id)
          complete.add(path)
          update(path, result)
          pump()
        })
    }
  }

  const unsubscribe = api.onFolderSizeProgress(({ requestId, result }) => {
    const path = pending.get(requestId)
    if (alive && path) update(path, result)
  })

  return {
    setVisible(next): void {
      if (!alive) return
      const before = new Set(visible)
      visible = [...new Set(next)].filter((path) => allowed.has(path))
      const current = new Set(visible)
      for (const [id, path] of pending) {
        if (current.has(path)) continue
        pending.delete(id)
        api.cancelFolderSize(id)
      }
      const entering = visible.filter((path) => !before.has(path) && !complete.has(path))
      if (entering.length) {
        void api
          .folderSizesCached(entering)
          .then((sizes) => {
            if (!alive) return
            for (const path of entering) {
              if (visible.includes(path) && known[path] === undefined && sizes[path]) {
                update(path, sizes[path])
              }
            }
          })
          .catch(() => {})
      }
      pump()
    },
    dispose(): void {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      for (const id of pending.keys()) api.cancelFolderSize(id)
      pending.clear()
    }
  }
}

/** The optional viewport defaults to the supplied paths for a single-folder
 * Properties view. Explorer supplies an explicit (possibly empty) viewport. */
export function useFolderSizes(
  paths: string[],
  enabled = true,
  visiblePaths: string[] = paths
): FolderSizes {
  const scanKey = useMemo(() => ({ paths, enabled }), [paths, enabled])
  const controller = useRef<ReturnType<typeof createVisibleFolderSizes> | null>(null)
  const [state, setState] = useState<{ key: typeof scanKey; sizes: FolderSizes }>(() => ({
    key: scanKey,
    sizes: {}
  }))
  useEffect(() => {
    if (!enabled) return
    const requests = createVisibleFolderSizes(paths, window.prism, (updates) => {
      setState((previous) => ({
        key: scanKey,
        sizes: { ...(previous.key === scanKey ? previous.sizes : {}), ...updates }
      }))
    })
    controller.current = requests
    return () => {
      requests.dispose()
      if (controller.current === requests) controller.current = null
    }
  }, [paths, enabled, scanKey])
  useEffect(() => {
    controller.current?.setVisible(visiblePaths)
  }, [visiblePaths, scanKey])
  return state.key === scanKey && enabled ? state.sizes : {}
}
