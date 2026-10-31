import { useSyncExternalStore } from 'react'
import { PLACE_PATHS, type PlaceIconName } from '../components/icons/placePaths'
import { haystack, type Haystack } from './fuzzy'

/**
 * THE BUILT-IN FOLDER ICONS, LOADED WHEN FIRST NEEDED (2026-10-31, D2): the
 * generated Lucide set (`folderIconSet.ts`, about 450KB) is a dynamic import,
 * so it is its own chunk and never in the launch bundle. Prism's own place
 * glyphs come first (D12), named `prism-<place>`.
 *
 * Until it has loaded, a row with a built-in icon draws the folder glyph and
 * swaps once (`useFolderIconSet` renders again). `preloadFolderIconSet` asks
 * for it at idle when any folder has an icon.
 */

export interface FolderIconDef {
  name: string
  d: string
  tags: readonly string[]
  /** Filled dots, drawn over the stroke. */
  fill?: string
  /** Prism's own glyph (shown first, under "Prism"). */
  prism?: boolean
}

export interface FolderIconSet {
  icons: readonly FolderIconDef[]
  byName: ReadonlyMap<string, FolderIconDef>
  /** `icons[i]`'s search haystack, folded once. */
  hay: readonly Haystack[]
}

const PLACE_TAGS: Record<PlaceIconName, string[]> = {
  home: ['home', 'house', 'user', 'prism'],
  desktop: ['desktop', 'monitor', 'screen', 'prism'],
  downloads: ['downloads', 'arrow', 'save', 'prism'],
  documents: ['documents', 'page', 'file', 'prism'],
  pictures: ['pictures', 'photos', 'images', 'prism'],
  music: ['music', 'note', 'audio', 'prism'],
  videos: ['videos', 'film', 'movies', 'prism'],
  drive: ['drive', 'disk', 'storage', 'prism'],
  usb: ['usb', 'stick', 'removable', 'prism']
}

/** Prism's nine glyphs, in the places panel's order. */
export const PRISM_ICONS: readonly FolderIconDef[] = (
  Object.keys(PLACE_PATHS) as PlaceIconName[]
).map((name) => ({ name: `prism-${name}`, d: PLACE_PATHS[name], tags: PLACE_TAGS[name], prism: true }))

/** The set from the generated rows (exported for the tests). */
export function buildFolderIconSet(
  rows: ReadonlyArray<readonly [string, string, string, string?]>
): FolderIconSet {
  const icons: FolderIconDef[] = [
    ...PRISM_ICONS,
    ...rows.map(([name, d, tags, fill]) => ({
      name,
      d,
      tags: tags ? tags.split(',') : [],
      ...(fill ? { fill } : {})
    }))
  ]
  return {
    icons,
    byName: new Map(icons.map((icon) => [icon.name, icon])),
    hay: icons.map((icon) => haystack(icon.name, icon.tags))
  }
}

let loaded: FolderIconSet | null = null
let loading: Promise<FolderIconSet> | null = null
const listeners = new Set<() => void>()

export function loadFolderIconSet(): Promise<FolderIconSet> {
  loading ??= import('./folderIconSet').then(
    ({ LUCIDE }) => {
      loaded = buildFolderIconSet(LUCIDE)
      for (const l of [...listeners]) l()
      return loaded
    },
    (err: unknown) => {
      // A failed chunk load may be asked for again (the next picker).
      loading = null
      throw err
    }
  )
  return loading
}

/** The set once loaded, else null (and nothing is asked for). */
export const folderIconSetNow = (): FolderIconSet | null => loaded

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The set, or null until it has loaded; renders again when it arrives. Does
 *  not START the load: a row never pays for it, the store's preload does. */
export function useFolderIconSet(): FolderIconSet | null {
  return useSyncExternalStore(subscribe, folderIconSetNow, folderIconSetNow)
}

/** Ask for the set when the renderer is idle. */
export function preloadFolderIconSet(): void {
  if (loaded || loading) return
  const go = (): void => void loadFolderIconSet().catch(() => {})
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof idle === 'function') idle(go, { timeout: 2000 })
  else setTimeout(go, 0)
}
