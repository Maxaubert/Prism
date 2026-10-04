import { useSyncExternalStore } from 'react'
import { REMEMBER_FOLDERS_KEY } from '@shared/listingPrefs'

// WHETHER THE EXPLORER KEEPS A LIST OF WHAT IS IN THE FOLDERS IT OPENS (#271;
// owner-approved recommendation 1, 2026-10-04: "the listing cache on disk, on
// by default, local only, a Settings switch and a Clear button, never for
// network or removable drives"). It is what lets the first frame after a
// launch, even after a reboot, show rows. Main reads the same key through the
// window preferences store and deletes the cache when it goes off.

let listeners: Array<() => void> = []

export function rememberFolders(): boolean {
  try {
    return localStorage.getItem(REMEMBER_FOLDERS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setRememberFolders(on: boolean): void {
  try {
    localStorage.setItem(REMEMBER_FOLDERS_KEY, on ? 'on' : 'off')
  } catch {
    /* a blocked store keeps the default */
  }
  listeners.forEach((l) => l())
}

const sub = (cb: () => void): (() => void) => {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

export const useRememberFolders = (): boolean => useSyncExternalStore(sub, rememberFolders)
