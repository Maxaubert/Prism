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
 * FILTERED, by the same rules the listing uses. Waking the renderer for a
 * `.git` write, or for a file it would never draw a row for, is all cost and
 * no answer.
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
 * `interesting` is the caller's rule (dirList's own, injected rather than
 * duplicated here): it answers for a FILE name. A change with no name, or one
 * that looks like a directory, is always reported - a new subfolder is a new
 * row, and the renderer decides what it can draw.
 */
export function shouldReport(
  name: string | null,
  skip: (name: string) => boolean,
  interesting: (name: string) => boolean
): boolean {
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
  // No extension: almost certainly a directory, and a new one is a new row.
  if (!/\.[^.]+$/.test(base)) return true
  return interesting(base)
}

export function watchRoot(
  root: string,
  emit: Emit,
  skip: (name: string) => boolean,
  interesting: (name: string) => boolean,
  now: () => number = Date.now
): void {
  if (!root || watched.has(key(root))) return
  const flush = (): void => {
    const w = watched.get(key(root))
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    w.timer = null
    const dirs = [...w.pending].filter((d) => !isMuted(d, now()))
    w.pending.clear()
    w.firstAt = 0
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
    if (!shouldReport(name, skip, interesting)) return
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
