import { createPref } from './prefs/createPref'

// WHETHER PRISM REOPENS LAST TIME'S TABS (owner, 2026-09-22: "Prism should also
// have the option to not remember tabs"). On by default, which is how Prism
// has always started. Off, a cold start opens only the Explorer tab (and
// whatever file or folder Prism was opened with). The tabs are still SAVED
// while it is off, so a reload of the window keeps them and switching it back
// on loses nothing. Main reads the same key at startup, through the window
// preferences store every `prism.*` key is mirrored to.

export const REMEMBER_TABS_KEY = 'prism.tabs.remember'

const pref = createPref<boolean>({
  key: REMEMBER_TABS_KEY,
  read: 'always',
  parse: (raw) => raw !== 'off',
  serialize: (on) => (on ? 'on' : 'off'),
  fallback: true
})

export const rememberTabs = pref.get
export const setRememberTabs = pref.set
export const useRememberTabs = pref.use
