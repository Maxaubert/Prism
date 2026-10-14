import type { BrowseDriveUsage, BrowseShortcut } from '@shared/browse'
import type { PlacesAnswer } from '@shared/phoneWire'
import { localPath } from './phoneAccess'

/**
 * The phone's places (2026-10-14, owner: the drawer shows "Explorer's places"):
 * what the Explorer's side panel lists, in its order. Quick access is the
 * Known Folders, then the user's own pins (a pin that IS a Known Folder is
 * not listed twice); This PC is every drive with what the drive rows show.
 * Pure: main hands in its own `browseLocations`, the pins the window reported
 * and `driveUsage`.
 */
export async function phonePlaces(
  locations: () => Promise<BrowseShortcut[]>,
  pins: readonly { name: string; path: string }[],
  usage: (paths: string[]) => Promise<BrowseDriveUsage[]>
): Promise<PlacesAnswer> {
  const all = await locations()
  const key = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  const quick = all
    .filter((l) => l.group === 'quick')
    .map((l) => ({ name: l.name, path: l.path, ...(l.known ? { known: l.known } : {}) }))
  const seen = new Set(quick.map((q) => key(q.path)))
  for (const pin of pins) {
    if (seen.has(key(pin.path))) continue
    seen.add(key(pin.path))
    quick.push({ name: pin.name, path: pin.path })
  }
  const drives = all.filter((l) => l.group === 'drive')
  const used = await usage(drives.map((d) => d.path)).catch(() => [] as BrowseDriveUsage[])
  return {
    quick,
    drives: drives.map((d) => ({ name: d.name, ...(used.find((u) => key(u.path) === key(d.path)) ?? {}), path: d.path }))
  }
}

/** A Quick access pin, as the window reports it. */
export interface PhonePin {
  name: string
  path: string
}

/** The pins, in the window's order, as plain local folders: anything else the
 *  page sent is dropped rather than shown to a phone. */
export function parsePins(raw: unknown): PhonePin[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p): PhonePin[] => {
    const pin = p as Partial<PhonePin> | null
    if (!pin || typeof pin.path !== 'string' || !localPath(pin.path)) return []
    const name = typeof pin.name === 'string' && pin.name ? pin.name.slice(0, 120) : pin.path
    return [{ name, path: pin.path }]
  }).slice(0, 200)
}
