import { createPref } from './prefs/createPref'

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

export function validTitleBar(v: unknown): TitleBarMode {
  return v === 'hidden' ? 'hidden' : 'shown'
}

const pref = createPref<TitleBarMode>({
  key: TITLE_BAR_KEY,
  read: 'always',
  parse: validTitleBar,
  serialize: validTitleBar,
  fallback: 'shown'
})

export const titleBarMode = pref.get
export const setTitleBarMode = pref.set
export const onTitleBarChange = pref.subscribe
export const useTitleBarMode = pref.use
