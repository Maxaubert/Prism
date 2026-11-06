import { createPref } from './createPref'

// KEEP PRISM READY (owner, 2026-11-06: "maybe stay hidden in a mode that
// doesnt use much compute ram, but just a state that helps it launch a lot
// faster"). On by default: closing the last window leaves Prism in standby
// (src/main/standby.ts), so Win+E and a file opened from Windows open fast.
// Off, closing the last window quits Prism, as it always did. Main reads the
// same key through the window preferences store every `prism.*` key is
// mirrored to.

export const STANDBY_KEY = 'prism.standby'

const pref = createPref<boolean>({
  key: STANDBY_KEY,
  read: 'always',
  parse: (raw) => raw !== 'off',
  serialize: (on) => (on ? 'on' : 'off'),
  fallback: true
})

export const stayReady = pref.get
export const setStayReady = pref.set
export const useStayReady = pref.use
