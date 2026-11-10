
/** A question Prism has to put to the user before (or instead of) touching a
 *  file. App holds one at a time; `AskDialogs` draws it. */
export type Ask =
  | { kind: 'delete'; path: string; name: string; isFolder: boolean }
  | { kind: 'delete-many'; paths: string[] }
  // The middle button of a delete: the same items, for good (#500).
  | { kind: 'delete-permanent'; paths: string[] }
  | { kind: 'move-clash'; paths: string[]; dest: string; names: string[] }
  | { kind: 'clash'; path: string; name: string; suggestion: string }
  | { kind: 'failed'; message: string; op?: string }
  | { kind: 'close-dirty'; then?: 'install' }
  // Closing a TAB that holds unsaved text. Same three answers as the
  // window's, because the stake is the same: leave that tab and the only route
  // back to those buffers is gone, even though the window stays open.
  | { kind: 'close-tab'; id: string; names: readonly string[] }
  | { kind: 'file-changed'; path: string; name: string }
  // Change icon... on folder rows or a sidebar pin (2026-10-31): one pick
  // applies to every path. `name` is the folder's, or "3 folders".
  | { kind: 'folder-icon'; paths: string[]; name: string }
  // The Recycle Bin's own questions (Recycle Bin, D13 to D15). `paths` are bin
  // entries and `names` their ORIGINAL names. A Restore onto taken names asks
  // the move question (the same dialog); Delete permanently and Empty are final.
  | { kind: 'bin-clash'; paths: string[]; names: string[] }
  /** `bytes` is the total of these rows from the list (`$I` sizes), when it is on screen. */
  | { kind: 'bin-delete'; paths: string[]; names: string[]; bytes?: number }
  // Empty Recycle Bin: main counts what it frees when the question opens (#503).
  | { kind: 'bin-empty' }
