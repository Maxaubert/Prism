import { opendir, realpath, stat } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { BrowseSearchProgress, BrowseSearchResult } from '@shared/browse'
import { SEARCH_WINDOW_MAX, type BrowseSearchWindowRequest, type BrowseSort } from '@shared/browse'
import { fileKind } from '@shared/fileKind'
import { parseBrowseQuery } from '@shared/browseQuery'
import { nameRank } from '@shared/searchSuggest'
import { filetimeToMs, isDirAttr } from '@shared/everythingQuery'
import { searchEverythingBrowse, searchEverythingBrowseWindow } from './everythingBrowse'
import { desktopClosed, grantDesktopDirectory, ownsDesktopDirectory } from './desktopAccess'

const searches = new Map<string, { requestId: string; controller: AbortController }>()

/** The search popup's slot (#267): its suggestions run beside the list's own
 *  search rather than in its place, so typing in the popup never stops the
 *  full search the list is showing. The tab's grants are still the tab's. */
export const suggestSlot = (tabId: string): string => `${tabId}\u0000suggest`

/** What the popup asks for: up to 200 candidates, of which it shows about
 *  eight. Bounded tighter than the list's search, since a suggestion that
 *  takes thirty seconds is no suggestion. */
export const SUGGEST_LIMITS = { maxEntries: 100000, maxHits: 200, maxMs: 3000, candidates: 5000 }

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
  /** The popup's walk (#267): rather than stop at the first `maxHits`, walk
   *  the whole budget and keep the `maxHits` best by this rank (0 is best).
   *  Breadth-first alone kept whatever came first, so the one file named as
   *  typed was lost behind 200 weaker matches nearer the top (review of #268). */
  rank?: (name: string) => number
  /** With `rank`, how many rows the index is asked for before the best
   *  `maxHits` of them are checked. The index answers by name A to Z, so its
   *  first 200 in a repo full of *.test.ts never reached `test-utils.ts`. */
  candidates?: number
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
  requestedWindow?: BrowseSearchWindowRequest,
  slot: string = tabId
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
  cancelBrowseSearch(slot)
  const ticket = { requestId, controller: new AbortController() }
  searches.set(slot, ticket)
  const active = (): boolean => searches.get(slot) === ticket && !desktopClosed(tabId)
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
    const answered = window
      ? (indexedWindow?.rows ?? null)
      : await searchEverythingBrowse(
          result.path,
          query,
          limits.rank ? Math.max(maxHits, limits.candidates ?? maxHits) : maxHits,
          ticket.controller.signal
        )
    if (!active()) return { ...result, cancelled: true }
    // Ranked (the popup): the best names of everything the index gave, sorted
    // from its own paths before any is checked, so only the kept are granted.
    const indexed =
      answered && limits.rank && !window
        ? answered
            .map((entry, order) => ({
              entry,
              order,
              rank: entry ? limits.rank!(basename(entry.filename)) : Infinity,
              depth: entry ? entry.filename.split(/[\\/]/).length : Infinity
            }))
            .sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.order - b.order)
            .map(({ entry }) => entry)
        : answered
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
    type Folder = BrowseSearchResult['listing']['folders'][number]
    type File = BrowseSearchResult['listing']['files'][number]
    const rank = limits.rank
    const best: Array<{ rank: number; folder?: Folder; file?: File }> = []
    /** The kept candidate a better one replaces: the worst rank, and of
     *  those the last found, which the breadth-first walk found deepest. */
    const worst = (): number => {
      let at = -1
      for (let index = 0; index < best.length; index++)
        if (at < 0 || best[index].rank >= best[at].rank) at = index
      return at
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
          const entryRank = rank ? rank(entry.name) : 0
          if (rank && best.length >= maxHits && entryRank >= best[worst()].rank) {
            // Full of candidates at least this good: no stat, no grant.
            result.truncated = true
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
          if (rank) {
            let found: { rank: number; folder?: Folder; file?: File } | null = null
            if (entry.isDirectory())
              found = { rank: entryRank, folder: { path: fullPath, name: entry.name } }
            else if (entry.isFile()) {
              try {
                const info = await stat(fullPath)
                if (!active()) break
                const ext = extname(entry.name).toLowerCase()
                found = {
                  rank: entryRank,
                  file: {
                    path: fullPath,
                    name: entry.name,
                    ext,
                    kind: fileKind(ext, entry.name),
                    size: info.size,
                    mtimeMs: info.mtimeMs
                  }
                }
              } catch {
                result.unreadable++
              }
            }
            if (!found) continue
            if (best.length >= maxHits) {
              best.splice(worst(), 1)
              result.truncated = true
            }
            best.push(found)
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
      if (result.truncated && !rank) break
    }
    // Only what is kept is granted: a candidate pushed out by a better one
    // never widens what the tab may open.
    for (const kept of best) {
      if (kept.folder) result.listing.folders.push(kept.folder)
      if (kept.file) result.listing.files.push(kept.file)
      if (active()) grantDesktopDirectory(tabId, dirname((kept.folder ?? kept.file)!.path))
    }
    result.cancelled = !active()
    return snapshot()
  } catch {
    result.unreadable++
    result.cancelled = !active()
    return snapshot()
  } finally {
    if (searches.get(slot) === ticket) searches.delete(slot)
  }
}

/**
 * The search popup's candidates (#267): main's own search (the index when it
 * runs, the walk when it does not) in the popup's slot, keeping the BEST
 * names by `nameRank` rather than the first ones found (review of #268). The
 * popup ranks again to show its eight.
 */
export function browseSuggest(
  tabId: string,
  path: string,
  query: string,
  requestId: string
): Promise<BrowseSearchResult> {
  return browseSearch(
    tabId,
    path,
    query,
    requestId,
    () => {},
    { ...SUGGEST_LIMITS, rank: (name: string) => nameRank(name, typeof query === 'string' ? query : '') },
    undefined,
    typeof tabId === 'string' ? suggestSlot(tabId) : tabId
  )
}
