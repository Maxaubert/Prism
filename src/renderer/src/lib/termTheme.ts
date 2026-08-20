import { deriveAnsi, type Ansi16 } from './termAnsi'

// The terminal wears the style. Styles publish their surfaces as CSS custom
// properties on :root (--p-bg, --p-text, --p-accent-hi), so the terminal reads
// those instead of owning colours: the void style gets a black terminal, a
// light style gets a light one, and a style switch restyles running shells.

export interface TermTheme extends Partial<Ansi16> {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

/** Pure: style surfaces in, xterm theme out. Fallbacks are the app's default
 *  dark, for the moment before the style has painted. */
export function buildTermTheme(bg: string, text: string, accent: string): TermTheme {
  const b = bg.trim() || '#0b0b0f'
  const t = text.trim() || '#d7dae1'
  const a = accent.trim() || '#5b5bd6'
  // The ANSI sixteen are DERIVED from the base, not assumed: edit a style's
  // background toward red and red text adapts instead of vanishing into it.
  return { background: b, foreground: t, cursor: a, selectionBackground: `${a}55`, ...deriveAnsi(b, t) }
}

/** What the current style says, right now. */
export function readTermTheme(): TermTheme {
  const cs = getComputedStyle(document.documentElement)
  return buildTermTheme(
    cs.getPropertyValue('--p-bg'),
    cs.getPropertyValue('--p-text'),
    cs.getPropertyValue('--p-accent-hi')
  )
}

/** Call `cb` whenever the style repaints :root. Returns the stop function. */
export function watchTermTheme(cb: (t: TermTheme) => void): () => void {
  const mo = new MutationObserver(() => cb(readTermTheme()))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  return () => mo.disconnect()
}

/**
 * Preset terminal themes, whole palettes each. Presets rather than variants
 * of the app styles on purpose: a style's material (acrylic, mica, gradients)
 * does not translate into a terminal palette, so half-derived themes looked
 * wrong. 'style' - the default - is not in this list; it means readTermTheme.
 */
export interface TermPreset {
  id: string
  name: string
  bg: string
  fg: string
  cursor: string
  /** A curated full palette (extracted from Tabby's schemes, or the user's
   *  own). Absent, the sixteen are derived from bg/fg by the engine. */
  ansi?: Ansi16
}

/**
 * Preset terminal themes, two kinds. The first block is EXTRACTED palettes -
 * the user's own Bright Lights (from their Tabby config) and a pick of
 * Tabby's community schemes, exact colours kept. The second block is BASES:
 * background/foreground/cursor only, their sixteen derived by the same
 * engine the follow-style path uses. Names are the terminal's own,
 * deliberately not the app styles' names.
 */
export const TERM_PRESETS: TermPreset[] = [
  {
    id: 'bright-lights',
    name: 'Bright Lights',
    bg: '#000000',
    fg: '#ffffff',
    cursor: '#f34b00',
    ansi: { black: '#191919', red: '#ff355b', green: '#b7e876', yellow: '#ffc251', blue: '#ef5350', magenta: '#ba76e7', cyan: '#6cbfb5', white: '#c2c8d7', brightBlack: '#191919', brightRed: '#ff355b', brightGreen: '#b7e876', brightYellow: '#ffc251', brightBlue: '#76d5ff', brightMagenta: '#ba76e7', brightCyan: '#6cbfb5', brightWhite: '#c2c8d7' }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    bg: '#1e1f29',
    fg: '#f8f8f2',
    cursor: '#bbbbbb',
    ansi: { black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bbbbbb', brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#50fa7b', brightYellow: '#f1fa8c', brightBlue: '#bd93f9', brightMagenta: '#ff79c6', brightCyan: '#8be9fd', brightWhite: '#ffffff' }
  },
  {
    id: 'nord',
    name: 'Nord',
    bg: '#2e3440',
    fg: '#d8dee9',
    cursor: '#d8dee9',
    ansi: { black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#373e4d', brightRed: '#94545d', brightGreen: '#809575', brightYellow: '#b29e75', brightBlue: '#68809a', brightMagenta: '#8c738c', brightCyan: '#6d96a5', brightWhite: '#aeb3bb' }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    bg: '#1e1e1e',
    fg: '#e6d4a3',
    cursor: '#bbbbbb',
    ansi: { black: '#161819', red: '#f73028', green: '#aab01e', yellow: '#f7b125', blue: '#719586', magenta: '#c77089', cyan: '#7db669', white: '#faefbb', brightBlack: '#7f7061', brightRed: '#be0f17', brightGreen: '#868715', brightYellow: '#cc881a', brightBlue: '#377375', brightMagenta: '#a04b73', brightCyan: '#578e57', brightWhite: '#e6d4a3' }
  },
  {
    id: 'tokyonight',
    name: 'TokyoNight',
    bg: '#1a1b26',
    fg: '#c0caf5',
    cursor: '#c0caf5',
    ansi: { black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' }
  },
  {
    id: 'molokai',
    name: 'Molokai',
    bg: '#121212',
    fg: '#bbbbbb',
    cursor: '#bbbbbb',
    ansi: { black: '#121212', red: '#fa2573', green: '#98e123', yellow: '#dfd460', blue: '#1080d0', magenta: '#8700ff', cyan: '#43a8d0', white: '#bbbbbb', brightBlack: '#555555', brightRed: '#f6669d', brightGreen: '#b1e05f', brightYellow: '#fff26d', brightBlue: '#00afff', brightMagenta: '#af87ff', brightCyan: '#51ceff', brightWhite: '#ffffff' }
  },
  {
    id: 'argonaut',
    name: 'Argonaut',
    bg: '#0e1019',
    fg: '#fffaf4',
    cursor: '#ff0018',
    ansi: { black: '#232323', red: '#ff000f', green: '#8ce10b', yellow: '#ffb900', blue: '#008df8', magenta: '#6d43a6', cyan: '#00d8eb', white: '#ffffff', brightBlack: '#444444', brightRed: '#ff2740', brightGreen: '#abe15b', brightYellow: '#ffd242', brightBlue: '#0092ff', brightMagenta: '#9a5feb', brightCyan: '#67fff0', brightWhite: '#ffffff' }
  },
  {
    id: 'afterglow',
    name: 'Afterglow',
    bg: '#212121',
    fg: '#d0d0d0',
    cursor: '#d0d0d0',
    ansi: { black: '#151515', red: '#ac4142', green: '#7e8e50', yellow: '#e5b567', blue: '#6c99bb', magenta: '#9f4e85', cyan: '#7dd6cf', white: '#d0d0d0', brightBlack: '#505050', brightRed: '#ac4142', brightGreen: '#7e8e50', brightYellow: '#e5b567', brightBlue: '#6c99bb', brightMagenta: '#9f4e85', brightCyan: '#7dd6cf', brightWhite: '#f5f5f5' }
  },
  {
    id: 'rose-pine',
    name: 'Rose Pine',
    bg: '#191724',
    fg: '#e0def4',
    cursor: '#555169',
    ansi: { black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4', brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4' }
  },
  { id: 'pitch', name: 'Pitch', bg: '#000000', fg: '#e6e6e6', cursor: '#ffffff' },
  { id: 'ink', name: 'Ink', bg: '#0d1117', fg: '#dbe2ea', cursor: '#7aa5d8' },
  { id: 'cinder', name: 'Cinder', bg: '#191214', fg: '#e8dcd8', cursor: '#e0955e' },
  { id: 'denim', name: 'Denim', bg: '#142033', fg: '#d9e4f2', cursor: '#8fb7e8' },
  { id: 'paper', name: 'Paper', bg: '#f6f4ee', fg: '#2a2620', cursor: '#3a63c2' }
]

/** The theme the settings say, resolved: a preset by id, else follow-style. */
export function resolveTermTheme(themeId: string): TermTheme {
  const p = TERM_PRESETS.find((x) => x.id === themeId)
  if (!p) return readTermTheme() // unknown ids (old saves) follow the style
  return {
    background: p.bg,
    foreground: p.fg,
    cursor: p.cursor,
    selectionBackground: `${p.cursor}55`,
    // A curated palette is taste and stays exact; only base-only presets get
    // the derived sixteen.
    ...(p.ansi ?? deriveAnsi(p.bg, p.fg))
  }
}
