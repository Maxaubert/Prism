import { useSyncExternalStore } from 'react'

// WHETHER THE WINDOW HAS A TITLE BAR (#250; owner, 2026-10-02: "normal prism
// should also have no titlebar option", the same setting Prism Terminal got in
// its #91). `hidden` drops the title bar's row: the sidebar button, the tabs
// and the bar's own buttons share ONE row, and the wordmark goes. `shown` is
// the window as it always was, and the DEFAULT, so nobody's window changes
// with the update. The same key and words as Prism Terminal's; the value is
// each app's own. Read defensively: anything unknown, or a store that throws,
// is shown.

export type TitleBarMode = 'shown' | 'hidden'

export const TITLE_BAR_KEY = 'prism.window.titleBar'

let listeners: Array<() => void> = []

export function validTitleBar(v: unknown): TitleBarMode {
  return v === 'hidden' ? 'hidden' : 'shown'
}

export function titleBarMode(): TitleBarMode {
  try {
    return validTitleBar(localStorage.getItem(TITLE_BAR_KEY))
  } catch {
    return 'shown'
  }
}

export function setTitleBarMode(mode: TitleBarMode): void {
  try {
    localStorage.setItem(TITLE_BAR_KEY, validTitleBar(mode))
  } catch {
    /* a blocked store keeps the default */
  }
  listeners.forEach((l) => l())
}

export function onTitleBarChange(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

export const useTitleBarMode = (): TitleBarMode => useSyncExternalStore(onTitleBarChange, titleBarMode)
