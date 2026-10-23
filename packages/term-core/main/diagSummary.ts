/**
 * WHAT A DIAGNOSTICS LINE MAY HOLD (#140). Pure, for both hosts.
 *
 * A line is one flat JSON object, short enough that a 2 MB file holds hours of
 * a quiet day and that `npm run diag` can print it on one row. So a string is
 * capped at 300 characters, a stack at 2000 (300 is about two frames, and the
 * frames are the point of a stack), an array of IPC arguments is logged as its
 * length, and an object one level deep. Paths are kept in full (owner,
 * 2026-10-07: the log stays local); typed text and the clipboard are not
 * (`opaque`), since a slow keystroke would otherwise write the keystroke down.
 */

export const STRING_MAX = 300
export const STACK_MAX = 2000
/** Fields whose strings take the longer cap. */
const LONG_FIELDS = new Set(['stack'])
const MAX_KEYS = 12
const MAX_ITEMS = 10
const MAX_ARGS = 4

/** A string at most `max` characters, a cut one ending in how much was cut. */
export function capString(s: string, max = STRING_MAX): string {
  return s.length <= max ? s : `${s.slice(0, max)}...(+${s.length - max})`
}

/** One value as an IPC argument is logged: primitives as they are, a string
 *  capped, an array as `[n]`, bytes as `bytes:n`, an object one level deep. */
export function summariseValue(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return capString(v)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'function' || typeof v === 'symbol') return typeof v
  if (ArrayBuffer.isView(v)) return `bytes:${v.byteLength}`
  if (v instanceof ArrayBuffer) return `bytes:${v.byteLength}`
  if (Array.isArray(v)) return `[${v.length}]`
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
    if (depth > 0) return `{${keys.length}}`
    const out: Record<string, unknown> = {}
    for (const k of keys.slice(0, MAX_KEYS)) out[k] = summariseValue((v as Record<string, unknown>)[k], depth + 1)
    return out
  }
  return null
}

/** The arguments of an IPC call as `ipc-slow` logs them. An OPAQUE channel
 *  (typed text, the clipboard, audio) says only each argument's kind and size. */
export function summariseArgs(args: readonly unknown[], opaque = false): unknown[] {
  const first = args.slice(0, MAX_ARGS)
  if (!opaque) return first.map((a) => summariseValue(a))
  return first.map((a) => {
    if (typeof a === 'string') return `string:${a.length}`
    if (ArrayBuffer.isView(a)) return `bytes:${a.byteLength}`
    if (Array.isArray(a)) return `[${a.length}]`
    return typeof a
  })
}

/** Anything thrown, as `msg` and (when there is one) `stack`. */
export function errorFields(err: unknown): { msg: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack ? { msg: capString(err.message), stack: capString(err.stack, STACK_MAX) } : { msg: capString(err.message) }
  }
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    const o = err as { message: string; stack?: unknown }
    return typeof o.stack === 'string'
      ? { msg: capString(o.message), stack: capString(o.stack, STACK_MAX) }
      : { msg: capString(o.message) }
  }
  return { msg: capString(String(err)) }
}

/**
 * A line's fields made safe to write: every string capped (a `stack` at its
 * own cap), a list kept to ten items, records inside a list cleaned the same
 * way one level down, and what JSON cannot say dropped. The page's lines come
 * through here too: they are text from a renderer, held to the same shape.
 */
export function cleanFields(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields).slice(0, depth === 0 ? 40 : MAX_KEYS)) {
    const c = cleanValue(k, v, depth)
    if (c !== undefined) out[k] = c
  }
  return out
}

function cleanValue(key: string, v: unknown, depth: number): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return capString(v, LONG_FIELDS.has(key) ? STACK_MAX : STRING_MAX)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  if (typeof v === 'function' || typeof v === 'symbol') return undefined
  if (depth >= 2) return summariseValue(v, 1)
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => cleanValue(key, x, depth + 1) ?? null)
  if (typeof v === 'object') return cleanFields(v as Record<string, unknown>, depth + 1)
  return String(v)
}
