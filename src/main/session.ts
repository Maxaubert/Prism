import type { SavedTab, SavedTabs } from './tabs'

/**
 * THE SESSION FILE, ONE ENTRY PER WINDOW (tab tear-off step 1, 2026-10-29;
 * spec section 2). tabs.json held ONE strip and window-state.json ONE set of
 * bounds, and with two windows each report would overwrite the other's every
 * 400 ms. Now every open window keeps its own entry (its strip and its
 * bounds), and the file says which one a cold start opens.
 *
 * THE LAST WINDOW CLOSED IS WHAT COMES BACK (owner, 2026-10-29: windows close
 * one by one, and starting Prism with none open gives ONE window). So:
 *
 * - A window closed while others stay open takes its entry with it.
 * - The last window closed keeps its entry, so the next launch restores it,
 *   exactly as the one window did before.
 * - Quitting with several open (an update's install, a shutdown) keeps them
 *   all; the one focused last is what comes back.
 *
 * The file stays readable as the old one: the top-level `tabs`, `active` and
 * `bounds` ARE the entry a cold start opens, and `windows` lists every entry.
 * A v1 file (no `windows`) is one window, and its bounds are still found in
 * window-state.json (`readWindowState`). Pure, so the rules are unit tested
 * (session.test.ts); tabsSession.ts writes what `doc()` answers.
 */

/** A window's place: its un-maximised bounds, and whether it was maximised
 *  (written, never restored since 2026-10-11; see windowSize.ts). */
export interface SavedBounds {
  x: number
  y: number
  width: number
  height: number
  maximised?: boolean
}

export interface SessionEntry {
  tabs: SavedTab[]
  active: number
  bounds?: SavedBounds
}

/** What is written. Top level: the entry a cold start opens. */
export interface SessionDoc extends SessionEntry {
  v: 2
  windows: SessionEntry[]
}

interface Entry {
  tabs?: SavedTab[]
  active?: number
  bounds?: SavedBounds
  focusedAt: number
  order: number
}

export interface SessionModel {
  /** The first window's entry starts as the saved one, so a write before its
   *  first report (a move, say) never empties the strip on disk. */
  seed(key: number, saved: SessionEntry | null): void
  report(key: number, state: SavedTabs): void
  bounds(key: number, bounds: SavedBounds): void
  focus(key: number): void
  /** A crash rebuild: the new window's page takes the old one's entry. */
  rekey(from: number, to: number): void
  closed(key: number, how: { others: boolean; quitting: boolean }): void
  /** The entry a cold start (or a window made when none is left) opens. */
  primary(): SessionEntry | null
  /** What to write; null while nothing has been reported. */
  doc(): SessionDoc | null
}

export function createSessionModel(): SessionModel {
  const entries = new Map<number, Entry>()
  let order = 0
  let focusSeq = 0
  const entry = (key: number): Entry => {
    let e = entries.get(key)
    if (!e) entries.set(key, (e = { focusedAt: 0, order: ++order }))
    return e
  }
  /** Only a window that has a strip counts: one that never reported (a page
   *  still loading) has nothing to come back to. */
  const kept = (): Entry[] =>
    [...entries.values()].filter((e) => e.tabs).sort((a, b) => a.order - b.order)
  const primaryEntry = (): Entry | null => {
    let best: Entry | null = null
    for (const e of kept()) if (!best || e.focusedAt > best.focusedAt) best = e // the oldest wins a tie
    return best
  }
  const out = (e: Entry): SessionEntry => ({
    tabs: e.tabs ?? [],
    active: e.active ?? 0,
    ...(e.bounds ? { bounds: e.bounds } : {})
  })
  const model: SessionModel = {
    seed(key, saved) {
      if (!saved) return
      const e = entry(key)
      if (!e.tabs) {
        e.tabs = saved.tabs
        e.active = saved.active
      }
      if (!e.bounds && saved.bounds) e.bounds = saved.bounds
    },
    report(key, state) {
      const e = entry(key)
      e.tabs = Array.isArray(state?.tabs) ? state.tabs : []
      e.active = typeof state?.active === 'number' ? state.active : 0
    },
    bounds(key, bounds) {
      entry(key).bounds = bounds
    },
    focus(key) {
      entry(key).focusedAt = ++focusSeq
    },
    rekey(from, to) {
      const e = entries.get(from)
      if (!e) return
      entries.delete(from)
      entries.set(to, e)
    },
    closed(key, { others, quitting }) {
      // Quitting keeps every window; the last one standing keeps its own.
      if (quitting || !others) return
      entries.delete(key)
    },
    primary() {
      const p = primaryEntry()
      return p ? out(p) : null
    },
    doc() {
      const p = primaryEntry()
      if (!p) return null
      // NO TAB ID IN TWO WINDOWS: ids key main's grants and watches, so a
      // later window's copy loses its id (the restore mints a fresh one).
      const seen = new Set<string>()
      const windows = kept().map((e) => {
        const s = out(e)
        return {
          ...s,
          tabs: s.tabs.map((t) => {
            if (!t.id) return t
            if (seen.has(t.id)) {
              const { id: _id, ...rest } = t
              void _id
              return rest
            }
            seen.add(t.id)
            return t
          })
        }
      })
      return { v: 2, ...out(p), windows }
    }
  }
  return model
}

/** The saved entry a cold start opens, read raw out of the file's JSON (the
 *  restore filters it, `parseTabs`). Null when there is none to read. */
export function savedEntry(raw: string | null): SessionEntry | null {
  if (!raw) return null
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object') return null
  const d = doc as { tabs?: unknown; active?: unknown; bounds?: unknown }
  const bounds = validBounds(d.bounds)
  return {
    tabs: Array.isArray(d.tabs) ? (d.tabs as SavedTab[]) : [],
    active: typeof d.active === 'number' ? d.active : 0,
    ...(bounds ? { bounds } : {})
  }
}

export function validBounds(raw: unknown): SavedBounds | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (!n(b.x) || !n(b.y) || !n(b.width) || !n(b.height)) return null
  return {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    ...(b.maximised === true ? { maximised: true } : {})
  }
}
