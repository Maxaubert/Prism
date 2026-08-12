import { useSyncExternalStore } from 'react'
import type { FileKind, ViewerFile } from '@shared/types'

// What the folder-navigation list contains. Main sends every viewable sibling;
// this decides which of them the arrows actually step through, based on the kind
// of file that was opened. Pure filtering here, persisted setting below.

export type NavScope = 'all' | 'group' | 'type'

export const DEFAULT_NAV_SCOPE: NavScope = 'group'

// One short line each: the hint sits on a single line in Settings.
export const NAV_SCOPES: Array<{ id: NavScope; name: string; hint: string }> = [
  { id: 'all', name: 'All in one', hint: 'Every file Prism can open, in one list.' },
  { id: 'group', name: 'Media / Documents', hint: 'Media with media, documents with documents.' },
  { id: 'type', name: 'Per file type', hint: 'Only the kind you opened.' }
]

// The two families. 'other' is its own bucket so an unrecognised file can only
// ever match itself (it is never listed anyway).
const GROUP: Record<FileKind, string> = {
  image: 'media',
  video: 'media',
  audio: 'media',
  pdf: 'docs',
  text: 'docs',
  other: 'other'
}

/** Whether a file of `kind` belongs with the opened file's `anchor` kind under
 *  the scope. Shared by the paging list and the sidebar tree, so the arrows and
 *  the rows always agree on what the filter means. */
export function matchesScope(kind: FileKind, anchor: FileKind, scope: NavScope): boolean {
  if (scope === 'all') return true
  if (scope === 'type') return kind === anchor
  return GROUP[kind] === GROUP[anchor]
}

/**
 * Narrow a folder listing to the files that belong with the opened one.
 * Returns the filtered list plus the position of that same file within it, so
 * changing scope never moves the viewer off what it is showing. The opened file
 * is always kept, whatever the scope says.
 */
export function scopeFiles(
  files: ViewerFile[],
  index: number,
  scope: NavScope
): { files: ViewerFile[]; index: number } {
  if (!files.length) return { files, index: 0 }
  const i = Math.max(0, Math.min(files.length - 1, index))
  if (scope === 'all') return { files, index: i }

  const anchor = files[i]
  const kept = files.filter((f) => f === anchor || matchesScope(f.kind, anchor.kind, scope))
  return { files: kept, index: Math.max(0, kept.indexOf(anchor)) }
}

/* ---------- the persisted setting ---------- */

const KEY = 'prism.nav.scope'

function load(): NavScope {
  try {
    const v = localStorage.getItem(KEY)
    return NAV_SCOPES.some((s) => s.id === v) ? (v as NavScope) : DEFAULT_NAV_SCOPE
  } catch {
    return DEFAULT_NAV_SCOPE // no storage (unit tests); the default is fine
  }
}

let scope: NavScope = load()
const listeners = new Set<() => void>()

export function setNavScope(s: NavScope): void {
  localStorage.setItem(KEY, s)
  scope = s
  listeners.forEach((l) => l())
}

export function useNavScope(): NavScope {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => scope
  )
}
