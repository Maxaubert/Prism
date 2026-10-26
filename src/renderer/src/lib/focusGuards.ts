/**
 * "Is the user typing, or is the key somebody else's?" in one place (structure
 * cleanup, 2026-10-12). Window-level key handlers used to spell these lists out
 * each time, and the copies had drifted. The selectors are the building blocks;
 * a handler joins the ones it yields to. `focusGuards.test.ts` pins every list.
 *
 * The differences between handlers are kept, on purpose:
 * - `isTypingTarget` (a field, or anything contenteditable, which covers the
 *   code editor: CodeMirror types into a div) is what the viewer letter keys
 *   and the selection keys yield to.
 * - `isFormField` (only input, textarea and select) is for handlers that want
 *   the code editor's keys: the media keys, PdfView, CodeView's own save/find.
 * - `isTextBox` (input and textarea) is what the document find shortcut has
 *   always yielded to.
 */

/** Anything that takes typed text. */
export const FIELD = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])'
/** The code editor: it types, but it is not an input. */
export const EDITOR = '.cm-editor'
/** A dialog or a menu is up and has the key. */
export const OVERLAY = '[role="dialog"],[role="menu"]'
/** The folder's own surfaces (Explorer, its places, a splitter): a search key
 *  pressed there searches the folder, not the open file. */
export const NAV_SURFACE = '.folder-browser,.browse-viewer-places,[role="separator"]'

export function isTypingTarget(el: HTMLElement | null | undefined): boolean {
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}

export function isFormField(el: HTMLElement | null | undefined): boolean {
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function isTextBox(el: HTMLElement | null | undefined): boolean {
  return !!el && /^(INPUT|TEXTAREA)$/.test(el.tagName)
}

export function inField(el: Element | null | undefined): boolean {
  return !!el?.closest(FIELD)
}

export function inOverlay(el: Element | null | undefined): boolean {
  return !!el?.closest(OVERLAY)
}

export function inNavSurface(el: Element | null | undefined): boolean {
  return !!el?.closest(NAV_SURFACE)
}
