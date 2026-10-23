/**
 * The versions the terminal reports to a program that asks (XTVERSION, #171).
 *
 * The terminal is Prism's now, so XTVERSION reports PRISM'S version: the host
 * build defines `__PRISM_VERSION__` from the root package.json
 * (`electron.vite.config.ts` for the app, `vitest.config.ts` for the tests),
 * so a release needs no second number to bump. `termVersion.test.ts` holds
 * both constants to the package files.
 */
declare const __PRISM_VERSION__: string
export const TERM_APP_VERSION: string = typeof __PRISM_VERSION__ === 'string' ? __PRISM_VERSION__ : '0.0.0'
export const XTERM_VERSION = '6.0.0'