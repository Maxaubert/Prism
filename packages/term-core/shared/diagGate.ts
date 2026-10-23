/**
 * ONE ERROR, NOT A FLOOD (#140, review of the branch). An error thrown on every
 * frame (a requestAnimationFrame loop, a render loop) is 60 lines a second of
 * up to 2.3 KB each, which would roll the 10 MB of log files over in about 75 s
 * and take the session line and the FIRST error, the one that explains the
 * rest, with it. Used by both halves: the page's errors and main's rejections.
 *
 * - The same error (its kind and key: message and place) is written once per
 *   `everyMs`. The copies in between are counted, and the next line written
 *   for it carries `repeats`, how many were not written since the last one.
 * - At most `budget` lines per kind per `everyMs`, whatever they say: a
 *   message with a counter in it is a new key every time.
 * - `sweep` writes what is still held once its time has come, so a burst that
 *   stops is still counted.
 *
 * Pure: the caller hands in the clock.
 */

export interface DiagGate<T extends object> {
  /** The line to write now (with `repeats` when copies were held), or null to hold it. */
  offer(k: string, key: string, line: T, now: number): (T & { repeats?: number }) | null
  /** The held copies whose time has come: one line each, with `repeats`. */
  sweep(now: number): Array<T & { repeats: number }>
}

interface Entry<T> {
  k: string
  line: T
  lastSent: number
  held: number
}

/** Past this many distinct errors, a new one over budget is not remembered. */
const MAX_KEYS = 200

export function createDiagGate<T extends object>(everyMs = 10_000, budget = 10): DiagGate<T> {
  const entries = new Map<string, Entry<T>>()
  const windows = new Map<string, { start: number; sent: number }>()

  const allow = (k: string, now: number): boolean => {
    let w = windows.get(k)
    if (!w || now - w.start >= everyMs) windows.set(k, (w = { start: now, sent: 0 }))
    if (w.sent >= budget) return false
    w.sent += 1
    return true
  }

  return {
    offer: (k, key, line, now) => {
      const e = entries.get(key)
      if (e && now - e.lastSent < everyMs) {
        e.held += 1
        return null
      }
      if (!allow(k, now)) {
        if (e) e.held += 1
        else if (entries.size < MAX_KEYS) entries.set(key, { k, line, lastSent: -Infinity, held: 1 })
        return null
      }
      const held = e?.held ?? 0
      entries.set(key, { k, line, lastSent: now, held: 0 })
      return held > 0 ? { ...line, repeats: held } : line
    },
    sweep: (now) => {
      const out: Array<T & { repeats: number }> = []
      for (const [key, e] of entries) {
        if (now - e.lastSent < everyMs) continue
        if (e.held === 0) {
          // Quiet for a while: forget it, so the map stays small.
          if (now - e.lastSent >= everyMs * 6) entries.delete(key)
          continue
        }
        if (!allow(e.k, now)) continue
        out.push({ ...e.line, repeats: e.held })
        e.held = 0
        e.lastSent = now
      }
      return out
    }
  }
}
