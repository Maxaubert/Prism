/**
 * THE PREVIEW WINDOW'S OWN KEYS (owner, 2026-11-08: "space opens and closes
 * that too ... should not disappear on alt tab, only on space"). With the
 * keyboard in the window itself (a click on it), Space closes it, as it does
 * from the list, and Escape does too, Quick Look's two. A held key does
 * nothing more and a chord is somebody else's. A field (the find bar) keeps
 * both; the text editor keeps Space (a space typed into the code view is a
 * space) but Escape still closes. A right-click menu up in the window keeps
 * both (owner, 2026-11-08): Escape closes the menu alone, and the window
 * stays. Space is a focused row's; anywhere else under the menu it is taken
 * and does nothing (a film never plays or pauses under its menu).
 */
export interface PreviewKeyEvent {
  key: string
  code?: string
  repeat: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** What the key landed on: a field, an editable text, a menu's row, or
 *  none of them. */
export type PreviewKeyTarget = 'field' | 'editor' | 'menu' | null

/** 'close' closes the window; 'held' and 'taken' stop the key and do nothing. */
export function previewWindowKey(
  e: PreviewKeyEvent,
  target: PreviewKeyTarget,
  menuUp = false
): 'close' | 'held' | 'taken' | null {
  const space = e.key === ' ' || e.code === 'Space'
  if (!space && e.key !== 'Escape') return null
  if (e.ctrlKey || e.altKey || e.metaKey || (space && e.shiftKey)) return null
  // Escape is the menu's own listener's; Space picks a focused row, and
  // under the menu (no row, no field, no editor) it is nobody's.
  if (menuUp) return space && target === null ? 'taken' : null
  if (target === 'field' || (space && target === 'editor')) return null
  return e.repeat ? 'held' : 'close'
}

/** A target that types: a field or a list box, or editable text (the code
 *  view's editor is contenteditable). */
export function keyTarget(target: EventTarget | null): PreviewKeyTarget {
  const el = target as { closest?: (s: string) => unknown; isContentEditable?: boolean } | null
  if (!el || typeof el.closest !== 'function') return null
  if (el.closest('input, textarea, select')) return 'field'
  if (el.closest('[role="menu"]')) return 'menu'
  return el.isContentEditable ? 'editor' : null
}
