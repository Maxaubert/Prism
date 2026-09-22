import { useSyncExternalStore } from 'react'

// WHETHER PRISM REOPENS LAST TIME'S TABS (owner, 2026-09-22: "Prism should also
// have the option to not remember tabs"). On by default, which is how Prism
// has always started. Off, a cold start opens only the Explorer tab (and
// whatever file or folder Prism was opened with). The tabs are still SAVED
// while it is off, so a reload of the window keeps them and switching it back
// on loses nothing. Main reads the same key at startup, through the window
// preferences store every `prism.*` key is mirrored to.

export const REMEMBER_TABS_KEY = 'prism.tabs.remember'

let listeners: Array<() => void> = []

export function rememberTabs(): boolean {
  try {
    return localStorage.getItem(REMEMBER_TABS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setRememberTabs(on: boolean): void {
  try {
    localStorage.setItem(REMEMBER_TABS_KEY, on ? 'on' : 'off')
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

export const useRememberTabs = (): boolean => useSyncExternalStore(sub, rememberTabs)
