// Undo and redo for the things Prism WRITES (2026-08-22). The viewer's own
// undo (CodeMirror's, inside a text file) is untouched: this stack is for file
// operations - moving, renaming, binning, duplicating - which until now had no
// way back except Explorer.
//
// Pure on purpose: the stack is bookkeeping, App owns the effects. Every entry
// carries what an inverse needs, so undo never has to guess.

export type UndoEntry =
  /** Files and folders that landed somewhere new: undo moves each back. */
  | { kind: 'move'; items: Array<{ from: string; to: string }>; replaced?: string[] }
  | { kind: 'rename'; from: string; to: string; replaced?: string }
  /** Sent to the Recycle Bin: undo asks Windows for them back. */
  | { kind: 'trash'; paths: string[] }
  /** A copy made beside the original: undo bins the copy, redo asks the
   *  SOURCE for another one (reconstructing it from the copy's name guessed
   *  wrong the moment a name was taken). */
  | { kind: 'duplicate'; source: string; path: string }
  /** Files MOVED into an archive: the members went in and the originals went
   *  to the bin, so undo takes both halves back. */
  | { kind: 'archive-in'; zip: string; dest: string; entries: string[]; originals: string[] }
  /** A NEW FOLDER (#330, Ctrl+Shift+N): undo bins it, and only while it is
   *  still empty; redo makes one of the same name in the same place. */
  | { kind: 'mkdir'; path: string }

export interface UndoState {
  past: readonly UndoEntry[]
  future: readonly UndoEntry[]
}

export const emptyUndo: UndoState = { past: [], future: [] }

/** How deep the history goes. Deliberately shallow: this is a viewer, and a
 *  stack older than the session's memory of it would undo a surprise. */
const CAP = 40

/** A new action happened: it becomes the thing undo will reverse, and the
 *  redo branch it diverged from is gone (the way every editor does it). */
export function remember(state: UndoState, entry: UndoEntry): UndoState {
  return { past: [...state.past, entry].slice(-CAP), future: [] }
}

/**
 * A RENAME THAT FINISHES A NEW FOLDER (#330). Ctrl+Shift+N makes "New folder"
 * and puts it straight into a rename, Explorer's way, and Explorer's Undo then
 * takes the folder away in one step, under whatever name it was given. So a
 * rename of the folder the newest entry just made folds into that entry
 * rather than stacking a second one; any other rename is remembered as usual.
 */
export function rememberRename(
  state: UndoState,
  entry: Extract<UndoEntry, { kind: 'rename' }>
): UndoState {
  const top = state.past[state.past.length - 1]
  if (top?.kind === 'mkdir' && !entry.replaced && top.path.toLowerCase() === entry.from.toLowerCase())
    return { past: [...state.past.slice(0, -1), { kind: 'mkdir', path: entry.to }], future: [] }
  return remember(state, entry)
}

/** Take the newest action off the past; the caller reverses it, then it waits
 *  in the future for a redo. Null when there is nothing to undo. */
export function undone(state: UndoState): { state: UndoState; entry: UndoEntry } | null {
  const entry = state.past[state.past.length - 1]
  if (!entry) return null
  return {
    entry,
    state: { past: state.past.slice(0, -1), future: [entry, ...state.future].slice(0, CAP) }
  }
}

/** Take the newest undone action off the future; the caller re-applies it. */
export function redone(state: UndoState): { state: UndoState; entry: UndoEntry } | null {
  const [entry, ...rest] = state.future
  if (!entry) return null
  return { entry, state: { past: [...state.past, entry].slice(-CAP), future: rest } }
}

const baseName = (p: string): string => /[^\\/]*$/.exec(p)?.[0] ?? p

/** What the action was, for the message that says it was undone. */
export function describe(entry: UndoEntry): string {
  switch (entry.kind) {
    case 'move':
      return entry.items.length > 1 ? `moving ${entry.items.length} items` : `moving ${baseName(entry.items[0]?.to ?? '')}`
    case 'rename':
      return `renaming ${baseName(entry.from)}`
    case 'trash':
      return entry.paths.length > 1 ? `deleting ${entry.paths.length} items` : `deleting ${baseName(entry.paths[0] ?? '')}`
    case 'duplicate':
      return `duplicating ${baseName(entry.path)}`
    case 'mkdir':
      return `making ${baseName(entry.path)}`
    case 'archive-in':
      return entry.entries.length > 1
        ? `moving ${entry.entries.length} items into ${baseName(entry.zip)}`
        : `moving ${baseName(entry.entries[0] ?? '')} into ${baseName(entry.zip)}`
  }
}
