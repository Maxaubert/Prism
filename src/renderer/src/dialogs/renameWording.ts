/**
 * The words of the name dialog (`browse/BrowseRename`), in one place so a test
 * can pin them (docs/dialogs.md). F2 renames something that exists; Ctrl+Shift+N
 * names a folder that was just made, so it reads as that (owner, 2026-11-10:
 * "when you ctrl shift n to create a new folder it says rename"). Escape or
 * Cancel on the second keeps the folder named "New folder", as File Explorer does.
 */
export interface RenameWords {
  title: string
  /** The field's label, and its accessible name. */
  label: string
  /** The primary button. */
  done: string
}

export const RENAME_WORDS: RenameWords = { title: 'Rename', label: 'New name', done: 'Rename' }
export const NEW_FOLDER_WORDS: RenameWords = { title: 'New folder', label: 'Name', done: 'Done' }
