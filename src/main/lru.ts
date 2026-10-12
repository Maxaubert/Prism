/**
 * A small in-memory cache that keeps the newest `max` entries and drops the
 * oldest (structure cleanup, 2026-10-12: the decoded HEIC, raw preview, image,
 * peaks, probe and Everything caches each had their own copy). A Map keeps
 * insertion order, so its first key is the oldest.
 *
 * `get` counts as a use and moves the entry to the newest end; `peek` reads
 * without that, for the caches that drop strictly oldest-written first.
 */
export interface Lru<K, V> {
  get(key: K): V | undefined
  peek(key: K): V | undefined
  /** Adds or replaces the entry as the newest, then drops the oldest past `max`. */
  set(key: K, value: V): void
  delete(key: K): boolean
  clear(): void
  readonly size: number
}

export function createLru<K, V>(max: number): Lru<K, V> {
  const map = new Map<K, V>()
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key) as V
      map.delete(key)
      map.set(key, value)
      return value
    },
    peek: (key) => map.get(key),
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > max) map.delete(map.keys().next().value as K)
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size
    }
  }
}
