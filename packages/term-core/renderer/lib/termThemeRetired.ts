// THEMES THAT WERE RETIRED, AND WHERE THEIR WEARERS GO (owner, 2026-09-23:
// "clean up the themes. there's too many similar themes"). A theme id is a
// saved-settings key, in both apps; a retired one must not drop somebody onto
// the host's default, which may look nothing like what they chose. Each maps
// to the kept theme nearest in ground and mood. Read where the id is read
// (`termThemeId`), so the wall shows the right card, and where it is resolved.

export const RETIRED_THEMES: Readonly<Record<string, string>> = {
  'bright-lights': 'pitch',
  // High Contrast removed (owner, 2026-10-11); Pitch is the black kept.
  'high-contrast': 'pitch',
  // Solarized Dark, Gruvbox Dark and Tokyo Night came BACK in the forty
  // (2026-09-24), so they are no longer here.
  molokai: 'monokai',
  jellybeans: 'graphite',
  wombat: 'pt-default',
  hybrid: 'graphite',
  'monokai-soda': 'monokai',
  'jetbrains-darcula': 'graphite',
  afterglow: 'graphite',
  materialdark: 'graphite',
  onehalfdark: 'prism',
  espresso: 'umber',
  zenburn: 'moss',
  onehalflight: 'paper',
  'ayu-light': 'paper',
  github: 'paper',
  'tokyonight-day': 'mist',
  'rose-pine-dawn': 'blossom',
  'solarized-light': 'fawn',
  'night-owl': 'tokyonight',
  ayu: 'prism',
  denim: 'prism',
  spacegray: 'nord',
  argonaut: 'prism',
  iceberg: 'nord',
  'tokyonight-storm': 'tokyonight',
  adventuretime: 'prism',
  'rose-pine-moon': 'rosewood',
  'rose-pine': 'rosewood',
  ubuntu: 'rosewood',
  // Ink made way for Volt (2026-09-28); Prism is the black nearest it.
  ink: 'prism'
}

/** The id to use for `id`: its replacement when it was retired, else itself. */
export const liveThemeId = (id: string): string => RETIRED_THEMES[id] ?? id
