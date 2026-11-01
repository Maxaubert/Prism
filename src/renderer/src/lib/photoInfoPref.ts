import { createPref } from './prefs/createPref'

/**
 * Whether the I key's photo info card is on (#78, D5, owner 2026-11-01:
 * "approve as recommended"). Remembered across launches: someone who wants
 * the camera details wants them on every photo. Off until turned on; a store
 * that refuses reads as off (`createPref`).
 */
export const photoInfoPref = createPref<boolean>({
  key: 'prism.photoInfo',
  parse: (raw) => raw === '1',
  serialize: (on) => (on ? '1' : '0'),
  fallback: false
})
