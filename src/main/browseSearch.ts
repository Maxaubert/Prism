import { opendir, realpath, stat } from 'fs/promises'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'path'
import type { BrowseSearchProgress, BrowseSearchResult } from '@shared/browse'
import { fileKind } from '@shared/fileKind'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import { desktopClosed, grantDesktopDirectory, ownsDesktopDirectory } from './desktopAccess'

const searches = new Map<string, { requestId: string }>()

export function cancelBrowseSearch(tabId: string, requestId?: string): void {
  if (requestId === undefined || searches.get(tabId)?.requestId === requestId)
    searches.delete(tabId)
}

interface SearchLimits {
  maxEntries?: number
  maxHits?: number
  maxMs?: number
}

function comparable(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** The Explorer searches everything beneath its visited directory, including
 * AppData and unsupported files. It never changes phone roots, follows a link,
 * or grants whole subtrees. Only result parents become desktop locations. */
export async function browseSearch(
  tabId: string,
  path: string,
  query: string,
  requestId: string,
  emit: (progress: BrowseSearchProgress) => void = () => {},
  limits: SearchLimits = {}
): Promise<BrowseSearchResult> {
  const result: BrowseSearchResult = {
    path,
    listing: { folders: [], files: [] },
    scanned: 0,
    unreadable: 0,
    skippedLinks: 0,
    truncated: false,
    cancelled: false
  }
  if (
    typeof tabId !== 'string' ||
    !tabId ||
    desktopClosed(tabId) ||
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    typeof query !== 'string' ||
    query.length > 1024 ||
    typeof requestId !== 'string' ||
    !requestId ||
    !ownsDesktopDirectory(tabId, path)
  ) {
    result.unreadable = 1
    return result
  }
  const ticket = { requestId }
  searches.set(tabId, ticket)
  const active = (): boolean => searches.get(tabId) === ticket && !desktopClosed(tabId)
  const terms = parseQuery(query)
  const { maxEntries = 250000, maxHits = 1000, maxMs = 30000 } = limits
  const started = Date.now()
  let lastProgress = 0
  const snapshot = (): BrowseSearchResult => ({
    ...result,
    listing: { folders: [...result.listing.folders], files: [...result.listing.files] }
  })
  const progress = (): void => {
    if (!active() || Date.now() - lastProgress < 150) return
    lastProgress = Date.now()
    emit({ ...snapshot(), tabId, requestId })
  }
  try {
    if (!terms.some((term) => !term.negated)) return result
    result.path = resolve(path)
    const root = comparable(await realpath(result.path))
    const rootPrefix = root.endsWith(sep) ? root : root + sep
    const seen = new Set<string>()
    const queue = [result.path]
    let next = 0
    while (next < queue.length) {
      if (!active()) break
      if (result.scanned >= maxEntries || Date.now() - started >= maxMs) {
        result.truncated = true
        break
      }
      const dir = queue[next++]
      try {
        const canonical = comparable(await realpath(dir))
        if (!active()) break
        // Recheck before opening: even an ordinary directory can have been
        // replaced with a junction since its parent was enumerated.
        if ((canonical !== root && !canonical.startsWith(rootPrefix)) || seen.has(canonical)) {
          result.skippedLinks++
          continue
        }
        seen.add(canonical)
        const handle = await opendir(dir)
        // opendir streams entries in small batches instead of holding an
        // entire giant directory in main's memory. Leaving the loop closes it.
        for await (const entry of handle) {
          if (!active()) break
          if (result.scanned >= maxEntries || Date.now() - started >= maxMs) {
            result.truncated = true
            break
          }
          result.scanned++
          if (entry.isSymbolicLink()) {
            result.skippedLinks++
            continue
          }
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) queue.push(fullPath)
          if (!matchesQuery(entry.name, terms)) {
            progress()
            continue
          }
          let target: string
          try {
            target = comparable(await realpath(fullPath))
          } catch {
            // A changing folder can lose one entry after enumeration. Keep
            // the rest of its siblings and subfolders in the search.
            result.unreadable++
            continue
          }
          if (!active()) break
          if (target !== root && !target.startsWith(rootPrefix)) {
            result.skippedLinks++
            continue
          }
          if (entry.isDirectory()) result.listing.folders.push({ path: fullPath, name: entry.name })
          else if (entry.isFile()) {
            try {
              const info = await stat(fullPath)
              if (!active()) break
              const ext = extname(entry.name).toLowerCase()
              result.listing.files.push({
                path: fullPath,
                name: entry.name,
                ext,
                kind: fileKind(ext, entry.name),
                size: info.size,
                mtimeMs: info.mtimeMs
              })
            } catch {
              result.unreadable++
              continue
            }
          } else continue
          if (!active()) break
          grantDesktopDirectory(tabId, dirname(fullPath))
          progress()
          if (result.listing.folders.length + result.listing.files.length >= maxHits) {
            result.truncated = true
            break
          }
        }
      } catch {
        result.unreadable++
      }
      progress()
      if (result.truncated) break
    }
    result.cancelled = !active()
    return snapshot()
  } catch {
    result.unreadable++
    result.cancelled = !active()
    return snapshot()
  } finally {
    if (searches.get(tabId) === ticket) searches.delete(tabId)
  }
}
