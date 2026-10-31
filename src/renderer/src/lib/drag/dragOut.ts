import { samePathSet, type DragOutRequest, type NativeDragRecord } from '@shared/dragOut'
import type { DragPayload } from './dragDrop'

/**
 * The page's half of the drag out of Prism (#103): what cargo becomes a
 * request to main, and what a drop of Windows files is (Prism's own cargo
 * coming back, or files from outside). Pure; `dragDrop.ts` and
 * `internalFileDrag.ts` wire them.
 */

/**
 * WHAT MAIN SAID YES TO (#103). The carry hands off at the edge only a cargo
 * whose press `drag:prepare` answered ok: a member still extracting, one over
 * the budget, or a path main refused keeps the in-app carry instead of ending
 * it for nothing. Keyed by the request, the last few kept.
 */
const READY_KEEP = 8
const ready: string[] = []

export function requestKey(r: DragOutRequest): string {
  return JSON.stringify(r.kind === 'files' ? ['f', r.paths] : ['m', r.archive, r.entries])
}

/** Remember main's answer to a press's prepare. */
export function noteReady(r: DragOutRequest, ok: boolean): void {
  const key = requestKey(r)
  const at = ready.indexOf(key)
  if (at >= 0) ready.splice(at, 1)
  if (!ok) return
  ready.push(key)
  if (ready.length > READY_KEEP) ready.shift()
}

/** Did main answer ok for exactly this cargo. */
export function isReady(r: DragOutRequest): boolean {
  return ready.includes(requestKey(r))
}

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
