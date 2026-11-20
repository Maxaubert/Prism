/**
 * THE DOCUMENTS A TIP CAN APPEAR IN (audit #95). `Tooltips` is mounted once, in the page's own window; a host that
 * draws part of its tree into another window (Prism's preview window, a portal into `window.open`) registers that
 * window's document here, and the tips follow the pointer there too. The core has no `src/`, so the registry is
 * its own.
 */
const extra = new Set<Document>()
const watchers = new Set<() => void>()

/** A window the host draws into, until the returned undo. */
export function addTooltipDocument(doc: Document): () => void {
  extra.add(doc)
  watchers.forEach((w) => w())
  return () => {
    extra.delete(doc)
    watchers.forEach((w) => w())
  }
}

/** This page's document first, then every registered one. */
export function tooltipDocuments(): Document[] {
  return [document, ...[...extra].filter((d) => d !== document)]
}

/** Told whenever the list changes; returns the undo. */
export function onTooltipDocuments(fn: () => void): () => void {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}