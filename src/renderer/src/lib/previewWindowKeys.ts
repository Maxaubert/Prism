/**
 * THE PREVIEW WINDOW'S OWN KEYS (owner, 2026-11-08: "space opens and closes
 * that too ... should not disappear on alt tab, only on space"). With the
 * keyboard in the window itself (a click on it), Space closes it, as it does
 * from the list, and Escape does too, Quick Look's two. A held key does
 * nothing more, a chord is somebody else's, and a field or the text editor
 * keeps both (a space typed into the code view is a space).
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

export function previewWindowKey(e: PreviewKeyEvent, typing: boolean): 'close' | 'held' | null {
  const space = e.key === ' ' || e.code === 'Space'
  if (!space && e.key !== 'Escape') return null
  if (e.ctrlKey || e.altKey || e.metaKey || (space && e.shiftKey)) return null
  if (typing) return null
  return e.repeat ? 'held' : 'close'
}

/** A target that types: a field, a list box, or anything editable (the code
 *  view's editor is contenteditable). */
export function typesText(target: EventTarget | null): boolean {
  const el = target as { closest?: (s: string) => unknown; isContentEditable?: boolean } | null
  if (!el || typeof el.closest !== 'function') return false
  return (
    !!el.isContentEditable ||
    !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
  )
}
