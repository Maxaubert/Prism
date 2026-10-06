import { RETIRED_MAP, retiredById } from './retired'

/**
 * SAVED THEMES MOVE ONCE (#298, spec 4). The ten styles Prism shipped were
 * replaced by the 18 themes, so a saved id that named a retired style is
 * mapped, deliberately, to its nearest new theme: nobody lands on the default
 * in silence. Runs ONCE, synchronously, at `theme.ts`'s import, before the
 * first paint; the marker `prism.style.v` is a synced preference, so a second
 * window finds it done.
 *
 * What it keeps: the unsaved edits (the draft) as they are, now sitting on the
 * mapped theme; every own copy field for field, with its `base` mapped so a
 * delete lands on a theme that exists; the visualizer's and the progress
 * bar's colours, which are the user's. Onyx's glass is carried over as an
 * unsaved edit of Void, since taking the see-through away unasked would be a
 * second decision hidden in the first. It never touches the terminal's theme
 * (it writes ids, it never calls `setStyle`), and it does not READ
 * `prism.mode`: Colour mode only ever filtered the wall.
 */

export const STYLE_KEY = 'prism.style'
export const DRAFT_KEY = 'prism.style.draft'
export const PRESETS_KEY = 'prism.style.presets'
export const VERSION_KEY = 'prism.style.v'
/** The retired theme's NAME, for the one quiet line on the Themes card. */
export const RETIRED_KEY = 'prism.style.retired'
export const THEME_VERSION = '2'

/**
 * Onyx's place on the old Acrylic slider: its glass was the acrylic dark
 * default, 0.55, which the slider (0.85 down to 0.30 over 100 steps) put at
 * 55. `migrate.test.ts` holds it to `acrylicLevel` of the retired Onyx.
 */
export const ONYX_LEVEL = Math.round(((0.85 - (retiredById('default')?.glass ?? 0.55)) / 0.55) * 100)

export type StorageSnapshot = Record<string, string | null | undefined>

export interface Migration {
  set: Record<string, string>
  remove: string[]
}

const parse = (raw: string | null | undefined): unknown => {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** What to write, from a snapshot of the keys. Pure. */
export function migrateThemes(snap: StorageSnapshot): Migration {
  const out: Migration = { set: {}, remove: [] }
  if (snap[VERSION_KEY] === THEME_VERSION) return out
  out.set[VERSION_KEY] = THEME_VERSION

  const saved = snap[STYLE_KEY]
  const mapped = typeof saved === 'string' ? RETIRED_MAP[saved] : undefined
  if (saved && mapped) {
    out.set[STYLE_KEY] = mapped
    const was = retiredById(saved)
    if (was) out.set[RETIRED_KEY] = was.name
    if (saved === 'default') {
      // Onyx was glass: Void carries it as an unsaved edit, unless the draft
      // already says how much glass (or none) the user wanted.
      const raw = parse(snap[DRAFT_KEY])
      const draft = isRecord(raw) ? { ...raw } : {}
      if (typeof draft.acrylic !== 'number') {
        draft.acrylic = ONYX_LEVEL
        out.set[DRAFT_KEY] = JSON.stringify(draft)
      }
    }
  }

  // Own copies: every field kept, their `base` mapped.
  const presets = parse(snap[PRESETS_KEY])
  if (Array.isArray(presets)) {
    let changed = false
    const next = presets.map((p) => {
      if (isRecord(p) && typeof p.base === 'string' && RETIRED_MAP[p.base]) {
        changed = true
        return { ...p, base: RETIRED_MAP[p.base] }
      }
      return p
    })
    if (changed) out.set[PRESETS_KEY] = JSON.stringify(next)
  }
  return out
}

/** The store's half: read the keys, write what the migration says. */
export function migrateThemeStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Migration {
  const snap: StorageSnapshot = {}
  for (const k of [STYLE_KEY, DRAFT_KEY, PRESETS_KEY, VERSION_KEY]) snap[k] = storage.getItem(k)
  const m = migrateThemes(snap)
  // The marker last, so a write that throws half way is tried again.
  for (const [k, v] of Object.entries(m.set)) if (k !== VERSION_KEY) storage.setItem(k, v)
  for (const k of m.remove) storage.removeItem(k)
  if (m.set[VERSION_KEY]) storage.setItem(VERSION_KEY, m.set[VERSION_KEY])
  return m
}
