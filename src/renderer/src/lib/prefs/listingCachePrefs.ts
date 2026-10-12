import { createPref } from './createPref'
import { REMEMBER_FOLDERS_KEY } from '@shared/listingPrefs'

// WHETHER THE EXPLORER KEEPS A LIST OF WHAT IS IN THE FOLDERS IT OPENS (#271;
// owner-approved recommendation 1, 2026-10-04: "the listing cache on disk, on
// by default, local only, a Settings switch and a Clear button, never for
// network or removable drives"). It is what lets the first frame after a
// launch, even after a reboot, show rows. Main reads the same key through the
// window preferences store and deletes the cache when it goes off.

const pref = createPref<boolean>({
  key: REMEMBER_FOLDERS_KEY,
  read: 'always',
  parse: (raw) => raw !== 'off',
  serialize: (on) => (on ? 'on' : 'off'),
  fallback: true
})

export const rememberFolders = pref.get
export const setRememberFolders = pref.set
export const useRememberFolders = pref.use
