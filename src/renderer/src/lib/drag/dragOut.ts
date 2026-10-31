import { samePathSet, type DragOutRequest, type NativeDragRecord } from '@shared/dragOut'
import type { DragPayload } from './dragDrop'

/**
 * The page's half of the drag out of Prism (#103): what cargo becomes a
 * request to main, and what a drop of Windows files is (Prism's own cargo
 * coming back, or files from outside). Pure; `dragDrop.ts` and
 * `internalFileDrag.ts` wire them.
 */

/** The request main gets for an in-app payload, or null when it cannot leave
 *  the window (members with no places, an empty cargo). */
export function requestOf(payload: DragPayload | null): DragOutRequest | null {
  if (!payload) return null
  if (payload.kind === 'files') return payload.paths.length ? { kind: 'files', paths: payload.paths } : null
  const places = payload.places
  if (!places || !payload.entries.length || places.length !== payload.entries.length) return null
  return { kind: 'members', archive: payload.archive, entries: payload.entries, places }
}

/**
 * A drop of Windows files, read against the OS drag in flight. The SAME set
 * of paths as the record is Prism's own cargo (a move, or members to
 * extract); anything else, a stale record included, is from outside: a copy.
 */
export function ownDropFrom(dropped: readonly string[], record: NativeDragRecord | null): DragPayload | null {
  if (!dropped.length) return null
  if (record && samePathSet(dropped, record.paths)) {
    const c = record.cargo
    return c.kind === 'files' ? { kind: 'files', paths: [...c.paths] } : { kind: 'members', archive: c.archive, entries: [...c.entries] }
  }
  return { kind: 'files', paths: [...dropped], external: true }
}
