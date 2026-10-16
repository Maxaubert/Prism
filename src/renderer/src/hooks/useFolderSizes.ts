import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderSizeResult } from '@shared/folderSize'
import type { FolderSizes } from '../lib/folderSize'

type FolderSizeApi = Pick<
  Window['prism'],
  'folderSize' | 'folderSizesCached' | 'onFolderSizeProgress' | 'cancelFolderSize'
>

// THE LAST SIZE SEEN, FOR THE WHOLE SESSION (owner, 2026-10-13: "fix some
// cache for the sizes so i dont see this calculating all the time"). A listing
// refresh, a revisit or a finished navigation builds a new viewport; it starts
// from what earlier ones learned and refreshes in place, so a folder measured
// once never reads "Calculating…" again.
const remembered = new Map<string, FolderSizeResult>()
const REMEMBERED_MAX = 5000

function remember(path: string, result: FolderSizeResult): void {
  remembered.delete(path)
  remembered.set(path, result)
  if (remembered.size > REMEMBERED_MAX) remembered.delete(remembered.keys().next().value!)
}

export function rememberedFolderSizes(paths: readonly string[]): FolderSizes {
  const sizes: FolderSizes = {}
  for (const path of paths) {
    const size = remembered.get(path)
    if (size) sizes[path] = size
  }
  return sizes
}

/** Tests only. */
export function forgetFolderSizes(): void {
  remembered.clear()
}

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
    // A failed answer never hides a size already known.
    if (result === null && remembered.has(path)) return
    if (result) remember(path, result)
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
  // Keyed by the folders, not the array: every refreshed listing hands in a
  // new array, and a new key used to cancel every request and start over.
  const pathsKey = paths.join('\n')
  const stablePaths = useMemo(() => (pathsKey ? pathsKey.split('\n') : []), [pathsKey])
  const scanKey = useMemo(() => ({ paths: stablePaths, enabled }), [stablePaths, enabled])
  const controller = useRef<ReturnType<typeof createVisibleFolderSizes> | null>(null)
  const [state, setState] = useState<{ key: typeof scanKey; sizes: FolderSizes }>(() => ({
    key: scanKey,
    sizes: {}
  }))
  useEffect(() => {
    if (!enabled) return
    const requests = createVisibleFolderSizes(stablePaths, window.prism, (updates) => {
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
  }, [stablePaths, enabled, scanKey])
  useEffect(() => {
    controller.current?.setVisible(visiblePaths)
  }, [visiblePaths, scanKey])
  const seeded = useMemo(() => rememberedFolderSizes(stablePaths), [stablePaths])
  // ONE object until something changes (review, 2026-10-16): a fresh one per
  // render made every Explorer render, a scroll's included, look like new
  // sizes, so FolderBrowser re-sorted the whole folder each time.
  const sizes = state.key === scanKey && enabled ? state.sizes : null
  return useMemo(() => (sizes ? { ...seeded, ...sizes } : seeded), [seeded, sizes])
}
