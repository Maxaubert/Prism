import { app } from 'electron'

/**
 * The single-instance lock, asked for ONCE per process (2026-11-28). `boot.ts`
 * asks first, before the app's main code is loaded; `index.ts` reads the same
 * answer. Electron's own call is not made twice.
 */
let held: boolean | undefined

export function haveInstanceLock(): boolean {
  held ??= app.requestSingleInstanceLock()
  return held
}
