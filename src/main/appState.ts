import type { BrowserWindow } from 'electron'

/**
 * What more than one part of main needs to know about the app right now
 * (stage 9c of the structure cleanup, 2026-10-12). These were `let`s at the
 * top of index.ts; once the window chrome, the update flow and the IPC
 * handlers moved into their own files, each of them needed the same answer,
 * so the answer lives here and nowhere else. Plain fields, read and written
 * in place: a module that copied one out would be holding a stale value.
 */
export const appState = {
  /** The window, or null while there is none (between a crash and its
   *  rebuild, or before the first one). */
  mainWindow: null as BrowserWindow | null,
  /** The renderer's editor holds unsaved text. Mirrored here so `close` can ask. */
  editorDirty: false,
  /** Mirrored from the renderer: an agent is MID-ANSWER in some shell. Holds the
   *  window exactly as unsaved text does (prism-term-core's close rule, #154). */
  agentBusy: false,
  /** The user has answered the "unsaved changes" question: let the close through. */
  closeConfirmed: false,
  /** An update is installing: the quit it ends in is already agreed to. */
  installingUpdate: false,
  /** `before-quit` has fired (or the window gave up): nothing new is started. */
  appQuitting: false
}

/**
 * The e2e's window never takes the foreground (2026-08-28).
 *
 * Electron has no headless mode, so the suite parks a real window offscreen -
 * but every launch still ACTIVATED it, and a suite that launches thirty times
 * yanked the caret out of whatever the machine's owner was typing. Playwright
 * drives the page over CDP, which needs no OS focus at all, so in this mode
 * the window is created unfocusable and shown inactive.
 */
export const E2E = process.argv.includes('--e2e')
