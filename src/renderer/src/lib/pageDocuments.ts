/**
 * THE PAGE'S DOCUMENTS (2026-11-08, the preview window; `ownWindow.ts` has the
 * rule). This page draws the preview window's viewer into that window's own
 * document, so a question about everything on the page (is anything playing,
 * which players are a tab's) asks every one of them, not `document` alone.
 */

const drawnInto = new Set<Document>()

/** A window this page draws into, until the returned undo. */
export function addPageDocument(doc: Document): () => void {
  drawnInto.add(doc)
  return () => {
    drawnInto.delete(doc)
  }
}

export function pageDocuments(): Document[] {
  return [document, ...[...drawnInto].filter((d) => d !== document)]
}

/**
 * A right-click menu or a question up in front, in ANY of the page's
 * documents: the list's Space and Escape stand down for it (a menu in the
 * preview window, owner 2026-11-08, as much as one in the Explorer).
 */
export function menuOrDialogUp(docs: ReadonlyArray<Pick<Document, 'querySelector'>> = pageDocuments()): boolean {
  return docs.some((d) => !!d.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]'))
}
