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
