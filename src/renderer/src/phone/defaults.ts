/**
 * What a phone starts with when it has chosen nothing (2026-09-07, #106).
 *
 * The code viewer's word wrap is tri-state on the PC and `auto` by default:
 * prose wraps, code does not. On a phone a line of code that does not wrap
 * is a horizontal scroll on a screen 390 pixels wide, so the phone's default
 * is ON. It is written INTO the preference, once, rather than forced over
 * it: a phone that later turns wrapping off from the editor's menu has
 * chosen, and a default that came back on every open would be a setting that
 * lies. The key and its values are `codePrefs`'s own; this only decides
 * whether the phone has a say.
 */

const WRAP_KEY = 'prism.code.wrap'

/** The value to write, or null when the phone has already chosen. Anything
 *  but on/off is what `codePrefs` reads as `auto`, which is no choice. */
export function phoneWrapDefault(storage: Pick<Storage, 'getItem'>): 'on' | null {
  let v: string | null
  try {
    v = storage.getItem(WRAP_KEY)
  } catch {
    v = null
  }
  return v === 'on' || v === 'off' ? null : 'on'
}
