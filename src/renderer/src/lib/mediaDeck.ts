import type { ViewerFile } from '@shared/types'

/**
 * Which tabs keep a live player (2026-08-27).
 *
 * A tab renders only while it is in front, so leaving one stopped its film
 * dead. Handing the sound to a second, hidden element was audible - a pause
 * and an unpause every time you switched - because the only seamless answer is
 * for the ELEMENT ITSELF to survive: same element, same clock, just not on
 * screen. So every tab holding a video or a track keeps its player mounted,
 * and the tab strip only decides which one you can see.
 *
 * Two rules make that work:
 *
 *  - The order is APPEND-ONLY. Removing a media element from the document
 *    pauses it (the HTML spec says so), and React moves DOM nodes when a list
 *    reorders - so a deck that followed the tab strip's order would stutter
 *    every time a tab was dragged. New tabs go on the end; the rest never move.
 *  - There is a CEILING. Films are expensive, and a dozen tabs quietly decoding
 *    is not what anyone asked for by opening them; the oldest background player
 *    stands down. The active tab is never the one dropped.
 */
export interface DeckEntry {
  tabId: string
  file: ViewerFile
}

interface DeckTab {
  id: string
  files: readonly ViewerFile[]
  index: number
}

const MEDIA = new Set(['video', 'audio'])

export const MAX_PLAYERS = 4

export function deckFileOf(tab: DeckTab): ViewerFile | null {
  const f = tab.index >= 0 ? (tab.files[tab.index] ?? null) : null
  return f && MEDIA.has(f.kind) ? f : null
}

export function deckOf(
  tabs: readonly DeckTab[],
  order: readonly string[],
  activeId: string | null,
  max: number = MAX_PLAYERS
): { entries: DeckEntry[]; order: string[] } {
  const want = new Map<string, ViewerFile>()
  for (const t of tabs) {
    const f = deckFileOf(t)
    if (f) want.set(t.id, f)
  }
  // Kept order first (only what still wants a player), then whatever is new.
  const next = order.filter((id) => want.has(id))
  for (const t of tabs) if (want.has(t.id) && !next.includes(t.id)) next.push(t.id)
  // Over the ceiling: the oldest background players go, never the active one.
  const doomed = new Set<string>()
  let over = next.length - max
  for (const id of next) {
    if (over <= 0) break
    if (id === activeId) continue
    doomed.add(id)
    over -= 1
  }
  const kept = next.filter((id) => !doomed.has(id))
  return {
    entries: kept.map((id) => ({ tabId: id, file: want.get(id) as ViewerFile })),
    order: kept
  }
}
