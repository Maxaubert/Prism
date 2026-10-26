import { createPref } from './createPref'

// What the + (and Ctrl+T) opens: where the new tab roots, and what it shows.
// One saved setting per key (prefs/createPref.ts).

export type NewTabMode = 'home' | 'folder' | 'ask'
// What a new tab SHOWS ('prism.newtab.show') went with the project tabs
// (2026-10-26): every tab opens on its folder. The key stays in `prefKeys.ts`.

const modePref = createPref<NewTabMode>({
  key: 'prism.newtab.mode',
  read: 'always',
  parse: (v) => (v === 'folder' || v === 'ask' ? v : 'home'),
  fallback: 'home'
})
const folderPref = createPref<string>({
  key: 'prism.newtab.folder',
  read: 'always',
  parse: (v) => v ?? '',
  fallback: ''
})

export const newTabMode = modePref.get

/** The chosen folder, only meaningful while mode is 'folder'. */
export const newTabFolder = folderPref.get

export function setNewTabMode(mode: NewTabMode, folder?: string): void {
  if (folder !== undefined) folderPref.set(folder)
  modePref.set(mode)
}

export const useNewTabMode = modePref.use
export const useNewTabFolder = folderPref.use
