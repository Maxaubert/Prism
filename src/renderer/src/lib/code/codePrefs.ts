import { createPref } from '../prefs/createPref'

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

/** The phone writes its own default into the same key (phone/defaults.ts). */
export const WRAP_KEY = 'prism.code.wrap'

const wrap = createPref<WrapPref>({
  key: WRAP_KEY,
  parse: (v) => (v === 'on' || v === 'off' ? v : 'auto'),
  fallback: 'auto'
})

export const wrapPref = wrap.get
export const setWrapPref = wrap.set

/** Does THIS file wrap? `auto` keeps the old per-kind rule. */
export function wrapsFor(pref: WrapPref, prose: boolean): boolean {
  if (pref === 'on') return true
  if (pref === 'off') return false
  return prose
}

export const useWrapPref = wrap.use
