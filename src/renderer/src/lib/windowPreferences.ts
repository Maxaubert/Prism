import { validWindowPreferenceKey, type WindowPreferencesSnapshot } from '@shared/windowPreferences'

/** Runs before App imports, including stores that read preferences at module evaluation. */
function loadWindowPreferences(): void {
  const bridge = window.prism
  const storage = window.localStorage
  const prototype = Storage.prototype
  const marker = Symbol.for('prism.windowPreferences')
  if (Object.prototype.hasOwnProperty.call(prototype, marker)) return
  const nativeSet = prototype.setItem
  const nativeRemove = prototype.removeItem
  let snapshot = bridge.windowPreferencesLoad()
  if (!snapshot) return

  if (!snapshot.shared) {
    const seed: Record<string, string> = {}
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!validWindowPreferenceKey(key)) continue
      const value = storage.getItem(key)
      if (value !== null) seed[key] = value
    }
    // The main process merges individual keys, with canonical values and removals winning.
    snapshot = bridge.windowPreferencesSeed(seed) ?? snapshot
  }
  const apply = (next: WindowPreferencesSnapshot, notify: boolean): void => {
    const changes = new Map<string, string | null>()
    for (const [key, value] of Object.entries(next.values)) {
      if (validWindowPreferenceKey(key) && typeof value === 'string') changes.set(key, value)
    }
    for (const key of next.removed ?? []) {
      if (validWindowPreferenceKey(key)) changes.set(key, null)
    }
    for (const [key, newValue] of changes) {
      const oldValue = storage.getItem(key)
      if (oldValue === newValue) continue
      if (newValue === null) nativeRemove.call(storage, key)
      else nativeSet.call(storage, key, newValue)
      if (notify)
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            oldValue,
            newValue,
            storageArea: storage
          })
        )
    }
  }
  apply(snapshot, false)

  prototype.setItem = function (key: string, value: string): void {
    nativeSet.call(this, key, value)
    const name = String(key)
    if (this !== storage || !validWindowPreferenceKey(name)) return
    try {
      bridge.windowPreferencesSet({ key: name, value: String(value) })
    } catch {
      // A failed shared write must not break the current window's working preference.
    }
  }
  prototype.removeItem = function (key: string): void {
    nativeRemove.call(this, key)
    const name = String(key)
    if (this !== storage || !validWindowPreferenceKey(name)) return
    try {
      bridge.windowPreferencesSet({ key: name, value: null })
    } catch {
      // The native removal still applies locally if the shared store is unavailable.
    }
  }
  Object.defineProperty(prototype, marker, { value: true })
  bridge.onWindowPreferencesChanged((next) => {
    try {
      apply(next, true)
    } catch {
      /* Keep local preferences usable if storage is unavailable. */
    }
  })
  window.addEventListener('focus', () => {
    try {
      const next = bridge.windowPreferencesLoad()
      if (next) apply(next, true)
    } catch {
      /* The next focus or directory notification can retry. */
    }
  })
}

try {
  if (typeof window !== 'undefined' && typeof window.prism?.windowPreferencesLoad === 'function')
    loadWindowPreferences()
} catch {
  // Storage may be unavailable; existing stores retain their own defaults and error handling.
}
