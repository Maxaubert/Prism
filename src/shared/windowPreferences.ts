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

const LOCAL_KEYS = new Set([
  'prism.sidebar',
  'prism.sidebar.width',
  'prism.explorer.places',
  'prism.explorer.widths',
  'prism.settings.rail',
  'prism.term.h',
  'prism.term.w'
])

/** Preferences travel between windows; layout, reading progress and phone credentials do not. */
export function validWindowPreferenceKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length > 6 &&
    key.length <= 200 &&
    key.startsWith('prism.') &&
    !LOCAL_KEYS.has(key) &&
    !['prism.docpos.', 'prism.resume.', 'prism.phone.'].some((prefix) => key.startsWith(prefix))
  )
}
