import { stat } from 'fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'path'
import { containerCandidates } from '@shared/archivePlace'
import { container } from './archiveBrowse'
import type { BrowseDirectory, BrowseShortcut } from '@shared/browse'
import { listDir, listNames } from './dirList'
import {
  desktopClosed,
  desktopRevision,
  grantDesktopDirectory,
  ownsDesktopDirectory
} from './desktopAccess'
import { closeBrowseWatch, setBrowseWatch } from './browseWatch'
import type { DirChange } from '@shared/types'

/** Each tab's newest watch ask: an older one still waiting on its archive
 *  check must not land over it. */
const watchTurns = new Map<string, number>()

/**
 * Watch the folder a tab shows. The archive check is an awaited stat
 * (owner, 2026-10-12: main never waits on the disk), taken only for a path
 * with an archive's name in it, and a newer ask for the same tab wins
 * whatever order the stats finish in: the older one sets nothing up.
 */
export async function browseWatch(
  tabId: string,
  path: string | null,
  emit: (change: DirChange) => void
): Promise<boolean> {
  if (typeof tabId !== 'string' || !tabId) return false
  const turn = (watchTurns.get(tabId) ?? 0) + 1
  watchTurns.set(tabId, turn)
  if (path === null) {
    closeBrowseWatch(tabId)
    return true
  }
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  // Inside an archive (#300): the folder holding the zip is watched, and only
  // a change to the zip itself reports the place on screen.
  const outer = containerCandidates(path).length ? await container(path) : null
  if (watchTurns.get(tabId) !== turn) return true // a newer ask for this tab decides
  if (outer) {
    if (!ownsDesktopDirectory(tabId, dirname(outer))) return false
    return setBrowseWatch(tabId, dirname(outer), emit, { only: basename(outer), report: path })
  }
  if (!ownsDesktopDirectory(tabId, path)) return false
  return setBrowseWatch(tabId, path, emit)
}

/** A read for the Explorer, with the folder's own modified time beside it so
 *  the listing cache can tell a changed folder from an unchanged one. */
export type BrowseRead = BrowseDirectory & { folderMtimeMs: number }

/**
 * `phase` 'names' is the Explorer's names-first read (#271): rows without size
 * or date, which `statDetails` fills afterwards. 'full' stats every file first,
 * as every read did before, for the callers that need sizes in the answer.
 */
export async function browseDirectory(
  tabId: string,
  path: string,
  phase: 'full' | 'names' = 'full'
): Promise<BrowseRead | null> {
  if (
    typeof tabId !== 'string' ||
    !tabId ||
    desktopClosed(tabId) ||
    typeof path !== 'string' ||
    !isAbsolute(path)
  )
    return null
  const dir = resolve(path)
  const revision = desktopRevision(tabId)
  try {
    const info = await stat(dir)
    if (!info.isDirectory()) return null
    const listing = phase === 'names' ? await listNames(dir) : await listDir(dir, true)
    if (desktopRevision(tabId) !== revision) return null
    if (!listing.unreadable) grantDesktopDirectory(tabId, dir)
    return { path: dir, listing, folderMtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

type CommonPath = 'home' | 'desktop' | 'downloads' | 'documents' | 'pictures' | 'music' | 'videos'

export async function browseLocations(
  getPath: (key: CommonPath) => string
): Promise<BrowseShortcut[]> {
  const common: Array<[CommonPath, string]> = [
    ['home', 'Home'],
    ['desktop', 'Desktop'],
    ['downloads', 'Downloads'],
    ['documents', 'Documents'],
    ['pictures', 'Pictures'],
    ['music', 'Music'],
    ['videos', 'Videos']
  ]
  const shortcuts: BrowseShortcut[] = common.map(([key, name]) => ({
    name,
    path: getPath(key),
    group: 'quick',
    // Which Known Folder it is (#285): the page finds Downloads by this,
    // never by a folder's name.
    known: key
  }))
  // Check drive roots without spawning a shell or scanning their contents.
  // A missing/removable drive simply has no shortcut until it is available.
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code)
      shortcuts.push({ name: `${letter}:`, path: `${letter}:\\`, group: 'drive' })
    }
  }
  const found = await Promise.all(
    shortcuts.map(async (entry) => {
      try {
        return (await stat(entry.path)).isDirectory() ? entry : null
      } catch {
        return null
      }
    })
  )
  return found.filter((entry): entry is BrowseShortcut => entry !== null)
}
