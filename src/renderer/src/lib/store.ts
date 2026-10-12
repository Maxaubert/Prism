import { useSyncExternalStore } from 'react'

/**
 * A value in module state that components can follow (structure cleanup,
 * 2026-10-12): the jobs chip, the extraction window and the cut mark each
 * hold one. A saved setting is `prefs/createPref.ts` instead. `set` always tells the listeners, so a caller that
 * wants "only on change" checks before it sets, as the reducers do.
 */
export interface Store<T> {
  get: () => T
  set: (next: T) => void
  /** Tell the listeners without a new value (something they read changed). */
  notify: () => void
  subscribe: (listener: () => void) => () => void
  /** The hook: the component renders again whenever the store is set. */
  use: () => T
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const get = (): T => value
  const notify = (): void => {
    for (const l of [...listeners]) l()
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return {
    get,
    set: (next) => {
      value = next
      notify()
    },
    notify,
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, get)
  }
}
