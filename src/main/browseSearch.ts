import { opendir, realpath, stat } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { BrowseSearchProgress, BrowseSearchResult } from '@shared/browse'
import { SEARCH_WINDOW_MAX, type BrowseSearchWindowRequest, type BrowseSort } from '@shared/browse'
import { fileKind } from '@shared/fileKind'
import { parseBrowseQuery } from '@shared/browseQuery'
import { filetimeToMs, isDirAttr } from '@shared/everythingQuery'
import { searchEverythingBrowse, searchEverythingBrowseWindow } from './everythingBrowse'
import { desktopClosed, grantDesktopDirectory, ownsDesktopDirectory } from './desktopAccess'

const searches = new Map<string, { requestId: string; controller: AbortController }>()

export function cancelBrowseSearch(tabId: string, requestId?: string): void {
  if (requestId === undefined || searches.get(tabId)?.requestId === requestId) {
    searches.get(tabId)?.controller.abort()
    searches.delete(tabId)
  }
}

interface SearchLimits {
  maxEntries?: number
  maxHits?: number
  maxMs?: number
}

export function normalizeSearchWindow(value: unknown): BrowseSearchWindowRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const request = value as Partial<BrowseSearchWindowRequest>
  const number = (value: unknown, fallback: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(max, Math.floor(value)))
      : fallback
  const keys: BrowseSort['key'][] = ['name', 'path', 'type', 'size', 'modified']
  return {
    offset: number(request.offset, 0, 0xffffffff),
    limit: Math.max(1, number(request.limit, SEARCH_WINDOW_MAX, SEARCH_WINDOW_MAX)),
    sort: {
      key: keys.includes(request.sort?.key as BrowseSort['key']) ? request.sort!.key : 'name',
      direction: request.sort?.direction === 'desc' ? 'desc' : 'asc'
    }
  }
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
  limits: SearchLimits = {},
  requestedWindow?: BrowseSearchWindowRequest
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
  cancelBrowseSearch(tabId)
  const ticket = { requestId, controller: new AbortController() }
  searches.set(tabId, ticket)
  const active = (): boolean => searches.get(tabId) === ticket && !desktopClosed(tabId)
  const { maxEntries = 250000, maxHits = 1000, maxMs = 30000 } = limits
  const window = normalizeSearchWindow(requestedWindow)
  const started = Date.now()
  let lastProgress = 0
  const snapshot = (): BrowseSearchResult => ({
    ...result,
    ...(result.window
      ? {
          window: {
            ...result.window,
            paths: [...result.window.paths],
            folderSizes: { ...result.window.folderSizes }
          }
        }
      : {}),
    listing: { folders: [...result.listing.folders], files: [...result.listing.files] }
  })
  const progress = (): void => {
    if (!active() || Date.now() - lastProgress < 150) return
    lastProgress = Date.now()
    emit({ ...snapshot(), tabId, requestId })
  }
  try {
    if (!query.trim()) return result
    result.path = resolve(path)
    const root = comparable(await realpath(result.path))
    const rootPrefix = root.endsWith(sep) ? root : root + sep
    const indexedWindow = window
      ? await searchEverythingBrowseWindow(result.path, query, window, ticket.controller.signal)
      : null
    const indexed = window
      ? (indexedWindow?.rows ?? null)
      : await searchEverythingBrowse(result.path, query, maxHits, ticket.controller.signal)
    if (!active()) return { ...result, cancelled: true }
    if (window && window.offset > 0 && !indexedWindow) {
      result.notice = 'The search index is temporarily unavailable. Try scrolling again.'
      return result
    }
    if (indexed !== null) {
      result.source = 'everything'
      const resultLimit =
        indexedWindow && window
          ? Math.min(window.limit, Math.max(0, indexedWindow.total - indexedWindow.offset))
          : maxHits
      result.truncated = !window && indexed.length > maxHits
      if (indexedWindow)
        result.window = {
          offset: indexedWindow.offset,
          total: indexedWindow.total,
          paths: Array(resultLimit).fill(null),
          folderSizes: {}
        }
      const prefix = comparable(result.path.endsWith(sep) ? result.path : result.path + sep)
      // Validate in bounded batches. Everything supplies metadata, so this does
      // no recursive enumeration or per-result stat for size/date columns.
      for (let start = 0; start < Math.min(indexed.length, resultLimit) && active(); start += 16) {
        await Promise.all(
          indexed.slice(start, Math.min(start + 16, resultLimit)).map(async (entry, index) => {
            if (!entry) return
            const fullPath = resolve(entry.filename)
            if (!comparable(fullPath).startsWith(prefix)) return
            if (entry.attributes & 1024) {
              result.skippedLinks++
              return
            }
            try {
              const canonical = comparable(await realpath(fullPath))
              if (!active()) return
              // Even descendants reached through an indexed junction cannot
              // extend this tab's grant or disclose a different directory.
              if (canonical !== comparable(resolve(root, relative(result.path, fullPath)))) {
                result.skippedLinks++
                return
              }
              const name = basename(fullPath)
              const ext = extname(name).toLowerCase()
              if (isDirAttr(entry.attributes)) {
                result.listing.folders.push({ path: fullPath, name })
                if (result.window && Number.isSafeInteger(entry.size) && entry.size! >= 0)
                  result.window.folderSizes![fullPath] = {
                    bytes: entry.size!,
                    files: 0,
                    folders: 0,
                    unreadable: 0,
                    skippedLinks: 0,
                    truncated: false,
                    source: 'index',
                    countsKnown: false,
                    measuredAt: Date.now()
                  }
              } else
                result.listing.files.push({
                  path: fullPath,
                  name,
                  ext,
                  kind: fileKind(ext, name),
                  size: entry.size ?? 0,
                  mtimeMs: entry.date_modified === undefined ? 0 : filetimeToMs(entry.date_modified)
                })
              if (result.window) result.window.paths[start + index] = fullPath
              grantDesktopDirectory(tabId, dirname(fullPath))
            } catch {
              result.unreadable++
            }
            result.scanned++
          })
        )
        if (!result.window) progress()
      }
      result.cancelled = !active()
      return snapshot()
    }
    result.source = 'filesystem'
    const terms = parseBrowseQuery(query)
    if (terms.error) {
      result.notice = terms.error
      return result
    }
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
          if (!terms.matches(entry.name, entry.isDirectory())) {
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
