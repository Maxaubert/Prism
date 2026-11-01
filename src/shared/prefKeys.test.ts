import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { PREF_KEYS, PREF_PREFIXES, RETIRED_PREF_KEYS, WINDOW_LOCAL_KEYS, retiredPrefKey } from './prefKeys'
import { validWindowPreferenceKey } from './windowPreferences'

// A key is a user's saved setting: renamed, it is lost. These are the strings
// as they shipped (2026-10-12); a change here is a change to what users keep.
const SHIPPED: Record<string, 'shared' | 'window'> = {
  'prism.explorer.places': 'window',
  'prism.explorer.widths': 'window',
  'prism.settings.rail': 'window',
  'prism.onboarded': 'shared',
  'prism.code.wrap': 'shared',
  'prism.explorer.rememberFolders': 'shared',
  'prism.explorer.side': 'shared',
  'prism.explorer.size': 'shared',
  'prism.folderIcons': 'shared',
  'prism.newtab.folder': 'shared',
  'prism.newtab.mode': 'shared',
  'prism.newtab.show': 'shared',
  'prism.open.external': 'shared',
  'prism.player.prefs': 'shared',
  'prism.quickAccess': 'shared',
  // Moved from the terminal core into src/renderer/src/lib/recentRoots (2026-10-26); same strings.
  'prism.recentRoots': 'shared',
  'prism.pinnedRoots': 'shared',
  'prism.sidebar.driveStyle': 'shared',
  'prism.slideshow.seconds': 'shared',
  // The I key's photo info card, on or off (#78, 2026-11-01).
  'prism.photoInfo': 'shared',
  'prism.sort': 'shared',
  'prism.tabs.remember': 'shared',
  'prism.transport.bg': 'shared',
  'prism.transport.style': 'shared',
  'prism.tree.size': 'shared',
  'prism.window.tabWidth': 'shared',
  'prism.window.titleBar': 'shared',
  'prism.mode': 'shared',
  'prism.style': 'shared',
  'prism.style.draft': 'shared',
  'prism.style.presets': 'shared',
  'prism.style.retired': 'shared',
  'prism.style.v': 'shared',
  'prism.viz.barCycle': 'shared',
  'prism.viz.barGlow': 'shared',
  'prism.viz.barMove': 'shared',
  'prism.viz.barTheme': 'shared',
  'prism.viz.cycle': 'shared',
  'prism.viz.drop': 'shared',
  'prism.viz.followsTheme': 'shared',
  'prism.viz.glow': 'shared',
  'prism.viz.height': 'shared',
  'prism.viz.logo': 'shared',
  'prism.viz.move': 'shared',
  'prism.viz.pos': 'shared',
  'prism.viz.presets': 'shared',
  'prism.viz.presetsSeed': 'shared',
  'prism.viz.removedThemes': 'shared',
  'prism.viz.style': 'shared',
  'prism.viz.theme': 'shared',
  'prism.viz.width': 'shared'
}

// Retired (2026-10-28): read by nothing since the terminal, the tree and the
// project tabs went. Pinned as they shipped, so the cleanup deletes exactly
// these and never a live key that shares their prefix.
const RETIRED = [
  'prism.sidebar',
  'prism.sidebar.width',
  'prism.split.dir',
  'prism.tabs.confirmClose',
  'prism.term.acrylic',
  'prism.term.agentColor',
  'prism.term.agentDoneColor',
  'prism.term.agentIndicator',
  'prism.term.agentQuestionColor',
  'prism.term.custom',
  'prism.term.dock',
  'prism.term.font',
  'prism.term.fontPct',
  'prism.term.h',
  'prism.term.opacity',
  'prism.term.shell',
  'prism.term.theme',
  'prism.term.w',
  'prism.tree.side'
]

/** Every source file under a folder, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sources(path)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : []
  })
}

describe('prefKeys', () => {
  it('keeps every key and its scope as they shipped', () => {
    expect(PREF_KEYS).toEqual(SHIPPED)
    expect(PREF_PREFIXES).toEqual({
      'prism.docpos.': 'window',
      'prism.resume.': 'window',
      'prism.phone.': 'window'
    })
  })

  it('derives the window-local list the sync used to spell out', () => {
    expect([...WINDOW_LOCAL_KEYS].sort()).toEqual(
      [
        'prism.explorer.places',
        'prism.explorer.widths',
        'prism.settings.rail'
      ].sort()
    )
    for (const [key, scope] of Object.entries(PREF_KEYS))
      expect(validWindowPreferenceKey(key), key).toBe(scope === 'shared')
    for (const prefix of Object.keys(PREF_PREFIXES))
      expect(validWindowPreferenceKey(`${prefix}item`)).toBe(false)
  })

  it('retires exactly the dead keys, and none of them syncs', () => {
    expect([...RETIRED_PREF_KEYS]).toEqual(RETIRED)
    for (const key of RETIRED) {
      expect(key in PREF_KEYS, key).toBe(false)
      expect(retiredPrefKey(key)).toBe(true)
      expect(validWindowPreferenceKey(key), key).toBe(false)
    }
    // Live keys that only look like the retired ones.
    for (const key of ['prism.term.colourFormat', 'prism.tree.size', 'prism.sidebar.driveStyle']) {
      expect(retiredPrefKey(key), key).toBe(false)
      expect(validWindowPreferenceKey(key), key).toBe(true)
    }
  })

  it('has every prism.* key the renderer and main name', () => {
    const root = join(__dirname, '..')
    const named = new Set<string>()
    for (const file of [...sources(join(root, 'renderer', 'src')), ...sources(join(root, 'main')), ...sources(__dirname)]) {
      for (const m of readFileSync(file, 'utf8').matchAll(/['"`](prism\.[A-Za-z0-9_.]+)['"`]/g)) named.add(m[1])
    }
    // The scan sees the keys at all (the main process names this one).
    expect(named.has('prism.tabs.remember')).toBe(true)
    // Not storage keys: the window preferences' Symbol.for marker and the exe.
    named.delete('prism.windowPreferences')
    named.delete('prism.exe')
    const unknown = [...named].filter(
      (key) =>
        !(key in PREF_KEYS) &&
        !retiredPrefKey(key) &&
        !Object.keys(PREF_PREFIXES).some((prefix) => key === prefix || key.startsWith(prefix)) &&
        key !== 'prism.'
    )
    expect(unknown, 'add each to src/shared/prefKeys.ts').toEqual([])
  })
})
