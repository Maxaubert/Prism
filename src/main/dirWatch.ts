import { watch, type FSWatcher } from 'fs'
import { dirname, join } from 'path'

/**
 * Noticing that the folder changed underneath you.
 *
 * The tree only ever refreshed on PRISM'S OWN writes (2026-08-30). A download
 * finishing, an Explorer copy, a build writing into the folder you are looking
 * at - none of it appeared until you closed and reopened. In an app whose
 * primary workload is an AI CLI rewriting the folder you have open in the
 * panel beside it, that is not a nicety.
 *
 * Three things make this safe to leave running:
 *
 * COALESCED. A terminal writing a build output fires hundreds of events a
 * second. They are collected into a set of affected DIRECTORIES and flushed on
 * a quiet window, with a hard ceiling so a continuously-writing folder still
 * gets one flush a second rather than none at all.
 *
 * FILTERED, but only of what nobody could ever see: dot paths and Windows
 * clutter. A `.git` write is not the folder changing, and an agent committing
 * in the folder you have open does that constantly.
 *
 * MUTED around Prism's own writes. Every rename, bin, duplicate and save
 * already bumps the tree itself; an echo would be a second refresh that also
 * wipes the selection twice.
 *
 * No electron import, so this is testable against a real temp directory.
 */

/** Quiet window before a flush. Long enough that a copy of many files is one. */
const QUIET_MS = 500
/** ...but never wait longer than this, whatever keeps arriving. */
const MAX_WAIT_MS = 1500
/** How long Prism's own write silences a directory. */
const MUTE_MS = 1200
/** ...and how soon a deferred directory is looked at again. */
const MUTE_RETRY_MS = 400

export interface DirChange {
  root: string
  dirs: string[]
}

type Emit = (change: DirChange) => void

interface Watched {
  watcher: FSWatcher
  pending: Set<string>
  timer: NodeJS.Timeout | null
  firstAt: number
}

const watched = new Map<string, Watched>()
const muted = new Map<string, number>()

const key = (p: string): string => p.toLowerCase()

/**
 * Silence a directory for a moment: Prism is about to write there itself, and
 * the renderer refreshes on its own after its own writes.
 */
export function muteDir(dir: string, now: number, ms = MUTE_MS): void {
  if (!dir) return
  muted.set(key(dir), now + ms)
}

export function isMuted(dir: string, now: number): boolean {
  const until = muted.get(key(dir))
  if (until === undefined) return false
  if (until <= now) {
    muted.delete(key(dir))
    return false
  }
  return true
}

/**
 * Should a change to this name be reported at all?
 *
 * Only the noise nobody could ever see is dropped: dot paths and Windows
 * clutter. Everything else goes through, because a watch event carries no
 * type and the renderer is the one that knows what it can draw.
 */
export function shouldReport(name: string | null, skip: (name: string) => boolean): boolean {
  if (!name) return true // Windows can report a change with no name
  // EVERY segment, not just the last. A recursive watch reports paths relative
  // to the root, so a commit arrives as ".git/HEAD" - and an agent working in
  // the folder you have open does that constantly. The tree never draws
  // anything under a dot directory, so waking it for one is pure cost.
  const parts = name.split(/[\\/]/).filter(Boolean)
  if (!parts.length) return false
  for (const seg of parts.slice(0, -1)) if (seg.startsWith('.') || skip(seg)) return false
  const base = parts[parts.length - 1]
  if (base.startsWith('.') || skip(base)) return false
  // Anything else is reported (2026-08-30).
  //
  // This used to treat "has a dot in it" as "is a file" and then ask whether
  // that file was viewable, which quietly lost every FOLDER with a dot in its
  // name - `v1.2.3`, `dist.old`, `My.Project` - because `.3` is not a
  // viewable extension. A watch event carries no type, and stat-ing here
  // would put a filesystem call on main's thread per event.
  //
  // So the filter's job is only to drop the noise nobody could ever see: dot
  // paths and Windows clutter, both handled above. Everything else goes to
  // the renderer, which re-lists the DIRECTORY and draws whatever it can -
  // and the coalescing means one re-list however many files arrived. An
  // unviewable file changes the "N files Prism can't open" count anyway.
  return true
}

export function watchRoot(
  root: string,
  emit: Emit,
  skip: (name: string) => boolean,
  now: () => number = Date.now
): void {
  if (!root || watched.has(key(root))) return
  const flush = (): void => {
    const w = watched.get(key(root))
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    w.timer = null
    const t = now()
    const dirs: string[] = []
    const held: string[] = []
    for (const d of w.pending) (isMuted(d, t) ? held : dirs).push(d)
    // A muted directory is DEFERRED, not dropped (2026-08-30). Clearing it
    // here lost the change outright: Ctrl+S mutes the folder for 1200ms, and
    // an agent writing a file into it inside that window never appeared in
    // the tree at all - which is the "a forgotten filter reads as missing
    // files" failure wearing a different hat. The save path has no
    // compensating refresh of its own, so nothing else would have caught it.
    w.pending = new Set(held)
    w.firstAt = held.length ? t : 0
    if (held.length) w.timer = setTimeout(flush, MUTE_RETRY_MS)
    if (dirs.length) emit({ root, dirs })
  }
  let watcher: FSWatcher
  try {
    // Recursive is native on Windows (ReadDirectoryChangesW) and is the only
    // way one handle covers a tree. persistent: false so a watcher can never
    // be the reason the process stays alive.
    watcher = watch(root, { recursive: true, persistent: false })
  } catch {
    return // an unwatchable root (a vanished drive, a permission) is not fatal
  }
  const entry: Watched = { watcher, pending: new Set(), timer: null, firstAt: 0 }
  watched.set(key(root), entry)
  watcher.on('error', () => unwatchRoot(root))
  watcher.on('change', (_event, filename) => {
    const name = typeof filename === 'string' ? filename : filename?.toString() ?? null
    if (!shouldReport(name, skip)) return
    const full = name ? join(root, name) : root
    entry.pending.add(name ? dirname(full) : root)
    const t = now()
    if (!entry.firstAt) entry.firstAt = t
    if (entry.timer) clearTimeout(entry.timer)
    // The ceiling: a folder being written continuously must still report.
    if (t - entry.firstAt >= MAX_WAIT_MS) {
      flush()
      return
    }
    entry.timer = setTimeout(flush, QUIET_MS)
  })
}

export function unwatchRoot(root: string): void {
  const w = watched.get(key(root))
  if (!w) return
  if (w.timer) clearTimeout(w.timer)
  try {
    w.watcher.close()
  } catch {
    /* already gone */
  }
  watched.delete(key(root))
}

export function closeAllWatches(): void {
  for (const root of [...watched.keys()]) unwatchRoot(root)
  muted.clear()
}

/** Test seam: which roots are being watched. */
export function watchedRoots(): string[] {
  return [...watched.keys()]
}
