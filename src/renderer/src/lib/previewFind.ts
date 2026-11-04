/**
 * The Explorer's preview pane and the find inside it (owner, 2026-11-04; the
 * rule is `findRoute.ts`). The viewers' own Ctrl+F listeners sit on `window`
 * and used to take the key from anywhere nobody had claimed it first: from
 * nowhere (body), from a tab button, from wherever the focus landed after a
 * popup closed. In the Explorer's preview that is no longer theirs to decide:
 * a viewer there answers a find key only when it comes from INSIDE it, and the
 * Explorer routes the rest, handing the key in with `openPreviewFind` when the
 * rule says the preview's find.
 */

/** The App's viewer box while it is the Explorer's preview. */
export const PREVIEW = '[data-browse-preview]'
/** What carries a viewer's find: PdfView, DocView and MarkdownView's scroller,
 *  CodeView's editor. */
const FIND_SURFACE = '[data-doc-scroller],.cm-editor'

export function inPreview(el: Element | null | undefined): boolean {
  return !!el?.closest(PREVIEW)
}

/** The find surface of the viewer on screen in the preview, if it has one. A
 *  background tab's viewer (inert, a pixel wide) is never it. */
export function previewFindSurface(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`${PREVIEW} :is(${FIND_SURFACE})`)) {
    if (el.closest('[inert]') || !el.getClientRects().length) continue
    if (el.parentElement?.closest(FIND_SURFACE)) continue
    return el
  }
  return null
}

/**
 * True when a viewer must leave a find key to the Explorer: the viewer is the
 * Explorer's preview and the key was not pressed inside the preview (its find
 * bar included). Outside the Explorer (the viewer on its own) it is always the
 * viewer's.
 */
export function yieldsFindToExplorer(
  box: Element | null | undefined,
  target: EventTarget | null
): boolean {
  if (!box?.closest(PREVIEW)) return false
  return !(target instanceof Element && inPreview(target))
}

/**
 * Hands a find key to the preview's viewer, as if pressed inside it. F3 goes
 * in as F3 first (the PDF's: it steps an open find), and as Ctrl+F when no
 * viewer took it (the document and code finds open on Ctrl+F only).
 */
export function openPreviewFind(
  surface: HTMLElement,
  key: 'find' | 'F3' = 'find',
  shift = false
): void {
  const send = (init: KeyboardEventInit): boolean =>
    surface.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    )
  if (key === 'F3' && !send({ key: 'F3', code: 'F3', shiftKey: shift })) return
  send({ key: 'f', code: 'KeyF', ctrlKey: true })
}
