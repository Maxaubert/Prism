import { useSyncExternalStore } from 'react'

// Whether closing a tab asks first. Same tiny-store shape as treePrefs: one
// key, a hook for the UI, a plain reader for the close path.
//
// Three modes, not a switch: 'agent' sits between them and asks only while
// the tab's shell hosts a live agent (Claude, codex and kin) - the one thing
// in a tab that a reflex Ctrl+W genuinely destroys. Unsaved text is not this
// setting's business: the close path asks about it in every mode.

export type ConfirmClose = 'agent' | 'never'

const KEY = 'prism.tabs.confirmClose'
let listeners: Array<() => void> = []

/** Ordinary browsing closes directly. Legacy confirmation settings now protect
 * agent sessions; an explicit opt-out is retained. Unsaved text always asks. */
export function confirmCloseMode(): ConfirmClose {
  const v = localStorage.getItem(KEY)
  if (v === '0') return 'never'
  return 'agent'
}

export function setConfirmCloseMode(mode: ConfirmClose): void {
  localStorage.setItem(KEY, mode === 'never' ? '0' : 'agent')
  listeners.forEach((l) => l())
}

export function useConfirmCloseMode(): ConfirmClose {
  return useSyncExternalStore(
    (cb) => {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    },
    () => confirmCloseMode()
  )
}
