/**
 * THE MENUS OF A PLACE INSIDE AN ARCHIVE (#300; owner, 2026-10-06: "you open
 * them like any other folder but you get the zip relevant right click menu
 * options"). Pure: the rows each context shows, in order, and nothing about
 * what they do, which App wires to the archive verbs main already has. The
 * e2e compares the menus on screen against this.
 *
 * LEFT OUT, because the archive code cannot do them safely (the spec's
 * Decision 5): Rename on a FOLDER inside a zip (`renameMember` is file-only,
 * "a decision, not a gap", 2026-08-30), "Open with" an app on a member (the app
 * would be handed a temp copy and whatever it saved would be lost), and Paste
 * into a zip (not in the mockup; it would be a new route). A read-only
 * container (a 7z and the rest, a zip past adm-zip's cap, a nested one) has no
 * Add, Rename or Delete anywhere.
 */

export type ArchiveRowId =
  | 'open'
  | 'open-new-tab'
  | 'extract-here'
  | 'extract-to'
  | 'add-files'
  | 'copy'
  | 'copy-path'
  | 'rename'
  | 'delete'
  | 'show'
  | 'properties'

export interface ArchiveRow {
  id: ArchiveRowId
  label: string
  hint?: string
  danger?: true
}

export type ArchiveMenuContext =
  /** An archive's own row, outside it (mockup 02). */
  | { kind: 'outside'; writable: boolean }
  /** A folder inside an archive (mockup 07). */
  | { kind: 'folder'; writable: boolean; zip: string }
  /** A file inside an archive (mockup 08). */
  | { kind: 'file'; writable: boolean; zip: string }
  /** Several rows marked inside an archive. */
  | { kind: 'many'; writable: boolean; count: number; zip: string }
  /** The list's empty space inside an archive. */
  | { kind: 'empty'; writable: boolean; zip: string }

export function archiveMenuRows(context: ArchiveMenuContext): ArchiveRow[] {
  const w = context.writable
  const rows: Array<ArchiveRow | false> = (() => {
    switch (context.kind) {
      case 'outside':
        return [
          { id: 'open', label: 'Open', hint: 'Enter' },
          { id: 'open-new-tab', label: 'Open in new tab' },
          { id: 'extract-here', label: 'Extract here' },
          { id: 'extract-to', label: 'Extract to...' },
          w && { id: 'add-files', label: 'Add files...' },
          { id: 'copy', label: 'Copy', hint: 'Ctrl+C' },
          { id: 'copy-path', label: 'Copy path' },
          { id: 'rename', label: 'Rename', hint: 'F2' },
          { id: 'delete', label: 'Delete', hint: 'Del', danger: true },
          { id: 'show', label: 'Show in File Explorer' },
          { id: 'properties', label: 'Properties' }
        ]
      case 'folder':
        return [
          { id: 'open', label: 'Open', hint: 'Enter' },
          { id: 'open-new-tab', label: 'Open in new tab' },
          { id: 'extract-here', label: 'Extract this folder' },
          { id: 'extract-to', label: 'Extract this folder to...' },
          w && { id: 'add-files', label: 'Add files here...' },
          { id: 'copy', label: 'Copy folder', hint: 'Ctrl+C' },
          w && { id: 'delete', label: 'Delete from zip', hint: 'Del', danger: true },
          { id: 'show', label: `Show ${context.zip} in File Explorer` },
          { id: 'properties', label: 'Properties' }
        ]
      case 'file':
        return [
          { id: 'open', label: 'Open', hint: 'Enter' },
          { id: 'extract-here', label: 'Extract this file' },
          { id: 'extract-to', label: 'Extract this file to...' },
          { id: 'copy', label: 'Copy file', hint: 'Ctrl+C' },
          w && { id: 'rename', label: 'Rename', hint: 'F2' },
          w && { id: 'delete', label: 'Delete from zip', hint: 'Del', danger: true },
          { id: 'show', label: `Show ${context.zip} in File Explorer` },
          { id: 'properties', label: 'Properties' }
        ]
      case 'many':
        return [
          { id: 'copy', label: `Copy ${context.count} items`, hint: 'Ctrl+C' },
          { id: 'extract-here', label: `Extract ${context.count} items here` },
          { id: 'extract-to', label: `Extract ${context.count} items to...` },
          w && {
            id: 'delete',
            label: `Delete ${context.count} items from zip`,
            hint: 'Del',
            danger: true
          }
        ]
      case 'empty':
        return [
          { id: 'extract-here', label: 'Extract here' },
          { id: 'extract-to', label: 'Extract to...' },
          w && { id: 'add-files', label: 'Add files here...' },
          { id: 'show', label: `Show ${context.zip} in File Explorer` },
          { id: 'copy-path', label: 'Copy address' }
        ]
    }
  })()
  return rows.filter((r): r is ArchiveRow => !!r)
}
