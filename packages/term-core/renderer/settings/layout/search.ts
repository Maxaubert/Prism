/**
 * FIND A SETTING (2026-10-05, the grouped cards redesign). Pure: the frame
 * hands in an index (one entry per row the host DRAWS on this PC), this
 * answers which match a query and in what order. No model, no network.
 *
 * Every word of the query must match the START of some word of the entry's
 * label, subtext, section, page or hidden keywords, case and accents folded.
 * Entries whose LABEL holds every word come first, an exact label first of
 * all; otherwise the index's own order (the page order) stands.
 */
export interface SettingsIndexEntry {
  /** The row's `data-pref`. */
  id: string
  /** The page that holds it. */
  page: string
  /** A view inside that page, for a host whose page has two (Prism's Media). */
  view?: string
  /** The section's title, as the result says where the row lives. */
  section: string
  /** The section's `data-settings-section`, flashed if the row never comes. */
  sectionId?: string
  label: string
  sub: string
  icon: string
  /** Words nobody sees that should still find the row. */
  keywords?: string
}

/** Lower case, accents gone. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const words = (text: string): string[] => fold(text).split(/[^a-z0-9]+/).filter(Boolean)

/** The page's NAME, which the index entry knows only by id. */
export type PageNames = Record<string, string>

export function searchSettings(index: readonly SettingsIndexEntry[], query: string, pages: PageNames = {}): SettingsIndexEntry[] {
  const q = words(query)
  if (!q.length) return []
  const scored: Array<{ e: SettingsIndexEntry; rank: number; i: number }> = []
  index.forEach((e, i) => {
    const hay = words([e.label, e.sub, e.section, pages[e.page] ?? e.page, e.keywords ?? ''].join(' '))
    if (!q.every((w) => hay.some((h) => h.startsWith(w)))) return
    const label = words(e.label)
    const inLabel = q.every((w) => label.some((h) => h.startsWith(w)))
    const exact = fold(e.label).trim() === fold(query).trim().replace(/\s+/g, ' ')
    scored.push({ e, rank: exact ? 0 : inLabel ? 1 : 2, i })
  })
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).map((s) => s.e)
}
