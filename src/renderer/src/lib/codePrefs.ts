import { useSyncExternalStore } from 'react'

/**
 * How the code viewer is set up, kept out of the component so a preference
 * survives paging to the next file.
 *
 * Word wrap is TRI-STATE, and the middle value is the default for a reason
 * (2026-08-31). Prose has always wrapped and code has never wrapped - that is
 * what `chromeFor` decided per file - so a plain on/off boolean defaulting to
 * off would silently unwrap every .txt and .log the day it shipped, which is
 * a regression wearing a feature's clothes. `auto` keeps the old rule; `on`
 * and `off` are the override for the minified .json that is otherwise a
 * horizontal scrollbar and nothing else.
 */

export type WrapPref = 'auto' | 'on' | 'off'

const WRAP_KEY = 'prism.code.wrap'
const listeners = new Set<() => void>()

function loadWrap(): WrapPref {
  try {
    const v = localStorage.getItem(WRAP_KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let wrap: WrapPref = loadWrap()

export function wrapPref(): WrapPref {
  return wrap
}

export function setWrapPref(v: WrapPref): void {
  wrap = v
  try {
    localStorage.setItem(WRAP_KEY, v)
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

/** Does THIS file wrap? `auto` keeps the old per-kind rule. */
export function wrapsFor(pref: WrapPref, prose: boolean): boolean {
  if (pref === 'on') return true
  if (pref === 'off') return false
  return prose
}

export function useWrapPref(): WrapPref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => wrap
  )
}
