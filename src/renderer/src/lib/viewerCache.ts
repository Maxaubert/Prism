import type { ViewerFile } from '@shared/types'

/**
 * Which tabs keep their viewer in memory (2026-09-01).
 *
 * A tab renders only while it is in front, so switching away unmounted the
 * viewer and threw away everything it had built: a pdf's parsed document and
 * rendered pages, a decoded image, an editor's document, a converted docx.
 * Coming back paid for all of it again, which on a large file is seconds of
 * work to show something the app had a moment ago.
 *
 * This is `mediaDeck` generalised to the kinds that do not play. The deck
 * exists so a film KEEPS RUNNING off screen and is therefore about the element
 * surviving; this is about the WORK surviving, so the rules can be laxer - but
 * the central one is the same, and it is the reason a cache like this has to
 * live at the top and not inside each viewer:
 *
 *   THE ELEMENT ITSELF MUST SURVIVE THE SWITCH.
 *
 * Rendering the active tab through one code path and background tabs through
 * another looks equivalent and is not: React unmounts the first and mounts the
 * second, so the very act of switching destroys the thing being cached. Every
 * warm tab, active or not, comes out of one list.
 *
 * Two bounds, because holding viewers is holding memory:
 *
 *  - A CEILING. Somebody with fifteen tabs open has not asked for fifteen
 *    parsed pdfs. The least recently visited background tab is dropped first;
 *    the active tab is never dropped.
 *  - A COOLDOWN, applied by the caller. While the window has the focus,
 *    everything within the ceiling stays. Once it does not, the cache is worth
 *    holding for a little longer - coming back to the app is the common case -
 *    and then released, because a viewer nobody is looking at should not hold
 *    a decoded document for the rest of the session.
 *
 * MEDIA IS NOT HERE. Video and audio are the deck's, which mounts them under
 * different rules and would otherwise mount them twice.
 */
export interface WarmEntry {
  tabId: string
  file: ViewerFile
}

interface WarmTab {
  id: string
  files: readonly ViewerFile[]
  index: number
  kind?: string
}

/** Handled by `mediaDeck` instead, under its own rules. */
const MEDIA = new Set(['video', 'audio'])

/** Active plus three, matching the deck's ceiling for the same reason. */
export const MAX_WARM = 4

/** The file a tab is showing, if it is one this cache is responsible for. */
export function warmFileOf(tab: WarmTab): ViewerFile | null {
  if (tab.kind === 'settings') return null
  const f = tab.index >= 0 ? (tab.files[tab.index] ?? null) : null
  return f && !MEDIA.has(f.kind) ? f : null
}

/**
 * The tabs to keep mounted, and the order to remember for next time.
 *
 * `order` is most-recently-visited first, which is what makes the ceiling
 * evict the right one. Unlike the deck this list MAY be reordered freely:
 * nothing here is playing, so moving a DOM node costs a reflow rather than a
 * pause, and React keeps the instances alive because they are keyed by tab.
 */
export function warmOf(
  tabs: readonly WarmTab[],
  order: readonly string[],
  activeId: string | null,
  keep = true,
  max = MAX_WARM
): { entries: WarmEntry[]; order: string[] } {
  const live = new Map<string, ViewerFile>()
  for (const t of tabs) {
    const f = warmFileOf(t)
    if (f) live.set(t.id, f)
  }
  // Most recent first: the active tab, then the previous order, then anything
  // new. Tabs that have closed or stopped showing a cacheable file fall out.
  const ranked = [
    ...(activeId && live.has(activeId) ? [activeId] : []),
    ...order.filter((id) => id !== activeId && live.has(id)),
    ...tabs.map((t) => t.id).filter((id) => id !== activeId && live.has(id) && !order.includes(id))
  ]
  // Not keeping: only whatever is on screen, so the rest is released now.
  const kept = keep ? ranked.slice(0, Math.max(1, max)) : ranked.slice(0, 1)
  return {
    entries: kept.map((id) => ({ tabId: id, file: live.get(id) as ViewerFile })),
    order: ranked
  }
}
