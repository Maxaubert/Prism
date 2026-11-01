/**
 * EVERY `prism.*` KEY THE RENDERER KEEPS IN localStorage, AND WHO SEES IT
 * (structure cleanup, 2026-10-12). One table, so the pref stores, the window
 * preferences sync and main agree on the names. A key here is a user's saved
 * setting: renaming one loses it, so the strings never change
 * (`prefKeys.test.ts` pins them).
 *
 * `shared` travels between windows (the window preferences store mirrors it to
 * every Prism window and main reads it); `window` stays in the window that set
 * it: its layout, which is that window's own.
 */
export type PrefScope = 'shared' | 'window'

export const PREF_KEYS = {
  // Layout of this window.
  'prism.explorer.places': 'window',
  'prism.explorer.widths': 'window',
  'prism.settings.rail': 'window',
  // Settings.
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
  'prism.photoInfo': 'shared',
  'prism.pinnedRoots': 'shared',
  'prism.player.prefs': 'shared',
  'prism.quickAccess': 'shared',
  'prism.recentRoots': 'shared',
  'prism.sidebar.driveStyle': 'shared',
  'prism.slideshow.seconds': 'shared',
  'prism.sort': 'shared',
  'prism.tabs.remember': 'shared',
  'prism.transport.bg': 'shared',
  'prism.transport.style': 'shared',
  'prism.tree.size': 'shared',
  'prism.window.tabWidth': 'shared',
  'prism.window.titleBar': 'shared',
  // The look: theme.ts and vizStore.ts keep their own stores.
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
} as const satisfies Record<string, PrefScope>

export type PrefKey = keyof typeof PREF_KEYS

/**
 * Keys nothing reads any more: the terminal, the sidebar tree and the split
 * panes went with #439 and the project tabs (2026-10-26). They stay named
 * here so they stop travelling (2026-10-28, performance review: "things that
 * use up too many resources"): the window preferences sync refuses them, main
 * deletes their files from the store once per run, and each window drops them
 * from its localStorage. An EXPLICIT list, never a prism.term prefix: the
 * colour picker's format (core colourFormat.ts) lives under that prefix, and
 * the tree size and the sidebar drive style are live despite their names.
 */
export const RETIRED_PREF_KEYS: readonly string[] = [
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

const RETIRED: ReadonlySet<string> = new Set(RETIRED_PREF_KEYS)

/** True for a key on the retired list above. */
export function retiredPrefKey(key: string): boolean {
  return RETIRED.has(key)
}

/** Families of keys, one per item: reading progress, the player's legacy
 *  resume points, and the phone page's own token and view. None travels. */
export const PREF_PREFIXES = {
  'prism.docpos.': 'window',
  'prism.resume.': 'window',
  'prism.phone.': 'window'
} as const satisfies Record<string, PrefScope>

/** The keys that stay in their window, derived from the table above. */
export const WINDOW_LOCAL_KEYS: ReadonlySet<string> = new Set(
  Object.entries(PREF_KEYS)
    .filter(([, scope]) => scope === 'window')
    .map(([key]) => key)
)

export const WINDOW_LOCAL_PREFIXES: readonly string[] = Object.entries(PREF_PREFIXES)
  .filter(([, scope]) => scope === 'window')
  .map(([prefix]) => prefix)
