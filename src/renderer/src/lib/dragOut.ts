/**
 * Dragging OUT of Prism (2026-09-05, #103): to Explorer, a browser's upload
 * box, Discord, another Prism window. Electron's native drag carries file
 * paths, so it wants files that exist the moment the drag begins. Tree rows
 * have them. Archive members do not - they live inside a container - so
 * their temp copies are extracted on the PRESS, and the drag goes native only
 * if every copy is ready by the time it starts. Pure; the decisions only.
 */

/** How much a press may extract on speculation: past this, the members keep
 *  the in-app drag and Copy stays their way out to Explorer. */
export const PREFETCH_BUDGET = 64 * 1024 * 1024
/** And how many: a folder of a thousand thumbnails is not a thing to
 *  extract because somebody pressed on it. */
export const PREFETCH_MAX_ENTRIES = 64

export interface Member {
  path: string
  size: number
  dir: boolean
}

/**
 * Which members a press should extract ahead of a possible drag, or [] when
 * the selection is too much to do on speculation. Folders count as their
 * listed size (the archive's own figure for the members under them).
 */
export function prefetchPlan(
  members: readonly Member[],
  ready: ReadonlySet<string>,
  budget = PREFETCH_BUDGET,
  maxEntries = PREFETCH_MAX_ENTRIES
): string[] {
  if (!members.length || members.length > maxEntries) return []
  const total = members.reduce((n, m) => n + Math.max(0, m.size), 0)
  if (total > budget) return []
  return members.filter((m) => !ready.has(m.path)).map((m) => m.path)
}

/**
 * The temp paths to hand the native drag, or null when any member's copy is
 * not ready yet - in which case the drag stays in-app.
 */
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
