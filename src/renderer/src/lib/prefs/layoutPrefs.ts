import { createPref } from './createPref'

// THE WINDOW'S OWN LAYOUT, AND WHETHER SETUP HAS RUN: the switches App reads
// once at mount and writes as they flip. The panels are this window's
// (`window` in @shared/prefKeys), so a second window keeps its own.

const flag = (on: boolean): string => (on ? '1' : '0')

/** The Explorer tab's places panel. On unless it was closed. */
export const placesPref = createPref<boolean>({
  key: 'prism.explorer.places',
  read: 'always',
  parse: (raw) => raw !== '0',
  serialize: flag,
  fallback: true
})

/** Settings' rail, collapsed to its icons. */
export const compactRailPref = createPref<boolean>({
  key: 'prism.settings.rail',
  read: 'always',
  parse: (raw) => raw === '1',
  serialize: flag,
  fallback: false
})

/** The setup guide has been through once. Shown again from Settings > About. */
export const onboardedPref = createPref<boolean>({
  key: 'prism.onboarded',
  read: 'always',
  parse: (raw) => raw === '1',
  serialize: flag,
  fallback: false
})
