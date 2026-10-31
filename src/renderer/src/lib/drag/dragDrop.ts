// What is being dragged right now (#70). HTML5 drag events can only carry
// strings, and reading them mid-drag is forbidden in most browsers anyway, so
// the payload lives here for the app's own drags; the MIME type is still set
// so a drop target can tell "this came from Prism" before it inspects us.
// Files arriving from EXPLORER carry no payload - they show up as
// dataTransfer.files instead, which is how the two are told apart.
import { samePath } from '@shared/path'
import type { NativeDragRecord } from '@shared/dragOut'
import { ownDropFrom } from './dragOut'

export const DRAG_MIME = 'application/prism-drag'

export type DragPayload =
  /** Real files and folders on disk, dragged out of the sidebar. */
  | { kind: 'files'; paths: string[]; /** Dropped from Windows, not dragged out of Prism: never moved, only copied in. */ external?: true }
  /** Members of one archive, dragged out of the archive view. `places` are
   *  their paths as the Explorer spells them (`C:\x.zip\a.txt`), one per
   *  entry: main resolves them to hand the members to Windows (#103). */
  | { kind: 'members'; archive: string; entries: string[]; places?: string[] }

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

/** A carried row is never its own destination or hover highlight. */
export function dragIncludesPath(dt: DataTransfer | null, path: string): boolean {
  const payload = dragPayload(dt)
  return payload?.kind === 'files' && payload.paths.some((source) => samePath(source, path))
}

/**
 * THE OS DRAG IN FLIGHT (#103). Main tells every Prism window when a drag
 * leaves one (`drag:native-start`) and when it ends. A drop that carries
 * Windows files is Prism's OWN only when a record is set AND the dropped
 * paths are its paths: a stale payload can never match a drop. The end
 * clears it a moment later, not at once: the drop and main's end message
 * travel apart, and the drop must still find the record it came from.
 */
let native: NativeDragRecord | null = null
let clearTimer: ReturnType<typeof setTimeout> | null = null
export const NATIVE_GRACE_MS = 1500

export function setNative(record: NativeDragRecord | null): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = null
  native = record
}

export function endNative(token: number): void {
  if (!native || native.token !== token) return
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    clearTimer = null
    if (native?.token === token) native = null
  }, NATIVE_GRACE_MS)
}

export function getNative(): NativeDragRecord | null {
  return native
}

/**
 * What a drag over a target carries, as far as a DRAGOVER can tell (#103):
 * the in-app payload, or, for a drag Windows carries while Prism's own OS drag
 * is recorded, that record's files. A dragover cannot read the dropped paths
 * (Chromium hides them until the drop), and while the record is set the drag
 * Windows carries is Prism's own, so a target can refuse itself and its own
 * folder the way it does for the in-app carry.
 */
export function overPayload(dt: DataTransfer | null): DragPayload | null {
  const inside = dragPayload(dt)
  if (inside) return inside
  if (!windowsDrag(dt) || native?.cargo.kind !== 'files') return null
  return { kind: 'files', paths: [...native.cargo.paths] }
}

/** A drag Windows carries (Explorer, another app, or Prism after the hand-off),
 *  not Prism's in-app carry. Its drop is chosen by `ownDrop`, and its targets
 *  show 'copy': Electron's OS drag offers copy and link, never move, and a
 *  'move' effect would be refused. */
export function windowsDrag(dt: DataTransfer | null): boolean {
  return !!dt?.types?.includes?.('Files') && !dt.types.includes(DRAG_MIME)
}

/**
 * What THIS drop carries, wherever it came from (#103):
 *  - Prism's in-app carry: its payload, as before;
 *  - an OS drag that left a Prism window, matched by its paths: its cargo
 *    (files move, members extract, D4);
 *  - anything else from Windows: the dropped files, `external` (a copy, D3).
 * Null when the drop carries nothing Prism can take.
 */
export function ownDrop(dt: DataTransfer | null): DragPayload | null {
  const inside = dragPayload(dt)
  if (inside) return inside
  return ownDropFrom(droppedPaths(dt), native)
}
