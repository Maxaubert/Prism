/**
 * The first module the phone page runs (2026-09-06, #104). ES imports hoist,
 * so `installShim()` inline in main.tsx would run AFTER every viewer module
 * it imports has evaluated, and `lib/theme` paints on import and reaches for
 * `window.prism` as it does. Importing this module first is what puts the
 * shim in place before anything can look for it.
 */
import { installShim } from './prismShim'
import { setWrapPref } from '../lib/codePrefs'
import { phoneWrapDefault } from './defaults'

installShim()
// The phone's own defaults, written once into the preferences a viewer
// reads (#106): word wrap on, unless this phone has already chosen.
// `localStorage` itself can throw where site data is blocked; a phone with
// no storage still gets the default, for the session.
let wrap: 'on' | null
try {
  wrap = phoneWrapDefault(localStorage)
} catch {
  wrap = 'on'
}
if (wrap) setWrapPref(wrap)
