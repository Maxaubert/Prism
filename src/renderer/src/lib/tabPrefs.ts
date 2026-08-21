import { useSyncExternalStore } from 'react'

// Whether closing a tab asks first. Same tiny-store shape as treePrefs: one
// key, a hook for the UI, a plain reader for the close path.

const KEY = 'prism.tabs.confirmClose'
let listeners: Array<() => void> = []

/** Default ON: a tab carries a place and possibly a shell; a reflex Ctrl+W
 *  should not silently take both. The Settings toggle is the opt-out. */
export function confirmCloseTabs(): boolean {
  return localStorage.getItem(KEY) !== '0'
}

export function setConfirmCloseTabs(on: boolean): void {
  localStorage.setItem(KEY, on ? '1' : '0')
  listeners.forEach((l) => l())
}

export function useConfirmCloseTabs(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    },
    () => confirmCloseTabs()
  )
}
