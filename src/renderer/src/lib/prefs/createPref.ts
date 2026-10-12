import { useSyncExternalStore } from 'react'
import { PREF_KEYS, type PrefKey, type PrefScope } from '@shared/prefKeys'

/**
 * ONE SAVED SETTING (structure cleanup, 2026-10-12). Every pref store the
 * renderer keeps in localStorage is one of these, so each gets the same two
 * guarantees without writing them again: storage that refuses (a profile it
 * cannot open, a full quota, a blocked site) never throws out of a read or a
 * write, and a component following the setting renders again when it is set.
 *
 * The key must be in `@shared/prefKeys`, which also says whether it travels
 * between windows. `parse` turns the stored string (null when never set) into
 * a value and is where junk becomes the default; `serialize` is the string
 * written (String by default). `fallback` is what a store that throws reads as.
 *
 * Two ways to read, both as they were before the stores shared this:
 * - `once`: read when the module loads and held in memory; a refused write
 *   keeps the choice for the session. `reload()` reads again (tests).
 * - `always`: storage is asked on every read, so another window's choice is
 *   what the next read sees. `live` also renders again on its storage event.
 */
export interface PrefOptions<T> {
  key: PrefKey
  parse: (raw: string | null) => T
  serialize?: (value: T) => string
  fallback: T
  read?: 'once' | 'always'
  live?: boolean
}

export interface Pref<T> {
  readonly key: PrefKey
  readonly scope: PrefScope
  get: () => T
  set: (value: T) => void
  subscribe: (listener: () => void) => () => void
  use: () => T
  /** Read the stored value again, as a fresh launch would. */
  reload: () => void
}

export function createPref<T>(options: PrefOptions<T>): Pref<T> {
  const { key, parse, fallback, live = false } = options
  const serialize = options.serialize ?? ((value: T) => String(value))
  const listeners = new Set<() => void>()

  const load = (): T => {
    try {
      return parse(localStorage.getItem(key))
    } catch {
      return fallback
    }
  }
  const write = (value: T): void => {
    try {
      localStorage.setItem(key, serialize(value))
    } catch {
      /* a blocked store keeps the choice for the session, or the default */
    }
  }

  // `always` parses again only when the stored string changed, so a value
  // that is an object keeps its identity between reads (a hook needs that).
  let seen: { raw: string | null; value: T } | null = null
  const readNow = (): T => {
    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch {
      return fallback
    }
    if (seen && seen.raw === raw) return seen.value
    let value: T
    try {
      value = parse(raw)
    } catch {
      value = fallback
    }
    seen = { raw, value }
    return value
  }

  let held: T = options.read === 'always' ? fallback : load()
  const get = options.read === 'always' ? readNow : (): T => held

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    // Another window's choice arrives as a storage event (windowPreferences).
    if (live) window.addEventListener('storage', listener)
    return () => {
      listeners.delete(listener)
      if (live) window.removeEventListener('storage', listener)
    }
  }

  return {
    key,
    scope: PREF_KEYS[key],
    get,
    set: (value) => {
      if (options.read !== 'always') held = value
      write(value)
      for (const l of [...listeners]) l()
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, get),
    reload: () => {
      if (options.read === 'always') seen = null
      else held = load()
    }
  }
}
