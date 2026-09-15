import { stat } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import type { BrowseDirectory, BrowseShortcut } from '@shared/browse'
import { listDir } from './dirList'
import {
  desktopClosed,
  desktopRevision,
  grantDesktopDirectory,
  ownsDesktopDirectory
} from './desktopAccess'
import { closeBrowseWatch, setBrowseWatch } from './browseWatch'
import type { DirChange } from '@shared/types'

export function browseWatch(
  tabId: string,
  path: string | null,
  emit: (change: DirChange) => void
): boolean {
  if (typeof tabId !== 'string' || !tabId) return false
  if (path === null) {
    closeBrowseWatch(tabId)
    return true
  }
  if (typeof path !== 'string' || !isAbsolute(path) || !ownsDesktopDirectory(tabId, path))
    return false
  return setBrowseWatch(tabId, path, emit)
}

export async function browseDirectory(
  tabId: string,
  path: string
): Promise<BrowseDirectory | null> {
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
    if (!(await stat(dir)).isDirectory()) return null
    const listing = await listDir(dir, true)
    if (desktopRevision(tabId) !== revision) return null
    if (!listing.unreadable) grantDesktopDirectory(tabId, dir)
    return { path: dir, listing }
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
    group: 'quick'
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
