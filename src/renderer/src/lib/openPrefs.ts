import { useSyncExternalStore } from 'react'

// How a file from outside is shown in the Explorer tab (owner, 2026-09-22:
// "a setting to choose whether to open files maximized or as previews ...
// default should be preview"). Preview is the folder's list with the preview
// pane showing the file; full is the file filling the Explorer, as a double-
// click on a row does. Same tiny-store shape as newTabPrefs, read with the
// plain getter at the moment a file arrives.

export type OpenMode = 'preview' | 'full'

const KEY = 'prism.open.external'

let listeners: Array<() => void> = []
const notify = (): void => listeners.forEach((l) => l())

/** Anything but 'full' - unset, junk, an unreadable store - is the default. */
export function openMode(): OpenMode {
  try {
    return localStorage.getItem(KEY) === 'full' ? 'full' : 'preview'
  } catch {
    return 'preview'
  }
}

export function setOpenMode(mode: OpenMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* a blocked store loses the choice, not the app */
  }
  notify()
}

const sub = (cb: () => void): (() => void) => {
  listeners.push(cb)
  // Another window's choice arrives as a storage event (windowPreferences).
  window.addEventListener('storage', cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
    window.removeEventListener('storage', cb)
  }
}

export function useOpenMode(): OpenMode {
  return useSyncExternalStore(sub, openMode)
}
