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
 * the Windows copy/cut mode, falling back to matching marks for older clipboards.
 *
 * EVERY COPY GOES TO MAIN AT ONCE (#484). Main answers as soon as it has the
 * copy (Prism's own record; the Windows clipboard write runs behind it), so
 * nothing here waits on a PowerShell any more. They used to queue: a copy
 * waited for the write before it, and a paste for the last write, so one
 * write stuck 10 s held every copy and paste in the app. The newest copy's
 * answer sets the mark; an older one answering late changes nothing. */
export function copyFilePaths(paths: string[], cut = false): Promise<boolean> {
  const request = ++revision
  const answer = window.prism
    .copyFilesToClipboard(paths, cut)
    .catch(() => false)
    .then((copied) => {
      if (request === revision && copied) mark(cut ? [...paths] : [])
      return copied
    })
  pending = answer
  return answer
}

export const fileClipboardReady = (): Promise<boolean> => pending.catch(() => false)
export const fileCutPaths = (): string[] => [...cutPaths]
export function clearFileCut(paths: string[]): void {
  if (paths.length === cutPaths.length && paths.every((path, index) => path === cutPaths[index])) {
    mark([])
  }
}

export const useFileCut = cutSet.use
