/** Which key answer FolderBrowser's onKeyDown gives, as a pure function (#537 item 16).
 * The order of the checks is the order of the old else-if chain: the first
 * that fits wins, and the handler claims the key (preventDefault and
 * stopPropagation) for every action it returns.
 */

/** The common keys FolderBrowser answers for the list (#330). */
export const FOLDER_KEYS = new Set(['new-folder', 'bin', 'search', 'properties', 'copy-paths', 'open-new-tab'])

export type FolderKeyAction =
  | 'common'
  | 'refresh'
  | 'delete'
  | 'edit-path'
  | 'find'
  | 'back-or-up'
  | 'history'
  | 'rename'
  | 'clipboard'

export interface FolderKeyEvent {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export interface FolderKeyContext {
  /** The focus is in a text field, an editor or an overlay field. */
  typing: boolean
  /** The focus is inside the list. */
  inList: boolean
  /** The common key listKey gave for the event, already limited to the list (or New folder). */
  common: string | null
  hasSelected: boolean
  many: boolean
  bin: boolean
  hasRefresh: boolean
  hasDelete: boolean
  hasRename: boolean
  /** The target sits in an editor or a document scroller, which keep their own find. */
  inOwnFind: boolean
}

export function folderKeyAction(e: FolderKeyEvent, c: FolderKeyContext): FolderKeyAction | null {
  if (c.common && FOLDER_KEYS.has(c.common)) return 'common'
  if (e.key === 'F5' && c.hasRefresh) return 'refresh'
  if (!c.typing && c.inList && c.hasSelected && e.key === 'Delete' && !e.ctrlKey && !e.shiftKey && (c.hasDelete || c.bin)) {
    return 'delete'
  }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') return 'edit-path'
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !c.inOwnFind) return 'find'
  if (!c.typing && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Backspace') return 'back-or-up'
  if (!c.typing && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.key)) return 'history'
  if (!c.typing && c.inList && c.hasSelected && !c.many && !c.bin && e.key === 'F2' && c.hasRename) return 'rename'
  if (
    !c.typing &&
    c.inList &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    ['c', 'x', 'v'].includes(e.key.toLowerCase())
  ) {
    return 'clipboard'
  }
  return null
}