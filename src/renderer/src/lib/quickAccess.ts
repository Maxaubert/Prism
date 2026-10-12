import { useEffect } from 'react'
import { pathKey, samePath } from '@shared/path'
import { createPref } from './prefs/createPref'
import { readStored } from './storage'

export interface QuickAccessPin {
  path: string
  label: string
  isFolder: boolean
}

export const QUICK_ACCESS_KEY = 'prism.quickAccess'
export const QUICK_ACCESS_PIN_MIME = 'application/x-prism-quick-access-pin'
export const sameQuickAccessPath = samePath

/** Stored order is deliberate. Invalid entries and equivalent paths never add rows. */
export function parseQuickAccess(raw: string | null): QuickAccessPin[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    return value
      .filter((pin): pin is QuickAccessPin => {
        if (
          !pin ||
          typeof pin !== 'object' ||
          typeof pin.path !== 'string' ||
          !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/i.test(pin.path) ||
          typeof pin.label !== 'string' ||
          !pin.label.trim() ||
          typeof pin.isFolder !== 'boolean'
        )
          return false
        const key = pathKey(pin.path)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map(({ path, label, isFolder }) => ({ path, label, isFolder }))
  } catch {
    return []
  }
}

// Another window's pins arrive as a storage event (windowPreferences).
const pref = createPref<QuickAccessPin[]>({
  key: QUICK_ACCESS_KEY,
  read: 'always',
  live: true,
  parse: parseQuickAccess,
  serialize: (pins) => JSON.stringify(pins),
  fallback: []
})

export const readQuickAccess = (): QuickAccessPin[] => pref.get()
const save = (pins: readonly QuickAccessPin[]): void => pref.set([...pins])

/** An explicitly emptied rail stays empty across both renders and restarts. */
export function seedQuickAccess(defaults: readonly QuickAccessPin[]): void {
  if (readStored(QUICK_ACCESS_KEY) === null && defaults.length) save(parseQuickAccess(JSON.stringify(defaults)))
}

export function withQuickAccessPins(
  current: readonly QuickAccessPin[],
  pins: readonly QuickAccessPin[],
  beforePath?: string
): QuickAccessPin[] {
  const valid = parseQuickAccess(JSON.stringify(pins))
  const added = valid.filter(
    (pin) => !current.some((item) => sameQuickAccessPath(item.path, pin.path))
  )
  const at = beforePath ? current.findIndex((pin) => sameQuickAccessPath(pin.path, beforePath)) : -1
  const next = [...current]
  next.splice(at < 0 ? next.length : at, 0, ...added)
  return next
}

/** Move before another stable path; omitted means the end of the rail. */
export function reorderedQuickAccess(
  current: readonly QuickAccessPin[],
  path: string,
  beforePath?: string
): QuickAccessPin[] {
  const moving = current.find((pin) => sameQuickAccessPath(pin.path, path))
  if (!moving || (beforePath && sameQuickAccessPath(path, beforePath))) return [...current]
  const next = current.filter((pin) => pin !== moving)
  const at = beforePath ? next.findIndex((pin) => sameQuickAccessPath(pin.path, beforePath)) : -1
  next.splice(at < 0 ? next.length : at, 0, moving)
  return next
}

export const pinQuickAccess = (pins: readonly QuickAccessPin[], beforePath?: string): void =>
  save(withQuickAccessPins(readQuickAccess(), pins, beforePath))
export const unpinQuickAccess = (path: string): void =>
  save(readQuickAccess().filter((pin) => !sameQuickAccessPath(pin.path, path)))
export const moveQuickAccess = (path: string, beforePath?: string): void =>
  save(reorderedQuickAccess(readQuickAccess(), path, beforePath))

export function useQuickAccess(defaults: readonly QuickAccessPin[]): QuickAccessPin[] {
  const pins = pref.use()
  useEffect(() => seedQuickAccess(defaults), [defaults])
  return pins
}
