/**
 * A small in-memory cache that keeps the newest `max` entries and drops the
 * oldest (structure cleanup, 2026-10-12: the decoded HEIC, raw preview, image,
 * peaks, probe and Everything caches each had their own copy). A Map keeps
 * insertion order, so its first key is the oldest.
 *
 * `get` counts as a use and moves the entry to the newest end; `peek` reads
 * without that, for the caches that drop strictly oldest-written first.
 *
 * `weight` caps by SIZE as well as by count (review, 2026-10-16): six decoded
 * TIFF scans as RGBA PNGs were hundreds of MB pinned in main. An entry heavier
 * than the whole cap is not kept at all.
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

export function createLru<K, V>(
  max: number,
  weight?: { of: (value: V) => number; max: number }
): Lru<K, V> {
  const map = new Map<K, V>()
  let total = 0
  const drop = (key: K): boolean => {
    if (!map.has(key)) return false
    if (weight) total -= weight.of(map.get(key) as V)
    return map.delete(key)
  }
  const over = (): boolean => map.size > max || (!!weight && total > weight.max)
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
      drop(key)
      map.set(key, value)
      if (weight) total += weight.of(value)
      while (map.size > 0 && over()) drop(map.keys().next().value as K)
    },
    delete: drop,
    clear: () => {
      map.clear()
      total = 0
    },
    get size() {
      return map.size
    }
  }
}
