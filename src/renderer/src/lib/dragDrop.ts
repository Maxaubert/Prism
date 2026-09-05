// What is being dragged right now (#70). HTML5 drag events can only carry
// strings, and reading them mid-drag is forbidden in most browsers anyway, so
// the payload lives here for the app's own drags; the MIME type is still set
// so a drop target can tell "this came from Prism" before it inspects us.
// Files arriving from EXPLORER carry no payload - they show up as
// dataTransfer.files instead, which is how the two are told apart.

export const DRAG_MIME = 'application/prism-drag'

export type DragPayload =
  /** Real files and folders on disk, dragged out of the sidebar. */
  | { kind: 'files'; paths: string[] }
  /** Members of one archive, dragged out of the archive view. */
  | { kind: 'members'; archive: string; entries: string[] }

let current: DragPayload | null = null

export function setDrag(p: DragPayload | null): void {
  current = p
}

export function getDrag(): DragPayload | null {
  return current
}

/** Absolute paths of files Explorer just dropped, or [] when the drop came
 *  from inside Prism. */
export function droppedPaths(dt: DataTransfer | null): string[] {
  if (!dt?.files?.length) return []
  return [...dt.files].map((f) => window.prism.getDroppedPath(f)).filter(Boolean)
}

/**
 * The payload for THIS drop, or null when the drag did not come from Prism.
 *
 * The MIME type is the authority, not the module state: a drag that ended
 * without a drop (Escape, released over the viewer) leaves `current` set, and
 * trusting it made the NEXT drop - an Explorer file, a tab - move whatever was
 * dragged before. The event carries its own truth; this only looks the
 * payload up.
 */
export function dragPayload(dt: DataTransfer | null): DragPayload | null {
  return dt?.types?.includes?.(DRAG_MIME) ? getDrag() : null
}

/**
 * The payload for this drop when the drag is Prism's own, HTML or NATIVE
 * (2026-09-05, #103). A native drag carries no MIME type - it arrives as
 * dropped FILES, exactly like a drag from Explorer - so the second look is
 * at the payload set when the drag began, which main clears the moment the
 * OS drag ends (`drag:end`). That is what keeps the old worry out: a stale
 * payload cannot outlive its drag, so an Explorer drop never inherits it.
 */
export function ownDrag(dt: DataTransfer | null): DragPayload | null {
  const html = dragPayload(dt)
  if (html) return html
  return dt?.files?.length ? getDrag() : null
}

// Main says when a native drag is over; nothing else can, since the HTML
// dragend never fires for a drag that was cancelled in favour of the OS one.
if (typeof window !== 'undefined' && window.prism?.onDragEnd) window.prism.onDragEnd(() => setDrag(null))
