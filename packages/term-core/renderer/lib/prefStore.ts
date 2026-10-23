import { useSyncExternalStore } from 'react'

/**
 * ONE SETTING IN localStorage, WITH ITS LISTENERS (audit 2026-10-12: about
 * fourteen modules each wrote the same listener list, the same subscribe and
 * the same reads, some defensive and some not). A store that throws (blocked
 * or full) loses the choice, never the app: reads fall back to the default,
 * writes are dropped and still announced.
 *
 * The keys are passed in byte for byte as they were: a saved choice keeps
 * meaning what it meant.
 */
export interface Pref<T> {
  get: () => T
  set: (v: T) => void
  onChange: (cb: () => void) => () => void
  use: () => T
}

/** The raw store, defensively. */
export const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export const writePref = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* a full or blocked store loses the setting, not the app */
  }
}

function store<T>(key: string, read: (raw: string | null) => T, write: (v: T) => string): Pref<T> {
  const listeners = new Set<() => void>()
  const get = (): T => read(readPref(key))
  const onChange = (cb: () => void): (() => void) => {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }
  return {
    get,
    set: (v) => {
      writePref(key, write(v))
      listeners.forEach((l) => l())
    },
    onChange,
    use: () => useSyncExternalStore(onChange, get)
  }
}

/** One of a closed set of words; anything else stored reads as `fallback`. */
export function enumPref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): Pref<T> & { valid: (v: unknown) => T } {
  const valid = (v: unknown): T => ((allowed as readonly unknown[]).includes(v) ? (v as T) : fallback)
  return { ...store(key, valid, (v) => valid(v)), valid }
}

/** On or off, stored '1' / '0'. Anything else stored reads as the default. */
export function boolPref(key: string, defaultOn: boolean): Pref<boolean> {
  return store(
    key,
    (raw) => (defaultOn ? raw !== '0' : raw === '1'),
    (on) => (on ? '1' : '0')
  )
}
