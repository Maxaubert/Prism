import { createPref } from './prefs/createPref'

// HOW WIDE A TAB IS (owner, 2026-09-23, asked in Prism Terminal and agreed for
// Prism: "add a setting for tab width, where the user can pick fixed size or
// dynamic, so essentially what we got now and what we had before"; then "call
// it dynamic ... have dynamic be the default"). `dynamic` is the tab as wide as
// its name, up to a cap, as before 2026-09-21, and the DEFAULT by the owner's
// word; `fixed` is every tab one width. The same key and words as Prism
// Terminal's; the value is each app's own.

export type TabWidth = 'dynamic' | 'fixed'

export const TAB_WIDTH_KEY = 'prism.window.tabWidth'

export function validTabWidth(v: unknown): TabWidth {
  return v === 'fixed' ? 'fixed' : 'dynamic'
}

const pref = createPref<TabWidth>({
  key: TAB_WIDTH_KEY,
  read: 'always',
  parse: validTabWidth,
  serialize: validTabWidth,
  fallback: 'dynamic'
})

export const tabWidth = pref.get
export const setTabWidth = pref.set
export const onTabWidthChange = pref.subscribe
export const useTabWidth = pref.use
