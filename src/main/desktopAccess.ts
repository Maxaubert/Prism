import { dirname } from 'path'
import { canonicalPath, forgetCanonical, warmCanonical, withinCanonical } from './dirList'
import { insideAnyRoot, validRoot } from './roots'
import { closeAllBrowseWatches, closeBrowseWatch } from './browseWatch'
import { diagMain } from 'prism-term-core/main/diagLog'

// Desktop exploration is not a phone share. A visited directory grants its
// immediate entries only, even when the user browses a drive's top level.
// Keep earlier locations for history, dirty files and mounted preview panes.
//
// EACH GRANT IS RESOLVED ONCE, WHEN IT IS GRANTED (#351). The guards below
// used to resolve every grant natively (realpath) on every call, several times
// over, in main's thread: a restored project tree lists hundreds of folders at
// launch, and with 86 grants that was 3.6 s of the first 25 s (MEASURED). The
// path asked about is still resolved on every call, so a junction is judged
// by where it points now; a granted folder later swapped for a junction no
// longer matches its own grant, which refuses rather than allows.
//
// AND LOOKED UP, NOT SCANNED (perf review #31, 2026-10-28): a search grants
// every hit's folder, so a tab that has searched a lot holds many grants, and
// the owner checks spread and scanned all of them on every listing, watch and
// search. Each tab keeps its resolved folders counted by value too, so "does
// this tab hold that folder" is one lookup.
interface Grants {
  /** The path as granted, and what it resolved to then. */
  byPath: Map<string, string>
  /** Each resolved folder, and how many granted paths resolved to it. */
  canon: Map<string, number>
}
const directories = new Map<string, Grants>()
const revisions = new Map<string, number>()

export function desktopRevision(tabId: string): number {
  return revisions.get(tabId) ?? 0
}

export function desktopClosed(tabId: string): boolean {
  return revisions.has(tabId)
}

export function grantDesktopDirectory(tabId: string, path: string): void {
  if (desktopClosed(tabId)) return
  let grants = directories.get(tabId)
  if (!grants) directories.set(tabId, (grants = { byPath: new Map(), canon: new Map() }))
  if (!grants.byPath.has(path)) hold(grants, path, canonicalPath(path))
}

function hold(grants: Grants, path: string, resolved: string): void {
  grants.byPath.set(path, resolved)
  grants.canon.set(resolved, (grants.canon.get(resolved) ?? 0) + 1)
}

export function releaseDesktop(tabId: string): void {
  closeBrowseWatch(tabId)
  directories.delete(tabId)
  revisions.set(tabId, desktopRevision(tabId) + 1)
}

/** Timed like the other guards (review of #322): a search grants every hit's
 *  folder, so after a big one each listing and each `browse:watch` resolves
 *  thousands of grants here. */
export function ownsDesktopDirectory(tabId: string, path: string): boolean {
  return timed('ownsDesktopDirectory', 1, () => {
    const grants = directories.get(tabId)
    if (!grants || !path) return false
    return grants.canon.has(canonicalPath(path))
  })
}

/**
 * THE GUARD TIMES ITSELF (#322). Suspect 1 of the diagnostics design: these
 * guards resolve paths natively (realpath) against every grant, and a search
 * or a folder full of size rows hands them thousands of paths, in main's
 * thread. One call of 50 ms or more is written as `guard-slow` with how many
 * paths it was asked about and how many grants it held, so the log can say
 * whether a stall was the guard. Two `performance.now()` calls a guard;
 * nothing is written for a fast one.
 */
export const GUARD_SLOW_MS = 50

function grantCount(): number {
  let n = 0
  for (const grants of directories.values()) n += grants.byPath.size
  return n
}

function timed<T>(fn: string, paths: number, body: () => T): T {
  const t0 = performance.now()
  try {
    return body()
  } finally {
    const ms = performance.now() - t0
    if (ms >= GUARD_SLOW_MS)
      diagMain().write('main', 'guard-slow', { fn, paths, grants: grantCount(), ms: Math.round(ms) })
  }
}

/** A path resolved once for a guard call: itself and its parent. */
interface Asked {
  path: string
  parent: string
}

function asked(path: string): Asked {
  return { path: canonicalPath(path), parent: canonicalPath(dirname(path)) }
}

/** One owner holds the folder itself or the folder of a direct entry, both
 *  sides resolved: two lookups, whatever the number of grants. */
