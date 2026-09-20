/**
 * THE KEYBOARD, while the extraction window is up (2026-09-19, #166).
 *
 * Owner: "a pop-up window that you can't close ... you just have to wait
 * until it's done extracting", and of the Cancel button asked for the same
 * day: no X, Escape and clicking outside do nothing. The click is easy (the
 * window's scrim covers the app and the app behind it is `inert`). The keys
 * are not, because `inert` stops FOCUS and not KEYSTROKES: with nothing
 * focused a key still arrives at `window`, where App, the sidebar, the
 * archive panel and the players all listen. Ctrl+W would close the tab the
 * extraction was started from, Delete would bin a file, the arrows would page
 * the folder, all behind a window that says the app is busy.
 *
 * Those listeners are on `window` in the CAPTURE phase, and among listeners on
 * one target the order is the order they were added. So this one is added
 * FIRST, before React renders anything (`renderApp.tsx`), which is the only
 * position from which `stopImmediatePropagation` reaches all of them. A guard
 * installed by the window's own effect would run after every listener that
 * was already there, which is all of the ones that matter.
 */
import { extractionUp } from './extraction'

/** Marks the window's box, so the guard can tell a key aimed at its button. */
export const EXTRACT_WINDOW_ATTR = 'data-extract-window'

/**
 * Is this key swallowed? Pure, so the rule is a test.
 *
 * Everything is, except what it takes to work the ONE button from the
 * keyboard: Tab to reach it, Enter or Space to press it, and only when the
 * key is aimed inside the window. Escape is deliberately not on the list.
 */
export function swallows(up: boolean, key: string, insideWindow: boolean): boolean {
  if (!up) return false
  if (insideWindow && (key === 'Tab' || key === 'Enter' || key === ' ')) return false
  return true
}

export function installExtractionGuard(target: Window = window): void {
  const onKey = (e: KeyboardEvent): void => {
    const el = e.target instanceof Element ? e.target : null
    if (!swallows(extractionUp(), e.key, !!el?.closest(`[${EXTRACT_WINDOW_ATTR}]`))) return
    e.stopImmediatePropagation()
    e.preventDefault()
  }
  for (const type of ['keydown', 'keyup', 'keypress'] as const)
    target.addEventListener(type, onKey, true)
}
