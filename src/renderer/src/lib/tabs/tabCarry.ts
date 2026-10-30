import type { OpenPayload } from '@shared/types'
import type { TabCarry } from '@shared/tabTear'
import type { Tab } from './tabs'

/**
 * WHAT A TORN-OFF TAB TAKES TO ITS NEW WINDOW (tab tear-off step 3, owner,
 * 2026-10-29; spec section 1, "What a moved tab keeps"). Two pages share no
 * memory, so what the source page holds for the tab outside the tab itself
 * (its unsaved text, its volume and speed, where its film had got to and
 * whether it played, a document's place, the archive passwords given for it,
 * the listing on screen) is packed here and unpacked in the new page before
 * the tab mounts. Pure: the stores are handed in, so `tabCarry.test.ts` holds
 * the round trip.
 */

/** Where the source page's stores are read. */
export interface CarrySources {
  /** Every unsaved buffer of the page, by lowercase path. */
  buffers: ReadonlyMap<string, { path: string; text: string }>
  /** The lowercase paths each tab has edited. */
  owners: ReadonlyMap<string, ReadonlySet<string>>
  level(tabId: string): { vol: number; muted: boolean }
  rate(tabId: string): number
  mediaKey(path: string): string
  mark(key: string): { t: number; paused: boolean } | undefined
  docPos(path: string): number
  passwords(paths: readonly string[]): Array<{ path: string; password: string }>
  listing(path: string): { path: string; listing: NonNullable<OpenPayload['listing']>['listing'] } | null
}

/** Where the new page puts it all back. */
export interface CarrySinks {
  setLevel(tabId: string, level: { vol: number; muted: boolean }): void
  setRate(tabId: string, rate: number): void
  rememberTime(key: string, t: number): void
  rememberPaused(key: string, paused: boolean): void
  rememberDocPos(key: string, value: number): void
  rememberPassword(path: string, password: string): void
}

const shownPath = (tab: Tab): string | null => (tab.index >= 0 ? (tab.files[tab.index]?.path ?? null) : null)

/** The lowercase keys of the unsaved buffers a tab owns: the ones it edited,
 *  and the file it shows. */
export function ownedBufferKeys(
  tab: Tab,
  buffers: ReadonlyMap<string, unknown>,
  owners: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  const keys = new Set<string>()
  for (const k of owners.get(tab.id) ?? []) if (buffers.has(k)) keys.add(k)
  const shown = shownPath(tab)?.toLowerCase()
  if (shown && buffers.has(shown)) keys.add(shown)
  return [...keys]
}

/** Of a leaving tab's buffers, the ones no tab staying behind also holds: only
 *  those leave the source page (two tabs on one edited file keep it here). */
export function buffersLeaving(
  tab: Tab,
  staying: readonly Tab[],
  buffers: ReadonlyMap<string, unknown>,
  owners: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  const kept = new Set(staying.flatMap((t) => ownedBufferKeys(t, buffers, owners)))
  return ownedBufferKeys(tab, buffers, owners).filter((k) => !kept.has(k))
}

export function carryOf(tab: Tab, src: CarrySources): TabCarry {
  const shown = shownPath(tab)
  const buffers = ownedBufferKeys(tab, src.buffers, src.owners).flatMap((k) => {
    const b = src.buffers.get(k)
    return b ? [{ path: b.path, text: b.text }] : []
  })
  const key = shown ? src.mediaKey(shown) : null
  const mark = key ? src.mark(key) : undefined
  const pos = shown ? src.docPos(shown) : 0
  const places = [tab.root, tab.browse.path, ...tab.browse.history.map((h) => h.path), ...(shown ? [shown] : [])]
  const listing = src.listing(tab.browse.path)
  return {
    tab: {
      id: tab.id,
      ...(tab.pinned ? { pinned: true } : {}),
      root: tab.root,
      browse: tab.browse,
      files: tab.files,
      index: tab.index
    },
    buffers,
    level: { ...src.level(tab.id), rate: src.rate(tab.id) },
    ...(key && mark ? { marks: [{ key, t: mark.t, paused: mark.paused }] } : {}),
    ...(shown && pos > 0 ? { docPos: [{ key: shown, value: pos }] } : {}),
    passwords: src.passwords(places),
    ...(listing ? { listing } : {})
  }
}

/**
 * Put the carried state into the new page's stores and answer the payload
 * that rebuilds the tab under its SAME id (the restore shape: `restoreTabId`,
 * in front, the window's home). The buffers are the caller's: they are App's.
 */
export function applyCarry(carry: TabCarry, sinks: CarrySinks): OpenPayload {
  const id = carry.tab.id
  if (carry.level) {
    sinks.setLevel(id, { vol: carry.level.vol, muted: carry.level.muted })
    sinks.setRate(id, carry.level.rate)
  }
  for (const m of carry.marks ?? []) {
    if (m.t > 0) sinks.rememberTime(m.key, m.t)
    sinks.rememberPaused(m.key, m.paused)
  }
  for (const d of carry.docPos ?? []) sinks.rememberDocPos(d.key, d.value)
  for (const p of carry.passwords ?? []) sinks.rememberPassword(p.path, p.password)
  return {
    root: carry.tab.root,
    files: carry.tab.files,
    index: carry.tab.index,
    browse: carry.tab.browse,
    role: 'explorer',
    // The new window's one tab is its HOME (the invisible mark files from
    // outside land on, tabs.ts), wherever it was in the strip it left; the
    // source hands its own mark on if this tab had it (`closeTab`).
    pinned: true,
    restore: true,
    restoreTabId: id,
    restoreActive: true,
    ...(carry.listing ? { listing: carry.listing } : {})
  }
}
