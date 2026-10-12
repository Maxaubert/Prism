import { createPref } from './prefs/createPref'

// How a file from outside is shown in the Explorer tab (owner, 2026-09-22:
// "a setting to choose whether to open files maximized or as previews ...
// default should be preview"). Preview is the folder's list with the preview
// pane showing the file; full is the file filling the Explorer, as a double-
// click on a row does. A saved setting (prefs/createPref.ts), read with the
// plain getter at the moment a file arrives.

export type OpenMode = 'preview' | 'full'

/** Anything but 'full' - unset, junk, an unreadable store - is the default. */
const pref = createPref<OpenMode>({
  key: 'prism.open.external',
  read: 'always',
  // Another window's choice arrives as a storage event (windowPreferences).
  live: true,
  parse: (raw) => (raw === 'full' ? 'full' : 'preview'),
  fallback: 'preview'
})

export const openMode = pref.get
export const setOpenMode = pref.set
export const useOpenMode = pref.use
