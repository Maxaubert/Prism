import { createStore } from './store'

let cutPaths: string[] = []
const cutSet = createStore<ReadonlySet<string>>(new Set())
let revision = 0
let pending: Promise<boolean> = Promise.resolve(false)

function mark(paths: string[]): void {
  cutPaths = paths
  cutSet.set(new Set(paths.map((path) => path.toLowerCase())))
}

/** A shared cut mark follows files between Explorer and project tabs. Main reads
 * the Windows copy/cut mode, falling back to matching marks for older clipboards. */
export function copyFilePaths(paths: string[], cut = false): Promise<boolean> {
  const request = ++revision
  pending = pending
    .catch(() => false)
    .then(async () => {
      const copied = await window.prism.copyFilesToClipboard(paths, cut)
      if (request === revision && copied) mark(cut ? [...paths] : [])
      return copied
    })
  return pending
}

export const fileClipboardReady = (): Promise<boolean> => pending.catch(() => false)
export const fileCutPaths = (): string[] => [...cutPaths]
export function clearFileCut(paths: string[]): void {
  if (paths.length === cutPaths.length && paths.every((path, index) => path === cutPaths[index])) {
    mark([])
  }
}

export const useFileCut = cutSet.use
