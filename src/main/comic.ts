import { createHash } from 'crypto'
import { mkdir, readdir, rm, rename, stat, utimes, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import { comicPages } from '@shared/comicPages'
import { extractAllSeven } from './sevenZip'

/**
 * A comic book, unpacked once (2026-08-31).
 *
 * The obvious design - extract a page when it is asked for - is the one the
 * performance rules forbid. adm-zip reads the WHOLE container synchronously
 * on construction, so lazily paging a 500MB .cbz through it would be one
 * 500MB sync read per page turn on main's single thread; and the 7-Zip route
 * spawns a process into a fresh temp directory per member, measured here at
 * ~278ms, which is not a page turn either. Both also leave a temp directory
 * per page that nothing ever removes.
 *
 * So the container is unpacked ONCE into a cache directory named after the
 * file's path, size and mtime, and the pages are then ordinary files. A page
 * turn costs what showing a jpeg costs. The cache is LRU by directory mtime
 * with a ceiling, like the converted-video cache; and because every page
 * lives UNDER one directory, the media wall grants that directory rather
 * than growing an unbounded allowlist of individual pages.
 *
 * Read-only, both formats. A .cbr is a rar and nothing free writes rar; a
 * .cbz could be written and deliberately is not, because a comic reader that
 * can rewrite the book is an archive panel wearing a costume.
 */

/** Two comics' worth of pictures. Past this the coldest book goes. */
const CACHE_MAX = 2 * 1024 * 1024 * 1024

/** A name for this exact version of this exact file. */
function cacheName(file: string, mtimeMs: number, size: number): string {
  return createHash('sha1')
    .update(`${file.toLowerCase()}|${mtimeMs}|${size}`)
    .digest('hex')
    .slice(0, 16)
}

/** Every file under `dir`, as paths relative to it, with forward slashes. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else if (e.isFile()) out.push(relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

/** Total bytes under a directory. */
async function dirSize(dir: string): Promise<number> {
  let n = 0
  for (const rel of await walk(dir)) {
    const st = await stat(join(dir, rel)).catch(() => null)
    if (st) n += st.size
  }
  return n
}

/**
 * Drop the coldest unpacked comics until the cache fits.
 *
 * Read oldest-first by the marker file's mtime, which `openComic` touches on
 * every hit - so the book you are rereading is not the one that goes.
 */
async function evict(root: string, maxBytes: number): Promise<void> {
  const names = await readdir(root, { withFileTypes: true }).catch(() => [])
  const books: Array<{ dir: string; at: number; size: number }> = []
  for (const e of names) {
    if (!e.isDirectory()) continue
    const dir = join(root, e.name)
    const st = await stat(join(dir, MARKER)).catch(() => null)
    books.push({ dir, at: st?.mtimeMs ?? 0, size: await dirSize(dir) })
  }
  books.sort((a, b) => a.at - b.at)
  let total = books.reduce((n, b) => n + b.size, 0)
  for (const b of books) {
    if (total <= maxBytes) return
    // Never the one just opened: it is the newest, so the sort has already
    // put it last, but a cache that can evict what it just wrote is a cache
    // that loops.
    await rm(b.dir, { recursive: true, force: true }).catch(() => {})
    total -= b.size
  }
}

/** Written last, so a half-unpacked book never looks like a finished one. */
const MARKER = '.prism-comic'

export interface ComicOpen {
  /** The unpacked directory: what the media wall grants, once. */
  dir: string
  /** Absolute page paths, in reading order. */
  pages: string[]
}

/**
 * Unpack `file` if it is not already unpacked, and answer its pages.
 *
 * `root` is the cache directory (userData/comics). 7-Zip does the walking, so
 * no member name from the container is ever joined onto a path here - the
 * only path handed to it is a directory Prism made, and its own extraction
 * refuses to write outside it.
 */
export async function openComic(
  exe: string,
  file: string,
  root: string,
  password = ''
): Promise<ComicOpen | { error: 'password' | 'failed' | 'empty' }> {
  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(file)
  } catch {
    return { error: 'failed' }
  }
  const dir = join(root, cacheName(file, st.mtimeMs, st.size))
  const marker = join(dir, MARKER)

  if (!existsSync(marker)) {
    // Into a partial directory, renamed on success: an interrupted unpack
    // must not be found later and read as a short comic.
    const partial = `${dir}.part`
    await rm(partial, { recursive: true, force: true }).catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    await mkdir(partial, { recursive: true })
    const got = await extractAllSeven(exe, file, partial, password)
    if (!got.ok) {
      await rm(partial, { recursive: true, force: true }).catch(() => {})
      return { error: got.reason === 'password' ? 'password' : 'failed' }
    }
    await writeFile(join(partial, MARKER), '')
    await rename(partial, dir).catch(async () => {
      await rm(partial, { recursive: true, force: true }).catch(() => {})
    })
    if (!existsSync(marker)) return { error: 'failed' }
  } else {
    // Touch, so eviction reads genuinely cold books and not this one.
    const now = new Date()
    await utimes(marker, now, now).catch(() => {})
  }

  const rels = await walk(dir)
  const pages = comicPages(rels.map((path) => ({ path })))
  await evict(root, CACHE_MAX)
  if (!pages.length) return { error: 'empty' }
  return { dir, pages: pages.map((p) => join(dir, ...p.split('/'))) }
}

/** Everything Prism unpacked, gone. For a "clear cache" and for tests. */
export async function clearComics(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
