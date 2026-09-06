/**
 * The first module the phone page runs (2026-09-06, #104). ES imports hoist,
 * so `installShim()` inline in main.tsx would run AFTER every viewer module
 * it imports has evaluated, and `lib/theme` paints on import and reaches for
 * `window.prism` as it does. Importing this module first is what puts the
 * shim in place before anything can look for it.
 */
import { installShim } from './prismShim'

installShim()
