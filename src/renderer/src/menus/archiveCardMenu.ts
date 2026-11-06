import { archiveMenuRows, type ArchiveRow, type ArchiveRowId } from './archiveMenus'

/**
 * THE ZIP CARD'S RIGHT-CLICK (#483; owner, 2026-11-06: "i wanna use it while
 * its in the preview, select files drag them into the main view to extract
 * and so on"). The rows of the selected rows in the preview's zip card: the
 * SAME member verbs the list inside a zip has (`archiveMenuRows`, their words
 * and order), only those that act on what is picked without walking the
 * Explorer or changing the zip. Open (a folder is gone into in the card, a
 * file opens in the viewer), Extract beside the zip, Extract to..., Copy.
 * Left out: Open in new tab and Show in File Explorer (they leave the card),
 * Rename and Delete (the zip is changed from inside it, where its list
 * refreshes), Properties.
 */
const CARD: ReadonlySet<ArchiveRowId> = new Set<ArchiveRowId>(['open', 'extract-here', 'extract-to', 'copy'])

export type ArchiveCardMenuContext =
  | { kind: 'file'; zip: string }
  | { kind: 'folder'; zip: string }
  | { kind: 'many'; count: number; zip: string }

export function archiveCardMenuRows(context: ArchiveCardMenuContext): ArchiveRow[] {
  const all =
    context.kind === 'many'
      ? archiveMenuRows({ kind: 'many', writable: false, count: context.count, zip: context.zip })
      : archiveMenuRows({ kind: context.kind, writable: false, zip: context.zip })
  return all.filter((row) => CARD.has(row.id))
}
