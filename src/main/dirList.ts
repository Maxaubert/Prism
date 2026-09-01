import { realpathSync, type Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { basename, extname, join, resolve, sep } from 'path'
import { fileKind, isViewable } from '@shared/fileKind'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import type { DirListing, SearchHit, SearchResult, ViewerFile } from '@shared/types'

// Reading directories for the sidebar tree, and the guard that keeps it inside
// the folder Prism was opened in. Main owns this: the renderer never gets to name
// a path we haven't checked.

// Windows clutter nobody wants in a viewer's tree. Dotfiles are dropped too.
const SKIP = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information'])

/** The same rule, for the folder watcher: waking the renderer for a change
 *  to something it would never draw a row for is all cost and no answer. */
export const isSkipped = (name: string): boolean => SKIP.has(name.toLowerCase())

const isWin = process.platform === 'win32'

/** Resolved, symlink-free, comparable form of a path. Falls back to `resolve`
 *  when the path doesn't exist yet (realpath throws on missing entries). */
function canonical(p: string): string {
  let r: string
  try {
    r = realpathSync.native ? realpathSync.native(p) : realpathSync(p)
  } catch {
    r = resolve(p)
  }
  // Trailing separator would break the boundary check below ("C:\a\" vs "C:\a").
  if (r.length > 1 && r.endsWith(sep)) r = r.slice(0, -1)
  return isWin ? r.toLowerCase() : r
}

/**
 * True when `p` is the root or sits beneath it. Compares real paths, so a
 * symlink or junction pointing out of the root is refused, and requires a
 * separator boundary so `C:\photos-old` is not "inside" `C:\photos`.
 */
export function isInsideRoot(root: string, p: string): boolean {
  if (!root || !p) return false
  const r = canonical(root)
  const t = canonical(p)
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep)
}

/** True when `p` is the root itself, which nothing is allowed to rename or bin. */
export function isRoot(root: string, p: string): boolean {
  return !!root && !!p && canonical(root) === canonical(p)
}

/** One file as the renderer sees it. Size is 0 when it can't be stat'ed. */
export async function toViewerFile(p: string): Promise<ViewerFile> {
  const ext = extname(p).toLowerCase()
  let size = 0
  let mtimeMs = 0
  try {
    const st = await stat(p)
    size = st.size
    mtimeMs = st.mtimeMs
  } catch {
    /* unreadable; leave 0 so the renderer just treats it as unknown */
  }
  const name = basename(p)
  return { path: p, name, ext, kind: fileKind(ext, name), size, mtimeMs }
}

/**
 * Run `fn` over `items`, at most `limit` at once.
 *
 * The limit is the whole point, and it is why this is not a Promise.all. An
 * unbounded fan-out over a folder of 8400 files puts 8400 stats into libuv's
 * threadpool at once, which is the same pool the fsmedia:// Range handler a
 * playing film reads through. Sixteen is measured (see listDir) and leaves
 * the pool room to do anything else.
 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** How many stats may be in flight at once. Measured, see listDir. */
const STAT_LIMIT = 16

// Hoisted, and worth 23ms of every click (2026-08-31). `localeCompare` builds
// a fresh collator on EVERY comparison, so sorting 5000 names paid for 5000
// of them: 23.3ms sorting System32 against 0.5ms with one collator reused.
const collator = new Intl.Collator(undefined, { numeric: true })
const byName = (a: { name: string }, b: { name: string }): number =>
  collator.compare(a.name, b.name)

/**
 * Searches are SUPERSEDED, not stacked (2026-08-31).
 *
 * While this walk was synchronous it finished inside one keystroke and there
 * was never a second one in flight. Async, a walk survives the debounce, so
 * typing "holiday" could leave seven overlapping walks of up to 20000 entries
 * each competing for the same threadpool the media handler reads through.
 * Each call takes a ticket; a walk whose ticket is stale stops where it is.
 * The same reasoning that cancels a conversion nobody is waiting for.
 */
let searchGeneration = 0

/**
 * Every viewable file under `root` whose name contains `query`, breadth-first
 * so shallow matches come before deep ones. Bounded twice over - matches
 * returned and directory entries scanned - because "the folder Prism opened
 * in" can be a network share with a million files, and a search must never
 * become a hang.
 */
