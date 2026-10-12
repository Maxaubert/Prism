import type { OpenPayload } from '@shared/types'

/** The agent a close is about to end: what it is, and how long it has been
 *  mid-answer. `forMs` is null when it is only present, waiting at its own
 *  prompt - still a conversation the close ends. */
export interface AgentBusy {
  kind: 'claude' | 'codex' | 'other'
  forMs: number | null
}

/** A question Prism has to put to the user before (or instead of) touching a
 *  file. App holds one at a time; `AskDialogs` draws it. */
export type Ask =
  | { kind: 'delete'; path: string; name: string; isFolder: boolean }
  | { kind: 'delete-many'; paths: string[] }
  | { kind: 'move-clash'; paths: string[]; dest: string; names: string[] }
  | { kind: 'clash'; path: string; name: string; suggestion: string }
  | { kind: 'failed'; message: string }
  | { kind: 'close-dirty'; then?: 'install' }
  // Closing a TAB whose root holds unsaved text. Same three answers as the
  // window's, because the stake is the same: leave that tab and the only route
  // back to those buffers is gone, even though the window stays open.
  | { kind: 'close-tab'; id: string; names: readonly string[] }
  // The plain "sure?" for a clean tab, on by default and switchable in
  // Settings. Dirty tabs take the unsaved-changes question above instead.
  | { kind: 'close-tab-confirm'; id: string; label: string; agent: AgentBusy }
  // The WINDOW, while an agent is mid-answer. `others` is how many more
  // shells are working too; `then` carries an update install through.
  | { kind: 'close-window-agent'; label: string; agent: AgentBusy; others: number; then?: 'install' }
  | { kind: 'file-changed'; path: string; name: string }
  // Pointing a tab at a different folder strands its unsaved text exactly as
  // closing it would, so it asks the same question and carries the payload it
  // will apply on the way through.
  | { kind: 'reroot'; id: string; names: readonly string[]; payload: OpenPayload }
