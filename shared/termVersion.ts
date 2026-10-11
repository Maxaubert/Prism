/**
 * The versions the terminal reports to a program that asks (XTVERSION, #171).
 *
 * Constants, not a JSON import of package.json: Prism's renderer tsconfig is
 * `composite` and does not include the core's package.json, so the import
 * would not build there. `termVersion.test.ts` holds both to the package files,
 * so a core release that bumps `core/package.json` (or xterm) without this
 * fails `npm test` (core/README.md, "Releasing the core").
 */
export const TERM_CORE_VERSION = '0.32.0'
export const XTERM_VERSION = '6.0.0'
