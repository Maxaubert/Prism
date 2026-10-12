import type { OpenWithApp } from '@shared/types'

// The project tree's own shapes, shared by Sidebar.tsx and its hooks.

export interface Menu {
  x: number
  y: number
  path: string
  name: string
  isFolder: boolean
  /** Bytes on disk, for the Properties row's hint. Folders carry none. */
  size?: number
  /** "Open in" candidates: undefined for folders, null while they load. */
  apps?: OpenWithApp[] | null
  /** Set when the right-click landed inside a multi-selection: every selected
   *  path, and the menu acts on all of them. */
  multi?: string[]
  /** The archive verbs, for a row that is one: undefined when the row is not an
   *  archive, null while the stat is in flight. `write` is false for a 7z, a
   *  rar and anything else read-only, and for a zip past adm-zip's ceiling -
   *  which is why it is asked rather than inferred from the extension. */
  arc?: { write: boolean } | null
  /** Whether the clipboard holds files, so a Paste row is worth drawing.
   *  Undefined while the answer is in flight - the row appears when it lands
   *  rather than being drawn disabled, because a verb that cannot work is
   *  noise. */
  canPaste?: boolean
}

/** An extraction started from a tree row, and what to say about it.
 *
 *  The archive PANEL has a progress track and a button that can say
 *  "Extracting…"; a context menu has neither, and it closes the moment the verb
 *  is picked. A 2GB archive takes minutes, and minutes of nothing is
 *  indistinguishable from a hang - the same lesson the panel's own progress
 *  reporting was written for - so the job gets a dialog of its own. */
export interface ArcJob {
  path: string
  name: string
  pct: number | null
  error?: string
}
