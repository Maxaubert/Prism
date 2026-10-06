import { fileKind } from './fileKind'
import type { ArchiveEntry, ArchiveMeta, FileKind } from './types'

/**
 * PLACES INSIDE AN ARCHIVE (#300; owner, 2026-10-06: "make zips seem like
 * ordinary folders, they keep the icon but you open them like any other
 * folder", then, of the mockup, "I like the look for zip files, use that").
 * Design and plan: docs/superpowers/specs/2026-10-06-zip-as-folder-design.md.
 *
 * A place inside a zip is ONE Windows-shaped path, the one File Explorer shows:
 * `C:\Users\Admin\Downloads\Wind-0.2.2.zip\Wind-0.2.2\src`. It is a history
 * entry, a tab's path, a crumb and a row's path like any folder's, so Back,
 * Forward, Up and the crumbs need nothing new. Which segment is the container
 * is MAIN's call (a stat: a folder named `x.zip` stays a folder); the pure
 * halves are here.
 */

/** Containers nested deeper than this are not opened. */
export const MAX_NEST = 4

/** An archive kind the Explorer walks into: every one `fileKind` calls an
 *  archive (zip, 7z, rar, tar, gz, iso, cab...). Comics are their own kind and
 *  stay books. */
export function browsableArchive(name: string): boolean {
  const ext = /\.[^.\\/]*$/.exec(name)?.[0] ?? ''
  return !!ext && fileKind(ext.toLowerCase(), name) === 'archive'
}

/** A Windows path's segments; the drive (`C:`) or share stays the first. */
export function segments(path: string): string[] {
  // Not filtered: a share's `\\server` is two empty segments, and joining the
  // pieces back must give the same path.
  return path.replace(/\//g, '\\').replace(/\\+$/, '').split('\\')
}

/** Windows paths compare without case. */
const key = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** Is `path` the place `base` or below it. */
export function within(base: string, path: string): boolean {
  const b = key(base)
  const p = key(path)
  return p === b || p.startsWith(b + '\\')
}

/**
 * The forward-slash name inside a container for a place below its root, ''
 * at the root itself, null when the place is not inside it at all.
 */
export function innerOf(base: string, path: string): string | null {
  const b = key(base)
  const p = path.replace(/\//g, '\\').replace(/\\+$/, '')
  if (p.toLowerCase() === b) return ''
  if (!p.toLowerCase().startsWith(b + '\\')) return null
  return p.slice(b.length + 1).replace(/\\/g, '/')
}

/** The address-bar path of a name inside a container whose root is `base`. */
export function placeOf(base: string, inner: string): string {
  const clean = inner.replace(/^\/+|\/+$/g, '')
  return clean ? `${base.replace(/[\\/]+$/, '')}\\${clean.replace(/\//g, '\\')}` : base
}

/** A member's name inside the innermost container of a listing, or null when
 *  the path is not inside it. What the archive verbs are handed. */
export function memberOf(meta: Pick<ArchiveMeta, 'base'>, path: string): string | null {
  return innerOf(meta.base, path)
}

/**
 * The candidates for a container along a path: every prefix whose last
 * segment names an archive, shortest first. Only these can be one, so a path
 * with none of them is an ordinary folder and costs main no stat at all.
 */
export function containerCandidates(path: string): string[] {
  const parts = segments(path)
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) {
    if (browsableArchive(parts[i])) out.push(parts.slice(0, i + 1).join('\\'))
  }
  return out
}

/** A folder inside a container: the totals of everything beneath it. */
export interface LevelFolder {
  path: string
  name: string
  mtime?: number
  /** Unpacked bytes of every file below. */
  size: number
  /** Entries below, files and folders. */
  items: number
}

/**
 * One level of a container: the folders and files whose parent is `inner`
 * ('' is the root). Implied folders must already be filled in
 * (`withImpliedFolders`). Order is left to the caller, which sorts every
 * listing with the Explorer's own numeric collator.
 */
export function levelOf(
  entries: readonly ArchiveEntry[],
  inner: string
): { folders: LevelFolder[]; files: ArchiveEntry[] } {
  const at = inner.replace(/^\/+|\/+$/g, '')
  const prefix = at ? at + '/' : ''
  const lower = prefix.toLowerCase()
  const folders = new Map<string, LevelFolder>()
  const files: ArchiveEntry[] = []
  for (const e of entries) {
    const p = e.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!p || (lower && !p.toLowerCase().startsWith(lower))) continue
    const rest = p.slice(prefix.length)
    if (!rest) continue
    const slash = rest.indexOf('/')
    if (slash < 0) {
      if (e.dir) {
        const k = rest.toLowerCase()
        const was = folders.get(k)
        if (!was) folders.set(k, { path: prefix + rest, name: rest, size: 0, items: 0, ...(e.mtime ? { mtime: e.mtime } : {}) })
        else if (e.mtime && !was.mtime) was.mtime = e.mtime
      } else files.push(e)
      continue
    }
    // Below a folder of this level: it counts toward that folder's totals.
    const top = rest.slice(0, slash)
    const k = top.toLowerCase()
    let f = folders.get(k)
    if (!f) folders.set(k, (f = { path: prefix + top, name: top, size: 0, items: 0 }))
    f.items += 1
    if (!e.dir) f.size += e.size
  }
  return { folders: [...folders.values()], files }
}

/** Every entry below `inner` (the archive search's scope), not the level. */
export function below(entries: readonly ArchiveEntry[], inner: string): ArchiveEntry[] {
  const at = inner.replace(/^\/+|\/+$/g, '')
  if (!at) return [...entries]
  const lower = at.toLowerCase() + '/'
  return entries.filter((e) => e.path.toLowerCase().startsWith(lower))
}

/** Does the listing hold this name (a folder or a file), case-insensitively. */
export function hasEntry(entries: readonly ArchiveEntry[], inner: string): ArchiveEntry | null {
  const want = inner.replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!want) return null
  return entries.find((e) => e.path.replace(/\/+$/, '').toLowerCase() === want) ?? null
}

/** What `archive:member` answers (#300). */
export type MemberAnswer =
  | { ok: true; path: string; kind: FileKind }
  | {
      ok: false
      reason: 'password' | 'aes' | 'failed' | 'missing' | 'deep' | 'too-big' | 'space'
      size?: number
      container?: string
    }

/** What `archive:summary` answers: the archive card (#300). */
export type ArchiveSummary =
  | {
      ok: true
      meta: ArchiveMeta
      /** The single top folder a "download as zip" makes, when that is all. */
      top: string | null
      rows: Array<{ name: string; dir: boolean; size: number }>
    }
  | { ok: false; reason: 'password' | 'aes' | 'failed' | 'missing' | 'deep' }
