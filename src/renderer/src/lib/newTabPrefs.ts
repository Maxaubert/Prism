import { useSyncExternalStore } from 'react'

// What the + (and Ctrl+T) opens: where the new tab roots, and what it shows.
// Same tiny-store shape as tabPrefs.

export type NewTabMode = 'home' | 'folder' | 'ask'
export type NewTabShow = 'file' | 'terminal' | 'none'

const MODE_KEY = 'prism.newtab.mode'
const FOLDER_KEY = 'prism.newtab.folder'
const SHOW_KEY = 'prism.newtab.show'

let listeners: Array<() => void> = []
const notify = (): void => listeners.forEach((l) => l())

export function newTabMode(): NewTabMode {
  const v = localStorage.getItem(MODE_KEY)
  return v === 'folder' || v === 'ask' ? v : 'home'
}

/** The chosen folder, only meaningful while mode is 'folder'. */
export function newTabFolder(): string {
  return localStorage.getItem(FOLDER_KEY) ?? ''
}

export function newTabShow(): NewTabShow {
  const v = localStorage.getItem(SHOW_KEY)
  return v === 'terminal' || v === 'none' ? v : 'file'
}

export function setNewTabMode(mode: NewTabMode, folder?: string): void {
  localStorage.setItem(MODE_KEY, mode)
  if (folder !== undefined) localStorage.setItem(FOLDER_KEY, folder)
  notify()
}

export function setNewTabShow(show: NewTabShow): void {
  localStorage.setItem(SHOW_KEY, show)
  notify()
}

const sub = (cb: () => void): (() => void) => {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

export function useNewTabMode(): NewTabMode {
  return useSyncExternalStore(sub, newTabMode)
}
export function useNewTabFolder(): string {
  return useSyncExternalStore(sub, newTabFolder)
}
export function useNewTabShow(): NewTabShow {
  return useSyncExternalStore(sub, newTabShow)
}
