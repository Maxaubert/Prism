import { createPref } from './createPref'

// What the + (and Ctrl+T) opens: where the new tab roots, and what it shows.
// One saved setting per key (prefs/createPref.ts).

export type NewTabMode = 'home' | 'folder' | 'ask'
// 'terminal' is gone (2026-10-26); a saved one reads as the folder browser.
export type NewTabShow = 'file' | 'none'

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
const showPref = createPref<NewTabShow>({
  key: 'prism.newtab.show',
  read: 'always',
  parse: (v) => (v === 'file' ? v : 'none'),
  fallback: 'none'
})

export const newTabMode = modePref.get

/** The chosen folder, only meaningful while mode is 'folder'. */
export const newTabFolder = folderPref.get

export const newTabShow = showPref.get

export function setNewTabMode(mode: NewTabMode, folder?: string): void {
  if (folder !== undefined) folderPref.set(folder)
  modePref.set(mode)
}

export const setNewTabShow = showPref.set

export const useNewTabMode = modePref.use
export const useNewTabFolder = folderPref.use
export const useNewTabShow = showPref.use
