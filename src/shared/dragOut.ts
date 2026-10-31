import { samePath } from './path'

/**
 * DRAGGING OUT OF PRISM (#103; owner, 2026-10-31). The in-app carry hands
 * its cargo to Windows at the window's edge, and main starts the OS drag
 * (`src/main/dragOut.ts`). These are the pieces both sides agree on: the
 * request shape, the record of a drag in flight, and the pure rules (the
 * archive budget, the temp copies a drag can carry, the path-set match that
 * tells Prism's own drop from Windows').
 */

/** A press on archive members extracts at most this much ahead (D5). */
export const DRAG_OUT_BYTES = 64 * 1024 * 1024
/** And at most this many members (rows; a folder is one, at its listed size). */
export const DRAG_OUT_ENTRIES = 64

/** What the renderer asks main to prepare (on the press) or carry (at the
 *  edge). Members name their place paths too, so main can resolve each one
 *  against the archive's own listing; it never takes a temp path from the page. */
export type DragOutRequest =
  | { kind: 'files'; paths: string[] }
  | { kind: 'members'; archive: string; entries: string[]; places: string[] }

/** The cargo a drag in flight stands for, handed back on a drop that matches. */
export type NativeCargo =
  | { kind: 'files'; paths: string[] }
  | { kind: 'members'; archive: string; entries: string[] }

/** Main's record of the OS drag in flight, broadcast to every window. */
export interface NativeDragRecord {
  token: number
  /** The real paths Windows carries (temp copies for members). */
  paths: string[]
  cargo: NativeCargo
  /** The page (webContents id) the drag left. */
  source: number
}

export type DragOutResult =
  | { ok: true; token: number }
  | { ok: false; reason: 'busy' | 'refused' | 'missing' | 'not-ready' | 'failed' | 'cancelled' }

export type DragPrepareResult = { ok: true } | { ok: false; reason: 'refused' | 'budget' | 'failed' }

export interface PlanItem {
  entry: string
  size: number
  dir: boolean
}

/**
 * Which members a press should extract ahead of a possible drag: the ones
 * not ready yet, or null when the cargo is over the budget (then nothing is
 * extracted, the in-app drag still works and Copy stays the way out).
 */
export function prefetchPlan(
  items: readonly PlanItem[],
  ready: ReadonlySet<string>,
  bytes = DRAG_OUT_BYTES,
  entries = DRAG_OUT_ENTRIES
): string[] | null {
  if (!items.length || items.length > entries) return null
  const total = items.reduce((n, m) => n + Math.max(0, m.size), 0)
  if (total > bytes) return null
  return items.filter((m) => !ready.has(m.entry)).map((m) => m.entry)
}

/** The temp copies to hand the OS drag, or null when any one is not ready. */
export function nativePaths(
  entries: readonly string[],
  copies: ReadonlyMap<string, string>
): string[] | null {
  if (!entries.length) return null
  const out: string[] = []
  for (const e of entries) {
    const p = copies.get(e)
    if (!p) return null
    out.push(p)
  }
  return out
}

/** The same set of paths, in any order, compared the way Windows does. */
export function samePathSet(a: readonly string[], b: readonly string[]): boolean {
  if (!a.length || a.length !== b.length) return false
  const left = [...b]
  for (const p of a) {
    const i = left.findIndex((q) => samePath(p, q))
    if (i < 0) return false
    left.splice(i, 1)
  }
  return true
}

/** Is the cargo well formed (strings, not empty, members with one place each). */
export function validRequest(r: unknown): r is DragOutRequest {
  if (!r || typeof r !== 'object') return false
  const x = r as Record<string, unknown>
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length > 0 && v.length <= 4096 && v.every((s) => typeof s === 'string' && !!s)
  if (x.kind === 'files') return strings(x.paths)
  if (x.kind === 'members')
    return (
      typeof x.archive === 'string' &&
      !!x.archive &&
      strings(x.entries) &&
      strings(x.places) &&
      x.entries.length === x.places.length
    )
  return false
}
