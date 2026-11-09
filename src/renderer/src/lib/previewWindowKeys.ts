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

/**
 * UP AND DOWN IN THE WINDOW (owner, 2026-11-08, #492: "up down arrows
 * shoudl nvigate next file not adjust volume"), with the keyboard in the window:
 * 1 is the next file, -1 the one before. The App's own key listener is on the
 * Explorer's window, so a key pressed in this one never reaches it. A chord, a
 * menu up here and a field are not the walk's; the film's own range sliders are
 * (`slider`), or a focused volume would step instead.
 */
export function previewWindowStep(
  e: PreviewKeyEvent,
  target: PreviewKeyTarget,
  menuUp: boolean,
  slider: boolean
): 1 | -1 | null {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return null
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || menuUp) return null
  if (target !== null && !(target === 'field' && slider)) return null
  return e.key === 'ArrowDown' ? 1 : -1
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
