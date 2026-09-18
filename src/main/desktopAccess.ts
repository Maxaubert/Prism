import { dirname } from 'path'
import { isInsideRoot, isRoot } from './dirList'
import { insideAnyRoot, validRoot } from './roots'
import { closeAllBrowseWatches, closeBrowseWatch } from './browseWatch'

// Desktop exploration is not a phone share. A visited directory grants its
// immediate entries only, even when the user browses a drive's top level.
// Keep earlier locations for history, dirty files and mounted preview panes.
const directories = new Map<string, Set<string>>()
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
  if (!grants) directories.set(tabId, (grants = new Set()))
  grants.add(path)
}

export function releaseDesktop(tabId: string): void {
  closeBrowseWatch(tabId)
  directories.delete(tabId)
  revisions.set(tabId, desktopRevision(tabId) + 1)
}

export function ownsDesktopDirectory(tabId: string, path: string): boolean {
  return [...(directories.get(tabId) ?? [])].some((dir) => isRoot(dir, path))
}

function directlyWithin(dir: string, path: string): boolean {
  return isRoot(dir, path) || (isRoot(dir, dirname(path)) && isInsideRoot(dir, path))
}

export function insideDesktop(path: string): boolean {
  return (
    insideAnyRoot(path) ||
    [...directories.values()].some((grants) => [...grants].some((dir) => directlyWithin(dir, path)))
  )
}

export function validDesktopRoot(root: string, path: string): boolean {
  return (
    validRoot(root, path) ||
    [...directories.values()].some(
      (grants) =>
        [...grants].some((dir) => isRoot(dir, root)) &&
        [...grants].some((dir) => directlyWithin(dir, path))
    )
  )
}

/** A tree expansion or search explicitly visits additional paths under its
 * named desktop location. Extend only owners that already hold that location. */
export function extendDesktopDirectories(root: string, paths: string[]): void {
  for (const grants of directories.values()) {
    if (![...grants].some((dir) => isRoot(dir, root))) continue
    for (const path of paths) if (isInsideRoot(root, path)) grants.add(path)
  }
}

export function resetDesktopAccess(): void {
  closeAllBrowseWatches()
  directories.clear()
  revisions.clear()
}
