import type { BrowserWindow } from 'electron'
import type { HotkeyOpening } from './hotkeyRepeat'
import type { QuitReason } from './standby'

/** The window the latest Win+E press is opening, for repeat presses
 *  (`hotkeyRepeat.ts`; owner, 2026-11-06: four presses opened four windows). */
export type HotkeyWindow = HotkeyOpening & { win: BrowserWindow | null }

/**
 * THE PROCESS STATE THAT MORE THAN ONE PART OF MAIN READS OR SETS (audit #7
 * step 2). It was a handful of `let`s in index.ts, which the window factory,
 * the launch router and the quit path all touched; they now share this one
 * object, handed to each of them, so index.ts can be split without a global.
 */
export interface MainState {
  /** The first window of the session has been made (whenReady). */
  firstWindowMade: boolean
  /** `session-end` comes to every window; its last lines are written once. */
  sessionEnded: boolean
  /** Why this process is quitting, for the `quit` line (owner, 2026-11-06). */
  quitReason: QuitReason | null
  /** The window the latest Win+E press is opening. */
  hotkeyOpening: HotkeyWindow | null
  /** The session file as it was at startup (2026-10-29): the first window is
   *  sized from it, and its restore reads its strip from it. */
  sessionRaw: string | null
  /** Startup is over: a first window has restored (spareIdle.ts `settled`). */
  startupSettled: boolean
}

export function createMainState(): MainState {
  return {
    firstWindowMade: false,
    sessionEnded: false,
    quitReason: null,
    hotkeyOpening: null,
    sessionRaw: null,
    startupSettled: false
  }
}
