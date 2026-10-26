/**
 * The core's IPC channel names, ONCE. (The terminal's and dictation's tables went
 * with them, 2026-10-26: what is left is the diagnostics log's.)
 */

/** The diagnostics log's channels (#140). A table of its own: a host wires it with one call on each side of the bridge
 *  (`createDiagApi`, `startDiagnostics`). Every `diag:` channel is left out of
 *  the IPC timing, which would otherwise log the log. */
export const DGCH = {
  /** The page's lines, batched every 250 ms. */
  batch: 'diag:batch',
  /** The page is alive: every 500 ms. A 2 s gap asks for its stack. */
  beat: 'diag:beat',
  info: 'diag:info',
  setVerbose: 'diag:set-verbose',
  openFolder: 'diag:open-folder',
  mark: 'diag:mark'
} as const
