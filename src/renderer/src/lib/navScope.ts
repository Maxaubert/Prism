import { useSyncExternalStore } from 'react'
import type { FileKind, ViewerFile } from '@shared/types'

// What the folder-navigation list contains. Main sends every viewable sibling;
// this decides which of them the arrows actually step through, based on the kind
// of file that was opened. Pure filtering here, persisted setting below.

export type NavScope = 'all' | 'group' | 'type'

export const DEFAULT_NAV_SCOPE: NavScope = 'group'

export const NAV_SCOPES: Array<{ id: NavScope; name: string; desc: string }> = [
  { id: 'all', name: 'All in one', desc: 'Every file Prism can open, in one list.' },
  { id: 'group', name: 'Media / Documents', desc: 'Open a photo and page through media; open a PDF and page through documents.' },
  { id: 'type', name: 'Per file type', desc: 'Only the kind you opened - images with images, video with video.' }
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

/** The kinds shown alongside `kind` under `scope` - used by Settings to preview
 *  what each mode lists. */
export function scopeKinds(kind: FileKind, scope: NavScope): FileKind[] {
  const all: FileKind[] = ['image', 'video', 'audio', 'pdf', 'text']
  if (scope === 'all') return all
  if (scope === 'type') return [kind]
  return all.filter((k) => GROUP[k] === GROUP[kind])
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
  const matches =
    scope === 'type'
      ? (f: ViewerFile): boolean => f.kind === anchor.kind
      : (f: ViewerFile): boolean => GROUP[f.kind] === GROUP[anchor.kind]

  const kept = files.filter((f) => f === anchor || matches(f))
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
