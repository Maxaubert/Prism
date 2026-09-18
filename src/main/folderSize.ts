import { lstat, opendir, realpath } from 'fs/promises'
import { isAbsolute, join, resolve, sep } from 'path'
import type { FolderSizeResult } from '@shared/folderSize'

interface FolderSizeLimits {
  maxEntries?: number
  maxMs?: number
}

// One streamed filesystem operation per scan, at most two scans application-wide.
let running = 0
const waiting = new Set<() => void>()

async function acquire(signal: AbortSignal): Promise<boolean> {
  while (!signal.aborted && running >= 2) {
    await new Promise<void>((resolveWait) => {
      const wake = (): void => {
        waiting.delete(wake)
        signal.removeEventListener('abort', wake)
        resolveWait()
      }
      waiting.add(wake)
      signal.addEventListener('abort', wake, { once: true })
    })
  }
  if (signal.aborted) return false
  running++
  return true
}

function comparable(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** Never follows directory links, caches results, or grants filesystem access.
 * The caller must authorize the root. Limits bound work, not an individual OS
 * request: a slow disk operation finishes before cancellation can release it. */
export async function folderSize(
  path: string,
  signal: AbortSignal,
  limits: FolderSizeLimits = {}
): Promise<FolderSizeResult | null> {
  if (!isAbsolute(path) || !(await acquire(signal))) return null
  const result: FolderSizeResult = {
    bytes: 0,
    files: 0,
    folders: 0,
    unreadable: 0,
    skippedLinks: 0,
    truncated: false
  }
  const { maxEntries = 250000, maxMs = 30000 } = limits
  const started = Date.now()
  let scanned = 0
  const stopped = (): boolean => {
    if (signal.aborted) return true
    if (scanned >= maxEntries || Date.now() - started >= maxMs) {
      result.truncated = true
      return true
    }
    return false
  }
  try {
    const rootPath = resolve(path)
    const rootInfo = await lstat(rootPath)
    if (signal.aborted) return null
    if (rootInfo.isSymbolicLink()) {
      result.skippedLinks++
      return result
    }
    if (!rootInfo.isDirectory()) return null
    const root = comparable(await realpath(rootPath))
    const prefix = root.endsWith(sep) ? root : root + sep
    const seen = new Set<string>()
    const queue = [rootPath]
    let next = 0
    while (next < queue.length && !stopped()) {
      const dir = queue[next++]
      try {
        // Recheck queued directories in case a folder became a junction.
        const info = await lstat(dir)
        if (signal.aborted) break
        if (info.isSymbolicLink()) {
          result.skippedLinks++
          continue
        }
        const canonical = comparable(await realpath(dir))
        if (stopped()) break
        if ((canonical !== root && !canonical.startsWith(prefix)) || seen.has(canonical)) {
          result.skippedLinks++
          continue
        }
        seen.add(canonical)
        const handle = await opendir(dir)
        for await (const entry of handle) {
          if (stopped()) break
          scanned++
          if (entry.isSymbolicLink()) {
            result.skippedLinks++
            continue
          }
          const child = join(dir, entry.name)
          try {
            // lstat also catches a file changed into a link after enumeration.
            const childInfo = await lstat(child)
            if (signal.aborted) break
            if (childInfo.isSymbolicLink()) result.skippedLinks++
            else if (childInfo.isDirectory()) {
              result.folders++
              queue.push(child)
            } else if (childInfo.isFile()) {
              result.bytes += childInfo.size
              result.files++
            }
          } catch {
            result.unreadable++
          }
        }
      } catch {
        if (dir === rootPath) return null
        result.unreadable++
      }
    }
    return signal.aborted ? null : result
  } catch {
    return null
  } finally {
    running--
    for (const wake of [...waiting]) wake()
  }
}
