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

/** Every drop this app understands sets one of these; a drag carrying neither
 *  (a text selection, a link) must be left alone. */
export function isPrismDrag(dt: DataTransfer | null): boolean {
  return !!getDrag() || (dt?.types?.includes?.(DRAG_MIME) ?? false)
}