export async function searchFiles(
  root: string,
  query: string,
  maxHits = 200,
  maxEntries = 20000
): Promise<SearchResult> {
  // Every word, in any order, plus globs and ext: and exclusion - see
  // shared/searchQuery.ts. It used to be one substring, so "holiday 2024"
  // found nothing in a folder full of "2024-06 holiday" (2026-08-28).
  const terms = parseQuery(query)
  const hits: SearchHit[] = []
  if (!terms.length) return { hits, truncated: false }

  const mine = ++searchGeneration
  let scanned = 0
  const queue: string[] = [root]
  while (queue.length) {
    // A newer keystroke has started its own walk: this one has no reader.
    if (mine !== searchGeneration) return { hits: [], truncated: false }
    // A whole LEVEL at a time, bounded: breadth-first is the point (shallow
    // matches first), and reading the level's directories concurrently is
    // what makes it worth being async at all.
    const level = queue.splice(0, queue.length)
    const listings = await mapLimit(level, STAT_LIMIT, async (dir) => {
      try {
        return { dir, entries: await readdir(dir, { withFileTypes: true }) }
      } catch {
        return { dir, entries: [] as Dirent[] } // unreadable: a dead end, not a crash
      }
    })
    for (const { dir, entries } of listings) {
      for (const e of entries) {
        if (++scanned > maxEntries) return { hits, truncated: true }
        const name = e.name
        if (name.startsWith('.') || SKIP.has(name.toLowerCase())) continue
        if (e.isDirectory()) {
          queue.push(join(dir, name))
          // A folder is a search hit too (2026-08-30). This enqueued and moved
          // on without ever consulting the query, so searching for the name of
          // a folder you can see in the tree found nothing. Same parser, same
          // budget: a folder hit spends from `hits` exactly as a file does, or
          // a folder-heavy tree overruns the cap the walk is bounded by.
          if (matchesQuery(name, terms)) {
            hits.push({
              path: join(dir, name),
              name,
              kind: 'other',
              dir: dir.slice(root.length).replace(/^[\\/]/, ''),
              isFolder: true
            })
            if (hits.length >= maxHits) return { hits, truncated: true }
          }
          continue
        }
        const ext = extname(name)
        if (!isViewable(ext, name)) continue
        if (!matchesQuery(name, terms)) continue
        const rel = dir.slice(root.length).replace(/^[\\/]/, '')
        hits.push({ path: join(dir, name), name, kind: fileKind(ext.toLowerCase(), name), dir: rel })
        if (hits.length >= maxHits) return { hits, truncated: true }
      }
    }
  }
  return { hits, truncated: false }
}

/**
 * One directory's listable contents: subfolders and the files Prism can open,
 * each group sorted naturally. Unreadable directories come back empty rather
 * than throwing, so a permission-denied folder is a dead end, not a crash.
 *
 * ASYNC, and with a bounded fan-out (2026-08-31). This was `readdirSync` plus
 * a `statSync` per file on MAIN'S ONE THREAD, up to 20000 entries per
 * debounced keystroke, which is the thing CLAUDE.md's own performance block
 * rules out. Measured on System32 (about 5000 entries), median of five:
 *
 *   sync                140ms   (blocking every window and the media handler)
 *   naive await         269ms   (a REGRESSION - one round trip per entry)
 *   bounded 16           44ms
 *
 * The naive translation is the trap: it stops freezing the app, so it feels
 * better and can ship while being twice as slow. The win is the concurrency,
 * not the await.
 */
export async function listDir(dir: string): Promise<DirListing> {
  let entries: Dirent[]
  try {
    // withFileTypes: the directory read already knows what is a folder, so
    // asking the filesystem again is a syscall per entry for nothing. This
    // used to stat TWICE per entry - once to test isDirectory, once inside
    // toViewerFile for size and mtime. Measured over 8400 entries: 418ms
    // before, 222ms after (2026-08-26).
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { folders: [], files: [], unreadable: true }
  }
  const wanted = entries.filter((e) => !e.name.startsWith('.') && !SKIP.has(e.name.toLowerCase()))

  const rows = await mapLimit(wanted, STAT_LIMIT, async (e) => {
    const p = join(dir, e.name)
    try {
      // A symlink says nothing about itself, so it - and only it - is asked.
      const isDir = e.isSymbolicLink() ? (await stat(p)).isDirectory() : e.isDirectory()
      if (isDir) return { folder: { path: p, name: e.name } }
      if (!isViewable(extname(p), e.name)) return { hidden: true }
      return { file: await toViewerFile(p) }
    } catch {
      /* vanished or unreadable between readdir and stat; skip it */
      return {}
    }
  })

  const folders: DirListing['folders'] = []
  const files: ViewerFile[] = []
  // Files dropped for being unviewable, counted so the tree can say so. A
  // folder of installers used to read "empty", which is a different and
  // alarming claim: it says the folder is gone or wrong, not that Prism has
  // nothing to show from it.
  let hidden = 0
  for (const r of rows) {
    if (r.folder) folders.push(r.folder)
    else if (r.file) files.push(r.file)
    else if (r.hidden) hidden += 1
  }
  // Spread only when there is something to say: a genuinely empty folder must
  // not start reporting "0 files Prism can't open".
  return { folders: folders.sort(byName), files: files.sort(byName), ...(hidden ? { hidden } : {}) }
}