function holdsDirectly(grants: Grants, target: Asked): boolean {
  return (
    grants.canon.has(target.path) ||
    (grants.canon.has(target.parent) && withinCanonical(target.parent, target.path))
  )
}

function anyGrantDirectlyHolds(target: Asked): boolean {
  for (const grants of directories.values()) if (holdsDirectly(grants, target)) return true
  return false
}

/** ONE owner's grants only: `path` is a folder it visited, or a direct entry
 *  of one (both sides resolved, so a junction out of a visited folder is
 *  refused). The phone's wall (2026-10-14), where each phone is its own owner
 *  and another owner's visits must not count. */
export function ownsDirectly(tabId: string, path: string): boolean {
  return timed('ownsDirectly', 1, () => {
    const grants = directories.get(tabId)
    if (!grants || !path) return false
    return holdsDirectly(grants, asked(path))
  })
}

export function insideDesktop(path: string): boolean {
  return timed('insideDesktop', 1, () => inside(path))
}

/** The paths `insideDesktop` allows, as ONE guard call (#322): a caller that
 *  filters a whole list (folder sizes) is timed as the list it is, where a
 *  call per path would each stay under the line while the loop stalled. */
export function insideDesktopAll<T>(paths: readonly T[]): Array<T & string> {
  return timed('insideDesktopAll', paths.length, () =>
    paths.filter((path): path is T & string => typeof path === 'string' && inside(path))
  )
}

/**
 * The same guards, with the paths resolved OFF main's thread first (review,
 * 2026-10-28): for a caller that can await (the size lists and rows, the
 * media protocol). The answer is the sync guard's own; only the realpath
 * calls it would have made have already been made, and remembered.
 */
export async function insideDesktopAllAsync<T>(paths: readonly T[]): Promise<Array<T & string>> {
  const named = paths.filter((p): p is T & string => typeof p === 'string' && !!p)
  await warmCanonical(named.flatMap((p) => [p, dirname(p)]))
  return insideDesktopAll(paths)
}

export async function insideDesktopAsync(path: string): Promise<boolean> {
  if (typeof path !== 'string' || !path) return false
  await warmCanonical([path, dirname(path)])
  return insideDesktop(path)
}

function inside(path: string): boolean {
  if (!path) return false
  // Search grants many result parents. Resolve only a matching direct grant
  // before the alias-aware fallback; probing every unrelated grant with native
  // realpath for every size row made large result sets block the main thread.
  // The path itself is resolved ONCE however many owners hold its parent
  // (review, 2026-10-28), and the fallback reuses it.
  const parent = dirname(path)
  let target: string | undefined
  for (const { byPath: grants } of directories.values()) {
    if (grants.has(path)) return true
    const held = grants.get(parent)
    if (held !== undefined && withinCanonical(held, (target ??= canonicalPath(path)))) return true
  }
  if (insideAnyRoot(path)) return true
  return anyGrantDirectlyHolds({ path: target ?? canonicalPath(path), parent: canonicalPath(parent) })
}

export function validDesktopRoot(root: string, path: string): boolean {
  return timed('validDesktopRoot', 1, () => validDesktopRootNow(root, path))
}

function validDesktopRootNow(root: string, path: string): boolean {
  if (validRoot(root, path)) return true
  if (!root || !path) return false
  const owner = canonicalPath(root)
  let target: Asked | null = null
  for (const grants of directories.values()) {
    if (!grants.canon.has(owner)) continue
    target ??= asked(path)
    if (holdsDirectly(grants, target)) return true
  }
  return false
}

/** A tree expansion or search explicitly visits additional paths under its
 * named desktop location. Extend only owners that already hold that location. */
export function extendDesktopDirectories(root: string, paths: string[]): void {
  timed('extendDesktopDirectories', paths.length, () => extendNow(root, paths))
}

function extendNow(root: string, paths: string[]): void {
  if (!root) return
  const owner = canonicalPath(root)
  const owners = [...directories.values()].filter((grants) => grants.canon.has(owner))
  if (!owners.length) return
  for (const path of paths) {
    if (!path) continue
    const target = canonicalPath(path)
    if (!withinCanonical(owner, target)) continue
    for (const grants of owners) if (!grants.byPath.has(path)) hold(grants, path, target)
  }
}

export function resetDesktopAccess(): void {
  forgetCanonical()
  closeAllBrowseWatches()
  directories.clear()
  revisions.clear()
}
