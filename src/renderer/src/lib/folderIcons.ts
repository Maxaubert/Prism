import { isInside, pathKey } from '@shared/path'
import { createPref } from './prefs/createPref'
import { preloadFolderIconSet } from './folderIconSetLoad'

/**
 * FOLDER ICONS (owner, 2026-10-31: "allow the user to pick folder icons both
 * for the sidebar things and folders in general"). One icon per PATH (D3),
 * shown wherever that path shows: the Explorer row, the search popup row, the
 * sidebar pin. Prism's own (D6): nothing is written into the folder.
 *
 * Stored as one shared pref, `prism.folderIcons`: an object keyed by
 * `pathKey(path)`, each value `{ "set": "<built-in name>" }` or
 * `{ "file": "<sha256>" }` (a picture from a file, PR 3). Junk is dropped on
 * parse. Every window sees the same icons (a storage event).
 *
 * THE ROWS PAY NOTHING WHEN NO ICON IS SET: the store holds one parsed Map,
 * rebuilt only when the pref changes, and a lookup on an empty Map is skipped.
 */

export type FolderIconChoice = { set: string } | { file: string }

export type FolderIconMap = ReadonlyMap<string, FolderIconChoice>

export const FOLDER_ICONS_KEY = 'prism.folderIcons'

const NAME = /^[a-z0-9-]{1,64}$/
const HASH = /^[0-9a-f]{64}$/

function choice(value: unknown): FolderIconChoice | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.set === 'string' && NAME.test(v.set)) return { set: v.set }
  if (typeof v.file === 'string' && HASH.test(v.file)) return { file: v.file }
  return null
}

export function parseFolderIcons(raw: string | null): FolderIconMap {
  const out = new Map<string, FolderIconChoice>()
  if (!raw) return out
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return out
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const c = choice(v)
    if (c && key) out.set(pathKey(key), c)
  }
  return out
}

const serialize = (map: FolderIconMap): string => JSON.stringify(Object.fromEntries(map))

const EMPTY: FolderIconMap = new Map()

// `always` (another window's change is what the next read sees) and `live`
// (its storage event renders again); createPref keeps the parsed Map's
// identity while the stored string is the same.
const pref = createPref<FolderIconMap>({
  key: FOLDER_ICONS_KEY,
  read: 'always',
  live: true,
  parse: parseFolderIcons,
  serialize,
  fallback: EMPTY
})

/** Every icon now, keyed by `pathKey`. */
export const readFolderIcons = (): FolderIconMap => pref.get()

/** The icon of one path, if it has one. */
export function folderIconOf(map: FolderIconMap, path: string): FolderIconChoice | undefined {
  // No icons at all: no pathKey, no lookup (a 3,000-folder listing).
  return map.size === 0 ? undefined : map.get(pathKey(path))
}

/** Give every path in `paths` this icon, or (null) its default again. */
export function setFolderIcons(paths: readonly string[], icon: FolderIconChoice | null): void {
  const next = new Map(pref.get())
  for (const p of paths) {
    if (icon) next.set(pathKey(p), icon)
    else next.delete(pathKey(p))
  }
  pref.set(next)
}

/**
 * The icons FOLLOW a rename or move done in Prism (D9): every key equal to or
 * under a `from` becomes the same under its `to`. What was ALREADY at a `to`
 * goes first (review, 2026-10-31): a deleted folder keeps its entry for an
 * undo, and a replace leaves the replaced one's, and either would otherwise
 * dress the newcomer in the old folder's icon. The moves are one batch, read
 * against the map as it was. Returns the map unchanged (same object) when
 * nothing changed, so a caller can skip the write.
 */
export function followMoves(
  map: FolderIconMap,
  moves: ReadonlyArray<{ from: string; to: string }>
): FolderIconMap {
  if (map.size === 0 || !moves.length) return map
  const under = (root: string, key: string): boolean => key === root || isInside(root, key)
  const pairs = moves
    .map(({ from, to }) => ({ f: pathKey(from), t: pathKey(to) }))
    .filter(({ f, t }) => f && t && f !== t)
  if (!pairs.length) return map
  const placed: Array<[string, FolderIconChoice]> = []
  const gone = new Set<string>()
  for (const [key, icon] of map) {
    for (const { f, t } of pairs) {
      if (under(f, key)) {
        gone.add(key)
        placed.push([t + key.slice(f.length), icon])
      }
      if (under(t, key)) gone.add(key)
    }
  }
  if (!gone.size) return map
  const next = new Map(map)
  for (const key of gone) next.delete(key)
  for (const [key, icon] of placed) next.set(key, icon)
  return next
}

/** After Prism renamed or moved something: its icons go with it. */
export function followFolderIcons(moves: ReadonlyArray<{ from: string; to: string }>): void {
  const map = pref.get()
  const next = followMoves(map, moves)
  if (next !== map) pref.set(next)
}

/** The whole map, rendering again when it changes (any window). */
export function useFolderIcons(): FolderIconMap {
  const map = pref.use()
  // A stored built-in icon wants the glyph data: fetched at idle, once.
  if (map.size) preloadFolderIconSet()
  return map
}
