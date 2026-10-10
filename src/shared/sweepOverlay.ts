/**
 * THE NATIVE SWEEP BOX'S MESSAGES (#338). The page sends three, none per
 * pointer move: `begin` in the move that starts a sweep, `update` when the list
 * scrolls or resizes under it, `end` wherever the DOM box is hidden. Main
 * answers with `state` on every load and every change. Everything here is in
 * CSS px of the page, which is the window's client area; main maps it to
 * physical pixels (`sweepOverlayMath.ts`).
 *
 * The page is not trusted with the native side: main parses every message here
 * and drops what does not fit, so a number the addon is handed is always finite
 * and bounded. Only the known fields are copied, never the object itself.
 */

export interface CssPoint {
  x: number
  y: number
}
export interface CssRect {
  left: number
  top: number
  right: number
  bottom: number
}
/** Bytes, straight alpha, as CSS writes them. */
export type Rgba = readonly [number, number, number, number]
export interface SweepBegin {
  id: number
  anchor: CssPoint
  clip: CssRect
  dpr: number
  fill: Rgba
  edge: Rgba
}
/** Who moved the list: the native side delays each by its own frames. */
export type UpdateCause = 'auto' | 'scroll' | 'resize'
export interface SweepUpdate {
  id: number
  cause: UpdateCause
  anchor: CssPoint
  clip: CssRect
  dpr: number
}
export interface SweepEnd {
  id: number
}
export interface SweepState {
  native: boolean
}

export const SWEEP_CHANNELS = {
  begin: 'sweep-overlay:begin',
  update: 'sweep-overlay:update',
  end: 'sweep-overlay:end',
  state: 'sweep-overlay:state'
} as const

/** Far beyond any window, near enough that physical pixels stay in an int. */
const MAX_COORD = 100_000
const MIN_DPR = 0.25
const MAX_DPR = 8
const CAUSES: readonly UpdateCause[] = ['auto', 'scroll', 'resize']

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const coord = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD ? v : null

const id = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null

const dpr = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_DPR && v <= MAX_DPR ? v : null

function point(v: unknown): CssPoint | null {
  if (!isObject(v)) return null
  const x = coord(v.x)
  const y = coord(v.y)
  return x === null || y === null ? null : { x, y }
}

function rect(v: unknown): CssRect | null {
  if (!isObject(v)) return null
  const left = coord(v.left)
  const top = coord(v.top)
  const right = coord(v.right)
  const bottom = coord(v.bottom)
  if (left === null || top === null || right === null || bottom === null) return null
  if (right < left || bottom < top) return null
  return { left, top, right, bottom }
}

function rgba(v: unknown): Rgba | null {
  if (!Array.isArray(v) || v.length !== 4) return null
  for (const b of v) if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) return null
  return [v[0], v[1], v[2], v[3]]
}

export function parseBegin(v: unknown): SweepBegin | null {
  if (!isObject(v)) return null
  const i = id(v.id)
  const anchor = point(v.anchor)
  const clip = rect(v.clip)
  const d = dpr(v.dpr)
  const fill = rgba(v.fill)
  const edge = rgba(v.edge)
  if (i === null || !anchor || !clip || d === null || !fill || !edge) return null
  return { id: i, anchor, clip, dpr: d, fill, edge }
}

export function parseUpdate(v: unknown): SweepUpdate | null {
  if (!isObject(v)) return null
  const i = id(v.id)
  const cause = CAUSES.find((c) => c === v.cause)
  const anchor = point(v.anchor)
  const clip = rect(v.clip)
  const d = dpr(v.dpr)
  if (i === null || !cause || !anchor || !clip || d === null) return null
  return { id: i, cause, anchor, clip, dpr: d }
}

export function parseEnd(v: unknown): SweepEnd | null {
  if (!isObject(v)) return null
  const i = id(v.id)
  return i === null ? null : { id: i }
}
