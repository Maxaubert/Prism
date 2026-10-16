/**
 * Who is waiting for a video conversion, by SOURCE file (the renderer knows
 * the file it asked about, never the copy's name).
 *
 * Two tabs can hold the same film and share ONE conversion: the first to walk
 * away must not cancel it out from under the other (2026-08-28).
 *
 * A viewer is counted from the moment it ASKS (review, 2026-10-16). It used to
 * be counted only once the probe and convertVideo's mkdir and stats had
 * returned, and a cancel that arrived in that gap found nobody to cancel and
 * was dropped: arrowing past a few WMVs left one full re-encode running per
 * file, for nobody. Now a cancel in the gap marks the ask, and the copy is
 * stopped as soon as its name is known, unless another viewer still wants it.
 */
export interface ConvertAsk {
  readonly source: string
  /** Set by a cancel that arrived before the copy's name was known. */
  cancelled: boolean
}

interface Entry {
  out: string | null
  viewers: number
  asks: Set<ConvertAsk>
}

export interface ConvertWaiters {
  /** A viewer asks for `source`: counted at once, before any await. */
  join(source: string): ConvertAsk
  /** The copy's name is known. False (and the copy stopped, if nobody else
   *  wants it) when this ask was cancelled meanwhile. */
  started(ask: ConvertAsk, out: string): boolean
  /** The ask is over, finished or failed. */
  done(ask: ConvertAsk): void
  /** A viewer walked away from `source`. */
  cancel(source: string): void
}

export function createConvertWaiters(stop: (out: string) => void): ConvertWaiters {
  const entries = new Map<string, Entry>()
  const live = (ask: ConvertAsk): Entry | null => {
    const e = entries.get(ask.source)
    return e && e.asks.has(ask) ? e : null
  }
  return {
    join(source) {
      const ask: ConvertAsk = { source, cancelled: false }
      const e = entries.get(source) ?? { out: null, viewers: 0, asks: new Set() }
      e.viewers += 1
      e.asks.add(ask)
      entries.set(source, e)
      return ask
    },
    started(ask, out) {
      if (ask.cancelled) {
        // Somebody newer may have asked for the same film since: the job is
        // shared (videoConvert's own dedup), so it stays for them.
        const other = entries.get(ask.source)
        if (!other || other.viewers <= 0) stop(out)
        return false
      }
      const e = live(ask)
      if (e) e.out = out
      return true
    },
    done(ask) {
      const e = live(ask)
      if (!e) return
      e.asks.delete(ask)
      if (e.asks.size === 0) entries.delete(ask.source)
    },
    cancel(source) {
      const e = entries.get(source)
      if (!e) return
      e.viewers -= 1
      if (e.viewers > 0) return // somebody else is still waiting for it
      entries.delete(source)
      if (e.out) stop(e.out)
      // Not started yet: each ask stops its copy as soon as it is named.
      for (const ask of e.asks) ask.cancelled = true
    }
  }
}
