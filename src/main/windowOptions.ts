import type { SessionEntry } from './session'
import type { Launch } from './startupLog'
import type { WindowSeed } from './windowRegistry'

/** How a window is made (2026-10-29: Prism has several in one process). */
export interface WindowOptions {
  /** The session's first window, or its crash rebuild: the one a cold-start
   *  Win+E lands in, and the e2e's main window. */
  first?: boolean
  /** Where its tabs come from (windowRegistry.ts `WindowSeed`). Only the cold
   *  start's first window is made with `saved`. */
  seed?: WindowSeed
  /** `--prism-setup` / `--prism-demo`: the cold start's first window's only. */
  launchFlags?: readonly string[]
  /** Where it opens; the first window's come from the session file. */
  bounds?: { x?: number; y?: number; width: number; height: number }
  /** The saved entry of the session file, for the cold start's first window. */
  saved?: SessionEntry | null
  /** The Win+E or folder-verb request this window is opened for while Prism
   *  runs (step 2): its page answers it. */
  winE?: string | null
  /** The tear-off's spare (step 3): hidden until a tab is torn off into it. */
  spare?: boolean
  /** Shown at once, before its page (a Win+E's window after a wake from standby). */
  showNow?: boolean
  /** The launch or wake this window is timed for (`startupLog.ts`). */
  launch?: Launch
}