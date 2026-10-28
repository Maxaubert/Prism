import { WINDOW_LOCAL_KEYS, WINDOW_LOCAL_PREFIXES, retiredPrefKey } from './prefKeys'

export interface WindowPreferencesSnapshot {
  values: Record<string, string>
  /** Independent Explorer profiles load the primary profile's preferences without seeding. */
  shared: boolean
  /** Explicit removals prevent an older profile from restoring a deleted preference. */
  removed?: string[]
}

export interface WindowPreferenceChange {
  key: string
  value: string | null
}

/** Preferences travel between windows; layout, reading progress, phone credentials and
 *  retired keys (prefKeys.ts) do not. */
export function validWindowPreferenceKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length > 6 &&
    key.length <= 200 &&
    key.startsWith('prism.') &&
    !WINDOW_LOCAL_KEYS.has(key) &&
    !retiredPrefKey(key) &&
    !WINDOW_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))
  )
}
