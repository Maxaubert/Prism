import type { FileKind } from '@shared/types'

/**
 * WHICH FIND CTRL+F OPENS IN THE EXPLORER (owner, 2026-11-04: "the normal
 * search should only appear if youre not on a searchable file or youre on a
 * folder or you have nothing selected. otherwise when find is available and
 * your on that as the selected file or you just clicked the preview part it
 * should open find. so if you have a pdf open in preview and youre on a folder
 * as selected file then find should only open if you clicked the preview
 * part.").
 *
 * One answer from what is on screen, never from what happened before (the
 * owner saw the search first and, after an Escape, the PDF's find for the same
 * selection): the selected row and where the key came from decide.
 * - From the PREVIEW (the focus is in it, or the last press was): its own find
 *   if it has one, whatever row is selected.
 * - From anywhere else (the list, the rest of the Explorer, nowhere): the
 *   preview's find only when the SELECTED row is a file whose preview has one
 *   and that find is on screen; a folder, no selection, or a picture, a film,
 *   a song or an archive is the Explorer's search.
 */
export type FindRoute = 'preview-find' | 'explorer-search'

/** What the selected row is: a folder, nothing, or a file of this kind. */
export type FindSelection = 'folder' | 'none' | FileKind

/** The kinds whose viewer has a find of its own: PdfView, DocView (office,
 *  epub), MarkdownView and CodeView (text and code). */
const OWN_FIND: ReadonlySet<FileKind> = new Set<FileKind>(['pdf', 'doc', 'text'])

export function hasOwnFind(selection: FindSelection): boolean {
  return selection !== 'folder' && selection !== 'none' && OWN_FIND.has(selection)
}

export function findRoute(input: {
  selection: FindSelection
  /** Where the key came from: the preview pane, or anywhere else. */
  from: 'preview' | 'explorer'
  /** The preview pane shows a viewer with a find right now. */
  previewFind: boolean
}): FindRoute {
  if (!input.previewFind) return 'explorer-search'
  if (input.from === 'preview') return 'preview-find'
  return hasOwnFind(input.selection) ? 'preview-find' : 'explorer-search'
}
