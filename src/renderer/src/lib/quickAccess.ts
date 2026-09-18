import { useEffect, useMemo, useSyncExternalStore } from 'react'

export interface QuickAccessPin {
  path: string
  label: string
  isFolder: boolean
}

export const QUICK_ACCESS_KEY = 'prism.quickAccess'
export const QUICK_ACCESS_PIN_MIME = 'application/x-prism-quick-access-pin'
const listeners = new Set<() => void>()
const pathKey = (path: string): string =>
  path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
export const sameQuickAccessPath = (a: string, b: string): boolean => pathKey(a) === pathKey(b)

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

const snapshot = (): string | null => {
  try {
    return localStorage.getItem(QUICK_ACCESS_KEY)
  } catch {
    return null
  }
}
export const readQuickAccess = (): QuickAccessPin[] => parseQuickAccess(snapshot())
const save = (pins: readonly QuickAccessPin[]): void => {
  try {
    localStorage.setItem(QUICK_ACCESS_KEY, JSON.stringify(pins))
  } catch {
    return
  }
  for (const notify of listeners) notify()
}

/** An explicitly emptied rail stays empty across both renders and restarts. */
export function seedQuickAccess(defaults: readonly QuickAccessPin[]): void {
  if (snapshot() === null && defaults.length) save(parseQuickAccess(JSON.stringify(defaults)))
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

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  window.addEventListener('storage', notify)
  return () => {
    listeners.delete(notify)
    window.removeEventListener('storage', notify)
  }
}

export function useQuickAccess(defaults: readonly QuickAccessPin[]): QuickAccessPin[] {
  const raw = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => seedQuickAccess(defaults), [defaults])
  return useMemo(() => parseQuickAccess(raw), [raw])
}
